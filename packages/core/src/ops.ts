import { z } from "zod";
import {
  clone,
  deepEqual,
  mainTextField,
  mapElementRichText,
  mapElementStrings,
} from "./content.js";
import { PresentationError, issuesFromZod, type Issue, type IssuePath } from "./errors.js";
import { IdAllocator } from "./ids.js";
import { LAYOUTS, OVERFLOW_SLOT, findFreeSlot } from "./layouts.js";
import { toRichText } from "./markdown.js";
import {
  assignSlots,
  assertPresentation,
  checkSlot,
  normalizeElement,
  normalizeSlide,
  stripUndefined,
} from "./normalize.js";
import { normalizeRichText } from "./richtext.js";
import {
  AssetRef,
  Background,
  ElementInput,
  Id,
  LayoutId,
  RichTextInput,
  SlideInput,
  ThemeId,
  ThemeOverrides,
  Transition,
  type Element,
  type Paragraph,
  type Presentation,
  type RichText,
  type Run,
  type Slide,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Operation schemas
// ---------------------------------------------------------------------------

const SlideRef = z
  .union([Id, z.number().int().min(1)])
  .describe(
    'Slide id (e.g. "s_ab12cd") or 1-based slide number (resolved before any operation runs).',
  );
const AfterRef = z
  .union([SlideRef, z.literal("start")])
  .describe(
    'Insert after this slide; "start" inserts at the beginning. Omit to append at the end.',
  );

export const Operation = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("update_text"),
      slide: SlideRef,
      element: Id,
      text: RichTextInput,
    })
    .strict()
    .describe(
      "Replace the main text of an element (title/text/quote text, image caption, stat label).",
    ),
  z
    .object({
      op: z.literal("update_element"),
      slide: SlideRef,
      element: Id,
      patch: z
        .record(z.string(), z.unknown())
        .describe("Fields to change (merged). Cannot change id or type."),
    })
    .strict()
    .describe("Change any fields of an element: chart data, table cells, icon, slot, animation…"),
  z
    .object({
      op: z.literal("add_element"),
      slide: SlideRef,
      element: ElementInput,
      before: Id.optional().describe("Insert before this element id. Default: at the end."),
    })
    .strict(),
  z.object({ op: z.literal("remove_element"), slide: SlideRef, element: Id }).strict(),
  z
    .object({
      op: z.literal("reorder_elements"),
      slide: SlideRef,
      order: z.array(Id).describe("All element ids of the slide in the new order."),
    })
    .strict(),
  z
    .object({
      op: z.literal("update_slide"),
      slide: SlideRef,
      patch: z
        .object({
          layout: LayoutId.optional().describe(
            "Elements are moved to matching slots of the new layout.",
          ),
          variant: z.string().max(20).nullable().optional(),
          background: Background.nullable().optional(),
          transition: Transition.nullable().optional(),
          notes: RichTextInput.nullable().optional(),
          hidden: z.boolean().nullable().optional(),
        })
        .strict()
        .describe("null removes the field."),
    })
    .strict(),
  z.object({ op: z.literal("add_slide"), slide: SlideInput, after: AfterRef.optional() }).strict(),
  z.object({ op: z.literal("remove_slide"), slide: SlideRef }).strict(),
  z
    .object({
      op: z.literal("replace_slide"),
      slide: SlideRef,
      with: SlideInput.describe(
        "Full new content. Keeps the slide id unless another one is given.",
      ),
    })
    .strict()
    .describe("Rewrite a whole slide in place."),
  z
    .object({ op: z.literal("duplicate_slide"), slide: SlideRef, after: AfterRef.optional() })
    .strict()
    .describe("Copy a slide (new ids). Default: right after the original."),
  z
    .object({
      op: z.literal("reorder_slides"),
      order: z.array(SlideRef).describe("All slides, in the new order."),
    })
    .strict(),
  z.object({ op: z.literal("move_slide"), slide: SlideRef, after: AfterRef }).strict(),
  z
    .object({
      op: z.literal("update_presentation"),
      patch: z
        .object({
          title: z.string().min(1).max(200).optional(),
          author: z.string().max(120).nullable().optional(),
          lang: z
            .string()
            .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/)
            .optional(),
          aspectRatio: z.enum(["16:9", "4:3"]).optional(),
          theme: ThemeId.optional(),
          themeOverrides: ThemeOverrides.nullable().optional(),
          defaultTransition: Transition.optional(),
        })
        .strict(),
    })
    .strict()
    .describe("Change title, theme, aspect ratio, default transition…"),
  z
    .object({
      op: z.literal("find_replace"),
      find: z.string().min(1).max(500),
      replace: z.string().max(2000),
      matchCase: z.boolean().optional(),
      wholeWord: z.boolean().optional(),
      slides: z.array(SlideRef).optional().describe("Limit to these slides. Default: all."),
      includeNotes: z.boolean().optional().describe("Default true."),
    })
    .strict(),
  z
    .object({
      op: z.literal("set_image"),
      slide: SlideRef,
      element: Id,
      asset: AssetRef,
      alt: z.string().max(500).optional(),
    })
    .strict(),
]);
export type Operation = z.infer<typeof Operation>;
export const Operations = z.array(Operation).min(1).max(100);

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export interface ApplyResult {
  presentation: Presentation;
  changed: boolean;
  /** Ids of slides/elements affected, plus "meta" and "order" for presentation-level changes. */
  touched: string[];
  /** One human-readable line per operation. */
  summary: string[];
  /** Non-fatal notes, e.g. elements moved to the hidden overflow slot. */
  notes: string[];
}

