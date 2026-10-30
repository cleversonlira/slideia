/*
 * Minimal MCP Apps bridge (SEP-1865, spec 2026-01-26): JSON-RPC 2.0 over postMessage with the
 * host (Claude, ChatGPT…). The view sends ui/initialize, then ui/notifications/initialized; the
 * host then sends tool-input / tool-result notifications. No dependencies (keeps the bundle small).
 */

type Params = Record<string, unknown>;

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Params;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export class HostBridge {
  private nextId = 1;
  private readonly pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly onNotification: (method: string, params: Params) => void) {
    window.addEventListener("message", (e) => this.onMessage(e));
  }

  /** True when running inside a host iframe. */
  get embedded(): boolean {
    return window.parent !== window;
  }

  request<T = unknown>(method: string, params: Params = {}, timeoutMs = 10_000): Promise<T> {
    if (!this.embedded) return Promise.reject(new Error("not embedded"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: timeout`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v as T)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }

  notify(method: string, params: Params = {}): void {
    if (this.embedded) window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }

  private onMessage(e: MessageEvent): void {
    if (e.source !== window.parent) return;
    const m = e.data as RpcMessage | null;
    if (!m || typeof m !== "object" || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && !m.method) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message ?? "host error"));
      else p.resolve(m.result);
      return;
    }
    if (!m.method) return;
    // Host requests (e.g. ui/resource-teardown) just need an answer; nothing to clean up here.
    if (m.id !== undefined)
      window.parent.postMessage({ jsonrpc: "2.0", id: m.id, result: {} }, "*");
    this.onNotification(m.method, m.params ?? {});
  }
}
