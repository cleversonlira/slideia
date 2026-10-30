import type { Presentation, Slide, Transition } from "@apresenta/core/browser";
import { autofit } from "../fit.js";
import type { IconMap } from "../icons.js";
import { canvasSize, createContext, renderSlide, type RenderContext } from "../render.js";
import { Keymap, type Action } from "./keys.js";
import { Channel, type Blank, type Message } from "./protocol.js";
import { QuickEdit } from "./quickedit.js";
import { revealNode, runTransition } from "./transitions.js";
import { Chrome } from "./ui.js";

export class Player {
  readonly stage: HTMLElement;
  readonly chrome: Chrome;
  readonly keymap = new Keymap();
  readonly channel: Channel;
  readonly quickEdit: QuickEdit;
  ctx: RenderContext;
  visible: Slide[] = [];
  slides: HTMLElement[] = [];
  index = 0;
  step = 0;
  blank: Blank = null;
  private busy = false;
  private queued: (() => Promise<void>) | null = null;
  private gotoBuffer = "";
  private gotoTimer = 0;
  private cursorTimer = 0;
  private presenterWin: Window | null = null;

  constructor(
    readonly root: HTMLElement,
    public pres: Presentation,
    readonly icons: IconMap,
  ) {
    this.ctx = createContext(pres, { icons });
    root.innerHTML = `<div class="stage-wrap"><div class="stage" role="region" aria-roledescription="apresentação" aria-live="polite"></div></div><div class="blank-layer"></div>`;
    this.stage = root.querySelector(".stage")!;
    this.chrome = new Chrome(this);
    this.quickEdit = new QuickEdit(this);
    this.channel = new Channel(`apresenta-${pres.id}`, (m) => this.onMessage(m));
    this.renderAll();

    const fromHash = /^#(\d+)$/.exec(location.hash);
    if (fromHash) this.index = clamp(Number(fromHash[1]) - 1, 0, this.slides.length - 1);
    this.activate(this.index, 0);

    window.addEventListener("resize", () => this.scale());
    document.addEventListener("keydown", (e) => this.onKey(e));
    document.addEventListener("fullscreenchange", () => this.chrome.update());
    document.addEventListener("mousemove", () => this.wake());
    this.bindPointer();
    this.scale();
    void document.fonts?.ready.then(() => this.fit());
    this.wake();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  renderAll(): void {
    this.ctx = createContext(this.pres, { icons: this.icons });
    this.visible = this.pres.slides.filter((s) => !s.hidden);
    this.stage.innerHTML = this.visible.map((s) => renderSlide(s, this.ctx)).join("");
    this.slides = [...this.stage.querySelectorAll<HTMLElement>(":scope > .slide")];
    const { width, height } = canvasSize(this.pres.meta.aspectRatio);
    this.root.classList.toggle("ar-43", this.pres.meta.aspectRatio === "4:3");
    this.stage.style.width = `${width}px`;
    this.stage.style.height = `${height}px`;
    document.title = this.pres.meta.title;
    document.documentElement.lang = this.pres.meta.lang;
  }

  /** Re-renders one slide in place (after a quick edit). */
  rerenderSlide(i: number): void {
    const old = this.slides[i];
    const slide = this.visible[i];
    if (!old || !slide) return;
    const tpl = document.createElement("template");
    tpl.innerHTML = renderSlide(slide, this.ctx);
    const el = tpl.content.firstElementChild as HTMLElement;
    el.className = old.className;
    old.replaceWith(el);
    this.slides[i] = el;
    autofit(el);
    this.applySteps(el, i === this.index ? this.step : 0, false);
  }

  fit(): void {
    autofit(this.stage);
  }

  scale(): void {
    const { width, height } = canvasSize(this.pres.meta.aspectRatio);
    const s = Math.min(window.innerWidth / width, window.innerHeight / height);
    this.stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  }

  stepsOf(i: number): number {
    return Number(this.slides[i]?.dataset.steps ?? 0);
  }

  transitionOf(i: number): Transition {
    return this.visible[i]?.transition ?? this.pres.meta.defaultTransition;
  }

  applySteps(slide: HTMLElement, step: number, animateCurrent: boolean): void {
    for (const node of slide.querySelectorAll<HTMLElement>("[data-step]")) {
      const n = Number(node.dataset.step);
      if (n <= step) {
        if (!node.classList.contains("revealed")) revealNode(node, animateCurrent && n === step);
      } else {
        node.classList.remove("revealed");
      }
    }
  }

  private activate(i: number, step: number): void {
    for (const s of this.slides) s.classList.remove("is-active", "is-entering", "is-leaving");
    const el = this.slides[i];
    if (!el) return;
    el.classList.add("is-active");
    this.index = i;
    this.step = step;
    this.applySteps(el, step, false);
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /** Serializes slide changes: while a transition runs, only the last command is kept. */
  private async run(fn: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.queued = fn;
      return;
    }
    this.busy = true;
    try {
      await fn();
    } finally {
      this.busy = false;
    }
    const q = this.queued;
    this.queued = null;
    if (q) await this.run(q);
  }

  private async next(): Promise<void> {
    if (this.blank) return this.setBlank(null);
    if (this.step < this.stepsOf(this.index)) {
      this.step++;
      this.applySteps(this.slides[this.index]!, this.step, true);
      this.emit();
      return;
    }
    if (this.index < this.slides.length - 1) await this.go(this.index + 1, 0, false);
    else this.chrome.toast("Fim da apresentação");
  }

  private async prev(): Promise<void> {
    if (this.blank) return this.setBlank(null);
    if (this.step > 0) {
      this.step--;
      this.applySteps(this.slides[this.index]!, this.step, false);
      this.emit();
      return;
    }
    if (this.index > 0) await this.go(this.index - 1, this.stepsOf(this.index - 1), true);
  }

  private async go(target: number, step: number, backwards: boolean): Promise<void> {
    if (target === this.index || !this.slides[target]) return;
    const from = this.slides[this.index]!;
    const to = this.slides[target]!;
    const t = backwards ? this.transitionOf(this.index) : this.transitionOf(target);
    this.applySteps(to, step, false);
    from.classList.add("is-leaving");
    to.classList.add("is-entering");
    this.index = target;
    this.step = step;
    this.emit();
    await runTransition(from, to, t, backwards);
    from.classList.remove("is-active", "is-leaving");
    to.classList.remove("is-entering");
    to.classList.add("is-active");
  }

  goTo(i: number): Promise<void> {
    const target = clamp(i, 0, this.slides.length - 1);
    return this.run(() => this.go(target, 0, target < this.index));
  }

  setBlank(b: Blank): void {
    this.blank = b;
    this.root.dataset.blank = b ?? "";
    this.emit();
  }

  perform(action: Action | "goto", index?: number): void {
    switch (action) {
      case "next":
        void this.run(() => this.next());
        break;
      case "prev":
        void this.run(() => this.prev());
        break;
      case "first":
        void this.goTo(0);
        break;
      case "last":
        void this.goTo(this.slides.length - 1);
        break;
      case "goto":
        if (index !== undefined) void this.goTo(index);
        break;
      case "black":
        this.setBlank(this.blank === "black" ? null : "black");
        break;
      case "white":
        this.setBlank(this.blank === "white" ? null : "white");
        break;
      case "escape":
        if (this.chrome.closeOverlays()) break;
        if (this.gotoBuffer) this.clearGoto();
        else if (this.quickEdit.active) this.quickEdit.exit();
        else if (this.blank) this.setBlank(null);
        break;
      case "start":
        this.activate(0, 0);
        void this.enterFullscreen();
        break;
      case "startCurrent":
        void this.enterFullscreen();
        break;
      case "fullscreen":
        if (document.fullscreenElement) void document.exitFullscreen();
        else void this.enterFullscreen();
        break;
      case "presenter":
        this.openPresenter();
        break;
      case "keytest":
        this.chrome.toggleKeytest();
        break;
      case "edit":
        this.quickEdit.toggle();
        break;
      case "help":
        this.chrome.toggleHelp();
        break;
    }
  }

  async enterFullscreen(): Promise<void> {
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    } catch {
      // not allowed (no user gesture, iframe): stay windowed
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    const action = this.keymap.resolve(e);
    if (this.chrome.onKey(e, action)) return;
    if (this.quickEdit.active && this.quickEdit.onKey(e, action)) return;
    if (e.repeat) {
      if (action) e.preventDefault();
      return;
    }
    if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.gotoBuffer = (this.gotoBuffer + e.key).slice(-4);
      this.chrome.showGoto(this.gotoBuffer);
      clearTimeout(this.gotoTimer);
      this.gotoTimer = window.setTimeout(() => this.clearGoto(), 4000);
      e.preventDefault();
      return;
    }
    if (this.gotoBuffer && e.key === "Enter") {
      e.preventDefault();
      const n = Number(this.gotoBuffer);
      this.clearGoto();
      void this.goTo(n - 1);
      return;
    }
    if (this.gotoBuffer && e.key === "Backspace") {
      e.preventDefault();
      this.gotoBuffer = this.gotoBuffer.slice(0, -1);
      if (this.gotoBuffer) this.chrome.showGoto(this.gotoBuffer);
      else this.clearGoto();
      return;
    }
    if (!action) return;
    e.preventDefault();
    this.perform(action);
  }