class OpFailure extends Error {
  constructor(
    readonly path: IssuePath,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

/**
 * Applies operations atomically: either all succeed or a PresentationError is thrown and the
 * input is untouched. Slide numbers are resolved against the initial state.
 */
export function applyOps(input: Presentation, rawOps: unknown): ApplyResult {
  const parsed = Operations.safeParse(rawOps);
  if (!parsed.success) throw new PresentationError(issuesFromZod(parsed.error, ["operations"]));
  const ops = parsed.data;

  const pres = clone(input);
  const numberToId = new Map(input.slides.map((s, i) => [i + 1, s.id]));
  const alloc = new IdAllocator(allIds(pres));
  const touched = new Set<string>();
  const summary: string[] = [];
  const notes: string[] = [];

  ops.forEach((op, index) => {
    const base: IssuePath = ["operations", index];
    try {
      summary.push(applyOne(pres, op, { base, numberToId, alloc, touched, notes }));
    } catch (err) {
      if (err instanceof OpFailure) {
        throw new PresentationError([
          {
            path: [...base, ...err.path],
            message: err.message,
            ...(err.hint ? { hint: err.hint } : {}),
          },
        ]);
      }
      if (err instanceof PresentationError) {
        throw new PresentationError(err.issues.map((i) => ({ ...i, path: [...base, ...i.path] })));
      }
      throw err;
    }
  });

  const changed = !deepEqual(stripVersion(pres), stripVersion(input));
  if (changed) pres.version = input.version + 1;
  return { presentation: assertPresentation(pres), changed, touched: [...touched], summary, notes };
}

interface Ctx {
  base: IssuePath;
  numberToId: Map<number, string>;
  alloc: IdAllocator;
  touched: Set<string>;
  notes: string[];
}

function stripVersion(p: Presentation): Omit<Presentation, "version"> {
  const { version: _v, ...rest } = p;
  return rest;
}

function allIds(p: Presentation): string[] {
  return p.slides.flatMap((s) => [s.id, ...s.elements.map((e) => e.id)]);
}

function resolveSlideIndex(
  pres: Presentation,
  ref: string | number,
  ctx: Ctx,
  field = "slide",
): number {
  const id = typeof ref === "number" ? ctx.numberToId.get(ref) : ref;
  const idx = id === undefined ? -1 : pres.slides.findIndex((s) => s.id === id);
  if (idx < 0) {
    throw new OpFailure(
      [field],
      typeof ref === "number" ? `Slide number ${ref} does not exist` : `Slide "${ref}" not found`,
      `The presentation has ${pres.slides.length} slides; call get_presentation for current ids.`,
    );
  }
  return idx;
}

function resolveAfter(
  pres: Presentation,
  after: string | number | undefined,
  ctx: Ctx,
  fallback: number,
): number {
  if (after === undefined) return fallback;
  if (after === "start") return 0;
  return resolveSlideIndex(pres, after, ctx, "after") + 1;
}

function findElement(slide: Slide, id: string): { el: Element; index: number } {
  const index = slide.elements.findIndex((e) => e.id === id);
  if (index < 0) {
    throw new OpFailure(
      ["element"],
      `Element "${id}" not found on slide "${slide.id}"`,
      `Elements on this slide: ${slide.elements.map((e) => `${e.id} (${e.type})`).join(", ") || "none"}`,
    );
  }
  return { el: slide.elements[index]!, index };
}

function slideLabel(pres: Presentation, slide: Slide): string {
  return `slide ${pres.slides.indexOf(slide) + 1}`;
}

function applyOne(pres: Presentation, op: Operation, ctx: Ctx): string {
  switch (op.op) {
    case "update_text": {
      const slide = pres.slides[resolveSlideIndex(pres, op.slide, ctx)]!;
      const { el, index } = findElement(slide, op.element);
      const field = mainTextField(el.type);
      if (!field) {
        throw new OpFailure(
          ["element"],
          `Element "${el.id}" (${el.type}) has no main text`,
          "Use update_element instead.",
        );
      }
      slide.elements[index] = { ...el, [field]: toRichText(op.text) } as Element;
      ctx.touched.add(el.id);
      return `${slideLabel(pres, slide)}: text of ${el.id} updated`;
    }
    case "update_element": {
      const slide = pres.slides[resolveSlideIndex(pres, op.slide, ctx)]!;
      const { el, index } = findElement(slide, op.element);
      const patch = { ...op.patch };
      if ("id" in patch || "type" in patch) {
        throw new OpFailure(
          ["patch"],
          "id and type cannot be changed",
          "Remove the element and add a new one instead.",
        );
      }
      const merged: Record<string, unknown> = { ...el, ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === null) delete merged[k];
      const parsed = ElementInput.safeParse(merged);
      if (!parsed.success) throw new PresentationError(issuesFromZod(parsed.error, ["patch"]));
      const slot = parsed.data.slot ?? el.slot;
      if (slot !== el.slot) {
        const count = slide.elements.filter((e, i) => i !== index && e.slot === slot).length + 1;
        const problem = checkSlot(slide.layout, slot, el.type, count);
        if (problem) throw new OpFailure(["patch", "slot"], problem.message, problem.hint);
      }
      const issues: Issue[] = [];
      const local = new IdAllocator();
      const next = normalizeElement({ ...parsed.data, id: el.id }, slot, local, ["patch"], issues);
      slide.elements[index] = next;
      ctx.touched.add(el.id);
      return `${slideLabel(pres, slide)}: ${el.id} updated (${Object.keys(patch).join(", ")})`;
    }
    case "add_element": {
      const slide = pres.slides[resolveSlideIndex(pres, op.slide, ctx)]!;
      const issues: Issue[] = [];
      const counts = new Map<string, number>();
      for (const e of slide.elements) counts.set(e.slot, (counts.get(e.slot) ?? 0) + 1);
      let slot = op.element.slot;
      if (slot) {
        const problem = checkSlot(slide.layout, slot, op.element.type, (counts.get(slot) ?? 0) + 1);
        if (problem) throw new OpFailure(["element", "slot"], problem.message, problem.hint);
      } else {
        const free = findFreeSlot(slide.layout, op.element.type, counts);
        if (!free) {
          throw new OpFailure(
            ["element"],
            `No free slot for a "${op.element.type}" element in layout "${slide.layout}"`,
            `Slots: ${LAYOUTS[slide.layout].slots.map((s) => `${s.name}(${s.accepts.join("/")}, max ${s.max ?? 1})`).join(", ")}`,
          );
        }
        slot = free.name;
      }
      const el = normalizeElement(op.element, slot, ctx.alloc, ["element"], issues);
      if (issues.length) throw new PresentationError(issues);
      let at = slide.elements.length;
      if (op.before) at = findElement(slide, op.before).index;
      slide.elements.splice(at, 0, el);
      ctx.touched.add(slide.id).add(el.id);
      return `${slideLabel(pres, slide)}: ${el.type} ${el.id} added to ${slot}`;
    }
    case "remove_element": {
      const slide = pres.slides[resolveSlideIndex(pres, op.slide, ctx)]!;
      const { el, index } = findElement(slide, op.element);
      slide.elements.splice(index, 1);
      ctx.alloc.release(el.id);
      ctx.touched.add(slide.id).add(el.id);
      return `${slideLabel(pres, slide)}: ${el.id} removed`;
    }
    case "reorder_elements": {
      const slide = pres.slides[resolveSlideIndex(pres, op.slide, ctx)]!;
      const current = slide.elements.map((e) => e.id);
      if (op.order.length !== current.length || !current.every((id) => op.order.includes(id))) {
        throw new OpFailure(
          ["order"],
          "order must list every element id of the slide exactly once",
          `Current: ${current.join(", ")}`,
        );
      }
      slide.elements = op.order.map((id) => slide.elements.find((e) => e.id === id)!);
      ctx.touched.add(slide.id);
      return `${slideLabel(pres, slide)}: elements reordered`;
    }
    case "update_slide": {
      const idx = resolveSlideIndex(pres, op.slide, ctx);
      const slide = pres.slides[idx]!;
      const p = op.patch;
      const next: Record<string, unknown> = { ...slide };
      if (p.layout && p.layout !== slide.layout) {
        next.layout = p.layout;
        next.elements = remapElements(slide, p.layout, ctx, pres);
        if (!LAYOUTS[p.layout].variants?.includes(String(slide.variant))) delete next.variant;
      }
      for (const key of ["variant", "background", "transition", "hidden"] as const) {
        if (p[key] === null) delete next[key];
        else if (p[key] !== undefined) next[key] = p[key];
      }
      if (p.notes === null) delete next.notes;
      else if (p.notes !== undefined) next.notes = toRichText(p.notes);
      if (next.hidden === false) delete next.hidden;
      const layout = LAYOUTS[next.layout as Slide["layout"]];
      if (next.variant !== undefined && !layout.variants?.includes(next.variant as string)) {
        throw new OpFailure(
          ["patch", "variant"],
          `Layout "${layout.id}" has no variant "${String(next.variant)}"`,
          layout.variants ? `Use: ${layout.variants.join(", ")}` : "Remove variant.",
        );
      }
      pres.slides[idx] = next as Slide;
      ctx.touched.add(slide.id);
      return `${slideLabel(pres, pres.slides[idx]!)}: ${Object.keys(p).join(", ")} changed`;
    }
    case "add_slide": {
      const issues: Issue[] = [];
      const slide = normalizeSlide(op.slide, ctx.alloc, ["slide"], issues);
      if (issues.length) throw new PresentationError(issues);
      const at = resolveAfter(pres, op.after, ctx, pres.slides.length);
      pres.slides.splice(at, 0, slide);
      ctx.touched.add(slide.id).add("order");
      return `slide ${at + 1} added (${slide.layout}, ${slide.id})`;
    }
    case "remove_slide": {
      const idx = resolveSlideIndex(pres, op.slide, ctx);
      const [removed] = pres.slides.splice(idx, 1);
      releaseSlide(removed!, ctx);
      ctx.touched.add(removed!.id).add("order");
      return `slide ${idx + 1} removed (${removed!.id})`;
    }
    case "replace_slide": {
      const idx = resolveSlideIndex(pres, op.slide, ctx);
      const old = pres.slides[idx]!;
      releaseSlide(old, ctx);
      const issues: Issue[] = [];
      const slide = normalizeSlide(
        { ...op.with, id: op.with.id ?? old.id },
        ctx.alloc,
        ["with"],
        issues,
      );
      if (issues.length) throw new PresentationError(issues);
      pres.slides[idx] = slide;
      ctx.touched.add(old.id).add(slide.id);
      for (const e of [...old.elements, ...slide.elements]) ctx.touched.add(e.id);
      return `slide ${idx + 1} replaced (${slide.layout})`;
    }
    case "duplicate_slide": {
      const idx = resolveSlideIndex(pres, op.slide, ctx);
      const original = pres.slides[idx]!;
      const copy: Slide = {
        ...clone(original),
        id: ctx.alloc.next("s"),
        elements: original.elements.map((e) => ({ ...clone(e), id: ctx.alloc.next("e") })),
      };
      const at = resolveAfter(pres, op.after, ctx, idx + 1);
      pres.slides.splice(at, 0, copy);
      ctx.touched.add(copy.id).add("order");
      return `slide ${idx + 1} duplicated as slide ${at + 1} (${copy.id})`;
    }
    case "reorder_slides": {
      const ids = op.order.map((ref, i) => {
        const idx = resolveSlideIndex(pres, ref, ctx, `order[${i}]`);
        return pres.slides[idx]!.id;
      });
      if (ids.length !== pres.slides.length || new Set(ids).size !== ids.length) {
        throw new OpFailure(
          ["order"],
          `order must list all ${pres.slides.length} slides exactly once`,
          "Use move_slide to move a single slide.",
        );
      }
      pres.slides = ids.map((id) => pres.slides.find((s) => s.id === id)!);
      ctx.touched.add("order");
      return "slides reordered";
    }
    case "move_slide": {
      const from = resolveSlideIndex(pres, op.slide, ctx);
      const [slide] = pres.slides.splice(from, 1);
      const at = resolveAfter(pres, op.after, ctx, pres.slides.length);
      pres.slides.splice(at, 0, slide!);
      ctx.touched.add("order");
      return `slide ${from + 1} moved to position ${at + 1}`;
    }
    case "update_presentation": {
      const meta: Record<string, unknown> = { ...pres.meta };
      for (const [k, v] of Object.entries(op.patch)) {
        if (v === null) delete meta[k];
        else if (v !== undefined) meta[k] = v;
      }
      pres.meta = stripUndefined(meta) as Presentation["meta"];
      ctx.touched.add("meta");
      return `presentation: ${Object.keys(op.patch).join(", ")} changed`;
    }
    case "find_replace": {
      const scope = op.slides
        ? new Set(op.slides.map((r) => pres.slides[resolveSlideIndex(pres, r, ctx, "slides")]!.id))
        : null;
      const re = buildFindRegex(op.find, op);
      let count = 0;
      pres.slides = pres.slides.map((slide) => {
        if (scope && !scope.has(slide.id)) return slide;
        let slideCount = 0;
        const elements = slide.elements.map((el) => {
          let n = 0;
          let next = mapElementRichText<Element, RichText, RichText>(el, (rt) => {
            const r = replaceInRichText(rt, re, op.replace);
            n += r.count;
            return r.value;
          });
          next = mapElementStrings(next, (s) => {
            const r = s.replace(re, () => {
              n++;
              return op.replace;
            });
            return r;
          });
          if (n) ctx.touched.add(el.id);
          slideCount += n;
          return n ? next : el;
        });
        let notes = slide.notes;
        if (notes && op.includeNotes !== false) {
          const r = replaceInRichText(notes, re, op.replace);
          if (r.count) {
            notes = r.value;
            slideCount += r.count;
            ctx.touched.add(slide.id);
          }
        }
        count += slideCount;
        return slideCount ? stripUndefined({ ...slide, elements, notes }) : slide;
      });
      return `find_replace "${op.find}": ${count} replacement(s)`;
    }
    case "set_image": {
      const slide = pres.slides[resolveSlideIndex(pres, op.slide, ctx)]!;
      const { el, index } = findElement(slide, op.element);
      if (el.type !== "image") {
        throw new OpFailure(
          ["element"],
          `Element "${el.id}" is a ${el.type}, not an image`,
          "Use add_element to add an image.",
        );
      }
      const next = { ...el, asset: op.asset };
      if (op.alt !== undefined) next.alt = op.alt;
      delete next.crop;
      slide.elements[index] = next;
      ctx.touched.add(el.id);
      return `${slideLabel(pres, slide)}: image ${el.id} replaced`;
    }
  }
}

function releaseSlide(slide: Slide, ctx: Ctx): void {
  ctx.alloc.release(slide.id);
  for (const e of slide.elements) ctx.alloc.release(e.id);
}

/** Moves elements to slots of a new layout; what does not fit goes to the hidden overflow slot. */
function remapElements(
  slide: Slide,
  layout: Slide["layout"],
  ctx: Ctx,
  pres: Presentation,
): Element[] {
  const issues: Issue[] = [];
  const counts = new Map<string, number>();
  const wanted = slide.elements.map((e) => {
    // Keep the same slot name when the new layout has it and accepts the type.
    const problem = checkSlot(layout, e.slot, e.type, (counts.get(e.slot) ?? 0) + 1);
    if (e.slot !== OVERFLOW_SLOT && !problem) {
      counts.set(e.slot, (counts.get(e.slot) ?? 0) + 1);
      return { type: e.type, slot: e.slot };
    }
    return { type: e.type };
  });
  const slots = assignSlots(layout, wanted, [], issues);
  return slide.elements.map((e, i) => {
    const slot = slots[i]!;
    if (slot === OVERFLOW_SLOT && e.slot !== OVERFLOW_SLOT) {
      ctx.notes.push(
        `${slideLabel(pres, slide)}: ${e.type} ${e.id} does not fit layout "${layout}" and was hidden (slot "overflow")`,
      );
    }
    return { ...e, slot };
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFindRegex(
  find: string,
  opts: { matchCase?: boolean | undefined; wholeWord?: boolean | undefined },
): RegExp {
  const body = escapeRegex(find);
  const src = opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
  return new RegExp(src, `gu${opts.matchCase ? "" : "i"}`);
}

/** Replaces across runs; the replacement takes the marks of the first matched character. */
export function replaceInRichText(
  rt: RichText,
  re: RegExp,
  replacement: string,
): { value: RichText; count: number } {
  let count = 0;
  const paragraphs = rt.paragraphs.map((p): Paragraph => {
    const text = p.runs.map((r) => r.text).join("");
    if (!text) return p;
    const owner: number[] = [];
    p.runs.forEach((r, ri) => {
      for (let i = 0; i < r.text.length; i++) owner.push(ri);
    });
    const runs: Run[] = [];
    const push = (t: string, ri: number) => {
      if (!t) return;
      const marks = p.runs[ri]?.marks;
      runs.push(marks ? { text: t, marks } : { text: t });
    };
    let last = 0;
    let local = 0;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (end === start) continue;
      for (let i = last; i < start; i++) push(text[i]!, owner[i]!);
      push(replacement, owner[start]!);
      last = end;
      local++;
    }
    if (local === 0) return p;
    count += local;
    for (let i = last; i < text.length; i++) push(text[i]!, owner[i]!);
    return { ...p, runs };
  });
  return { value: count ? normalizeRichText({ paragraphs }) : rt, count };
}
