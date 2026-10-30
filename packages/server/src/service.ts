import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  IdAllocator,
  PresentationError,
  applyOps,
  checkDesign,
  diffToOps,
  loadPresentation,
  mainTextField,
  mapElementRichText,
  normalizePresentation,
  plainText,
  richTextToMarkdown,
  type DesignWarning,
  type Element,
  type Operation,
  type Presentation,
  type RichText,
  type Slide,
} from "@slideia/core";
import { buildStandaloneHtml, type AssetLoader } from "@slideia/renderer/node";
import type { Config } from "./config.js";
import { ImageError, decodeDataUri, fetchImage, placeholderImage, processImage } from "./images.js";
import type { AssetRow, Author, Channel, PresentationRepo } from "./repo.js";
import { MissingPresentation } from "./store.js";

export interface Links {
  editor(id: string, slide?: number): string;
  download(id: string): string;
  present(id: string): string;
  /** Public (signed) URL of an image, for the chat widget. Absent: images are inlined. */
  asset?(id: string): string;
}

export class NotFoundError extends Error {}
export class LimitError extends Error {}

export class ConflictError extends Error {
  constructor(
    message: string,
    readonly conflicts: string[],
    readonly currentVersion: number,
  ) {
    super(message);
  }
}

export interface ChangeEvent {
  id: string;
  version: number;
  author: Author;
  channel: Channel;
  touched: string[];
}

export interface ApplyResult {
  presentation: Presentation;
  changed: boolean;
  rebased: boolean;
  summary: string[];
  notes: string[];
  warnings: DesignWarning[];
}

export interface ServiceOptions {
  /** Shared emitter for live updates (one per process). */
  events?: EventEmitter;
  /** Local mode writes rendered .html files into the user's folder. */
  writeFiles?: boolean;
}

export function createEvents(): EventEmitter {
  const e = new EventEmitter();
  e.setMaxListeners(0);
  return e;
}

/** Business logic shared by the MCP tools and the editor API; scoped to one user (the repo). */
export class PresentationService {
  readonly events: EventEmitter;
  readonly writeFiles: boolean;

  constructor(
    readonly repo: PresentationRepo,
    readonly config: Config,
    public links: Links,
    opts: ServiceOptions = {},
  ) {
    this.events = opts.events ?? createEvents();
    this.writeFiles = opts.writeFiles ?? true;
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async get(id: string): Promise<Presentation> {
    const p = await this.repo.get(id);
    if (!p)
      throw new NotFoundError(
        `Presentation "${id}" not found. Call list_presentations to see the available ids.`,
      );
    return p;
  }

  list(query?: string, limit?: number) {
    return this.repo.list(query, limit);
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  async create(
    input: unknown,
    author: Author,
    channel: Channel,
  ): Promise<{ presentation: Presentation; warnings: DesignWarning[]; notes: string[] }> {
    if ((await this.repo.count()) >= this.config.limits.presentations) {
      throw new LimitError(
        `Limit of ${this.config.limits.presentations} presentations reached; delete old ones first.`,
      );
    }
    const notes: string[] = [];
    const prepared = await this.internalizeImages(input, notes);
    const presentation = normalizePresentation(prepared, { id: new IdAllocator().next("p") });
    this.checkSlideLimit(presentation);
    await this.repo.insert(presentation, author, channel, [
      `created with ${presentation.slides.length} slides`,
    ]);
    this.emit({
      id: presentation.id,
      version: presentation.version,
      author,
      channel,
      touched: ["*"],
    });
    return { presentation, warnings: checkDesign(presentation), notes };
  }

  /** Imports a stored/exported presentation JSON as a new presentation (new id). */
  async import(json: unknown, author: Author = "user"): Promise<Presentation> {
    if ((await this.repo.count()) >= this.config.limits.presentations) {
      throw new LimitError(`Limit of ${this.config.limits.presentations} presentations reached.`);
    }
    const loaded = loadPresentation(json);
    const presentation: Presentation = { ...loaded, id: new IdAllocator().next("p"), version: 1 };
    this.checkSlideLimit(presentation);
    await this.repo.insert(presentation, author, "import", ["imported"]);
    return presentation;
  }

  async duplicate(id: string): Promise<Presentation> {
    const src = await this.get(id);
    const copy: Presentation = {
      ...structuredClone(src),
      id: new IdAllocator().next("p"),
      version: 1,
      meta: { ...src.meta, title: `${src.meta.title} (cópia)`.slice(0, 200) },
    };
    await this.repo.insert(copy, "user", "editor", [`duplicated from ${id}`]);
    return copy;
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repo.delete(id))) throw new NotFoundError(`Presentation "${id}" not found.`);
  }

