import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import type { Config } from "./config.js";
import { createHttpApp } from "./http.js";
import { Previewer } from "./preview.js";
import { PresentationService, type Links } from "./service.js";
import { SqliteDatabase } from "./store.js";

export interface Runtime {
  service: PresentationService;
  previewer: Previewer;
  token: string;
  /** Base URL of the editor currently serving this data folder. */
  base(): string;
  /** Whether this process hosts the HTTP server. */
  ownsHttp(): boolean;
  close(): Promise<void>;
}

/** The session token is shared by every process using the same data folder (0600 file). */
function loadOrCreateToken(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "token");
  if (existsSync(file)) {
    const t = readFileSync(file, "utf8").trim();
    if (t.length >= 32) return t;
  }
  const t = randomBytes(24).toString("base64url");
  writeFileSync(file, t, { mode: 0o600 });
  chmodSync(file, 0o600);
  return t;
}

async function healthOf(port: number): Promise<{ app?: string; home?: string } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok ? ((await res.json()) as { app?: string; home?: string }) : null;
  } catch {
    return null;
  }
}

function boundPort(server: Server, fallback: number): number {
  const addr = server.address();
  return typeof addr === "object" && addr ? addr.port : fallback;
}

function makeLinks(base: () => string, token: string): Links {
  return {
    editor: (id, slide) => `${base()}/p/${id}?${slide ? `slide=${slide}&` : ""}t=${token}`,
    download: (id) => `${base()}/api/presentations/${id}/export.html?download=1&t=${token}`,
    present: (id) => `${base()}/api/presentations/${id}/export.html?t=${token}`,
    pptx: (id) => `${base()}/api/presentations/${id}/export.pptx?t=${token}`,
  };
}

/**
 * Starts storage, the service and (unless another process already serves this data folder)
 * the local HTTP server for the editor. Several AI sessions can run at once: the first one hosts
 * the editor on the preferred port and the others reuse it, taking over if it goes away.
 */
export async function startRuntime(
  config: Config,
  opts: { http?: boolean } = {},
): Promise<Runtime> {
  const db = new SqliteDatabase(config.dataDir);
  const token = loadOrCreateToken(config.dataDir);
  let port = config.port;
  let server: Server | null = null;
  const base = () => `http://127.0.0.1:${port}`;
  const service = new PresentationService(db.scoped("local"), config, makeLinks(base, token));
  const previewer = new Previewer();
  const app = createHttpApp({
    service,
    previewer,
    token,
    hosts: () => [`127.0.0.1:${port}`, `localhost:${port}`],
  });

  const listen = (p: number) =>
    new Promise<Server>((resolve, reject) => {
      const s = app.listen(p, config.host);
      s.once("listening", () => resolve(s));
      s.once("error", reject);
    });

  const ensureHttp = async (): Promise<void> => {
    if (server) return;
    try {
      server = await listen(config.port);
      port = boundPort(server, config.port);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
    const h = await healthOf(config.port);
    if (h?.app === "apresenta" && h.home === config.home) {
      port = config.port; // another session already serves this folder
      return;
    }
    server = await listen(0);
    port = boundPort(server, port);
  };

  let watchdog: NodeJS.Timeout | null = null;
  if (opts.http !== false) {
    await ensureHttp();
    watchdog = setInterval(() => {
      if (server) return;
      void healthOf(config.port).then((h) => {
        if (!h) void ensureHttp().catch(() => undefined);
      });
    }, 10_000);
    watchdog.unref();
  }

  return {
    service,
    previewer,
    token,
    base,
    ownsHttp: () => server !== null,
    async close() {
      if (watchdog) clearInterval(watchdog);
      await previewer.close();
      await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
      db.close();
    },
  };
}