  private clearGoto(): void {
    this.gotoBuffer = "";
    clearTimeout(this.gotoTimer);
    this.chrome.showGoto("");
  }

  private bindPointer(): void {
    let startX = 0;
    let startY = 0;
    let down = false;
    this.root.addEventListener("pointerdown", (e) => {
      down = true;
      startX = e.clientX;
      startY = e.clientY;
    });
    this.root.addEventListener("pointerup", (e) => {
      if (!down) return;
      down = false;
      const target = e.target as HTMLElement;
      if (
        this.quickEdit.active ||
        target.closest("a, button, input, .chrome, .overlay, [contenteditable=true]")
      )
        return;
      if (e.button !== 0) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) this.perform(dx < 0 ? "next" : "prev");
      else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) this.perform("next");
    });
  }

  private wake(): void {
    this.root.classList.remove("idle");
    clearTimeout(this.cursorTimer);
    this.cursorTimer = window.setTimeout(() => {
      if (!this.chrome.hovered) this.root.classList.add("idle");
    }, 2000);
  }

  // ---------------------------------------------------------------------------
  // Presenter view
  // ---------------------------------------------------------------------------

  openPresenter(): void {
    if (this.presenterWin && !this.presenterWin.closed) {
      this.presenterWin.focus();
      return;
    }
    const url = location.href.split("#")[0] + "#presenter";
    this.presenterWin = window.open(
      url,
      `apresenta-presenter-${this.pres.id}`,
      "popup,width=1280,height=800",
    );
    if (!this.presenterWin) {
      this.chrome.toast("O navegador bloqueou a janela. Permita pop-ups para este arquivo.");
      return;
    }
    this.channel.peer = this.presenterWin;
  }

  private onMessage(m: Message): void {
    if (m.type === "hello") this.emit();
    else if (m.type === "cmd") this.perform(m.action, m.index);
  }

  emit(): void {
    this.chrome.update();
    this.channel.send({
      __apz: 1,
      type: "state",
      index: this.index,
      step: this.step,
      blank: this.blank,
      total: this.slides.length,
    });
    try {
      history.replaceState(null, "", `#${this.index + 1}`);
    } catch {
      // some file:// contexts forbid replaceState
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
