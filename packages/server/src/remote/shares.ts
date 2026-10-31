import { hmac, randomToken, sha256 } from "./crypto.js";
import type { Sql } from "./sql.js";

/**
 * Public view-only links (`/s/<token>`), one per presentation, valid until disabled.
 *
 * The token is never stored: it is derived from a random nonce with the server key, so the link
 * can be shown again in the editor, while a database leak alone does not reveal working links
 * (lookups use its SHA-256).
 */
export class Shares {
  constructor(
    private readonly sql: Sql,
    private readonly key: string,
    private readonly publicUrl: string,
  ) {}

  private token(id: string, nonce: string): string {
    return hmac(this.key, `share:${id}:${nonce}`).slice(0, 26);
  }

  private url(id: string, nonce: string): string {
    return `${this.publicUrl}/s/${this.token(id, nonce)}`;
  }

  /** The link of an owner's presentation, or null when not shared. */
  async get(owner: string, id: string): Promise<string | null> {
    const r = await this.sql.query<{ nonce: string }>(
      "SELECT nonce FROM shares WHERE owner = $1 AND presentation_id = $2",
      [owner, id],
    );
    return r[0] ? this.url(id, r[0].nonce) : null;
  }

  /** Shares the presentation (the caller checked ownership); `fresh` replaces an existing link. */
  async enable(owner: string, id: string, fresh = false): Promise<string> {
    if (!fresh) {
      const current = await this.get(owner, id);
      if (current) return current;
    }
    const nonce = randomToken(16);
    await this.sql.tx(async (t) => {
      await t.query("DELETE FROM shares WHERE owner = $1 AND presentation_id = $2", [owner, id]);
      await t.query(
        "INSERT INTO shares (token_hash, owner, presentation_id, nonce) VALUES ($1, $2, $3, $4)",
        [sha256(this.token(id, nonce)), owner, id, nonce],
      );
    });
    return this.url(id, nonce);
  }

  async disable(owner: string, id: string): Promise<void> {
    await this.sql.query("DELETE FROM shares WHERE owner = $1 AND presentation_id = $2", [
      owner,
      id,
    ]);
  }

  /** Owner and presentation of a link, or null. */
  async resolve(token: string): Promise<{ owner: string; id: string } | null> {
    if (!/^[A-Za-z0-9_-]{26}$/.test(token)) return null;
    const r = await this.sql.query<{ owner: string; presentation_id: string }>(
      "SELECT owner, presentation_id FROM shares WHERE token_hash = $1",
      [sha256(token)],
    );
    return r[0] ? { owner: r[0].owner, id: r[0].presentation_id } : null;
  }

  /** Ids of the owner's shared presentations. */
  async sharedIds(owner: string): Promise<Set<string>> {
    const r = await this.sql.query<{ presentation_id: string }>(
      "SELECT presentation_id FROM shares WHERE owner = $1",
      [owner],
    );
    return new Set(r.map((x) => x.presentation_id));
  }
}
