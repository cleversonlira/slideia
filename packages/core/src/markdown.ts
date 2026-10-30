/*
 * Extended Markdown ⇄ RichText.
 *
 * - `markdownToRichText` is lenient: it accepts the Markdown language models usually write.
 * - `richTextToMarkdown` emits a canonical form; `markdownToRichText(richTextToMarkdown(x))`
 *   equals `normalizeRichText(x)` for every valid rich text (property-tested).
 *
 * Syntax (one line = one paragraph; blank lines are only separators):
 *   **bold**  *italic* or _italic_  ~~strike~~  ++underline++  ==highlight==
 *   ^sup^  ~sub~  [text](https://link)  [text]{color=accent highlight=#ff0 u sup sub}
 *   - bullet / 1. ordered (nesting by indentation, up to 3 levels)
 *   # / ## headings → display / large size
 *   trailing "{align=center size=large}" sets paragraph attributes; "{}" is an empty paragraph
 *   a backslash escapes any character; a backslash at the end of a line is a line break
 */

import { COLOR_TOKENS } from "./constants.js";
import type { ColorRef, Marks, Paragraph, RichText, Run } from "./schema.js";
import { normalizeRichText } from "./richtext.js";

interface Tok {
  ch: string;
  esc: boolean;
}

const WS = new Set([" ", "\t"]);
const ALNUM = /[\p{L}\p{N}]/u;
const ALIGNS = ["left", "center", "right", "justify"] as const;
const SIZES = ["small", "normal", "large", "display"] as const;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function markdownToRichText(md: string): RichText {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const paragraphs: Paragraph[] = [];
  const indentStack: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    let { toks, cont } = tokenizeLine(lines[i]!);
    while (cont && i + 1 < lines.length) {
      i++;
      const next = tokenizeLine(lines[i]!);
      toks.push({ ch: "\n", esc: true }, ...next.toks);
      cont = next.cont;
    }
    if (cont) toks.push({ ch: "\\", esc: true });

    let indent = 0;
    let start = 0;
    while (start < toks.length && isWs(toks[start])) {
      indent += toks[start]!.ch === "\t" ? 2 : 1;
      start++;
    }
    toks = trimEnd(toks.slice(start));
    if (toks.length === 0) continue;

    const para: Paragraph = { runs: [] };
    const attrs = extractParagraphAttrs(toks);
    if (attrs) {
      toks = trimEnd(toks.slice(0, attrs.at));
      if (attrs.align) para.align = attrs.align;
      if (attrs.size) para.size = attrs.size;
    }

    if (!attrs && isRule(toks)) continue;

    let isList = false;
    if (toks.length > 0) {
      const heading = matchHeading(toks);
      if (heading) {
        toks = heading.rest;
        if (!para.size)
          para.size = heading.level === 1 ? "display" : heading.level === 2 ? "large" : "normal";
      } else {
        if (isUn(toks[0], ">")) toks = trimStart(toks.slice(1));
        const marker = matchListMarker(toks);
        if (marker) {
          isList = true;
          toks = marker.rest;
          while (indentStack.length && indent < indentStack[indentStack.length - 1]!)
            indentStack.pop();
          if (!indentStack.length || indent > indentStack[indentStack.length - 1]!)
            indentStack.push(indent);
          const level = Math.min(indentStack.length, 3) as 1 | 2 | 3;
          para.list = { kind: marker.kind, level };
        }
      }
    }
    if (!isList) indentStack.length = 0;

    parseInline(toks, 0, toks.length, {}, para.runs);
    paragraphs.push(para);
  }
  return normalizeRichText({ paragraphs });
}

function tokenizeLine(line: string): { toks: Tok[]; cont: boolean } {
  const toks: Tok[] = [];
  let cont = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\") {
      if (i + 1 < line.length) {
        toks.push({ ch: line[i + 1]!, esc: true });
        i++;
      } else {
        cont = true;
      }
    } else {
      toks.push({ ch: c, esc: false });
    }
  }
  return { toks, cont };
}

function isUn(t: Tok | undefined, ch: string): boolean {
  return !!t && !t.esc && t.ch === ch;
}

function isWs(t: Tok | undefined): boolean {
  return !!t && !t.esc && WS.has(t.ch);
}

