/*
 * SlideIA chat widget (MCP Apps view). Shows the deck returned by a tool call as a carousel with
 * the same renderer as the player and the editor, plus links to the editor, presentation and
 * download. Data comes from the tool result `_meta["slideia/view"]` (widget-only, not the model).
 */
import { resolveTheme, type Presentation } from "@slideia/core/browser";
import { deckCss } from "../css.js";
import { autofit } from "../fit.js";
import type { IconMap } from "../icons.js";
import { canvasSize, createContext, renderSlide } from "../render.js";
import { HostBridge } from "./bridge.js";
import { WIDGET_CSS } from "./styles.js";

export const VIEW_KEY = "slideia/view";

export interface ViewPayload {
  presentation: Presentation;
  icons: IconMap;
  /** @font-face rules with font URLs on the SlideIA server. */
  fontCss: string;
  links: { editor: string; present: string; download: string; pptx?: string };
}

interface HostContext {
  theme?: "light" | "dark";
  displayMode?: string;
  availableDisplayModes?: string[];
  containerDimensions?: { height?: number; maxHeight?: number };
  styles?: { variables?: Record<string, string> };
}

const ICON = {
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  shrink: '<path d="m4 14 6 0 0 6M20 10l-6 0 0-6M14 10l7-7M3 21l7-7"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  play: '<path d="m6 3 14 9-14 9V3z"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
};
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