  /**
   * Applies operations with optimistic concurrency. If `expectedVersion` is behind, the batch is
   * re-applied on the latest version when it touches nothing changed since (rebase); otherwise a
   * ConflictError lists the conflicting ids.
   */
  async apply(
    id: string,
    expectedVersion: number,
    ops: unknown,
    author: Author,
    channel: Channel,
  ): Promise<ApplyResult> {
    const notes: string[] = [];
    const prepared = await this.internalizeImages(ops, notes);
    let out: { res: ReturnType<typeof applyOps>; rebased: boolean };
    try {
      out = await this.repo.update(id, async (current, ctx) => {
        if (expectedVersion > current.version) {
          throw new PresentationError([
            {
              path: ["expectedVersion"],
              message: `Version ${expectedVersion} does not exist yet (current is ${current.version}).`,
            },
          ]);
        }
        let res: ReturnType<typeof applyOps>;
        let rebased = false;
        if (expectedVersion < current.version) {
          const since = new Set(
            (await ctx.versionsSince(expectedVersion)).flatMap((v) => v.touched),
          );
          try {
            res = applyOps(current, prepared);
          } catch (err) {
            if (err instanceof PresentationError) {
              throw new ConflictError(
                `The presentation changed since version ${expectedVersion} (now ${current.version}) and the edits no longer apply: ${err.message}`,
                [],
                current.version,
              );
            }
            throw err;
          }
          const clashes = since.has("*") ? res.touched : res.touched.filter((t) => since.has(t));
          if (clashes.length) {
            throw new ConflictError(
              `Conflict: ${clashes.join(", ")} changed since version ${expectedVersion} (now ${current.version}). Reload the presentation and redo these edits.`,
              clashes,
              current.version,
            );
          }
          rebased = true;
        } else {
          res = applyOps(current, prepared);
        }
        if (!res.changed) return { result: { res, rebased } };
        this.checkSlideLimit(res.presentation);
        return {
          save: {
            presentation: res.presentation,
            author,
            channel,
            summary: res.summary,
            touched: res.touched,
          },
          result: { res, rebased },
        };
      });
    } catch (err) {
      if (err instanceof MissingPresentation) throw new NotFoundError(err.message);
      throw err;
    }
    const { res, rebased } = out;
    if (res.changed) {
      this.emit({ id, version: res.presentation.version, author, channel, touched: res.touched });
    }
    return {
      presentation: res.presentation,
      changed: res.changed,
      rebased,
      summary: res.summary,
      notes: [...notes, ...res.notes],
      warnings: checkDesign(res.presentation),
    };
  }

  /** Restores an old version as a new version (history is kept). */
  async restore(
    id: string,
    version: number,
    author: Author,
    channel: Channel,
  ): Promise<ApplyResult> {
    const current = await this.get(id);
    const old = await this.repo.versionDoc(id, version);
    if (!old) throw new NotFoundError(`Version ${version} of "${id}" is no longer available.`);
    const ops = diffToOps(current, old);
    if (!ops.length) {
      return {
        presentation: current,
        changed: false,
        rebased: false,
        summary: [],
        notes: [],
        warnings: checkDesign(current),
      };
    }
    return this.apply(id, current.version, ops, author, channel);
  }

  private checkSlideLimit(p: Presentation): void {
    if (p.slides.length > this.config.limits.slides) {
      throw new LimitError(`A presentation can have at most ${this.config.limits.slides} slides.`);
    }
  }

  private emit(e: ChangeEvent): void {
    this.events.emit("change", e);
  }

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  /** Downloads/decodes an image, normalizes it and stores it as an asset. */
  async addImage(source: string): Promise<AssetRow> {
    const limit = this.config.limits.imageBytes;
    const raw = source.startsWith("data:")
      ? decodeDataUri(source, limit)
      : await fetchImage(source, limit);
    return this.storeImage(raw);
  }

  async storeImage(raw: Uint8Array): Promise<AssetRow> {
    const img = await processImage(raw, this.config.limits.imageMaxSide);
    if ((await this.repo.assetBytes()) + img.data.byteLength > this.config.limits.storageBytes) {
      throw new LimitError(
        `Image storage limit (${Math.round(this.config.limits.storageBytes / 1048576)} MB) reached.`,
      );
    }
    return this.repo.putAsset(img.data, img.mime, img.width, img.height);
  }