function trimEnd(toks: Tok[]): Tok[] {
  let end = toks.length;
  while (end > 0 && isWs(toks[end - 1])) end--;
  return toks.slice(0, end);
}

function trimStart(toks: Tok[]): Tok[] {
  let s = 0;
  while (s < toks.length && isWs(toks[s])) s++;
  return toks.slice(s);
}

function raw(toks: Tok[], from = 0, to = toks.length): string {
  let s = "";
  for (let i = from; i < to; i++) s += toks[i]!.ch;
  return s;
}

function extractParagraphAttrs(
  toks: Tok[],
): { at: number; align?: Paragraph["align"]; size?: Paragraph["size"] } | null {
  const last = toks.length - 1;
  if (!isUn(toks[last], "}")) return null;
  let open = -1;
  for (let i = last - 1; i >= 0; i--) {
    const t = toks[i]!;
    if (t.esc) continue;
    if (t.ch === "}") return null;
    if (t.ch === "{") {
      open = i;
      break;
    }
  }
  if (open < 0) return null;
  if (open > 0 && !isWs(toks[open - 1])) return null;
  for (let i = open + 1; i < last; i++) if (toks[i]!.esc) return null;
  const body = raw(toks, open + 1, last).trim();
  const out: { at: number; align?: Paragraph["align"]; size?: Paragraph["size"] } = { at: open };
  if (!body) return out;
  for (const part of body.split(/\s+/)) {
    const [key, value] = part.split("=");
    if (key === "align" && (ALIGNS as readonly string[]).includes(value ?? "")) {
      out.align = value as Paragraph["align"];
    } else if (key === "size" && (SIZES as readonly string[]).includes(value ?? "")) {
      out.size = value as Paragraph["size"];
    } else {
      return null;
    }
  }
  return out;
}

function isRule(toks: Tok[]): boolean {
  if (toks.some((t) => t.esc)) return false;
  return /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(raw(toks));
}

function matchHeading(toks: Tok[]): { level: number; rest: Tok[] } | null {
  let n = 0;
  while (n < toks.length && isUn(toks[n], "#")) n++;
  if (n === 0 || n > 6) return null;
  if (n < toks.length && !isWs(toks[n])) return null;
  return { level: n, rest: trimStart(toks.slice(n)) };
}

function matchListMarker(toks: Tok[]): { kind: "bullet" | "ordered"; rest: Tok[] } | null {
  const first = toks[0];
  if (first && !first.esc && (first.ch === "-" || first.ch === "*" || first.ch === "+")) {
    if (toks.length === 1 || isWs(toks[1]))
      return { kind: "bullet", rest: trimStart(toks.slice(1)) };
    return null;
  }
  let n = 0;
  while (n < toks.length && n < 9 && !toks[n]!.esc && /[0-9]/.test(toks[n]!.ch)) n++;
  if (n === 0) return null;
  const punct = toks[n];
  if (!punct || punct.esc || (punct.ch !== "." && punct.ch !== ")")) return null;
  if (n + 1 < toks.length && !isWs(toks[n + 1])) return null;
  return { kind: "ordered", rest: trimStart(toks.slice(n + 1)) };
}

type InlineMatch =
  | { kind: "wrap"; innerFrom: number; innerTo: number; end: number; marks: Marks }
  | { kind: "literal"; text: string; end: number; marks?: Marks };

function parseInline(t: Tok[], from: number, to: number, marks: Marks, out: Run[]): void {
  let buf = "";
  const flush = () => {
    if (buf) out.push(makeRun(buf, marks));
    buf = "";
  };
  let i = from;
  while (i < to) {
    const tk = t[i]!;
    if (tk.esc) {
      buf += tk.ch;
      i++;
      continue;
    }
    const m = matchInline(t, i, to);
    if (!m) {
      buf += tk.ch;
      i++;
      continue;
    }
    flush();
    if (m.kind === "wrap") {
      parseInline(t, m.innerFrom, m.innerTo, mergeMarks(marks, m.marks), out);
    } else {
      out.push(makeRun(m.text, m.marks ? mergeMarks(marks, m.marks) : marks));
    }
    i = m.end;
  }
  flush();
}

function makeRun(text: string, marks: Marks): Run {
  return Object.keys(marks).length ? { text, marks: { ...marks } } : { text };
}

function mergeMarks(a: Marks, b: Marks): Marks {
  return { ...a, ...b };
}

