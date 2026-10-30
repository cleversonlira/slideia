import {
  COLOR_TOKENS,
  normalizeRichText,
  type ColorRef,
  type Marks,
  type Paragraph,
  type RichText,
  type Run,
} from "@apresenta/core/browser";

/*
 * DOM → RichText. Accepts the renderer's own markup and the messier HTML produced by
 * contentEditable or pasted content; anything outside the schema is dropped.
 */

const BLOCKS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "LI",
  "SECTION",
  "ARTICLE",
  "PRE",
]);

function parseColor(value: string | null | undefined): ColorRef | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if ((COLOR_TOKENS as readonly string[]).includes(v)) return v as ColorRef;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v.toLowerCase();
  const tok = /^var\(--c-([a-z0-9]+)\)$/.exec(v);
  if (tok && (COLOR_TOKENS as readonly string[]).includes(tok[1]!)) return tok[1] as ColorRef;
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(v);
  if (rgb && (rgb[4] === undefined || Number(rgb[4]) > 0)) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  }
  return undefined;
}

function marksFor(el: HTMLElement, inherited: Marks): Marks {
  const m: Marks = { ...inherited };
  const tag = el.tagName;
  if (tag === "STRONG" || tag === "B") m.bold = true;
  if (tag === "EM" || tag === "I") m.italic = true;
  if (tag === "U") m.underline = true;
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") m.strike = true;
  if (tag === "SUP") m.script = "sup";
  if (tag === "SUB") m.script = "sub";
  if (tag === "A") {
    const href = el.getAttribute("href") ?? "";
    if (/^(?:https?:\/\/|mailto:)/i.test(href)) m.link = { href };
  }
  if (tag === "MARK")
    m.highlight = parseColor(el.dataset.hl) ?? parseColor(el.style.backgroundColor) ?? "highlight";
  const color = parseColor(el.dataset.color) ?? parseColor(el.style.color);
  if (color && tag !== "MARK") m.color = color;
  const bg = tag === "SPAN" ? parseColor(el.style.backgroundColor) : undefined;
  if (bg) m.highlight = bg;
  const fw = el.style.fontWeight;
  if (fw === "bold" || Number(fw) >= 600) m.bold = true;
  if (el.style.fontStyle === "italic") m.italic = true;
  const deco = el.style.textDecorationLine || el.style.textDecoration;
  if (deco.includes("underline")) m.underline = true;
  if (deco.includes("line-through")) m.strike = true;
  return m;
}

function paragraphAttrs(el: HTMLElement): Pick<Paragraph, "align" | "size"> {
  const out: Pick<Paragraph, "align" | "size"> = {};
  for (const c of el.classList) {
    if (c.startsWith("a-")) {
      const a = c.slice(2);
      if (a === "left" || a === "center" || a === "right" || a === "justify") out.align = a;
    }
    if (c.startsWith("s-")) {
      const s = c.slice(2);
      if (s === "small" || s === "large" || s === "display") out.size = s;
    }
  }
  const ta = el.style.textAlign;
  if (ta === "left" || ta === "center" || ta === "right" || ta === "justify") out.align = ta;
  return out;
}

export function domToRichText(root: Node): RichText {
  const paragraphs: Paragraph[] = [];
  let current: Paragraph | null = null;

  const ensure = (): Paragraph => {
    if (!current) {
      current = { runs: [] };
      paragraphs.push(current);
    }
    return current;
  };
  const pushText = (text: string, marks: Marks) => {
    if (!text) return;
    const run: Run = Object.keys(marks).length ? { text, marks: { ...marks } } : { text };
    ensure().runs.push(run);
  };

  const walk = (node: Node, marks: Marks, list: Paragraph["list"] | undefined, level: number) => {
    if (node.nodeType === 3) {
      pushText((node.textContent ?? "").replace(/[\r\n\t]+/g, " ").replace(/\u00a0/g, " "), marks);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE" || tag === "SVG" || tag === "IMG")
      return;
    if (tag === "BR") {
      pushText("\n", marks);
      return;
    }
    if (tag === "UL" || tag === "OL") {
      const kind = tag === "UL" ? "bullet" : "ordered";
      const next = Math.min(level + 1, 3) as 1 | 2 | 3;
      for (const child of el.childNodes) walk(child, marks, { kind, level: next }, next);
      current = null;
      return;
    }
    if (BLOCKS.has(tag)) {
      const isLi = tag === "LI";
      // A <p> directly inside <li> continues the li paragraph.
      const inLiP =
        tag === "P" &&
        el.parentElement?.tagName === "LI" &&
        el.parentElement.firstElementChild === el;
      if (!inLiP) {
        current = { runs: [], ...paragraphAttrs(el) };
        if (isLi && list) current.list = list;
        if (/^H[1-3]$/.test(tag)) current.size = tag === "H1" ? "display" : "large";
        paragraphs.push(current);
      } else if (current) {
        Object.assign(current, paragraphAttrs(el));
      }
      const childMarks = /^H[1-6]$/.test(tag) ? { ...marks, bold: true as const } : marks;
      for (const child of el.childNodes) walk(child, childMarks, list, level);
      current = null;
      return;
    }
    const m = marksFor(el, marks);
    for (const child of el.childNodes) walk(child, m, list, level);
  };

  for (const child of root.childNodes) walk(child, {}, undefined, 0);
  const cleaned = paragraphs.map((p) => {
    const { list, ...rest } = p;
    return list ? { ...rest, list } : rest;
  });
  return normalizeRichText({ paragraphs: cleaned });
}
