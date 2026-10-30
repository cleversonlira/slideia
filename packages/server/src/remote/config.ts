import { resolve } from "node:path";
import { loadConfig, type Config } from "../config.js";
import type { S3Options } from "../blobs.js";

export interface StaticClient {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name?: string;
}

export interface RemoteConfig extends Config {
  /** Public base URL, without trailing slash (https in production). */
  publicUrl: string;
  listenHost: string;
  listenPort: number;
  databaseUrl: string;
  blobs: { driver: "disk"; dir: string } | ({ driver: "s3" } & S3Options);
  /** PEM (PKCS#8, EC P-256). Generated and stored in the database when absent. */
  jwtPrivateKey?: string | undefined;
  /** HMAC key for signed links and CSRF. Generated and stored when absent. */
  signingKey?: string | undefined;
  mail: {
    driver: "console" | "smtp" | "resend";
    from: string;
    smtpUrl?: string | undefined;
    resendApiKey?: string | undefined;
  };
  google?: { clientId: string; clientSecret: string } | undefined;
  openaiChallenge?: string | undefined;
  demo?: { email: string; password: string } | undefined;
  staticClients: StaticClient[];
  /** Development conveniences: e-mail links shown on screen, http public URL, private CIMD hosts. */
  dev: boolean;
  trustProxy: boolean;
  metricsToken?: string | undefined;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  /** Lifetime of signed download/present links (seconds). */
  linkTtl: number;
  supportEmail: string;
  productName: string;
  /** Data controller named in the privacy policy and terms (a person or company). */
  operatorName: string | null;
}

function required(env: NodeJS.ProcessEnv, key: string, fallback?: string): string {
  const v = env[key] ?? fallback;
  if (!v) throw new Error(`Missing environment variable ${key}`);
  return v;
}

export function loadRemoteConfig(env: NodeJS.ProcessEnv = process.env): RemoteConfig {
  const dev =
    env.APRESENTA_DEV === "1" || env.NODE_ENV === "development" || env.NODE_ENV === "test";
  const port = Number(env.PORT ?? 8787);
  const publicUrl = required(
    env,
    "PUBLIC_URL",
    dev ? `http://localhost:${port}` : undefined,
  ).replace(/\/+$/, "");
  if (!dev && !publicUrl.startsWith("https://"))
    throw new Error("PUBLIC_URL must use https in production.");
  const dataDir = resolve(env.DATA_DIR ?? "./data");
  const base = loadConfig({ ...env, APRESENTA_HOME: dataDir });
  const driver = (env.BLOB_DRIVER ?? "disk") as "disk" | "s3";
  return {
    ...base,
    home: dataDir,
    dataDir,
    limits: {
      ...base.limits,
      presentations: Number(env.APRESENTA_LIMIT_PRESENTATIONS ?? 100),
      storageBytes: Number(env.APRESENTA_LIMIT_STORAGE_BYTES ?? 200 * 1024 * 1024),
    },
    publicUrl,
    listenHost: env.HOST ?? "0.0.0.0",
    listenPort: port,
    databaseUrl: env.DATABASE_URL ?? `pglite:${resolve(dataDir, "pg")}`,
    blobs:
      driver === "s3"
        ? {
            driver: "s3",
            bucket: required(env, "S3_BUCKET"),
            region: env.S3_REGION,
            endpoint: env.S3_ENDPOINT,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            forcePathStyle: env.S3_FORCE_PATH_STYLE === "1",
            prefix: env.S3_PREFIX,
            createBucket: env.S3_CREATE_BUCKET === "1",
          }
        : { driver: "disk", dir: resolve(dataDir, "blobs") },
    jwtPrivateKey: env.JWT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    signingKey: env.SIGNING_KEY,
    mail: {
      driver: (env.MAIL_DRIVER ?? "console") as "console" | "smtp" | "resend",
      from: env.MAIL_FROM ?? "Apresentações <nao-responda@localhost>",
      smtpUrl: env.SMTP_URL,
      resendApiKey: env.RESEND_API_KEY,
    },
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : undefined,
    openaiChallenge: env.OPENAI_APPS_CHALLENGE_TOKEN,
    demo:
      env.DEMO_EMAIL && env.DEMO_PASSWORD
        ? { email: env.DEMO_EMAIL, password: env.DEMO_PASSWORD }
        : undefined,
    staticClients: env.OAUTH_STATIC_CLIENTS
      ? (JSON.parse(env.OAUTH_STATIC_CLIENTS) as StaticClient[])
      : [],
    dev,
    trustProxy: env.TRUST_PROXY === "1",
    metricsToken: env.METRICS_TOKEN,
    accessTokenTtl: Number(env.ACCESS_TOKEN_TTL ?? 3600),
    refreshTokenTtl: Number(env.REFRESH_TOKEN_TTL ?? 30 * 24 * 3600),
    linkTtl: Number(env.LINK_TTL ?? 24 * 3600),
    supportEmail: env.SUPPORT_EMAIL ?? "suporte@example.com",
    productName: env.PRODUCT_NAME ?? "SlideIA",
    operatorName: env.OPERATOR_NAME?.trim() || null,
  };
}