function matchInline(t: Tok[], i: number, to: number): InlineMatch | null {
  const c = t[i]!.ch;
  const next = isUn(t[i + 1], c) && i + 1 < to;
  switch (c) {
    case "*":
      return next ? delim(t, i, to, "**", { bold: true }) : delim(t, i, to, "*", { italic: true });
    case "_":
      return delim(t, i, to, "_", { italic: true }, { intraword: true });
    case "~":
      return next
        ? delim(t, i, to, "~~", { strike: true })
        : delim(t, i, to, "~", { script: "sub" }, { noSpace: true });
    case "^":
      return delim(t, i, to, "^", { script: "sup" }, { noSpace: true });
    case "+":
      return next ? delim(t, i, to, "++", { underline: true }, { intraword: true }) : null;
    case "=":
      return next ? delim(t, i, to, "==", { highlight: "highlight" }, { intraword: true }) : null;
    case "[":
      return matchBracket(t, i, to);
    case "`": {
      for (let k = i + 1; k < to; k++) {
        if (isUn(t[k], "`"))
          return k > i + 1 ? { kind: "literal", text: raw(t, i + 1, k), end: k + 1 } : null;
      }
      return null;
    }
    case "<": {
      for (let k = i + 1; k < to; k++) {
        if (isUn(t[k], ">")) {
          const url = raw(t, i + 1, k);
          if (/^(?:https?:\/\/|mailto:)\S+$/i.test(url)) {
            return { kind: "literal", text: url, end: k + 1, marks: { link: { href: url } } };
          }
          return null;
        }
        if (isWs(t[k])) return null;
      }
      return null;
    }
    default:
      return null;
  }
}

function delim(
  t: Tok[],
  i: number,
  to: number,
  d: string,
  marks: Marks,
  opts: { intraword?: boolean; noSpace?: boolean } = {},
): InlineMatch | null {
  const innerFrom = i + d.length;
  if (innerFrom >= to || isWs(t[innerFrom])) return null;
  if (opts.intraword) {
    const prev = t[i - 1];
    if (prev && (ALNUM.test(prev.ch) || (!prev.esc && prev.ch === d[0]))) return null;
  }
  const ch = d[0]!;
  let k = innerFrom;
  while (k < to) {
    const tk = t[k]!;
    if (tk.esc) {
      k++;
      continue;
    }
    if (opts.noSpace && WS.has(tk.ch)) return null;
    if (tk.ch === "[") {
      const skip = skipBracketConstruct(t, k, to);
      if (skip > k) {
        k = skip;
        continue;
      }
    }
    if (tk.ch === "`") {
      let e = k + 1;
      while (e < to && !isUn(t[e], "`")) e++;
      if (e < to) {
        k = e + 1;
        continue;
      }
    }
    if (tk.ch !== ch) {
      k++;
      continue;
    }
    let run = 0;
    while (k + run < to && isUn(t[k + run], ch)) run++;
    // Pick the closer inside a run of delimiter chars ("***" closes "*x*" inside "**…**").
    let closer = -1;
    if (d.length === 2) {
      if (run === 3) closer = k + 1;
      else if (run >= 2) closer = k;
    } else if (ch === "*" || ch === "~") {
      if (run === 1) closer = k;
      else if (run >= 3) closer = k + run - 1;
    } else {
      closer = k + run - 1;
    }
    if (closer > innerFrom && !isWs(t[closer - 1])) {
      const after = t[closer + d.length];
      const intraOk = ch !== "_" || !after || !ALNUM.test(after.ch);
      if (intraOk)
        return { kind: "wrap", innerFrom, innerTo: closer, end: closer + d.length, marks };
    }
    k += run;
  }
  return null;
}

