import { esc } from "../escape.js";
import type { Player } from "./app.js";
import { ACTION_LABELS, DEFAULT_KEYMAP, keyId, keyLabel, type Action } from "./keys.js";
import { uiIcon } from "./icons.js";

const REMAPPABLE: Action[] = [
  "next",
  "prev",
  "black",
  "white",
  "start",
  "startCurrent",
  "escape",
  "presenter",
];

/** Toolbar, HUD, toasts and overlays of the main player window. */
export class Chrome {
  hovered = false;
  private readonly bar: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly goto: HTMLElement;
  private readonly toastEl: HTMLElement;
  private help: HTMLElement | null = null;
  private keytest: HTMLElement | null = null;
  private remapping: Action | null = null;
  private toastTimer = 0;
  private log: Array<{ key: string; code: string; action: string }> = [];

  constructor(private readonly p: Player) {
    const root = p.root;
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="chrome" role="toolbar" aria-label="Controles">
        <button data-a="prev" title="Voltar (←)">${uiIcon("prev")}</button>
        <span class="counter" aria-live="polite"></span>
        <button data-a="next" title="Avançar (→)">${uiIcon("next")}</button>
        <span class="sep"></span>
        <button data-a="fullscreen" title="Tela cheia (F5 / F)">${uiIcon("fullscreen")}</button>
        <button data-a="presenter" title="Visão do apresentador (S)">${uiIcon("presenter")}</button>
        <button data-a="keytest" title="Teste do passador (T)">${uiIcon("keyboard")}</button>
        <button data-a="edit" title="Edição rápida (E)">${uiIcon("edit")}</button>
        <button data-a="print" title="Imprimir / PDF">${uiIcon("print")}</button>
        <button data-a="help" title="Atalhos (?)">${uiIcon("help")}</button>
      </div>
      <div class="hud-goto" aria-live="assertive"></div>
      <div class="toast" role="status"></div>`,
    );
    this.bar = root.querySelector(".chrome")!;
    this.counter = this.bar.querySelector(".counter")!;
    this.goto = root.querySelector(".hud-goto")!;
    this.toastEl = root.querySelector(".toast")!;
    this.bar.addEventListener("mouseenter", () => (this.hovered = true));
    this.bar.addEventListener("mouseleave", () => (this.hovered = false));
    this.bar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-a]");
      if (!btn) return;
      const a = btn.dataset.a!;
      if (a === "print") window.print();
      else this.p.perform(a as Action);
      btn.blur();
    });
  }

  update(): void {
    this.counter.textContent = `${this.p.index + 1} / ${this.p.slides.length}`;
    this.bar
      .querySelector('[data-a="fullscreen"]')
      ?.classList.toggle("on", !!document.fullscreenElement);
    this.bar
      .querySelector('[data-a="edit"]')
      ?.classList.toggle("on", this.p.quickEdit?.active ?? false);
  }

  showGoto(digits: string): void {
    this.goto.textContent = digits ? `Ir para o slide ${digits}` : "";
    this.goto.classList.toggle("show", !!digits);
  }

  toast(msg: string, ms = 2600): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), ms);
  }

  /** Closes open overlays; returns true if any was open. */
  closeOverlays(): boolean {
    const open = !!(this.help || this.keytest);
    this.help?.remove();
    this.help = null;
    this.keytest?.remove();
    this.keytest = null;
    this.remapping = null;
    return open;
  }

  /** Gives overlays first pick at key events. Returns true when consumed. */
  onKey(e: KeyboardEvent, action: Action | undefined): boolean {
    if (this.keytest) {
      e.preventDefault();
      if (e.repeat) return true;
      if (this.remapping) {
        const id = keyId(e);
        this.p.keymap.assign(id, this.remapping);
        this.toast(`${keyLabel(id)} → ${ACTION_LABELS[this.remapping]}`);
        this.remapping = null;
        this.renderKeytest();
        return true;
      }
      if (action === "keytest" || e.key === "Escape") {
        this.closeOverlays();
        return true;
      }
      this.log.unshift({ key: e.key, code: e.code, action: action ? ACTION_LABELS[action] : "—" });
      this.log = this.log.slice(0, 8);
      this.renderKeytest();
      return true;
    }
    if (this.help && (action === "help" || e.key === "Escape")) {
      e.preventDefault();
      this.closeOverlays();
      return true;
    }
    return false;
  }

  toggleHelp(): void {
    if (this.help) {
      this.closeOverlays();
      return;
    }
    this.closeOverlays();
    const rows: Array<[string, string]> = [
      ["→ ↓ PageDown Espaço Enter, clique", "Avançar"],
      ["← ↑ PageUp Backspace", "Voltar"],
      ["Home / End", "Primeiro / último slide"],
      ["número + Enter", "Ir para o slide"],
      ["F5 / Shift+F5", "Apresentar do início / do slide atual"],
      ["B ou .", "Tela preta"],
      ["W ou ,", "Tela branca"],
      ["S", "Visão do apresentador (segunda janela)"],
      ["T", "Teste e configuração do passador"],
      ["E", "Edição rápida dos textos"],
      ["F", "Tela cheia"],
      ["Esc", "Sair / cancelar"],
    ];
    this.help = this.overlay(
      "Atalhos",
      `<table class="kbd-table">${rows.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join("")}</table>`,
    );
  }

  toggleKeytest(): void {
    if (this.keytest) {
      this.closeOverlays();
      return;
    }
    this.closeOverlays();
    this.log = [];
    this.keytest = this.overlay("Teste do passador", "");
    this.keytest.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-remap], button[data-reset]",
      );
      if (!btn) return;
      if (btn.dataset.reset !== undefined) {
        this.p.keymap.reset();
        this.toast("Teclas restauradas para o padrão");
      } else {
        this.remapping = btn.dataset.remap as Action;
      }
      this.renderKeytest();
    });
    this.renderKeytest();
  }

  private renderKeytest(): void {
    if (!this.keytest) return;
    const body = this.keytest.querySelector(".overlay-body")!;
    const log = this.log.length
      ? this.log
          .map(
            (l) =>
              `<tr><td><code>${esc(l.key === " " ? "Espaço" : l.key)}</code></td><td><code>${esc(l.code || "—")}</code></td><td>${esc(l.action)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="3" class="muted">Pressione um botão do passador…</td></tr>`;
    const map = REMAPPABLE.map((a) => {
      const keys = this.p.keymap
        .keysFor(a)
        .map((k) => `<kbd>${esc(keyLabel(k))}</kbd>`)
        .join(" ");
      const waiting = this.remapping === a;
      return `<tr><td>${esc(ACTION_LABELS[a])}</td><td>${keys}</td><td><button data-remap="${a}" class="${waiting ? "on" : ""}">${waiting ? "Pressione a tecla…" : "Adicionar tecla"}</button></td></tr>`;
    }).join("");
    body.innerHTML =
      `<p class="muted">Cada tecla enviada pelo passador aparece abaixo (nada é executado enquanto este painel está aberto). Para que um botão faça outra ação, clique em <b>Adicionar tecla</b> e aperte o botão.</p>` +
      `<table class="log"><thead><tr><th>key</th><th>code</th><th>ação</th></tr></thead><tbody>${log}</tbody></table>` +
      `<h3>Mapeamento</h3><table class="map">${map}</table>` +
      `<p><button data-reset>Restaurar padrão</button> <span class="muted">Padrão inclui ${Object.keys(DEFAULT_KEYMAP).length} teclas. Feche com T ou Esc.</span></p>`;
  }

  private overlay(title: string, html: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "overlay";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", title);
    el.innerHTML = `<div class="overlay-card"><div class="overlay-head"><h2>${esc(title)}</h2><button class="overlay-close" title="Fechar (Esc)">${uiIcon("close")}</button></div><div class="overlay-body">${html}</div></div>`;
    el.querySelector(".overlay-close")!.addEventListener("click", () => this.closeOverlays());
    el.addEventListener("click", (e) => {
      if (e.target === el) this.closeOverlays();
    });
    this.p.root.appendChild(el);
    return el;
  }
}
