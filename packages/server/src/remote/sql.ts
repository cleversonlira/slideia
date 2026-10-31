import { mkdirSync } from "node:fs";
import pg from "pg";

/** Minimal async SQL client shared by node-postgres and PGlite (Postgres in WASM). */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` in a transaction; `fn` receives a client bound to it. */
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Opens a database from a URL:
 *   postgres://user:pass@host/db   real Postgres (connection pool)
 *   pglite:memory                  in-memory Postgres (tests)
 *   pglite:/path/to/dir            Postgres persisted in a folder (local simulation, no install)
 */
export async function openSql(url: string): Promise<Sql> {
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const target = url.slice("pglite:".length);
    if (target !== "memory") mkdirSync(target, { recursive: true });
    const db = await PGlite.create(target === "memory" ? undefined : target);
    type Q = { query<T>(t: string, p?: unknown[]): Promise<{ rows: T[] }> };
    // Inside a transaction every statement must go through the transaction handle.
    const sqlOf = (q: Q): Sql => ({
      query: async <T>(text: string, params?: unknown[]) => (await q.query<T>(text, params)).rows,
      tx: (inner) => inner(sqlOf(q)),
      close: async () => undefined,
    });
    return {
      ...sqlOf(db as unknown as Q),
      tx: (fn) => db.transaction((t) => fn(sqlOf(t as unknown as Q))),
      close: () => db.close(),
    };
  }

  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 10) });
  const clientSql = (client: pg.PoolClient): Sql => ({
    query: async <T>(text: string, params?: unknown[]) =>
      (await client.query(text, params)).rows as T[],
    tx: (inner) => inner(clientSql(client)),
    close: async () => undefined,
  });
  return {
    query: async <T>(text: string, params?: unknown[]) =>
      (await pool.query(text, params)).rows as T[],
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(clientSql(client));
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT,
    email_verified_at TIMESTAMPTZ,
    google_sub TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE oauth_clients (
    client_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT,
    redirect_uris JSON NOT NULL,
    secret_hash TEXT,
    auth_method TEXT NOT NULL DEFAULT 'none',
    logo_uri TEXT,
    client_uri TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    fetched_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ
  );
  CREATE TABLE oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    family_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
  );
  CREATE TABLE oauth_refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX oauth_refresh_family ON oauth_refresh_tokens(family_id);
  CREATE TABLE oauth_revoked_families (
    family_id TEXT PRIMARY KEY,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE consents (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, client_id)
  );
  CREATE TABLE presentations (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    version INTEGER NOT NULL,
    doc JSON NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX presentations_owner ON presentations(owner, updated_at DESC);
  CREATE TABLE versions (
    presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    author TEXT NOT NULL,
    channel TEXT NOT NULL,
    summary JSON NOT NULL,
    touched JSON NOT NULL,
    doc JSON NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (presentation_id, version)
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX assets_owner_sha ON assets(owner, sha256);
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE brands (
    owner TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    doc JSON NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `,
];

/** Applies pending migrations (idempotent; serialized with an advisory lock on real Postgres). */
export async function migrate(sql: Sql): Promise<void> {
  await sql.tx(async (t) => {
    await t.query("SELECT pg_advisory_xact_lock(4716253)");
    await t.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const rows = await t.query<{ v: number | null }>(
      "SELECT MAX(version) AS v FROM schema_migrations",
    );
    const current = Number(rows[0]?.v ?? 0);
    for (let i = current; i < MIGRATIONS.length; i++) {
      for (const stmt of MIGRATIONS[i]!.split(/;\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean))
        await t.query(stmt);
      await t.query("INSERT INTO schema_migrations (version) VALUES ($1)", [i + 1]);
    }
  });
}

export async function getMeta(sql: Sql, key: string): Promise<string | null> {
  const r = await sql.query<{ value: string }>("SELECT value FROM meta WHERE key = $1", [key]);
  return r[0]?.value ?? null;
}

/** Returns the stored value, or stores `make()` the first time (race-safe). */
export async function metaOnce(sql: Sql, key: string, make: () => string): Promise<string> {
  const existing = await getMeta(sql, key);
  if (existing) return existing;
  await sql.query("INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", [
    key,
    make(),
  ]);
  return (await getMeta(sql, key))!;
}