function findClose(t: Tok[], i: number, to: number, open: string, close: string): number {
  let depth = 0;
  for (let k = i; k < to; k++) {
    const tk = t[k]!;
    if (tk.esc) continue;
    if (tk.ch === open) depth++;
    else if (tk.ch === close) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** Returns the index after a `[..](..)` or `[..]{..}` construct starting at i, or i. */
function skipBracketConstruct(t: Tok[], i: number, to: number): number {
  const close = findClose(t, i, to, "[", "]");
  if (close < 0) return i;
  if (isUn(t[close + 1], "(")) {
    const end = findClose(t, close + 1, to, "(", ")");
    return end < 0 ? i : end + 1;
  }
  if (isUn(t[close + 1], "{")) {
    const end = findClose(t, close + 1, to, "{", "}");
    return end < 0 ? i : end + 1;
  }
  return i;
}

function matchBracket(t: Tok[], i: number, to: number): InlineMatch | null {
  const close = findClose(t, i, to, "[", "]");
  if (close < 0) return null;
  if (isUn(t[close + 1], "(")) {
    const end = findClose(t, close + 1, to, "(", ")");
    if (end < 0) return null;
    let href = raw(t, close + 2, end).trim();
    if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1);
    const titled = /^(\S+)\s+(?:"[^"]*"|'[^']*')$/.exec(href);
    if (titled) href = titled[1]!;
    if (!/^(?:https?:\/\/|mailto:)\S+$/i.test(href) || href.length > 2048) return null;
    return {
      kind: "wrap",
      innerFrom: i + 1,
      innerTo: close,
      end: end + 1,
      marks: { link: { href } },
    };
  }
  if (isUn(t[close + 1], "{")) {
    const end = findClose(t, close + 1, to, "{", "}");
    if (end < 0) return null;
    const marks = parseSpanAttrs(raw(t, close + 2, end));
    if (!marks) return null;
    return { kind: "wrap", innerFrom: i + 1, innerTo: close, end: end + 1, marks };
  }
  return null;
}

function parseColor(v: string | undefined): ColorRef | null {
  if (!v) return null;
  if ((COLOR_TOKENS as readonly string[]).includes(v)) return v as ColorRef;
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) return v;
  return null;
}

