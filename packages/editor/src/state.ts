import { create } from "zustand";
import { applyOps, PresentationError, type Operation, type Presentation } from "@slideia/core";

export type SaveStatus =
  "loading" | "saved" | "dirty" | "saving" | "offline" | "conflict" | "error";
export type Panel = "slide" | "element" | "deck";
export type Dialog = null | "find" | "history" | "layouts" | "image" | "help";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
}

interface EditorState {
  pres: Presentation | null;
  /** Last version acknowledged by the server. */
  saved: Presentation | null;
  status: SaveStatus;
  conflict: string | null;
  slideId: string | null;
  elementId: string | null;
  /** Element whose text is being edited in place. */
  editing: string | null;
  mode: "canvas" | "outline";
  panel: Panel;
  dialog: Dialog;
  /** Image dialog target: an image element, or the slide background. */
  imageTarget:
    | { kind: "element"; elementId: string }
    | { kind: "background" }
    | { kind: "new"; slot?: string }
    | null;
  past: Presentation[];
  future: Presentation[];
  /** Ids changed remotely (AI), highlighted for a moment. */
  highlight: string[];
  toasts: Toast[];
}

export const useEditor = create<EditorState>(() => ({
  pres: null,
  saved: null,
  status: "loading",
  conflict: null,
  slideId: null,
  elementId: null,
  editing: null,
  mode: "canvas",
  panel: "slide",
  dialog: null,
  imageTarget: null,
  past: [],
  future: [],
  highlight: [],
  toasts: [],
}));

const get = useEditor.getState;
const set = useEditor.setState;

let toastSeq = 0;
export function toast(message: string, kind: Toast["kind"] = "info"): void {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
  setTimeout(
    () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    kind === "error" ? 6000 : 3000,
  );
}

type SaveHook = () => void;
let onLocalChange: SaveHook = () => undefined;
export function setSaveHook(fn: SaveHook): void {
  onLocalChange = fn;
}

export function loadPresentation(p: Presentation): void {
  const state = get();
  const slideId =
    state.slideId && p.slides.some((s) => s.id === state.slideId)
      ? state.slideId
      : (p.slides[0]?.id ?? null);
  set({
    pres: p,
    saved: p,
    status: "saved",
    slideId,
    elementId: null,
    editing: null,
    past: [],
    future: [],
    conflict: null,
  });
}

/**
 * Applies operations locally (same code as the server), records undo history and schedules the
 * autosave. Returns false (with a toast) when the operation is invalid.
 */
export function mutate(
  ops: Operation[] | unknown[],
  opts: { select?: { slideId?: string | null; elementId?: string | null } } = {},
): boolean {
  const { pres, past } = get();
  if (!pres) return false;
  try {
    const r = applyOps(pres, ops);
    if (!r.changed) return true;
    const next = { ...r.presentation, version: pres.version };
    set({
      pres: next,
      past: [...past.slice(-99), pres],
      future: [],
      status: get().status === "conflict" ? "conflict" : "dirty",
      ...(opts.select?.slideId !== undefined ? { slideId: opts.select.slideId } : {}),
      ...(opts.select?.elementId !== undefined ? { elementId: opts.select.elementId } : {}),
    });
    for (const n of r.notes) toast(n);
    onLocalChange();
    return true;
  } catch (err) {
    toast(
      err instanceof PresentationError
        ? err.issues.map((i) => i.message + (i.hint ? ` (${i.hint})` : "")).join("; ")
        : String(err),
      "error",
    );
    return false;
  }
}

export function undo(): void {
  const { past, pres, future } = get();
  const prev = past[past.length - 1];
  if (!prev || !pres) return;
  set({
    pres: { ...prev, version: pres.version },
    past: past.slice(0, -1),
    future: [pres, ...future],
    status: "dirty",
  });
  fixSelection();
  onLocalChange();
}

export function redo(): void {
  const { past, pres, future } = get();
  const next = future[0];
  if (!next || !pres) return;
  set({
    pres: { ...next, version: pres.version },
    past: [...past, pres],
    future: future.slice(1),
    status: "dirty",
  });
  fixSelection();
  onLocalChange();
}

/** Keeps the selection pointing at existing slides/elements. */
export function fixSelection(): void {
  const { pres, slideId, elementId } = get();
  if (!pres) return;
  const slide = pres.slides.find((s) => s.id === slideId) ?? pres.slides[0];
  set({
    slideId: slide?.id ?? null,
    elementId: slide?.elements.some((e) => e.id === elementId) ? elementId : null,
  });
}

export function selectSlide(slideId: string): void {
  set({
    slideId,
    elementId: null,
    editing: null,
    panel: get().panel === "element" ? "slide" : get().panel,
  });
}

export function selectElement(elementId: string | null): void {
  set({
    elementId,
    panel: elementId ? "element" : get().panel === "element" ? "slide" : get().panel,
  });
}

export function currentSlide(s: EditorState = get()) {
  return s.pres?.slides.find((x) => x.id === s.slideId) ?? null;
}

export function flashHighlight(ids: string[]): void {
  if (!ids.length) return;
  set({ highlight: ids });
  setTimeout(() => set({ highlight: [] }), 2600);
}
