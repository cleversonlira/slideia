import { applyOps, diffToOps, type Presentation } from "@slideia/core";
import { ApiError, api } from "./api.js";
import {
  fixSelection,
  flashHighlight,
  loadPresentation,
  setSaveHook,
  toast,
  useEditor,
} from "./state.js";

/*
 * Autosave + live updates.
 * - Local edits are diffed against the last saved version and sent with expectedVersion
 *   (debounced 1 s). The server merges non-overlapping concurrent edits.
 * - Changes made elsewhere (the AI) arrive by SSE; local unsaved edits are rebased on top.
 */

const get = useEditor.getState;
const set = useEditor.setState;

let presId = "";
let timer = 0;
let saving: Promise<void> | null = null;
let source: EventSource | null = null;
let retry = 0;

function contentEquals(a: Presentation, b: Presentation): boolean {
  return JSON.stringify({ ...a, version: 0 }) === JSON.stringify({ ...b, version: 0 });
}

function scheduleSave(delay = 1000): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => void save(), delay);
}

/** Rebases local unsaved edits (base → local) onto `remote`. Returns null on failure. */
function rebase(
  base: Presentation,
  local: Presentation,
  remote: Presentation,
): Presentation | null {
  const ops = diffToOps(base, local);
  if (!ops.length) return remote;
  try {
    return { ...applyOps(remote, ops).presentation, version: remote.version };
  } catch {
    return null;
  }
}

async function save(): Promise<void> {
  if (saving) {
    await saving;
    return save();
  }
  const { pres, saved, status } = get();
  if (!pres || !saved || status === "conflict") return;
  const ops = diffToOps(saved, pres);
  if (!ops.length) {
    set({ status: "saved" });
    return;
  }
  const snapshot = pres;
  set({ status: "saving" });
  saving = (async () => {
    try {
      const res = await api.ops(presId, saved.version, ops);
      retry = 0;
      const server = res.presentation;
      const current = get().pres!;
      if (current === snapshot) {
        set({ pres: server, saved: server, status: "saved" });
      } else {
        const merged = rebase(snapshot, current, server);
        set({ pres: merged ?? server, saved: server, status: "dirty" });
        scheduleSave(300);
      }
      fixSelection();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        set({ status: "conflict", conflict: err.message });
      } else if (err instanceof ApiError && err.status === 400) {
        set({ status: "error" });
        toast(`Não foi possível salvar: ${err.message}`, "error");
      } else {
        set({ status: "offline" });
        retry = Math.min(retry + 1, 6);
        scheduleSave(1000 * 2 ** retry);
      }
    } finally {
      saving = null;
    }
  })();
  await saving;
  await afterSave();
}

/** A remote save may have happened while ours was in flight: catch up. */
async function afterSave(): Promise<void> {
  const latest = await api.get(presId).catch(() => null);
  if (latest && latest.presentation.version > (get().saved?.version ?? 0))
    await mergeRemote(latest.presentation, []);
}

async function mergeRemote(remote: Presentation, touched: string[]): Promise<void> {
  const { pres, saved } = get();
  if (!pres || !saved || remote.version <= saved.version) return;
  if (contentEquals(pres, saved)) {
    set({ pres: remote, saved: remote, past: [], future: [] });
  } else {
    const merged = rebase(saved, pres, remote);
    if (!merged) {
      set({
        status: "conflict",
        conflict: "A apresentação foi alterada pela IA enquanto você editava os mesmos elementos.",
      });
      return;
    }
    set({ pres: merged, saved: remote, past: [], future: [], status: "dirty" });
    scheduleSave(300);
  }
  fixSelection();
  flashHighlight(touched.filter((t) => t !== "order" && t !== "meta"));
}

/** Waits until local edits are on the server (before exporting/presenting). */
export async function flush(): Promise<boolean> {
  clearTimeout(timer);
  await save();
  return get().status === "saved";
}

export async function startSync(id: string): Promise<void> {
  stopSync();
  presId = id;
  set({ status: "loading" });
  const { presentation } = await api.get(id);
  loadPresentation(presentation);
  setSaveHook(() => scheduleSave());
  source = new EventSource(`/api/presentations/${id}/events`);
  source.addEventListener("change", (ev) => {
    const e = JSON.parse((ev as MessageEvent<string>).data) as {
      version: number;
      author: string;
      touched: string[];
    };
    if (saving || e.version <= (get().saved?.version ?? 0)) return;
    void api.get(id).then(({ presentation: remote }) => {
      if (saving) return;
      void mergeRemote(remote, e.author === "ai" ? e.touched : []);
      if (e.author === "ai") toast("A IA atualizou a apresentação");
    });
  });
  source.onerror = () => {
    if (get().status === "saved") set({ status: "offline" });
  };
  source.addEventListener("hello", () => {
    if (get().status === "offline") set({ status: "saved" });
  });
  window.addEventListener("beforeunload", beforeUnload);
}

function beforeUnload(e: BeforeUnloadEvent): void {
  const s = get().status;
  if (s === "dirty" || s === "saving" || s === "offline") {
    e.preventDefault();
  }
}

export function stopSync(): void {
  source?.close();
  source = null;
  clearTimeout(timer);
  window.removeEventListener("beforeunload", beforeUnload);
}

/** Conflict resolution: drop local edits and load the server version. */
export async function resolveReload(): Promise<void> {
  const { presentation } = await api.get(presId);
  loadPresentation(presentation);
  toast("Versão do servidor carregada");
}

/** Conflict resolution: re-apply local edits on top of the latest server version. */
export async function resolveKeepMine(): Promise<void> {
  const { pres, saved } = get();
  if (!pres || !saved) return;
  const { presentation: latest } = await api.get(presId);
  const ops = diffToOps(saved, pres);
  try {
    const res = await api.ops(presId, latest.version, ops);
    loadPresentation(res.presentation);
    toast("Suas alterações foram aplicadas sobre a versão mais recente");
  } catch (err) {
    toast(`Não foi possível manter as alterações: ${(err as Error).message}`, "error");
  }
}
