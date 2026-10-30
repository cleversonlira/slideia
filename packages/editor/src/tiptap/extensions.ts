import { Extension, Mark, type AnyExtension } from "@tiptap/core";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import StarterKit from "@tiptap/starter-kit";
import { COLOR_TOKENS, PARAGRAPH_SIZES } from "@apresenta/core/browser";
import { cssColor } from "@apresenta/renderer";

/*
 * TipTap restricted to the rich text schema, rendering the same markup as the renderer
 * (span[data-color], mark[data-hl], p.a-center.s-large…) so editing looks exactly like presenting.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphAttrs: {
      setAlign: (align: string | null) => ReturnType;
      setSize: (size: string | null) => ReturnType;
    };
    textColor: {
      setTextColor: (color: string) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
    hl: {
      setHl: (color: string) => ReturnType;
      unsetHl: () => ReturnType;
    };
  }
}

export function parseColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if ((COLOR_TOKENS as readonly string[]).includes(v)) return v;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v.toLowerCase();
  const tok = /^var\(--c-([a-z0-9]+)\)$/.exec(v);
  if (tok && (COLOR_TOKENS as readonly string[]).includes(tok[1]!)) return tok[1]!;
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
  if (rgb)
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  return null;
}

const TextColor = Mark.create({
  name: "textColor",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => parseColor(el.getAttribute("data-color")) ?? parseColor(el.style.color),
        renderHTML: (attrs) =>
          attrs.color
            ? { "data-color": attrs.color, style: `color:${cssColor(attrs.color as string)}` }
            : {},
      },
    };
  },
  parseHTML() {
    return [
      { tag: "span[data-color]" },
      { tag: "span", getAttrs: (el) => (parseColor(el.style.color) ? {} : false) },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },
  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

const Hl = Mark.create({
  name: "hl",
  addAttributes() {
    return {
      color: {
        default: "highlight",
        parseHTML: (el) =>
          parseColor(el.getAttribute("data-hl")) ??
          parseColor(el.style.backgroundColor) ??
          "highlight",
        renderHTML: (attrs) => ({
          "data-hl": attrs.color,
          style: `background-color:${cssColor((attrs.color as string) ?? "highlight")}`,
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", HTMLAttributes, 0];
  },
  addCommands() {
    return {
      setHl:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetHl:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Shift-h": () => this.editor.commands.toggleMark(this.name) };
  },
});

function classValue(el: HTMLElement, prefix: string, allowed: readonly string[]): string | null {
  for (const c of el.classList) {
    if (c.startsWith(prefix) && allowed.includes(c.slice(prefix.length)))
      return c.slice(prefix.length);
  }
  return null;
}

const ALIGNS = ["left", "center", "right", "justify"] as const;

const ParagraphAttrs = Extension.create({
  name: "paragraphAttrs",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          align: {
            default: null,
            parseHTML: (el) =>
              classValue(el, "a-", ALIGNS) ??
              ((ALIGNS as readonly string[]).includes(el.style.textAlign)
                ? el.style.textAlign
                : null),
            renderHTML: (attrs) => (attrs.align ? { class: `a-${attrs.align as string}` } : {}),
          },
          size: {
            default: null,
            parseHTML: (el) => classValue(el, "s-", PARAGRAPH_SIZES),
            renderHTML: (attrs) =>
              attrs.size && attrs.size !== "normal" ? { class: `s-${attrs.size as string}` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setAlign:
        (align) =>
        ({ commands }) =>
          commands.updateAttributes("paragraph", { align }),
      setSize:
        (size) =>
        ({ commands }) =>
          commands.updateAttributes("paragraph", { size }),
    };
  },
});

/** Tab/Shift-Tab indent list items, at most three levels deep. */
const ListDepth = Extension.create({
  name: "listDepth",
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { $from } = this.editor.state.selection;
        let depth = 0;
        for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "listItem") depth++;
        if (depth === 0) return true; // keep focus in the text box
        if (depth >= 3) return true;
        return this.editor.commands.sinkListItem("listItem");
      },
      "Shift-Tab": () => this.editor.commands.liftListItem("listItem") || true,
    };
  },
});

export function editorExtensions(opts: { singleLine?: boolean } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      code: false,
      blockquote: false,
      horizontalRule: false,
      trailingNode: false,
      dropcursor: false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        protocols: ["http", "https", "mailto"],
        isAllowedUri: (url) => /^(?:https?:\/\/|mailto:)/i.test(url),
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer", class: null },
      },
      ...(opts.singleLine
        ? { bulletList: false, orderedList: false, listItem: false, listKeymap: false }
        : {}),
    }),
    Superscript,
    Subscript,
    TextColor,
    Hl,
    ParagraphAttrs,
    ...(opts.singleLine ? [] : [ListDepth]),
  ];
}
