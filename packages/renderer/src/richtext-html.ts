import {
  isHex,
  type ColorRef,
  type Marks,
  type Paragraph,
  type RichText,
} from "@slideia/core/browser";
import { esc, safeHref } from "./escape.js";

/** CSS value for a color reference: theme tokens become custom properties. */
export function cssColor(ref: ColorRef): string {
  return isHex(ref) ? ref : `var(--c-${ref})`;
}

export interface RichTextHtmlOptions {
  /** Value of data-field, used by in-place editing. */
  field?: string;
  /** Extra classes on the container. */
  className?: string;
  /** Reveal each paragraph / list item on its own step, starting at `start`. */
  steps?: { start: number; anim: string };
  tag?: "div" | "figcaption";
}

/**
 * Renders rich text. The markup (p, ul/ol > li > p, a > span > mark > strong > em > u > s > sup)
 * is the contract shared with the editor (TipTap) and the DOM parser.
 */
export function richTextToHtml(rt: RichText, opts: RichTextHtmlOptions = {}): string {
  const tag = opts.tag ?? "div";
  const cls = ["rt", opts.className].filter(Boolean).join(" ");
  const field = opts.field ? ` data-field="${esc(opts.field)}"` : "";
  return `<${tag} class="${cls}"${field}>${paragraphsToHtml(rt.paragraphs, opts.steps)}</${tag}>`;
}

export function paragraphsToHtml(
  paragraphs: Paragraph[],
  steps?: { start: number; anim: string },
): string {
  let html = "";
  let step = steps?.start ?? 0;
  const stepAttr = () => (steps ? ` data-step="${step++}" data-anim="${esc(steps.anim)}"` : "");
  const stack: Array<{ kind: "bullet" | "ordered"; level: number }> = [];
  const tagOf = (k: "bullet" | "ordered") => (k === "bullet" ? "ul" : "ol");
  const closeTop = () => {
    const top = stack.pop()!;
    html += `</li></${tagOf(top.kind)}>`;
  };

  for (const p of paragraphs) {
    if (!p.list) {
      while (stack.length) closeTop();
      html += paragraphHtml(p, stepAttr());
      continue;
    }
    const { kind, level } = p.list;
    while (stack.length && stack[stack.length - 1]!.level > level) closeTop();
    const top = stack[stack.length - 1];
    if (top && top.level === level) {
      if (top.kind === kind) {
        html += `</li><li${stepAttr()}>`;
      } else {
        closeTop();
        html += `<${tagOf(kind)}><li${stepAttr()}>`;
        stack.push({ kind, level });
      }
    } else {
      html += `<${tagOf(kind)}><li${stepAttr()}>`;
      stack.push({ kind, level });
    }
    html += paragraphHtml(p, "");
  }
  while (stack.length) closeTop();
  return html;
}

function paragraphHtml(p: Paragraph, extra: string): string {
  const cls: string[] = [];
  if (p.align) cls.push(`a-${p.align}`);
  if (p.size) cls.push(`s-${p.size}`);
  const clsAttr = cls.length ? ` class="${cls.join(" ")}"` : "";
  let inner = "";
  for (const r of p.runs) inner += runHtml(r.text, r.marks);
  return `<p${clsAttr}${extra}>${inner}</p>`;
}

export function runHtml(text: string, m: Marks | undefined): string {
  let s = esc(text).replace(/\n/g, "<br>");
  if (!m) return s;
  if (m.script) s = `<${m.script}>${s}</${m.script}>`;
  if (m.strike) s = `<s>${s}</s>`;
  if (m.underline) s = `<u>${s}</u>`;
  if (m.italic) s = `<em>${s}</em>`;
  if (m.bold) s = `<strong>${s}</strong>`;
  if (m.highlight)
    s = `<mark data-hl="${esc(m.highlight)}" style="background-color:${cssColor(m.highlight)}">${s}</mark>`;
  if (m.color)
    s = `<span data-color="${esc(m.color)}" style="color:${cssColor(m.color)}">${s}</span>`;
  if (m.link) {
    const href = safeHref(m.link.href);
    s = href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${s}</a>` : s;
  }
  return s;
}

/** Number of reveal blocks (paragraphs and list items) in a rich text. */
export function blockCount(rt: RichText): number {
  return rt.paragraphs.length;
}