  /**
   * Replaces every `"asset": "<http(s) URL | data URI>"` inside `value` by "asset:<id>".
   * Failed downloads become a placeholder image and a note, so one bad URL does not lose the deck.
   */
  async internalizeImages(value: unknown, notes: string[]): Promise<unknown> {
    const cache = new Map<string, string>();
    const resolve = async (src: string): Promise<string> => {
      const hit = cache.get(src);
      if (hit) return hit;
      let ref: string;
      try {
        ref = `asset:${(await this.addImage(src)).id}`;
      } catch (err) {
        const reason = err instanceof ImageError ? err.message : "download failed";
        const ph = await placeholderImage();
        ref = `asset:${(await this.repo.putAsset(ph.data, ph.mime, ph.width, ph.height)).id}`;
        notes.push(
          `Image ${src.startsWith("data:") ? "(data URI)" : src} could not be used (${reason}); a placeholder was inserted. Use set_image with another URL, or ask the user to upload the image in the editor.`,
        );
      }
      cache.set(src, ref);
      return ref;
    };
    const walk = async (v: unknown): Promise<unknown> => {
      if (Array.isArray(v)) return Promise.all(v.map(walk));
      if (!v || typeof v !== "object") return v;
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v)) {
        if (
          k === "asset" &&
          typeof child === "string" &&
          /^(?:https?:\/\/|data:image\/)/i.test(child)
        ) {
          out[k] = await resolve(child);
        } else {
          out[k] = await walk(child);
        }
      }
      return out;
    };
    return walk(value);
  }

  assetLoader(): AssetLoader {
    return async (id) => this.repo.getAsset(id);
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  async renderHtml(
    id: string,
  ): Promise<{ html: string; warnings: string[]; presentation: Presentation }> {
    const presentation = await this.get(id);
    const { html, warnings } = await buildStandaloneHtml(presentation, {
      loadAsset: this.assetLoader(),
    });
    return { html, warnings, presentation };
  }

  /** Writes the standalone HTML into the user's folder. */
  async renderToFile(id: string): Promise<{ path: string; bytes: number; warnings: string[] }> {
    const { html, warnings, presentation } = await this.renderHtml(id);
    await mkdir(this.config.home, { recursive: true });
    const path = join(this.config.home, `${fileSlug(presentation.meta.title)}.html`);
    await writeFile(path, html);
    return { path, bytes: Buffer.byteLength(html), warnings };
  }

  // -------------------------------------------------------------------------
  // Views for the AI
  // -------------------------------------------------------------------------

  /** Compact text outline with ids (what the AI needs to edit). */
  outline(p: Presentation): string {
    const lines = [
      `# ${p.meta.title} (${p.id}) · version ${p.version} · theme ${p.meta.theme} · ${p.meta.aspectRatio} · ${p.slides.length} slides`,
    ];
    p.slides.forEach((s, i) => {
      lines.push(
        "",
        `## ${i + 1} · ${s.id} · ${s.layout}${s.variant ? `/${s.variant}` : ""}${s.hidden ? " · hidden" : ""}`,
      );
      for (const e of s.elements)
        lines.push(`- ${e.id} ${e.type} [${e.slot}]: ${elementSummary(e)}`);
      if (s.notes?.paragraphs.length) lines.push(`Notes: ${oneLine(plainText(s.notes), 300)}`);
    });
    return lines.join("\n");
  }

  /** Full JSON with rich text as Markdown (valid input format, token-friendly). */
  fullForAi(p: Presentation): unknown {
    const md = (rt: RichText) => richTextToMarkdown(rt);
    return {
      ...p,
      slides: p.slides.map((s) => ({
        ...s,
        elements: s.elements.map((e) => mapElementRichText<Element, RichText, string>(e, md)),
        ...(s.notes ? { notes: md(s.notes) } : {}),
      })),
    };
  }

  /** Readable description of what changed since `since` (used by get_changes). */
  async changesSince(
    id: string,
    since: number,
  ): Promise<{ text: string; version: number; byUser: number }> {
    const current = await this.get(id);
    if (since >= current.version)
      return { text: `No changes since version ${since}.`, version: current.version, byUser: 0 };
    const versions = await this.repo.versionsSince(id, since);
    const byUser = versions.filter((v) => v.author === "user").length;
    const old = await this.repo.versionDoc(id, since);
    const header = `Version ${since} → ${current.version}: ${versions.length} save(s), ${byUser} by the user in the editor, ${versions.length - byUser} by AI.`;
    if (!old) {
      return {
        text: `${header}\n${versions.flatMap((v) => v.summary.map((s) => `- v${v.version} (${v.author}): ${s}`)).join("\n")}`,
        version: current.version,
        byUser,
      };
    }
    const lines = diffToOps(old, current).flatMap((op) => describeOp(op, old, current));
    return {
      text: [header, ...lines.map((l) => `- ${l}`)].join("\n"),
      version: current.version,
      byUser,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function elementSummary(e: Element): string {
  switch (e.type) {
    case "title":
    case "text":
      return oneLine(richTextToMarkdown(e.text).replace(/\n/g, " ⏎ "), 220);
    case "quote":
      return `"${oneLine(plainText(e.text), 160)}"${e.author ? ` — ${e.author}` : ""}`;
    case "image":
      return `${e.asset.slice(0, 40)} alt="${oneLine(e.alt, 80)}"`;
    case "icon":
      return e.name;
    case "chart":
      return `${e.kind} ${e.labels.length} labels × ${e.series.map((s) => s.name).join(", ")}`;
    case "table":
      return `${e.rows.length}×${e.header.length}: ${e.header.map((h) => plainText(h)).join(" | ")}`;
    case "stat":
      return `${e.value} — ${oneLine(plainText(e.label), 80)}`;
    case "timeline":
      return e.items.map((i) => `${i.date}: ${i.title}`).join("; ");
  }
}

function slideTitle(s: Slide | undefined): string {
  const t = s?.elements.find((e) => e.type === "title");
  return t && t.type === "title" ? oneLine(plainText(t.text), 60) : (s?.layout ?? "?");
}

function slideRef(p: Presentation, id: string | number): string {
  const idx = typeof id === "number" ? id - 1 : p.slides.findIndex((s) => s.id === id);
  const s = p.slides[idx];
  return s ? `slide ${idx + 1} ("${slideTitle(s)}")` : `slide ${String(id)}`;
}

function elementText(e: Element | undefined): string {
  if (!e) return "";
  const field = mainTextField(e.type);
  const value = field ? (e as Record<string, unknown>)[field] : undefined;
  return value ? oneLine(plainText(value as RichText), 140) : elementSummary(e);
}

function findEl(p: Presentation, slide: string | number, el: string): Element | undefined {
  const s = typeof slide === "number" ? p.slides[slide - 1] : p.slides.find((x) => x.id === slide);
  return s?.elements.find((e) => e.id === el);
}

function describeOp(op: Operation, before: Presentation, after: Presentation): string[] {
  switch (op.op) {
    case "update_text": {
      const b = findEl(before, op.slide, op.element);
      const a = findEl(after, op.slide, op.element);
      return [
        `${slideRef(after, op.slide)}: ${a?.type ?? "element"} ${op.element} changed from "${elementText(b)}" to "${elementText(a)}"`,
      ];
    }
    case "update_element":
      return [
        `${slideRef(after, op.slide)}: ${findEl(after, op.slide, op.element)?.type ?? ""} ${op.element} changed (${Object.keys(op.patch).join(", ")})`,
      ];
    case "add_element": {
      const a = findEl(after, op.slide, op.element.id ?? "");
      return [
        `${slideRef(after, op.slide)}: added ${op.element.type}${a ? ` "${elementText(a)}"` : ""}`,
      ];
    }
    case "remove_element":
      return [
        `${slideRef(before, op.slide)}: removed ${findEl(before, op.slide, op.element)?.type ?? "element"} "${elementText(findEl(before, op.slide, op.element))}"`,
      ];
    case "reorder_elements":
      return [`${slideRef(after, op.slide)}: elements reordered`];
    case "update_slide":
      return [`${slideRef(after, op.slide)}: ${Object.keys(op.patch).join(", ")} changed`];
    case "add_slide":
      return [`slide added: ${slideRef(after, op.slide.id ?? "")}`];
    case "remove_slide":
      return [`removed ${slideRef(before, op.slide)}`];
    case "replace_slide":
      return [`${slideRef(after, op.slide)} rewritten (layout ${op.with.layout})`];
    case "reorder_slides":
    case "move_slide":
      return ["slides reordered"];
    case "update_presentation":
      return [
        `presentation settings changed: ${Object.entries(op.patch)
          .map(([k, v]) => `${k} → ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
          .join(", ")}`,
      ];
    default:
      return [op.op];
  }
}

export function fileSlug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "apresentacao"
  );
}
