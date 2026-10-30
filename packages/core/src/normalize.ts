import { mapElementRichText } from "./content.js";
import { PresentationError, issuesFromZod, type Issue, type IssuePath } from "./errors.js";
import { IdAllocator } from "./ids.js";
import { LAYOUTS, OVERFLOW_SLOT, findFreeSlot, getSlot } from "./layouts.js";
import { toRichText } from "./markdown.js";
import {
  CURRENT_SCHEMA_VERSION,
  PresentationInputSchema,
  PresentationSchema,
  type Element,
  type ElementInput,
  type LayoutId,
  type Meta,
  type Presentation,
  type RichText,
  type RichTextInput,
  type Slide,
  type SlideInput,
} from "./schema.js";

export const DEFAULT_META = {
  lang: "pt-BR",
  aspectRatio: "16:9",
  theme: "executivo",
  defaultTransition: { type: "fade" },
} as const satisfies Partial<Meta>;

/** Drops keys whose value is undefined (keeps stored JSON canonical). */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = stripUndefined(v);
    return out as T;
  }
  return value;
}

function claimId(
  wanted: string | undefined,
  prefix: "s" | "e",
  alloc: IdAllocator,
  path: IssuePath,
  issues: Issue[],
): string {
  if (wanted === undefined) return alloc.next(prefix);
  if (!alloc.claim(wanted)) {
    issues.push({
      path,
      message: `Duplicate id "${wanted}"`,
      hint: "Ids must be unique; omit the id to get a new one.",
    });
    return alloc.next(prefix);
  }
  return wanted;
}

export function normalizeRich(input: RichTextInput): RichText {
  return toRichText(input);
}

export function normalizeElement(
  input: ElementInput,
  slot: string,
  alloc: IdAllocator,
  path: IssuePath,
  issues: Issue[],
): Element {
  const id = claimId(input.id, "e", alloc, [...path, "id"], issues);
  const converted = mapElementRichText<ElementInput, RichTextInput, RichText>(input, (v) =>
    toRichText(v),
  );
  return stripUndefined({ ...converted, id, slot }) as Element;
}

/** Validates an explicit slot for an element type; returns an issue message or null. */
export function checkSlot(
  layout: LayoutId,
  slot: string,
  type: Element["type"],
  count: number,
): { message: string; hint: string } | null {
  if (slot === OVERFLOW_SLOT) return null;
  const def = getSlot(layout, slot);
  const names = LAYOUTS[layout].slots.map((s) => s.name).join(", ");
  if (!def)
    return {
      message: `Slot "${slot}" does not exist in layout "${layout}"`,
      hint: `Valid slots: ${names}`,
    };
  if (!def.accepts.includes(type)) {
    return {
      message: `Slot "${slot}" does not accept "${type}" elements`,
      hint: `It accepts: ${def.accepts.join(", ")}`,
    };
  }
  if (count > (def.max ?? 1)) {
    return {
      message: `Slot "${slot}" holds at most ${def.max ?? 1} element(s)`,
      hint: "Move the extra element to another slot or slide.",
    };
  }
  return null;
}

/** Assigns slots to elements: explicit ones are validated, missing ones are inferred. */
export function assignSlots(
  layout: LayoutId,
  elements: ReadonlyArray<{ type: Element["type"]; slot?: string | undefined }>,
  path: IssuePath,
  issues: Issue[],
): string[] {
  const counts = new Map<string, number>();
  const slots: Array<string | undefined> = elements.map((e) => e.slot);
  elements.forEach((e, i) => {
    if (!e.slot) return;
    const n = (counts.get(e.slot) ?? 0) + 1;
    counts.set(e.slot, n);
    const problem = checkSlot(layout, e.slot, e.type, n);
    if (problem) issues.push({ path: [...path, i, "slot"], ...problem });
  });
  elements.forEach((e, i) => {
    if (e.slot) return;
    const free = findFreeSlot(layout, e.type, counts);
    if (!free) {
      const accepting = LAYOUTS[layout].slots.filter((s) => s.accepts.includes(e.type));
      issues.push({
        path: [...path, i],
        message: `No free slot for a "${e.type}" element in layout "${layout}"`,
        hint: accepting.length
          ? `Slots accepting it (${accepting.map((s) => s.name).join(", ")}) are full; use another slide or layout.`
          : `This layout has no slot for "${e.type}". Slots: ${LAYOUTS[layout].slots.map((s) => `${s.name}(${s.accepts.join("/")})`).join(", ")}`,
      });
      slots[i] = OVERFLOW_SLOT;
      return;
    }
    counts.set(free.name, (counts.get(free.name) ?? 0) + 1);
    slots[i] = free.name;
  });
  return slots as string[];
}

