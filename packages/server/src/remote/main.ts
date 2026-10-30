#!/usr/bin/env node
/*
 * Remote mode: MCP over Streamable HTTP with OAuth 2.1, accounts, editor with login, Postgres.
 *   node dist/remote.js            (configuration via environment variables, see .env.example)
 */
import type { Server } from "node:http";
import { DiskBlobStore, S3BlobStore, type BlobStore } from "../blobs.js";
import { importExamples } from "../examples.js";
import { Previewer } from "../preview.js";
import { PresentationService, createEvents } from "../service.js";
import { Accounts } from "./accounts.js";
import { createRemoteApp, type RemoteContext } from "./app.js";
import { loadRemoteConfig, type RemoteConfig } from "./config.js";
import { generateJwtKeyPem, loadJwtKeys, publicJwk, randomToken } from "./crypto.js";
import { createMailer, type Mailer } from "./mailer.js";
import { Metrics, RateLimiter, log } from "./observability.js";
import { OAuthServer } from "./oauth.js";
import { PgPresentationRepo } from "./pg-repo.js";
import { metaOnce, migrate, openSql } from "./sql.js";

export interface RemoteRuntime {
  ctx: RemoteContext;
  server: Server;
  url: string;
  close(): Promise<void>;
}

export async function startRemote(
  config: RemoteConfig,
  opts: { mailer?: Mailer; listen?: boolean } = {},
): Promise<RemoteRuntime> {
  const sql = await openSql(config.databaseUrl);
  await retry(() => migrate(sql), 10);
  const pem = config.jwtPrivateKey ?? (await metaOnce(sql, "jwt_private_key", generateJwtKeyPem));
  const keys = loadJwtKeys(pem);
  const signingKey =
    config.signingKey ?? (await metaOnce(sql, "signing_key", () => randomToken(32)));
  let blobs: BlobStore;
  if (config.blobs.driver === "s3") {
    const s3 = new S3BlobStore(config.blobs);
    if (config.blobs.createBucket) await retry(() => s3.ensureBucket(), 10);
    blobs = s3;
  } else {
    blobs = new DiskBlobStore(config.blobs.dir);
  }
  const mailer = opts.mailer ?? createMailer(config);
  const accounts = new Accounts(sql, mailer, config, blobs);
  const ctx: RemoteContext = {
    config,
    sql,
    blobs,
    accounts,
    oauth: new OAuthServer(sql, config, keys),
    mailer,
    signingKey,
    jwk: publicJwk(keys),
    previewer: new Previewer(),
    events: createEvents(),
    metrics: new Metrics(),
    limiter: new RateLimiter(),
  };

  if (config.demo) {
    const { user, created } = await accounts.ensureDemo(config.demo.email, config.demo.password);
    if (created) {
      const svc = new PresentationService(new PgPresentationRepo(sql, blobs, user.id), config, {
        editor: () => "",
        download: () => "",
        present: () => "",
      });
      await importExamples(svc);
      log("demo_account_created", { email: config.demo.email });
    }
  }

  const app = createRemoteApp(ctx);
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(opts.listen === false ? 0 : config.listenPort, config.listenHost);
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  });
  // Long MCP calls (preview) must not be cut by default timeouts; keep-alive below typical LB idle.
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 65_000;
  const addr = server.address();
  const url = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : config.publicUrl;

  return {
    ctx,
    server,
    url,
    async close() {
      // close() waits for open connections (keep-alive, MCP SSE streams): drop idle ones now and
      // give in-flight requests 2 s before cutting the rest.
      const closed = new Promise<void>((r) => server.close(() => r()));
      server.closeIdleConnections();
      const force = setTimeout(() => server.closeAllConnections(), 2000);
      await closed;
      clearTimeout(force);
      await ctx.previewer.close();
      await sql.close();
    },
  };
}

async function retry<T>(fn: () => Promise<T>, times: number): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= times) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function main(): Promise<void> {
  const config = loadRemoteConfig();
  const rt = await startRemote(config);
  log("started", {
    publicUrl: config.publicUrl,
    port: config.listenPort,
    db: config.databaseUrl.split(":")[0],
    blobs: config.blobs.driver,
    mail: config.mail.driver,
    dev: config.dev,
  });
  console.error(
    `\n${config.productName} remoto em ${config.publicUrl}\n  MCP: ${config.publicUrl}/mcp\n  Editor: ${config.publicUrl}/\n`,
  );
  const stop = async () => {
    log("stopping");
    await rt.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

if (process.argv[1] && /remote(\.js|\/main\.ts)$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
