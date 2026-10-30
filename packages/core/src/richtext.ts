import { normalizeHex, isHex } from "./color.js";
import type { ColorRef, Marks, Paragraph, RichText, Run } from "./schema.js";

const MARK_ORDER = [
  "bold",
  "italic",
  "underline",
  "strike",
  "color",
  "highlight",
  "link",
  "script",
] as const;

function normalizeColor(c: ColorRef): ColorRef {
  return isHex(c) ? normalizeHex(c) : c;
}

/** Canonical marks object (fixed key order, no empty keys) or undefined. */
export function normalizeMarks(marks: Marks | undefined): Marks | undefined {
  if (!marks) return undefined;
  const out: Marks = {};
  for (const key of MARK_ORDER) {
    const v = marks[key];
    if (v === undefined) continue;
    if (key === "color" || key === "highlight") out[key] = normalizeColor(v as ColorRef);
    else if (key === "link") out.link = { href: (v as { href: string }).href };
    else (out as Record<string, unknown>)[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function marksEqual(a: Marks | undefined, b: Marks | undefined): boolean {
  return JSON.stringify(normalizeMarks(a) ?? {}) === JSON.stringify(normalizeMarks(b) ?? {});
}

export function normalizeParagraph(p: Paragraph): Paragraph {
  const runs: Run[] = [];
  for (const r of p.runs) {
    const text = r.text.replace(/\r\n?/g, "\n");
    if (!text) continue;
    const marks = normalizeMarks(r.marks);
    const prev = runs[runs.length - 1];
    if (prev && marksEqual(prev.marks, marks)) {
      prev.text += text;
    } else {
      runs.push(marks ? { text, marks } : { text });
    }
  }
  const out: Paragraph = { runs };
  if (p.align) out.align = p.align;
  if (p.list) out.list = { kind: p.list.kind, level: p.list.level };
  if (p.size && p.size !== "normal") out.size = p.size;
  return out;
}

/** Merges equal runs, drops empty runs and trims empty paragraphs at both ends. */
export function normalizeRichText(rt: RichText): RichText {
  const paragraphs = rt.paragraphs.map(normalizeParagraph);
  // A list item can be at most one level deeper than the previous paragraph.
  let prevLevel = 0;
  for (const p of paragraphs) {
    if (p.list) {
      p.list.level = Math.min(p.list.level, prevLevel + 1) as 1 | 2 | 3;
      prevLevel = p.list.level;
    } else {
      prevLevel = 0;
    }
  }
  let start = 0;
  let end = paragraphs.length;
  while (start < end && isEmptyParagraph(paragraphs[start]!)) start++;
  while (end > start && isEmptyParagraph(paragraphs[end - 1]!)) end--;
  return { paragraphs: paragraphs.slice(start, end) };
}

export function isEmptyParagraph(p: Paragraph): boolean {
  return p.runs.length === 0 && !p.list;
}

export function isEmptyRichText(rt: RichText | undefined): boolean {
  return !rt || rt.paragraphs.every((p) => p.runs.every((r) => !r.text.trim()));
}

export function emptyRichText(): RichText {
  return { paragraphs: [] };
}

export function richTextFromPlain(text: string): RichText {
  return normalizeRichText({
    paragraphs: text.split(/\r?\n/).map((line) => ({ runs: [{ text: line }] })),
  });
}

export function paragraphText(p: Paragraph): string {
  return p.runs.map((r) => r.text).join("");
}

/** Plain text, one line per paragraph. */
export function plainText(rt: RichText | undefined): string {
  if (!rt) return "";
  return rt.paragraphs.map(paragraphText).join("\n");
}

export function richTextEquals(a: RichText | undefined, b: RichText | undefined): boolean {
  return (
    JSON.stringify(normalizeRichText(a ?? emptyRichText())) ===
    JSON.stringify(normalizeRichText(b ?? emptyRichText()))
  );
}

export function countListItems(rt: RichText): number {
  return rt.paragraphs.filter((p) => p.list).length;
}
