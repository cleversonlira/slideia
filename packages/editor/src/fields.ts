import type { Operation } from "@slideia/core";
import { mainTextField, type Element, type RichText } from "@slideia/core/browser";

type Path = Array<string | number>;

export function parseField(field: string): Path {
  return field.split(".").map((k) => (/^\d+$/.test(k) ? Number(k) : k));
}

/** Reads a rich text field ("text", "rows.1.2", "items.0.text") of an element. */
export function getField(el: Element, field: string): RichText | undefined {
  let v: unknown = el;
  for (const k of parseField(field)) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<string | number, unknown>)[k];
  }
  return v as RichText | undefined;
}

/** Operation that writes a rich text field. */
export function fieldOp(slideId: string, el: Element, field: string, value: RichText): Operation {
  const path = parseField(field);
  if (path.length === 1 && path[0] === mainTextField(el.type)) {
    return { op: "update_text", slide: slideId, element: el.id, text: value };
  }
  const top = path[0] as string;
  const copy = structuredClone((el as Record<string, unknown>)[top]);
  let obj = copy as Record<string | number, unknown>;
  for (let i = 1; i < path.length - 1; i++) obj = obj[path[i]!] as Record<string | number, unknown>;
  if (path.length === 1)
    return { op: "update_element", slide: slideId, element: el.id, patch: { [top]: value } };
  obj[path[path.length - 1]!] = value;
  return { op: "update_element", slide: slideId, element: el.id, patch: { [top]: copy } };
}
