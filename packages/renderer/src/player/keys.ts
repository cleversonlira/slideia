export type Action =
  | "next"
  | "prev"
  | "first"
  | "last"
  | "black"
  | "white"
  | "escape"
  | "start"
  | "startCurrent"
  | "fullscreen"
  | "presenter"
  | "keytest"
  | "edit"
  | "help";

export const ACTION_LABELS: Record<Action, string> = {
  next: "Avançar",
  prev: "Voltar",
  first: "Primeiro slide",
  last: "Último slide",
  black: "Tela preta",
  white: "Tela branca",
  escape: "Sair / cancelar",
  start: "Apresentar do início",
  startCurrent: "Apresentar do slide atual",
  fullscreen: "Tela cheia",
  presenter: "Visão do apresentador",
  keytest: "Teste do passador",
  edit: "Edição rápida",
  help: "Atalhos",
};

/** Default mapping by `KeyboardEvent.key` (letters lowercased; modifiers as "Shift+F5"). */
export const DEFAULT_KEYMAP: Record<string, Action> = {
  PageDown: "next",
  ArrowRight: "next",
  ArrowDown: "next",
  " ": "next",
  Enter: "next",
  n: "next",
  MediaTrackNext: "next",
  PageUp: "prev",
  ArrowLeft: "prev",
  ArrowUp: "prev",
  Backspace: "prev",
  MediaTrackPrevious: "prev",
  Home: "first",
  End: "last",
  b: "black",
  ".": "black",
  w: "white",
  ",": "white",
  Escape: "escape",
  F5: "start",
  "Shift+F5": "startCurrent",
  f: "fullscreen",
  s: "presenter",
  t: "keytest",
  e: "edit",
  "?": "help",
  h: "help",
};

const STORAGE_KEY = "apresenta.keymap.v1";

export function keyId(e: KeyboardEvent): string {
  const base = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mods = [
    e.ctrlKey ? "Ctrl" : "",
    e.altKey ? "Alt" : "",
    e.metaKey ? "Meta" : "",
    e.shiftKey && e.key.length > 1 ? "Shift" : "",
  ]
    .filter(Boolean)
    .join("+");
  return mods ? `${mods}+${base}` : base;
}

export function loadCustomKeymap(): Record<string, Action> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, Action> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v in ACTION_LABELS) out[k] = v as Action;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCustomKeymap(map: Record<string, Action>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable (private mode, file:// restrictions): mapping lasts for this session only
  }
}

export class Keymap {
  custom: Record<string, Action>;

  constructor() {
    this.custom = loadCustomKeymap();
  }

  resolve(e: KeyboardEvent): Action | undefined {
    const id = keyId(e);
    return this.custom[id] ?? this.custom[e.code] ?? DEFAULT_KEYMAP[id];
  }

  assign(id: string, action: Action): void {
    this.custom[id] = action;
    saveCustomKeymap(this.custom);
  }

  reset(): void {
    this.custom = {};
    saveCustomKeymap(this.custom);
  }

  /** Keys currently bound to an action (defaults + custom). */
  keysFor(action: Action): string[] {
    const keys = Object.entries(DEFAULT_KEYMAP)
      .filter(([k, a]) => a === action && !(k in this.custom))
      .map(([k]) => k);
    for (const [k, a] of Object.entries(this.custom)) if (a === action) keys.push(k);
    return keys;
  }
}

export function keyLabel(k: string): string {
  const names: Record<string, string> = {
    " ": "Espaço",
    ArrowRight: "→",
    ArrowLeft: "←",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Escape: "Esc",
    Backspace: "Backspace",
    PageDown: "PageDown",
    PageUp: "PageUp",
  };
  return names[k] ?? (k.length === 1 ? k.toUpperCase() : k);
}
