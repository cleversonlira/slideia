import { createHash } from "node:crypto";

/** Structured JSON logs on stdout. Never pass presentation content here. */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  if (process.env.VITEST) return;
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), event, ...fields })}\n`);
}

/** Stable pseudonymous id for logs (user ids are not personal data, but keep logs minimal). */
export function anon(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 12);
}

/**
 * In-memory sliding-window rate limiter. Good for one instance; with several instances behind a
 * load balancer, replace by a shared store (Postgres/Redis) — see docs/ARQUITETURA.md.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  /** Records a hit; returns false when `key` exceeded `limit` hits within `windowMs`. */
  hit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 50_000) this.sweep(windowMs);
    return list.length <= limit;
  }

  private sweep(windowMs: number): void {
    const now = Date.now();
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < windowMs)) this.hits.delete(k);
  }
}

interface ToolStat {
  calls: number;
  errors: number;
  seconds: number;
}

/** Prometheus text metrics: tool calls, errors and durations; HTTP status classes. */
export class Metrics {
  private readonly tools = new Map<string, ToolStat>();
  private readonly http = new Map<string, number>();
  private readonly started = Date.now();

  tool(name: string, ms: number, ok: boolean): void {
    const s = this.tools.get(name) ?? { calls: 0, errors: 0, seconds: 0 };
    s.calls++;
    if (!ok) s.errors++;
    s.seconds += ms / 1000;
    this.tools.set(name, s);
  }

  request(status: number): void {
    const key = `${Math.floor(status / 100)}xx`;
    this.http.set(key, (this.http.get(key) ?? 0) + 1);
  }

  render(): string {
    const lines = [
      "# TYPE apresenta_tool_calls_total counter",
      ...[...this.tools].map(([n, s]) => `apresenta_tool_calls_total{tool="${n}"} ${s.calls}`),
      "# TYPE apresenta_tool_errors_total counter",
      ...[...this.tools].map(([n, s]) => `apresenta_tool_errors_total{tool="${n}"} ${s.errors}`),
      "# TYPE apresenta_tool_seconds_total counter",
      ...[...this.tools].map(
        ([n, s]) => `apresenta_tool_seconds_total{tool="${n}"} ${s.seconds.toFixed(3)}`,
      ),
      "# TYPE apresenta_http_responses_total counter",
      ...[...this.http].map(([k, v]) => `apresenta_http_responses_total{class="${k}"} ${v}`),
      "# TYPE apresenta_uptime_seconds gauge",
      `apresenta_uptime_seconds ${Math.round((Date.now() - this.started) / 1000)}`,
    ];
    return `${lines.join("\n")}\n`;
  }
}
