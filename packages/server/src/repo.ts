import type { Presentation } from "@slideia/core";

export type Author = "user" | "ai";
export type Channel = "editor" | "mcp" | "import";

export interface PresentationRow {
  id: string;
  title: string;
  version: number;
  slides: number;
  theme: string;
  createdAt: string;
  updatedAt: string;
}

export interface VersionRow {
  version: number;
  author: Author;
  channel: Channel;
  summary: string[];
  touched: string[];
  createdAt: string;
}

export interface AssetRow {
  id: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

export interface SaveRequest {
  presentation: Presentation;
  author: Author;
  channel: Channel;
  summary: string[];
  touched: string[];
}

/** Read access available inside an exclusive update. */
export interface UpdateContext {
  versionsSince(since: number): Promise<VersionRow[]>;
}

/**
 * Storage of one user's presentations (every method is scoped to `owner`). Implemented with
 * SQLite (local mode) and Postgres (remote mode).
 */
export interface PresentationRepo {
  readonly owner: string;
  count(): Promise<number>;
  get(id: string): Promise<Presentation | null>;
  version(id: string): Promise<number | null>;
  list(query?: string, limit?: number): Promise<PresentationRow[]>;
  insert(p: Presentation, author: Author, channel: Channel, summary: string[]): Promise<void>;
  /**
   * Runs `fn` with exclusive write access to the presentation (row lock / IMMEDIATE transaction).
   * When `fn` returns `save`, the new version is stored in the same transaction.
   */
  update<T>(
    id: string,
    fn: (current: Presentation, ctx: UpdateContext) => Promise<{ save?: SaveRequest; result: T }>,
  ): Promise<T>;
  versions(id: string, limit?: number): Promise<VersionRow[]>;
  /** Versions after `since`, oldest first. */
  versionsSince(id: string, since: number): Promise<VersionRow[]>;
  versionDoc(id: string, version: number): Promise<Presentation | null>;
  delete(id: string): Promise<boolean>;
  putAsset(data: Uint8Array, mime: string, width: number, height: number): Promise<AssetRow>;
  assetInfo(id: string): Promise<AssetRow | null>;
  getAsset(id: string): Promise<{ mime: string; data: Uint8Array } | null>;
  /** Total bytes of stored images. */
  assetBytes(): Promise<number>;
  /** The owner's saved brand (JSON validated by the service), or null. */
  getBrand(): Promise<unknown>;
  /** Saves (or, with null, forgets) the brand. */
  setBrand(brand: unknown): Promise<void>;
  /** Everything this owner stored (account deletion). */
  deleteAll(): Promise<void>;
}

export const KEEP_VERSIONS = 200;