export function normalizeSlide(
  input: SlideInput,
  alloc: IdAllocator,
  path: IssuePath,
  issues: Issue[],
): Slide {
  const id = claimId(input.id, "s", alloc, [...path, "id"], issues);
  const layout = LAYOUTS[input.layout];
  if (input.variant !== undefined && !layout.variants?.includes(input.variant)) {
    issues.push({
      path: [...path, "variant"],
      message: `Layout "${input.layout}" has no variant "${input.variant}"`,
      hint: layout.variants
        ? `Use one of: ${layout.variants.join(", ")}`
        : "Remove the variant field.",
    });
  }
  const slots = assignSlots(input.layout, input.elements, [...path, "elements"], issues);
  const elements = input.elements.map((e, i) =>
    normalizeElement(e, slots[i]!, alloc, [...path, "elements", i], issues),
  );
  return stripUndefined({
    id,
    layout: input.layout,
    variant: input.variant,
    elements,
    background: input.background,
    transition: input.transition,
    notes: input.notes === undefined ? undefined : toRichText(input.notes),
    hidden: input.hidden || undefined,
  });
}

/** Parses AI/import input into a normalized presentation. Throws PresentationError. */
export function normalizePresentation(input: unknown, opts: { id?: string } = {}): Presentation {
  const parsed = PresentationInputSchema.safeParse(input);
  if (!parsed.success) throw new PresentationError(issuesFromZod(parsed.error));
  const data = parsed.data;
  const issues: Issue[] = [];
  const alloc = new IdAllocator();
  const slides = data.slides.map((s, i) => normalizeSlide(s, alloc, ["slides", i], issues));
  if (issues.length) throw new PresentationError(issues);

  const presentation: Presentation = stripUndefined({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: opts.id ?? data.id ?? new IdAllocator().next("p"),
    version: data.version ?? 1,
    meta: {
      title: data.meta.title,
      author: data.meta.author,
      lang: data.meta.lang ?? DEFAULT_META.lang,
      aspectRatio: data.meta.aspectRatio ?? DEFAULT_META.aspectRatio,
      theme: data.meta.theme ?? DEFAULT_META.theme,
      themeOverrides: data.meta.themeOverrides,
      defaultTransition: data.meta.defaultTransition ?? { ...DEFAULT_META.defaultTransition },
    },
    slides,
  });
  return assertPresentation(presentation);
}

/** Validates a stored presentation (throws PresentationError). */
export function assertPresentation(value: unknown): Presentation {
  const parsed = PresentationSchema.safeParse(value);
  if (!parsed.success) throw new PresentationError(issuesFromZod(parsed.error));
  const p = parsed.data;
  const issues: Issue[] = [];
  const ids = new Set<string>();
  p.slides.forEach((s, si) => {
    if (ids.has(s.id))
      issues.push({ path: ["slides", si, "id"], message: `Duplicate id "${s.id}"` });
    ids.add(s.id);
    const counts = new Map<string, number>();
    s.elements.forEach((e, ei) => {
      if (ids.has(e.id))
        issues.push({
          path: ["slides", si, "elements", ei, "id"],
          message: `Duplicate id "${e.id}"`,
        });
      ids.add(e.id);
      const n = (counts.get(e.slot) ?? 0) + 1;
      counts.set(e.slot, n);
      const problem = checkSlot(s.layout, e.slot, e.type, n);
      if (problem) issues.push({ path: ["slides", si, "elements", ei, "slot"], ...problem });
    });
  });
  if (issues.length) throw new PresentationError(issues);
  return p;
}

/**
 * Loads a presentation from any supported JSON: the stored format (possibly an older
 * schemaVersion) or the AI input format.
 */
export function loadPresentation(value: unknown): Presentation {
  if (
    value &&
    typeof value === "object" &&
    "schemaVersion" in value &&
    "id" in value &&
    "version" in value
  ) {
    return assertPresentation(migrate(value as Record<string, unknown>));
  }
  return normalizePresentation(value);
}

/** Upgrades stored documents from older schema versions. Only v1 exists so far. */
export function migrate(doc: Record<string, unknown>): Record<string, unknown> {
  const v = doc.schemaVersion;
  if (v === CURRENT_SCHEMA_VERSION) return doc;
  throw new PresentationError([
    {
      path: ["schemaVersion"],
      message: `Unsupported schemaVersion ${String(v)}`,
      hint: `Current is ${CURRENT_SCHEMA_VERSION}`,
    },
  ]);
}
