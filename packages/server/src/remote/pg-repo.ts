import { createHash } from "node:crypto";
import { randomId, type Presentation } from "@slideia/core";
import type { BlobStore } from "../blobs.js";
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
} from "../repo.js";
import { MissingPresentation, assetKey } from "../store.js";
import type { Sql } from "./sql.js";

type Row = Record<string, unknown>;

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function parse<T>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

function toVersion(r: Row): VersionRow {
  return {
    version: Number(r.version),
    author: r.author as Author,
    channel: r.channel as Channel,
    summary: parse<string[]>(r.summary),
    touched: parse<string[]>(r.touched),
    createdAt: iso(r.created_at),
  };
}

/** Presentations of one user in Postgres (row locks for concurrent edits across instances). */
export class PgPresentationRepo implements PresentationRepo {
  constructor(
    private readonly sql: Sql,
    private readonly blobs: BlobStore,
    readonly owner: string,
  ) {}

  async count(): Promise<number> {
    const r = await this.sql.query<{ n: string | number }>(
      "SELECT COUNT(*) AS n FROM presentations WHERE owner = $1",
      [this.owner],
    );
    return Number(r[0]?.n ?? 0);
  }

  async get(id: string): Promise<Presentation | null> {
    const r = await this.sql.query("SELECT doc FROM presentations WHERE id = $1 AND owner = $2", [
      id,
      this.owner,
    ]);
    return r[0] ? parse<Presentation>(r[0].doc) : null;
  }

  async version(id: string): Promise<number | null> {
    const r = await this.sql.query(
      "SELECT version FROM presentations WHERE id = $1 AND owner = $2",
      [id, this.owner],
    );
    return r[0] ? Number(r[0].version) : null;
  }

  async list(query?: string, limit = 50): Promise<PresentationRow[]> {
    const rows = await this.sql.query(
      `SELECT id, title, version, doc, created_at, updated_at FROM presentations
       WHERE owner = $1 AND ($2::text IS NULL OR title ILIKE '%' || $2 || '%')
       ORDER BY updated_at DESC LIMIT $3`,
      [this.owner, query ?? null, limit],
    );
    return rows.map((r) => {
      const doc = parse<Presentation>(r.doc);
      return {
        id: String(r.id),
        title: String(r.title),
        version: Number(r.version),
        slides: doc.slides.length,
        theme: doc.meta.theme,
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
      };
    });
  }

