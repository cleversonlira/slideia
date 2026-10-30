import { deepEqual, mainTextField } from "./content.js";
import type { Operation } from "./ops.js";
import type { Element, Presentation, RichText, Slide } from "./schema.js";

/**
 * Operations that turn `a` into `b` (ignoring `version`). Used by the editor's autosave and
 * undo/redo, and to describe manual edits to the AI.
 */
export function diffToOps(a: Presentation, b: Presentation): Operation[] {
  const ops: Operation[] = [];

  const metaPatch: Record<string, unknown> = {};
  const metaKeys = new Set([...Object.keys(a.meta), ...Object.keys(b.meta)]);
  for (const key of metaKeys) {
    const av = (a.meta as Record<string, unknown>)[key];
    const bv = (b.meta as Record<string, unknown>)[key];
    if (!deepEqual(av, bv)) metaPatch[key] = bv ?? null;
  }
  if (Object.keys(metaPatch).length) {
    ops.push({ op: "update_presentation", patch: metaPatch } as Operation);
  }

  const bIds = new Set(b.slides.map((s) => s.id));
  const aById = new Map(a.slides.map((s) => [s.id, s]));

  for (const s of a.slides) if (!bIds.has(s.id)) ops.push({ op: "remove_slide", slide: s.id });

  // Element removals come before any addition, so ids moved between slides are free again.
  const rest: Operation[] = [];
  for (const bs of b.slides) {
    const as = aById.get(bs.id);
    if (!as) continue;
    const d = diffSlide(as, bs);
    ops.push(...d.removes);
    rest.push(...d.rest);
  }

  const order = a.slides.map((s) => s.id).filter((id) => bIds.has(id));
  b.slides.forEach((s, i) => {
    if (aById.has(s.id)) return;
    const prev = i === 0 ? "start" : b.slides[i - 1]!.id;
    ops.push({ op: "add_slide", slide: s, after: prev });
    const at = prev === "start" ? 0 : order.indexOf(prev) + 1;
    order.splice(at, 0, s.id);
  });

  const target = b.slides.map((s) => s.id);
  if (!deepEqual(order, target)) ops.push({ op: "reorder_slides", order: target });

  return [...ops, ...rest];
}

function diffSlide(a: Slide, b: Slide): { removes: Operation[]; rest: Operation[] } {
  if (deepEqual(a, b)) return { removes: [], rest: [] };
  const aEls = new Map(a.elements.map((e) => [e.id, e]));
  const needsReplace =
    a.layout !== b.layout ||
    b.elements.some((e) => {
      const old = aEls.get(e.id);
      return old && (old.type !== e.type || old.slot !== e.slot);
    });
  if (needsReplace) return { removes: [], rest: [{ op: "replace_slide", slide: a.id, with: b }] };

  const ops: Operation[] = [];
  const removes: Operation[] = [];
  const patch: Record<string, unknown> = {};
  for (const key of ["variant", "background", "transition", "notes", "hidden"] as const) {
    if (!deepEqual(a[key], b[key])) patch[key] = b[key] ?? null;
  }
  if (Object.keys(patch).length) ops.push({ op: "update_slide", slide: a.id, patch } as Operation);

  const bIds = new Set(b.elements.map((e) => e.id));
  const order = a.elements.map((e) => e.id).filter((id) => bIds.has(id));
  for (const e of a.elements) {
    if (!bIds.has(e.id)) removes.push({ op: "remove_element", slide: a.id, element: e.id });
  }
  b.elements.forEach((e, i) => {
    const old = aEls.get(e.id);
    if (!old) {
      const before = b.elements.slice(i + 1).find((n) => order.includes(n.id))?.id;
      ops.push(
        before
          ? { op: "add_element", slide: a.id, element: e, before }
          : { op: "add_element", slide: a.id, element: e },
      );
      const at = before ? order.indexOf(before) : order.length;
      order.splice(at, 0, e.id);
      return;
    }
    ops.push(...diffElement(a.id, old, e));
  });

  const target = b.elements.map((e) => e.id);
  if (!deepEqual(order, target)) ops.push({ op: "reorder_elements", slide: a.id, order: target });
  return { removes, rest: ops };
}

function diffElement(slideId: string, a: Element, b: Element): Operation[] {
  if (deepEqual(a, b)) return [];
  const changed = new Set<string>();
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
      changed.add(key);
  }
  const field = mainTextField(a.type);
  if (
    field &&
    changed.size === 1 &&
    changed.has(field) &&
    (b as Record<string, unknown>)[field] !== undefined
  ) {
    return [
      {
        op: "update_text",
        slide: slideId,
        element: a.id,
        text: (b as unknown as Record<string, RichText>)[field]!,
      },
    ];
  }
  const patch: Record<string, unknown> = {};
  for (const key of changed) patch[key] = (b as Record<string, unknown>)[key] ?? null;
  return [{ op: "update_element", slide: slideId, element: a.id, patch }];
}
