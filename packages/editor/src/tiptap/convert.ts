import type { JSONContent } from "@tiptap/core";
import {
  normalizeRichText,
  type Marks,
  type Paragraph,
  type RichText,
  type Run,
} from "@apresenta/core/browser";

/* RichText (storage format) ⇄ TipTap/ProseMirror JSON. */

function marksToTiptap(m: Marks | undefined): JSONContent["marks"] {
  if (!m) return undefined;
  const out: NonNullable<JSONContent["marks"]> = [];
  if (m.bold) out.push({ type: "bold" });
  if (m.italic) out.push({ type: "italic" });
  if (m.underline) out.push({ type: "underline" });
  if (m.strike) out.push({ type: "strike" });
  if (m.link) out.push({ type: "link", attrs: { href: m.link.href } });
  if (m.color) out.push({ type: "textColor", attrs: { color: m.color } });
  if (m.highlight) out.push({ type: "hl", attrs: { color: m.highlight } });
  if (m.script === "sup") out.push({ type: "superscript" });
  if (m.script === "sub") out.push({ type: "subscript" });
  return out.length ? out : undefined;
}

function paragraphNode(p: Paragraph): JSONContent {
  const content: JSONContent[] = [];
  for (const r of p.runs) {
    const marks = marksToTiptap(r.marks);
    r.text.split("\n").forEach((part, i) => {
      if (i > 0) content.push({ type: "hardBreak" });
      if (part)
        content.push(marks ? { type: "text", text: part, marks } : { type: "text", text: part });
    });
  }
  const attrs: Record<string, string> = {};
  if (p.align) attrs.align = p.align;
  if (p.size) attrs.size = p.size;
  return {
    type: "paragraph",
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(content.length ? { content } : {}),
  };
}

export function richTextToDoc(rt: RichText): JSONContent {
  const root: JSONContent[] = [];
  const stack: Array<{ kind: string; level: number; list: JSONContent; item: JSONContent }> = [];
  for (const p of rt.paragraphs) {
    const para = paragraphNode(p);
    if (!p.list) {
      stack.length = 0;
      root.push(para);
      continue;
    }
    const level = p.list.level;
    const kind = p.list.kind;
    while (stack.length && stack[stack.length - 1]!.level > level) stack.pop();
    let top = stack[stack.length - 1];
    if (top && top.level === level && top.kind !== kind) {
      stack.pop();
      top = stack[stack.length - 1];
    }
    const item: JSONContent = { type: "listItem", content: [para] };
    if (top && top.level === level) {
      top.list.content!.push(item);
      top.item = item;
    } else {
      const list: JSONContent = {
        type: kind === "bullet" ? "bulletList" : "orderedList",
        content: [item],
      };
      (top ? top.item.content! : root).push(list);
      stack.push({ kind, level: top ? top.level + 1 : 1, list, item });
    }
  }
  return { type: "doc", content: root.length ? root : [{ type: "paragraph" }] };
}

function marksFromTiptap(marks: JSONContent["marks"]): Marks | undefined {
  if (!marks?.length) return undefined;
  const m: Marks = {};
  for (const mk of marks) {
    const attrs = (mk.attrs ?? {}) as Record<string, unknown>;
    switch (mk.type) {
      case "bold":
        m.bold = true;
        break;
      case "italic":
        m.italic = true;
        break;
      case "underline":
        m.underline = true;
        break;
      case "strike":
        m.strike = true;
        break;
      case "link":
        if (typeof attrs.href === "string" && /^(?:https?:\/\/|mailto:)/i.test(attrs.href))
          m.link = { href: attrs.href };
        break;
      case "textColor":
        if (typeof attrs.color === "string") m.color = attrs.color;
        break;
      case "hl":
        m.highlight = typeof attrs.color === "string" ? attrs.color : "highlight";
        break;
      case "superscript":
        m.script = "sup";
        break;
      case "subscript":
        m.script = "sub";
        break;
    }
  }
  return Object.keys(m).length ? m : undefined;
}

function inlineRuns(node: JSONContent): Run[] {
  const runs: Run[] = [];
  for (const c of node.content ?? []) {
    if (c.type === "text" && c.text) {
      const marks = marksFromTiptap(c.marks);
      runs.push(marks ? { text: c.text, marks } : { text: c.text });
    } else if (c.type === "hardBreak") {
      runs.push({ text: "\n" });
    }
  }
  return runs;
}

function paragraphFrom(node: JSONContent, list?: Paragraph["list"]): Paragraph {
  const attrs = (node.attrs ?? {}) as { align?: string | null; size?: string | null };
  const p: Paragraph = { runs: inlineRuns(node) };
  if (attrs.align) p.align = attrs.align as Paragraph["align"];
  if (attrs.size && attrs.size !== "normal") p.size = attrs.size as Paragraph["size"];
  if (list) p.list = list;
  return p;
}

export function docToRichText(doc: JSONContent): RichText {
  const paragraphs: Paragraph[] = [];
  const walk = (
    nodes: JSONContent[] | undefined,
    list?: { kind: "bullet" | "ordered"; level: number },
  ) => {
    for (const n of nodes ?? []) {
      if (n.type === "bulletList" || n.type === "orderedList") {
        const level = Math.min((list?.level ?? 0) + 1, 3);
        for (const item of n.content ?? []) {
          walk(item.content, { kind: n.type === "bulletList" ? "bullet" : "ordered", level });
        }
      } else if (n.type === "paragraph") {
        paragraphs.push(
          paragraphFrom(n, list ? { kind: list.kind, level: list.level as 1 | 2 | 3 } : undefined),
        );
      } else if (n.content) {
        walk(n.content, list);
      }
    }
  };
  walk(doc.content);
  return normalizeRichText({ paragraphs });
}
