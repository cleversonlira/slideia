import { createHash } from "node:crypto";
import type { Sql } from "./sql.js";
import { getMeta } from "./sql.js";

/**
 * Tells MCP clients that the tool/prompt/resource lists changed after a deploy, so hosts that
 * cache them (Claude, ChatGPT) refresh without the user reconnecting the connector.
 *
 * The server is stateless and restarts on every deploy, so the change is detected by comparing
 * a fingerprint of the published surface with the one stored in `meta`. For `NOTICE_DAYS` after
 * a change, each (user, client) that opens a notification stream before listing the tools again
 * gets `notifications/*\/list_changed` once.
 */

const KEY = "mcp_surface";
const NOTICE_DAYS = 30;

export const LIST_CHANGED_METHODS = [
  "notifications/tools/list_changed",
  "notifications/prompts/list_changed",
  "notifications/resources/list_changed",
] as const;

export function fingerprint(parts: unknown[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" ? p : JSON.stringify(p)).update("\0");
  return h.digest("hex").slice(0, 32);
}

export class ListChanges {
  /** Clients known to have the current lists (listed them, or were notified) since boot. */
  private readonly current = new Set<string>();

  private constructor(
    /** When the surface last changed (ms), or null when it never changed since first boot. */
    readonly changedAt: number | null,
    private readonly now: () => number,
  ) {}

  /** Compares `hash` with the stored fingerprint and records a change. */
  static async init(sql: Sql, hash: string, now: () => number = Date.now): Promise<ListChanges> {
    const raw = await getMeta(sql, KEY);
    type Stored = { hash: string; changedAt: number | null };
    let stored: Stored | null;
    try {
      stored = raw ? (JSON.parse(raw) as Stored) : null;
    } catch {
      stored = null;
    }
    let changedAt = stored?.changedAt ?? null;
    if (!stored || stored.hash !== hash) {
      // First boot ever: no client can hold an older list.
      changedAt = stored ? now() : null;
      await sql.query(
        "INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
        [KEY, JSON.stringify({ hash, changedAt })],
      );
    }
    return new ListChanges(changedAt, now);
  }

  /** The client fetched (or was told to fetch) the current lists. */
  saw(client: string): void {
    this.current.add(client);
  }

  /** Whether a stream opened by this client should start with the list_changed notifications. */
  needsNotice(client: string): boolean {
    if (this.changedAt === null || this.current.has(client)) return false;
    return this.now() - this.changedAt < NOTICE_DAYS * 86_400_000;
  }
}