  private async insertVersion(sql: Sql, s: SaveRequest): Promise<void> {
    await sql.query(
      "INSERT INTO versions (presentation_id, version, author, channel, summary, touched, doc) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [
        s.presentation.id,
        s.presentation.version,
        s.author,
        s.channel,
        JSON.stringify(s.summary),
        JSON.stringify(s.touched),
        JSON.stringify(s.presentation),
      ],
    );
  }

  async insert(
    p: Presentation,
    author: Author,
    channel: Channel,
    summary: string[],
  ): Promise<void> {
    await this.sql.tx(async (t) => {
      await t.query(
        "INSERT INTO presentations (id, owner, title, version, doc) VALUES ($1, $2, $3, $4, $5)",
        [p.id, this.owner, p.meta.title, p.version, JSON.stringify(p)],
      );
      await this.insertVersion(t, { presentation: p, author, channel, summary, touched: ["*"] });
    });
  }

  async update<T>(
    id: string,
    fn: (current: Presentation, ctx: UpdateContext) => Promise<{ save?: SaveRequest; result: T }>,
  ): Promise<T> {
    return this.sql.tx(async (t) => {
      const r = await t.query(
        "SELECT doc FROM presentations WHERE id = $1 AND owner = $2 FOR UPDATE",
        [id, this.owner],
      );
      if (!r[0]) throw new MissingPresentation(id);
      const current = parse<Presentation>(r[0].doc);
      const ctx: UpdateContext = {
        versionsSince: async (since) =>
          (
            await t.query(
              "SELECT version, author, channel, summary, touched, created_at FROM versions WHERE presentation_id = $1 AND version > $2 ORDER BY version ASC",
              [id, since],
            )
          ).map(toVersion),
      };
      const { save, result } = await fn(current, ctx);
      if (save) {
        const p = save.presentation;
        await t.query(
          "UPDATE presentations SET title = $1, version = $2, doc = $3, updated_at = now() WHERE id = $4 AND owner = $5",
          [p.meta.title, p.version, JSON.stringify(p), id, this.owner],
        );
        await this.insertVersion(t, save);
        await t.query("DELETE FROM versions WHERE presentation_id = $1 AND version <= $2", [
          id,
          p.version - KEEP_VERSIONS,
        ]);
      }
      return result;
    });
  }

  async versions(id: string, limit = 100): Promise<VersionRow[]> {
    const rows = await this.sql.query(
      `SELECT v.version, v.author, v.channel, v.summary, v.touched, v.created_at FROM versions v
       JOIN presentations p ON p.id = v.presentation_id
       WHERE v.presentation_id = $1 AND p.owner = $2 ORDER BY v.version DESC LIMIT $3`,
      [id, this.owner, limit],
    );
    return rows.map(toVersion);
  }

  async versionsSince(id: string, since: number): Promise<VersionRow[]> {
    const rows = await this.sql.query(
      `SELECT v.version, v.author, v.channel, v.summary, v.touched, v.created_at FROM versions v
       JOIN presentations p ON p.id = v.presentation_id
       WHERE v.presentation_id = $1 AND p.owner = $2 AND v.version > $3 ORDER BY v.version ASC`,
      [id, this.owner, since],
    );
    return rows.map(toVersion);
  }

  async versionDoc(id: string, version: number): Promise<Presentation | null> {
    const r = await this.sql.query(
      `SELECT v.doc FROM versions v JOIN presentations p ON p.id = v.presentation_id
       WHERE v.presentation_id = $1 AND p.owner = $2 AND v.version = $3`,
      [id, this.owner, version],
    );
    return r[0] ? parse<Presentation>(r[0].doc) : null;
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.sql.query(
      "DELETE FROM presentations WHERE id = $1 AND owner = $2 RETURNING id",
      [id, this.owner],
    );
    return r.length > 0;
  }

  async putAsset(data: Uint8Array, mime: string, width: number, height: number): Promise<AssetRow> {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const existing = await this.sql.query<AssetRow>(
      "SELECT id, mime, width, height, bytes FROM assets WHERE owner = $1 AND sha256 = $2 LIMIT 1",
      [this.owner, sha256],
    );
    if (existing[0])
      return {
        ...existing[0],
        width: Number(existing[0].width),
        height: Number(existing[0].height),
        bytes: Number(existing[0].bytes),
      };
    const id = randomId("a", 12);
    await this.blobs.put(assetKey(id, mime), data, mime);
    await this.sql.query(
      "INSERT INTO assets (id, owner, mime, width, height, bytes, sha256) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [id, this.owner, mime, width, height, data.byteLength, sha256],
    );
    return { id, mime, width, height, bytes: data.byteLength };
  }

  async assetInfo(id: string): Promise<AssetRow | null> {
    const r = await this.sql.query<AssetRow>(
      "SELECT id, mime, width, height, bytes FROM assets WHERE id = $1 AND owner = $2",
      [id, this.owner],
    );
    return r[0]
      ? {
          ...r[0],
          width: Number(r[0].width),
          height: Number(r[0].height),
          bytes: Number(r[0].bytes),
        }
      : null;
  }

  async getAsset(id: string): Promise<{ mime: string; data: Uint8Array } | null> {
    const info = await this.assetInfo(id);
    if (!info) return null;
    const data = await this.blobs.get(assetKey(id, info.mime));
    return data ? { mime: info.mime, data } : null;
  }

  async assetBytes(): Promise<number> {
    const r = await this.sql.query<{ n: string | number }>(
      "SELECT COALESCE(SUM(bytes), 0) AS n FROM assets WHERE owner = $1",
      [this.owner],
    );
    return Number(r[0]?.n ?? 0);
  }

  async getBrand(): Promise<unknown> {
    const r = await this.sql.query<{ doc: unknown }>("SELECT doc FROM brands WHERE owner = $1", [
      this.owner,
    ]);
    const doc = r[0]?.doc;
    if (doc === undefined) return null;
    return typeof doc === "string" ? (JSON.parse(doc) as unknown) : doc;
  }

  async setBrand(brand: unknown): Promise<void> {
    if (brand === null) {
      await this.sql.query("DELETE FROM brands WHERE owner = $1", [this.owner]);
      return;
    }
    await this.sql.query(
      "INSERT INTO brands (owner, doc, updated_at) VALUES ($1, $2, now()) ON CONFLICT (owner) DO UPDATE SET doc = $2, updated_at = now()",
      [this.owner, JSON.stringify(brand)],
    );
  }

  async deleteAll(): Promise<void> {
    const assets = await this.sql.query<{ id: string; mime: string }>(
      "SELECT id, mime FROM assets WHERE owner = $1",
      [this.owner],
    );
    await this.sql.tx(async (t) => {
      await t.query("DELETE FROM presentations WHERE owner = $1", [this.owner]);
      await t.query("DELETE FROM assets WHERE owner = $1", [this.owner]);
      await t.query("DELETE FROM brands WHERE owner = $1", [this.owner]);
    });
    for (const a of assets) await this.blobs.delete(assetKey(a.id, a.mime)).catch(() => undefined);
  }
}