function parseSpanAttrs(body: string): Marks | null {
  const parts = body.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const marks: Marks = {};
  for (const p of parts) {
    const part = p.startsWith(".") ? p.slice(1) : p;
    const eq = part.indexOf("=");
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? undefined : part.slice(eq + 1);
    switch (key) {
      case "u":
      case "underline":
        marks.underline = true;
        break;
      case "b":
      case "bold":
        marks.bold = true;
        break;
      case "i":
      case "italic":
        marks.italic = true;
        break;
      case "s":
      case "strike":
        marks.strike = true;
        break;
      case "sup":
        marks.script = "sup";
        break;
      case "sub":
        marks.script = "sub";
        break;
      case "color": {
        const c = parseColor(value);
        if (!c) return null;
        marks.color = c;
        break;
      }
      case "highlight":
      case "hl": {
        const c = value === undefined ? "highlight" : parseColor(value);
        if (!c) return null;
        marks.highlight = c;
        break;
      }
      default:
        return null;
    }
  }
  return marks;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function richTextToMarkdown(input: RichText): string {
  const rt = normalizeRichText(input);
  const lines: string[] = [];
  const counters: number[] = [0, 0, 0];
  let prevKinds: Array<string | undefined> = [];

  for (const p of rt.paragraphs) {
    let prefix = "";
    if (p.list) {
      const lvl = p.list.level - 1;
      if (prevKinds[lvl] !== p.list.kind) counters[lvl] = 0;
      counters[lvl] = (counters[lvl] ?? 0) + 1;
      for (let d = lvl + 1; d < 3; d++) counters[d] = 0;
      prevKinds = prevKinds.slice(0, lvl + 1);
      prevKinds[lvl] = p.list.kind;
      prefix = "  ".repeat(lvl) + (p.list.kind === "bullet" ? "- " : `${counters[lvl]}. `);
    } else {
      counters.fill(0);
      prevKinds = [];
    }

    let body = serializeRuns(p.runs);
    if (!p.list) body = escapeLineStart(body);

    const attrs: string[] = [];
    if (p.align) attrs.push(`align=${p.align}`);
    if (p.size) attrs.push(`size=${p.size}`);
    const attrStr = attrs.length ? `{${attrs.join(" ")}}` : "";

    if (p.list) {
      const line = (body ? prefix + body : prefix.trimEnd()) + (attrStr ? ` ${attrStr}` : "");
      lines.push(line);
    } else if (!body) {
      lines.push(attrStr || "{}");
    } else {
      lines.push(body + (attrStr ? ` ${attrStr}` : ""));
    }
  }
  return lines.join("\n");
}

function escapeLineStart(s: string): string {
  if (/^(?:[#>-]|\+(?:[ \t]|$))/.test(s)) return `\\${s}`;
  const m = /^(\d{1,9})([.)])/.exec(s);
  if (m) return `${m[1]}\\${s.slice(m[1]!.length)}`;
  return s;
}

const ALWAYS_ESCAPE = new Set(["\\", "*", "_", "~", "^", "[", "]", "{", "}", "`", "<"]);

function escapeText(text: string, opts: { leadingWs: boolean; trailingWs: boolean }): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\n") {
      out += "\\\n";
      continue;
    }
    const isWsChar = c === " " || c === "\t";
    if (
      ALWAYS_ESCAPE.has(c) ||
      (isWsChar && ((opts.leadingWs && i === 0) || (opts.trailingWs && i === text.length - 1))) ||
      ((c === "+" || c === "=") &&
        (i === 0 || i === text.length - 1 || text[i - 1] === c || text[i + 1] === c))
    ) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return out;
}

function serializeRuns(runs: Run[]): string {
  let out = "";
  runs.forEach((run, idx) => {
    out += serializeRun(run, out.slice(-1), idx === 0, idx === runs.length - 1);
  });
  return out;
}

const DELIM_CHARS = new Set(["*", "_", "~", "+", "=", "^"]);

function serializeRun(run: Run, prevChar: string, first: boolean, last: boolean): string {
  const m = run.marks ?? {};
  let s = shortForm(run, first, last);
  if (!m.link) {
    const c0 = s[0] ?? "";
    // A closer immediately followed by an opener of the same char is ambiguous, and ++/== cannot
    // open right after a letter: use the unambiguous span form instead.
    const conflict =
      (DELIM_CHARS.has(c0) && prevChar === c0) ||
      ((s.startsWith("++") || s.startsWith("==")) && prevChar !== "" && ALNUM.test(prevChar));
    if (conflict) s = spanForm(run, first, last);
  }
  if (m.link) s = `[${s}](${m.link.href.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  return s;
}

function shortForm(run: Run, first: boolean, last: boolean): string {
  const m = run.marks ?? {};
  const hasWs = /\s/.test(run.text);
  const span: string[] = [];
  let underlineShort = false;
  let highlightShort = false;
  let scriptShort: "sup" | "sub" | null = null;

  if (m.color) span.push(`color=${m.color}`);
  if (m.highlight && (m.highlight !== "highlight" || m.color))
    span.push(`highlight=${m.highlight}`);
  else if (m.highlight) highlightShort = true;
  if (m.underline) {
    if (span.length) span.push("u");
    else underlineShort = true;
  }
  if (m.script) {
    const canShort = !hasWs && !(m.script === "sub" && m.strike);
    if (span.length || !canShort) span.push(m.script);
    else scriptShort = m.script;
  }

  const delimited =
    !!m.bold ||
    !!m.italic ||
    !!m.strike ||
    underlineShort ||
    highlightShort ||
    scriptShort !== null;
  let s = escapeText(run.text, {
    leadingWs: delimited || first,
    trailingWs: delimited || last,
  });

  if (scriptShort === "sup") s = `^${s}^`;
  if (scriptShort === "sub") s = `~${s}~`;
  if (highlightShort) s = `==${s}==`;
  if (underlineShort) s = `++${s}++`;
  if (m.italic) s = m.bold ? `_${s}_` : `*${s}*`;
  if (m.bold) s = `**${s}**`;
  if (m.strike) s = `~~${s}~~`;
  if (span.length) s = `[${s}]{${span.join(" ")}}`;
  return s;
}

function spanForm(run: Run, first: boolean, last: boolean): string {
  const m = run.marks ?? {};
  const attrs: string[] = [];
  if (m.bold) attrs.push("b");
  if (m.italic) attrs.push("i");
  if (m.strike) attrs.push("s");
  if (m.underline) attrs.push("u");
  if (m.color) attrs.push(`color=${m.color}`);
  if (m.highlight) attrs.push(`highlight=${m.highlight}`);
  if (m.script) attrs.push(m.script);
  return `[${escapeText(run.text, { leadingWs: first, trailingWs: last })}]{${attrs.join(" ")}}`;
}

/** Accepts either form of rich text input. */
export function toRichText(input: string | RichText): RichText {
  return typeof input === "string" ? markdownToRichText(input) : normalizeRichText(input);
}
