import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomId, type Presentation } from "@slideia/core";
import { DiskBlobStore, MIME_EXT, type BlobStore } from "./blobs.js";
import {
  KEEP_VERSIONS,
  type AssetRow,
  type Author,
  type Channel,
  type PresentationRepo,
  type PresentationRow,
  type SaveRequest,
  type UpdateContext,
  type VersionRow,
} from "./repo.js";

/** Serializes async critical sections in this process. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * SQLite database of the local mode (node:sqlite, WAL). Safe for several processes sharing the
 * data folder: writers use IMMEDIATE transactions; inside a process they are serialized.
 */
export class SqliteDatabase {
  readonly db: DatabaseSync;
  readonly blobs: BlobStore;
  readonly writes = new Mutex();

  constructor(dataDir: string, blobs?: BlobStore) {
    mkdirSync(dataDir, { recursive: true });
    this.blobs = blobs ?? new DiskBlobStore(join(dataDir, "assets"));
    this.db = new DatabaseSync(join(dataDir, "data.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS presentations (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        title TEXT NOT NULL,
        version INTEGER NOT NULL,
        doc TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS presentations_owner ON presentations(owner, updated_at);
      CREATE TABLE IF NOT EXISTS versions (
        presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        author TEXT NOT NULL,
        channel TEXT NOT NULL,
        summary TEXT NOT NULL,
        touched TEXT NOT NULL,
        doc TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (presentation_id, version)
      );
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        mime TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assets_sha ON assets(owner, sha256);
    `);
  }

  scoped(owner: string): PresentationRepo {
    return new SqlitePresentationRepo(this, owner);
  }

  /** IMMEDIATE transaction, serialized with every other write of this process. */
  write<T>(fn: () => Promise<T>): Promise<T> {
    return this.writes.run(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const out = await fn();
        this.db.exec("COMMIT");
        return out;
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    });
  }

  close(): void {
    this.db.close();
  }
}

type Row = Record<string, unknown>;

function toVersion(r: Row): VersionRow {
  return {
    version: Number(r.version),
    author: r.author as Author,
    channel: r.channel as Channel,
    summary: JSON.parse(String(r.summary)) as string[],
    touched: JSON.parse(String(r.touched)) as string[],
    createdAt: String(r.created_at),
  };
}

export function assetKey(id: string, mime: string): string {
  return `${id}.${MIME_EXT[mime] ?? "bin"}`;
}

class SqlitePresentationRepo implements PresentationRepo {
  constructor(
    private readonly s: SqliteDatabase,
    readonly owner: string,
  ) {}

  private get db() {
    return this.s.db;
  }

  async count(): Promise<number> {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM presentations WHERE owner = ?")
      .get(this.owner) as Row;
    return Number(r.n);
  }

  private getSync(id: string): Presentation | null {
    const r = this.db
      .prepare("SELECT doc FROM presentations WHERE id = ? AND owner = ?")
      .get(id, this.owner) as Row | undefined;
    return r ? (JSON.parse(String(r.doc)) as Presentation) : null;
  }

  async get(id: string): Promise<Presentation | null> {
    return this.getSync(id);
  }

  async version(id: string): Promise<number | null> {
    const r = this.db
      .prepare("SELECT version FROM presentations WHERE id = ? AND owner = ?")
      .get(id, this.owner) as Row | undefined;
    return r ? Number(r.version) : null;
  }

  async list(query?: string, limit = 50): Promise<PresentationRow[]> {
    const rows = this.db
      .prepare(
        `SELECT id, title, version, doc, created_at, updated_at FROM presentations
         WHERE owner = ? AND (? IS NULL OR title LIKE ?) ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(this.owner, query ?? null, `%${query ?? ""}%`, limit) as Row[];
    return rows.map((r) => {
      const doc = JSON.parse(String(r.doc)) as Presentation;
      return {
        id: String(r.id),
        title: String(r.title),
        version: Number(r.version),
        slides: doc.slides.length,
        theme: doc.meta.theme,
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      };
    });
  }

  async insert(
    p: Presentation,
    author: Author,
    channel: Channel,
    summary: string[],
  ): Promise<void> {
    await this.s.write(async () => {
      const now = new Date().toISOString();
      this.db
        .prepare(
          "INSERT INTO presentations (id, owner, title, version, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(p.id, this.owner, p.meta.title, p.version, JSON.stringify(p), now, now);
      this.insertVersion({ presentation: p, author, channel, summary, touched: ["*"] }, now);
    });
  }

  private insertVersion(s: SaveRequest, now: string): void {
    this.db
      .prepare(
        "INSERT INTO versions (presentation_id, version, author, channel, summary, touched, doc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        s.presentation.id,
        s.presentation.version,
        s.author,
        s.channel,
        JSON.stringify(s.summary),
        JSON.stringify(s.touched),
        JSON.stringify(s.presentation),
        now,
      );
  }

  async update<T>(
    id: string,
    fn: (current: Presentation, ctx: UpdateContext) => Promise<{ save?: SaveRequest; result: T }>,
  ): Promise<T> {
    return this.s.write(async () => {
      const current = this.getSync(id);
      if (!current) throw new MissingPresentation(id);
      const { save, result } = await fn(current, {
        versionsSince: (since) => this.versionsSince(id, since),
      });
      if (save) {
        const now = new Date().toISOString();
        const p = save.presentation;
        this.db
          .prepare(
            "UPDATE presentations SET title = ?, version = ?, doc = ?, updated_at = ? WHERE id = ? AND owner = ?",
          )
          .run(p.meta.title, p.version, JSON.stringify(p), now, p.id, this.owner);
        this.insertVersion(save, now);
        this.db
          .prepare("DELETE FROM versions WHERE presentation_id = ? AND version <= ?")
          .run(p.id, p.version - KEEP_VERSIONS);
      }
      return result;
    });
  }

  private owns(id: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM presentations WHERE id = ? AND owner = ?")
      .get(id, this.owner);
  }

  async versions(id: string, limit = 100): Promise<VersionRow[]> {
    if (!this.owns(id)) return [];
    const rows = this.db
      .prepare(
        "SELECT version, author, channel, summary, touched, created_at FROM versions WHERE presentation_id = ? ORDER BY version DESC LIMIT ?",
      )
      .all(id, limit) as Row[];
    return rows.map(toVersion);
  }

  async versionsSince(id: string, since: number): Promise<VersionRow[]> {
    if (!this.owns(id)) return [];
    const rows = this.db
      .prepare(
        "SELECT version, author, channel, summary, touched, created_at FROM versions WHERE presentation_id = ? AND version > ? ORDER BY version ASC",
      )
      .all(id, since) as Row[];
    return rows.map(toVersion);
  }

  async versionDoc(id: string, version: number): Promise<Presentation | null> {
    if (!this.owns(id)) return null;
    const r = this.db
      .prepare("SELECT doc FROM versions WHERE presentation_id = ? AND version = ?")
      .get(id, version) as Row | undefined;
    return r ? (JSON.parse(String(r.doc)) as Presentation) : null;
  }

  async delete(id: string): Promise<boolean> {
    return this.s.write(async () => {
      const res = this.db
        .prepare("DELETE FROM presentations WHERE id = ? AND owner = ?")
        .run(id, this.owner);
      return Number(res.changes) > 0;
    });
  }

  async putAsset(data: Uint8Array, mime: string, width: number, height: number): Promise<AssetRow> {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const existing = this.db
      .prepare("SELECT id, mime, width, height, bytes FROM assets WHERE owner = ? AND sha256 = ?")
      .get(this.owner, sha256) as AssetRow | undefined;
    if (existing) return { ...existing };
    const id = randomId("a", 12);
    await this.s.blobs.put(assetKey(id, mime), data, mime);
    await this.s.write(async () => {
      this.db
        .prepare(
          "INSERT INTO assets (id, owner, mime, width, height, bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          this.owner,
          mime,
          width,
          height,
          data.byteLength,
          sha256,
          new Date().toISOString(),
        );
    });
    return { id, mime, width, height, bytes: data.byteLength };
  }

  async assetInfo(id: string): Promise<AssetRow | null> {
    const r = this.db
      .prepare("SELECT id, mime, width, height, bytes FROM assets WHERE id = ? AND owner = ?")
      .get(id, this.owner) as AssetRow | undefined;
    return r ? { ...r } : null;
  }

  async getAsset(id: string): Promise<{ mime: string; data: Uint8Array } | null> {
    const info = await this.assetInfo(id);
    if (!info) return null;
    const data = await this.s.blobs.get(assetKey(id, info.mime));
    return data ? { mime: info.mime, data } : null;
  }

  async assetBytes(): Promise<number> {
    const r = this.db
      .prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM assets WHERE owner = ?")
      .get(this.owner) as Row;
    return Number(r.n);
  }

  async deleteAll(): Promise<void> {
    const assets = this.db
      .prepare("SELECT id, mime FROM assets WHERE owner = ?")
      .all(this.owner) as Row[];
    await this.s.write(async () => {
      this.db.prepare("DELETE FROM presentations WHERE owner = ?").run(this.owner);
      this.db.prepare("DELETE FROM assets WHERE owner = ?").run(this.owner);
    });
    for (const a of assets) await this.s.blobs.delete(assetKey(String(a.id), String(a.mime)));
  }
}

/** Thrown by repositories when the presentation does not exist for this owner. */
export class MissingPresentation extends Error {
  constructor(readonly id: string) {
    super(`Presentation "${id}" not found.`);
  }
}
