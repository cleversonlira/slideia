import type { Element, ElementInput, RichText } from "./schema.js";

export type FieldPath = Array<string | number>;

type AnyElement = Element | ElementInput;

/**
 * Calls `fn` for every rich text field of an element (stored or input form) and returns a copy
 * with the results. `fn` receives the field value and its path relative to the element.
 */
export function mapElementRichText<E extends AnyElement, In, Out>(
  el: E,
  fn: (value: In, path: FieldPath) => Out,
): E {
  const e = el as Record<string, unknown> & { type: string };
  const f = (v: unknown, path: FieldPath) => fn(v as In, path);
  switch (e.type) {
    case "title":
    case "text":
    case "quote":
      return { ...e, text: f(e.text, ["text"]) } as unknown as E;
    case "image":
      return (e.caption === undefined
        ? { ...e }
        : { ...e, caption: f(e.caption, ["caption"]) }) as unknown as E;
    case "stat":
      return { ...e, label: f(e.label, ["label"]) } as unknown as E;
    case "table":
      return {
        ...e,
        header: (e.header as unknown[]).map((c, i) => f(c, ["header", i])),
        rows: (e.rows as unknown[][]).map((row, r) => row.map((c, i) => f(c, ["rows", r, i]))),
      } as unknown as E;
    case "timeline":
      return {
        ...e,
        items: (e.items as Array<Record<string, unknown>>).map((it, i) =>
          it.text === undefined ? { ...it } : { ...it, text: f(it.text, ["items", i, "text"]) },
        ),
      } as unknown as E;
    default:
      return { ...e } as unknown as E;
  }
}

/** Rich text fields of a stored element. */
export function elementRichTexts(el: Element): Array<{ path: FieldPath; value: RichText }> {
  const out: Array<{ path: FieldPath; value: RichText }> = [];
  mapElementRichText<Element, RichText, RichText>(el, (value, path) => {
    out.push({ path, value });
    return value;
  });
  return out;
}

/** Plain string fields (not rich text) that hold visible text. */
export function mapElementStrings<E extends AnyElement>(
  el: E,
  fn: (value: string, path: FieldPath) => string,
): E {
  const e = { ...(el as Record<string, unknown>) } as Record<string, unknown> & { type: string };
  const opt = (key: string) => {
    if (typeof e[key] === "string") e[key] = fn(e[key], [key]);
  };
  switch (e.type) {
    case "image":
      opt("alt");
      break;
    case "chart":
      opt("title");
      e.labels = (e.labels as string[]).map((l, i) => fn(l, ["labels", i]));
      e.series = (e.series as Array<Record<string, unknown>>).map((s, i) => ({
        ...s,
        name: fn(s.name as string, ["series", i, "name"]),
      }));
      break;
    case "quote":
      opt("author");
      opt("role");
      break;
    case "stat":
      opt("value");
      break;
    case "timeline":
      e.items = (e.items as Array<Record<string, unknown>>).map((it, i) => ({
        ...it,
        date: fn(it.date as string, ["items", i, "date"]),
        title: fn(it.title as string, ["items", i, "title"]),
      }));
      break;
    default:
      break;
  }
  return e as unknown as E;
}

/** Field edited by `update_text` for each element type. */
export function mainTextField(type: Element["type"]): "text" | "caption" | "label" | null {
  switch (type) {
    case "title":
    case "text":
    case "quote":
      return "text";
    case "image":
      return "caption";
    case "stat":
      return "label";
    default:
      return null;
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a as object).filter(
    (k) => (a as Record<string, unknown>)[k] !== undefined,
  );
  const kb = Object.keys(b as object).filter(
    (k) => (b as Record<string, unknown>)[k] !== undefined,
  );
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}
