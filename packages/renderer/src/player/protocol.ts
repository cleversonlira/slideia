import type { Action } from "./keys.js";

/** Messages between the main window and the presenter view. */
export type Message =
  | { __apz: 1; type: "hello" }
  | { __apz: 1; type: "state"; index: number; step: number; blank: Blank; total: number }
  | { __apz: 1; type: "cmd"; action: Action | "goto"; index?: number };

export type Blank = null | "black" | "white";

export function isMessage(data: unknown): data is Message {
  return !!data && typeof data === "object" && (data as { __apz?: unknown }).__apz === 1;
}

/**
 * Channel between windows: postMessage to the opener/opened window (works on file://, where
 * origins are opaque) plus BroadcastChannel as a fallback when there is no window reference.
 */
export class Channel {
  private bc: BroadcastChannel | null = null;
  peer: Window | null = null;

  constructor(
    name: string,
    private readonly onMessage: (m: Message, source: Window | null) => void,
  ) {
    try {
      this.bc = new BroadcastChannel(name);
      this.bc.onmessage = (e) => {
        if (isMessage(e.data)) this.onMessage(e.data, null);
      };
    } catch {
      this.bc = null;
    }
    window.addEventListener("message", (e) => {
      if (!isMessage(e.data)) return;
      const src = e.source as Window | null;
      if (src && src !== window) this.peer = src;
      this.onMessage(e.data, src);
    });
  }

  send(m: Message): void {
    let sent = false;
    if (this.peer && !this.peer.closed) {
      try {
        this.peer.postMessage(m, "*");
        sent = true;
      } catch {
        this.peer = null;
      }
    }
    if (!sent) this.bc?.postMessage(m);
  }
}
