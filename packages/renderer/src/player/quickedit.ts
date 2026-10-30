import type { Element, RichText, Slide } from "@apresenta/core/browser";
import { domToRichText } from "../dom-parse.js";
import type { Player } from "./app.js";
import type { Action } from "./keys.js";

/**
 * Quick edit (key E): texts become editable in place; saving rewrites the embedded JSON and
 * produces a new standalone .html (File System Access API when available, download otherwise).
 */
export class QuickEdit {
  active = false;
  private dirty = new Set<number>();
  private banner: HTMLElement | null = null;
  private fileHandle: FileSystemFileHandle | null = null;
  /** Edits committed to the model but not yet written to a file. */
  private unsaved = false;

  constructor(private readonly p: Player) {}

  toggle(): void {
    if (this.active) this.exit();
    else this.enter();
  }

  enter(): void {
    this.active = true;
    this.p.root.classList.add("editing");
    this.p.setBlank(null);
    this.banner = document.createElement("div");
    this.banner.className = "edit-banner";
    this.banner.innerHTML = `<span><b>Edição rápida</b> · clique em um texto para editar · PageUp/PageDown trocam de slide · Ctrl+B/I/U formatam</span><button data-save>Salvar HTML</button><button data-exit>Concluir</button>`;
    this.banner.querySelector("[data-save]")!.addEventListener("click", () => void this.save());
    this.banner.querySelector("[data-exit]")!.addEventListener("click", () => this.exit());
    this.p.root.appendChild(this.banner);
    this.p.slides.forEach((slide, i) => this.makeEditable(slide, i));
    this.p.chrome.update();
  }

  private makeEditable(slide: HTMLElement, i: number): void {
    for (const node of slide.querySelectorAll<HTMLElement>("[data-step]"))
      node.classList.add("revealed");
    for (const rt of slide.querySelectorAll<HTMLElement>(".rt[data-field]")) {
      rt.contentEditable = "true";
      rt.spellcheck = true;
      rt.lang = this.p.pres.meta.lang;
      rt.addEventListener("input", () => this.dirty.add(i));
      rt.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData("text/plain") ?? "";
        document.execCommand("insertText", false, text);
      });
    }
  }

  exit(): void {
    this.commit();
    this.active = false;
    this.p.root.classList.remove("editing");
    this.banner?.remove();
    this.banner = null;
    for (const rt of this.p.stage.querySelectorAll<HTMLElement>(".rt[contenteditable]"))
      rt.removeAttribute("contenteditable");
    this.p.slides.forEach((_, i) => this.p.rerenderSlide(i));
    this.p.chrome.update();
    if (this.unsaved)
      this.p.chrome.toast(
        "Alterações aplicadas nesta janela. Para gravar, abra a edição rápida (E) e clique em “Salvar HTML”.",
        5000,
      );
  }

  /** Copies edited DOM text back into the presentation model. */
  commit(): void {
    for (const i of this.dirty) {
      const slideEl = this.p.slides[i];
      const slide = this.p.visible[i];
      if (!slideEl || !slide) continue;
      let next: Slide = slide;
      for (const rt of slideEl.querySelectorAll<HTMLElement>(".rt[data-field]")) {
        const elId = rt.closest<HTMLElement>("[data-el-id]")?.dataset.elId;
        const field = rt.dataset.field;
        if (!elId || !field) continue;
        next = {
          ...next,
          elements: next.elements.map((e) =>
            e.id === elId ? setField(e, field, domToRichText(rt)) : e,
          ),
        };
      }
      const idx = this.p.pres.slides.findIndex((s) => s.id === slide.id);
      if (idx >= 0) {
        const slides = [...this.p.pres.slides];
        slides[idx] = next;
        this.p.pres = { ...this.p.pres, slides, version: this.p.pres.version + 1 };
        this.p.visible[i] = next;
        this.unsaved = true;
      }
    }
    this.dirty.clear();
  }

  onKey(e: KeyboardEvent, action: Action | undefined): boolean {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void this.save();
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      this.exit();
      return true;
    }
    const inText = (e.target as HTMLElement).isContentEditable;
    if (inText) {
      if (e.key === "PageDown" || e.key === "PageUp") {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        this.p.perform(e.key === "PageDown" ? "next" : "prev");
      }
      return true;
    }
    // Outside a text box navigation keeps working; blanking the screen makes no sense while editing.
    return action === "black" || action === "white";
  }

  async save(): Promise<void> {
    this.commit();
    const html = serializeDocument(this.p);
    const name = `${slug(this.p.pres.meta.title) || "apresentacao"}.html`;
    const picker = (
      window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }
    ).showSaveFilePicker;
    if (picker) {
      try {
        this.fileHandle ??= await picker({
          suggestedName: name,
          types: [{ description: "Apresentação HTML", accept: { "text/html": [".html"] } }],
        });
        const w = await this.fileHandle.createWritable();
        await w.write(html);
        await w.close();
        this.unsaved = false;
        this.p.chrome.toast("Arquivo salvo");
        return;
      } catch (err) {
        if ((err as DOMException).name === "AbortError") return;
        this.fileHandle = null;
      }
    }
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    this.unsaved = false;
    this.p.chrome.toast("Download do novo HTML iniciado");
  }
}

function setField(e: Element, field: string, value: RichText): Element {
  const path = field.split(".").map((k) => (/^\d+$/.test(k) ? Number(k) : k));
  const copy = structuredClone(e) as unknown as Record<string | number, unknown>;
  let obj: Record<string | number, unknown> = copy;
  for (let i = 0; i < path.length - 1; i++) {
    const next = obj[path[i]!];
    if (!next || typeof next !== "object") return e;
    obj = next as Record<string | number, unknown>;
  }
  obj[path[path.length - 1]!] = value;
  return copy as unknown as Element;
}

/** The current document with the runtime DOM removed and the JSON updated. */
export function serializeDocument(p: Player): string {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  const app = clone.querySelector("#app");
  if (app) {
    app.innerHTML = "";
    app.removeAttribute("data-blank");
    app.className = "deck";
  }
  clone.querySelector("body")?.removeAttribute("class");
  const data = clone.querySelector("#presentation");
  if (data) data.textContent = safeJson(p.pres);
  return `<!doctype html>\n${clone.outerHTML}`;
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