class Viewer {
  private view: ViewPayload | null = null;
  private slides: HTMLElement[] = [];
  private index = 0;
  private host: HostContext = {};
  private readonly bridge = new HostBridge((m, p) => this.onHost(m, p));
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    document.head.insertAdjacentHTML("beforeend", `<style>${WIDGET_CSS}</style>`);
    this.message("Carregando a apresentação…");
    new ResizeObserver(() => this.reportSize()).observe(document.documentElement);
    window.addEventListener("resize", () => this.scale());
    void this.connect();
    this.openaiFallback();
  }

  // ---------------------------------------------------------------------------
  // Host protocol
  // ---------------------------------------------------------------------------

  private async connect(): Promise<void> {
    if (!this.bridge.embedded) return;
    try {
      const r = await this.bridge.request<{ hostContext?: HostContext }>("ui/initialize", {
        protocolVersion: "2026-01-26",
        clientInfo: { name: "slideia-viewer", version: "1.0.0" },
        capabilities: {},
        appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
      });
      this.applyHost(r?.hostContext ?? {});
    } catch {
      // Hosts that only speak the Apps SDK (window.openai) never answer: use the fallback.
    }
    this.bridge.notify("ui/notifications/initialized");
  }

  private onHost(method: string, params: Record<string, unknown>): void {
    if (method === "ui/notifications/tool-result") this.onResult(params);
    else if (method === "ui/notifications/host-context-changed")
      this.applyHost(params as HostContext);
    else if (method === "ui/notifications/tool-cancelled")
      this.message("A operação foi cancelada.");
  }

  /** ChatGPT also exposes the result on window.openai (Apps SDK compatibility). */
  private openaiFallback(): void {
    const read = () => {
      const o = (
        window as unknown as { openai?: { toolResponseMetadata?: Record<string, unknown> } }
      ).openai;
      const v = o?.toolResponseMetadata?.[VIEW_KEY];
      if (v && !this.view) this.show(v as ViewPayload);
    };
    read();
    window.addEventListener("openai:set_globals", read);
  }

  private onResult(result: Record<string, unknown>): void {
    const meta = result._meta as Record<string, unknown> | undefined;
    const view = meta?.[VIEW_KEY] as ViewPayload | undefined;
    if (view?.presentation) {
      this.show(view);
      return;
    }
    const sc = result.structuredContent as { editorUrl?: string } | undefined;
    if (result.isError) this.message("Não foi possível mostrar a apresentação.");
    else if (sc?.editorUrl) this.message("Apresentação atualizada.", sc.editorUrl);
  }

  private applyHost(ctx: HostContext): void {
    this.host = { ...this.host, ...ctx };
    if (this.host.theme) document.documentElement.dataset.theme = this.host.theme;
    for (const [k, v] of Object.entries(ctx.styles?.variables ?? {}))
      if (k.startsWith("--") && typeof v === "string")
        document.documentElement.style.setProperty(k, v);
    document.documentElement.dataset.mode = this.host.displayMode ?? "inline";
    this.updateFullscreenButton();
    this.scale();
  }

  private reportSize(): void {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    this.bridge.notify("ui/notifications/size-changed", { height });
  }

  private async open(url: string): Promise<void> {
    try {
      await this.bridge.request("ui/open-link", { url });
      return;
    } catch {
      // fall through
    }
    const o = (window as unknown as { openai?: { openExternal?: (a: { href: string }) => void } })
      .openai;
    if (o?.openExternal) o.openExternal({ href: url });
    else window.open(url, "_blank", "noopener");
  }

  private async toggleFullscreen(): Promise<void> {
    const mode = this.host.displayMode === "fullscreen" ? "inline" : "fullscreen";
    try {
      const r = await this.bridge.request<{ mode?: string }>("ui/request-display-mode", { mode });
      this.applyHost({ displayMode: r?.mode ?? mode });
    } catch {
      // host refused or does not support it
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private message(text: string, editorUrl?: string): void {
    this.view = null;
    this.root.innerHTML = `<div class="msg"><p>${escapeHtml(text)}</p>${editorUrl ? `<button class="btn primary" type="button">${svg(ICON.edit)}Abrir no editor</button>` : ""}</div>`;
    if (editorUrl)
      this.root.querySelector("button")!.addEventListener("click", () => void this.open(editorUrl));
  }

  private show(view: ViewPayload): void {
    this.view = view;
    const p = view.presentation;
    const visible = p.slides.filter((s) => !s.hidden);
    const ctx = createContext(p, { icons: view.icons });
    const { width, height } = canvasSize(p.meta.aspectRatio);
    document.documentElement.lang = p.meta.lang;
    document.getElementById("slideia-deck-css")?.remove();
    document.head.insertAdjacentHTML(
      "beforeend",
      `<style id="slideia-deck-css">${view.fontCss}\n${deckCss(resolveTheme(p.meta), p.meta.aspectRatio)}</style>`,
    );
    const dots =
      visible.length <= 15
        ? `<div class="dots" role="tablist">${visible.map((_, i) => `<button type="button" role="tab" aria-label="Slide ${i + 1}" data-i="${i}"></button>`).join("")}</div>`
        : "";
    this.root.innerHTML = `
<header class="head"><div class="title"><strong>${escapeHtml(p.meta.title)}</strong><span>${visible.length} slide${visible.length === 1 ? "" : "s"}</span></div>
<button class="icon fs" type="button" hidden>${svg(ICON.expand)}</button></header>
<div class="viewport" tabindex="0" aria-roledescription="carrossel" aria-label="Slides">
  <div class="frame"><div class="stage deck" style="width:${width}px;height:${height}px">${visible.map((s) => renderSlide(s, ctx)).join("")}</div></div>
  <button class="nav prev" type="button" aria-label="Slide anterior">${svg(ICON.prev)}</button>
  <button class="nav next" type="button" aria-label="Próximo slide">${svg(ICON.next)}</button>
  <span class="count" aria-live="polite"></span>
</div>
${dots}
<div class="actions">
  <button class="btn primary" type="button" data-link="editor">${svg(ICON.edit)}Abrir no editor</button>
  <button class="btn" type="button" data-link="present">${svg(ICON.play)}Apresentar</button>
  <button class="btn" type="button" data-link="download">${svg(ICON.download)}Baixar HTML</button>
  ${view.links.pptx ? `<button class="btn" type="button" data-link="pptx">${svg(ICON.download)}PowerPoint</button>` : ""}
</div>`;
    this.slides = [...this.root.querySelectorAll<HTMLElement>(".stage > .slide")];
    for (const s of this.slides)
      for (const n of s.querySelectorAll<HTMLElement>("[data-step]")) n.classList.add("revealed");
    this.bind();
    this.go(Math.min(this.index, this.slides.length - 1));
    this.updateFullscreenButton();
    this.scale();
    const stage = this.root.querySelector<HTMLElement>(".stage")!;
    void document.fonts.ready.then(() => autofit(stage));
  }

  private bind(): void {
    const vp = this.root.querySelector<HTMLElement>(".viewport")!;
    this.root.querySelector(".prev")!.addEventListener("click", () => this.go(this.index - 1));
    this.root.querySelector(".next")!.addEventListener("click", () => this.go(this.index + 1));
    this.root.querySelector(".fs")!.addEventListener("click", () => void this.toggleFullscreen());
    for (const d of this.root.querySelectorAll<HTMLElement>(".dots button"))
      d.addEventListener("click", () => this.go(Number(d.dataset.i)));
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-link]"))
      b.addEventListener("click", () => {
        const key = b.dataset.link as keyof ViewPayload["links"];
        const url = this.view?.links[key];
        if (url) void this.open(url);
      });
    vp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") this.go(this.index - 1);
      else if (e.key === "ArrowRight" || e.key === " ") this.go(this.index + 1);
      else return;
      e.preventDefault();
    });
    let startX: number | null = null;
    vp.addEventListener("pointerdown", (e) => (startX = e.clientX));
    vp.addEventListener("pointerup", (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) this.go(this.index + (dx < 0 ? 1 : -1));
    });
  }

  private go(i: number): void {
    if (!this.slides.length) return;
    this.index = Math.max(0, Math.min(i, this.slides.length - 1));
    this.slides.forEach((s, n) => s.classList.toggle("is-active", n === this.index));
    const count = this.root.querySelector(".count");
    if (count) count.textContent = `${this.index + 1} / ${this.slides.length}`;
    this.root.querySelector<HTMLButtonElement>(".prev")!.disabled = this.index === 0;
    this.root.querySelector<HTMLButtonElement>(".next")!.disabled =
      this.index === this.slides.length - 1;
    this.root
      .querySelectorAll<HTMLElement>(".dots button")
      .forEach((d, n) => d.setAttribute("aria-selected", String(n === this.index)));
  }

  private scale(): void {
    if (!this.view) return;
    const frame = this.root.querySelector<HTMLElement>(".frame");
    const stage = this.root.querySelector<HTMLElement>(".stage");
    if (!frame || !stage) return;
    const { width, height } = canvasSize(this.view.presentation.meta.aspectRatio);
    let s = frame.parentElement!.clientWidth / width;
    if (this.host.displayMode === "fullscreen") {
      const avail =
        (this.host.containerDimensions?.height ??
          this.host.containerDimensions?.maxHeight ??
          window.innerHeight) - 170;
      if (avail > 100) s = Math.min(s, avail / height);
    }
    stage.style.transform = `scale(${s})`;
    frame.style.width = `${width * s}px`;
    frame.style.height = `${height * s}px`;
  }

  private updateFullscreenButton(): void {
    const b = this.root.querySelector<HTMLButtonElement>(".fs");
    if (!b) return;
    const can = this.host.availableDisplayModes?.includes("fullscreen") ?? false;
    b.hidden = !can;
    const full = this.host.displayMode === "fullscreen";
    b.innerHTML = svg(full ? ICON.shrink : ICON.expand);
    b.setAttribute("aria-label", full ? "Sair da tela cheia" : "Tela cheia");
    b.title = b.getAttribute("aria-label")!;
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function boot(): void {
  const root = document.getElementById("app") ?? document.body;
  (window as unknown as { slideia: Viewer }).slideia = new Viewer(root);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
