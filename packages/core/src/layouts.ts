import type { ElementType, LayoutId } from "./schema.js";

export interface SlotDef {
  name: string;
  /** Element types allowed in this slot. */
  accepts: readonly ElementType[];
  required?: boolean;
  /** Max elements (default 1). */
  max?: number;
  /** Design capacity used for warnings. */
  capacity?: { chars?: number; items?: number };
  description: string;
}

export interface LayoutDef {
  id: LayoutId;
  label: string;
  description: string;
  slots: readonly SlotDef[];
  variants?: readonly string[];
}

/** Hidden slot that keeps elements which no longer fit after a layout change. */
export const OVERFLOW_SLOT = "overflow";

const TEXTUAL = ["text"] as const;

export const LAYOUTS: Record<LayoutId, LayoutDef> = {
  cover: {
    id: "cover",
    label: "Capa",
    description: "Opening slide: title, subtitle and optional background image and logo.",
    slots: [
      {
        name: "title",
        accepts: ["title"],
        required: true,
        capacity: { chars: 70 },
        description: "Presentation title",
      },
      {
        name: "subtitle",
        accepts: TEXTUAL,
        capacity: { chars: 140 },
        description: "Subtitle, author or date",
      },
      { name: "image", accepts: ["image"], description: "Full-bleed background image (darkened)" },
      { name: "logo", accepts: ["image", "icon"], description: "Small logo or icon" },
    ],
  },
  section: {
    id: "section",
    label: "Seção",
    description: "Divider that opens a new part of the talk.",
    slots: [
      {
        name: "title",
        accepts: ["title"],
        required: true,
        capacity: { chars: 60 },
        description: "Section title",
      },
      {
        name: "subtitle",
        accepts: TEXTUAL,
        capacity: { chars: 140 },
        description: "One-line description",
      },
      {
        name: "number",
        accepts: TEXTUAL,
        capacity: { chars: 6 },
        description: 'Section number, e.g. "02"',
      },
    ],
  },
  "title-content": {
    id: "title-content",
    label: "Título e conteúdo",
    description: "Title plus a paragraph or a bullet list. The workhorse layout.",
    slots: [
      {
        name: "title",
        accepts: ["title"],
        required: true,
        capacity: { chars: 70 },
        description: "Slide title",
      },
      {
        name: "body",
        accepts: ["text", "chart", "table", "image", "quote"],
        required: true,
        capacity: { chars: 420, items: 6 },
        description: "Main content",
      },
    ],
  },
  "two-columns": {
    id: "two-columns",
    label: "Duas colunas",
    description: "Title and two side-by-side columns of content.",
    slots: [
      {
        name: "title",
        accepts: ["title"],
        required: true,
        capacity: { chars: 70 },
        description: "Slide title",
      },
      {
        name: "left",
        accepts: ["text", "image", "chart", "icon", "stat"],
        required: true,
        max: 2,
        capacity: { chars: 240, items: 5 },
        description: "Left column",
      },
      {
        name: "right",
        accepts: ["text", "image", "chart", "icon", "stat"],
        required: true,
        max: 2,
        capacity: { chars: 240, items: 5 },
        description: "Right column",
      },
    ],
  },
  "full-image": {
    id: "full-image",
    label: "Imagem cheia",
    description: "A single full-bleed image with an optional title and caption over it.",
    slots: [
      { name: "image", accepts: ["image"], required: true, description: "Full-bleed image" },
      {
        name: "title",
        accepts: ["title"],
        capacity: { chars: 60 },
        description: "Optional title over the image",
      },
      {
        name: "caption",
        accepts: TEXTUAL,
        capacity: { chars: 160 },
        description: "Optional caption",
      },
    ],
  },
  "image-text": {
    id: "image-text",
    label: "Imagem e texto",
    description: "Image on one half, title and text on the other.",
    variants: ["left", "right"],
    slots: [
      {
        name: "image",
        accepts: ["image"],
        required: true,
        description: "Image (variant chooses the side, default left)",
      },
      {
        name: "title",
        accepts: ["title"],
        required: true,
        capacity: { chars: 60 },
        description: "Slide title",
      },
      {
        name: "body",
        accepts: ["text", "quote", "stat"],
        required: true,
        max: 3,
        capacity: { chars: 300, items: 5 },
        description: "Text",
      },
    ],
  },
  quote: {
    id: "quote",
    label: "Citação",
    description: "A memorable quote with author.",
    slots: [
      {
        name: "quote",
        accepts: ["quote"],
        required: true,
        capacity: { chars: 240 },
        description: "The quote",
      },
      { name: "image", accepts: ["image"], description: "Optional portrait of the author" },
    ],
  },
  stats: {
    id: "stats",
    label: "Números",
    description: "Two to four big numbers (KPIs) with labels.",
    slots: [
      { name: "title", accepts: ["title"], capacity: { chars: 70 }, description: "Slide title" },
      {
        name: "stats",
        accepts: ["stat"],
        required: true,
        max: 4,
        description: "2–4 stat elements",
      },
      {
        name: "footnote",
        accepts: TEXTUAL,
        capacity: { chars: 160 },
        description: "Source or note",
      },
    ],
  },
  timeline: {
    id: "timeline",
    label: "Linha do tempo",
    description: "Chronological milestones (3–7 items).",
    slots: [
      { name: "title", accepts: ["title"], capacity: { chars: 70 }, description: "Slide title" },
      {
        name: "timeline",
        accepts: ["timeline"],
        required: true,
        capacity: { items: 7 },
        description: "Timeline element",
      },
    ],
  },
  comparison: {
    id: "comparison",
    label: "Comparação",
    description: "Two options side by side (before/after, pros/cons, plan A/B).",
    slots: [
      {
        name: "title",
        accepts: ["title"],
        required: true,
        capacity: { chars: 70 },
        description: "Slide title",
      },
      {
        name: "leftTitle",
        accepts: TEXTUAL,
        required: true,
        capacity: { chars: 40 },
        description: "Heading of the left card",
      },
      {
        name: "left",
        accepts: ["text", "stat"],
        required: true,
        capacity: { chars: 220, items: 5 },
        description: "Left card content",
      },
      {
        name: "rightTitle",
        accepts: TEXTUAL,
        required: true,
        capacity: { chars: 40 },
        description: "Heading of the right card",
      },
      {
        name: "right",
        accepts: ["text", "stat"],
        required: true,
        capacity: { chars: 220, items: 5 },
        description: "Right card content",
      },
    ],
  },
  chart: {
    id: "chart",
    label: "Gráfico",
    description: "A chart, optionally with a short takeaway text beside it.",
    slots: [
      {
        name: "title",
        accepts: ["title"],
        required: true,
        capacity: { chars: 70 },
        description: "Slide title (state the insight)",
      },
      { name: "chart", accepts: ["chart"], required: true, description: "Chart element" },
      {
        name: "body",
        accepts: TEXTUAL,
        capacity: { chars: 200, items: 4 },
        description: "Optional takeaway",
      },
    ],
  },
  table: {
    id: "table",
    label: "Tabela",
    description: "A compact table (up to ~7 rows × 5 columns).",
    slots: [
      {
        name: "title",
        accepts: ["title"],
        required: true,
        capacity: { chars: 70 },
        description: "Slide title",
      },
      { name: "table", accepts: ["table"], required: true, description: "Table element" },
      {
        name: "footnote",
        accepts: TEXTUAL,
        capacity: { chars: 160 },
        description: "Source or note",
      },
    ],
  },
  closing: {
    id: "closing",
    label: "Encerramento",
    description: "Final slide: thanks, call to action, contact.",
    slots: [
      {
        name: "title",
        accepts: ["title"],
        required: true,
        capacity: { chars: 60 },
        description: 'E.g. "Obrigado!"',
      },
      {
        name: "body",
        accepts: TEXTUAL,
        capacity: { chars: 200 },
        description: "Call to action / next steps",
      },
      {
        name: "contact",
        accepts: TEXTUAL,
        capacity: { chars: 160 },
        description: "E-mail, site, social handles",
      },
      { name: "logo", accepts: ["image", "icon"], description: "Small logo or icon" },
    ],
  },
};

export function getLayout(id: LayoutId): LayoutDef {
  return LAYOUTS[id];
}

export function getSlot(layout: LayoutId, slot: string): SlotDef | undefined {
  return LAYOUTS[layout].slots.find((s) => s.name === slot);
}

/**
 * Slot for an element without an explicit slot: the first empty slot accepting `type`,
 * otherwise the first accepting slot that still has room.
 */
export function findFreeSlot(
  layout: LayoutId,
  type: ElementType,
  counts: ReadonlyMap<string, number>,
): SlotDef | undefined {
  const slots = LAYOUTS[layout].slots.filter((s) => s.accepts.includes(type));
  return (
    slots.find((s) => !counts.get(s.name)) ??
    slots.find((s) => (counts.get(s.name) ?? 0) < (s.max ?? 1))
  );
}
