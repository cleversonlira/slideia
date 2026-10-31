import { z } from "zod";
import {
  COLOR_TOKENS,
  CURRENT_SCHEMA_VERSION,
  FONT_IDS,
  LAYOUT_IDS,
  PARAGRAPH_SIZES,
  LOGO_POSITIONS,
  THEME_IDS,
  TRANSITION_TYPES,
  type ElementType,
} from "./constants.js";

export * from "./constants.js";

/*
 * Presentation Schema.
 *
 * Two flavours share the same building blocks:
 * - Stored (`PresentationSchema`): the normalized format kept in storage. Every id is present,
 *   every rich text is structured.
 * - Input (`PresentationInputSchema`): what an AI (or an import) may send. Ids and slots are
 *   optional and any rich text field also accepts a Markdown string.
 *
 * Identifiers and descriptions are in English on purpose: they are read by language models.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const ThemeId = z.enum(THEME_IDS).describe("Visual theme of the whole presentation.");
export type ThemeId = z.infer<typeof ThemeId>;

export const FontId = z.enum(FONT_IDS);
export type FontId = z.infer<typeof FontId>;

export const LayoutId = z.enum(LAYOUT_IDS).describe("Slide layout. Each layout has named slots.");
export type LayoutId = z.infer<typeof LayoutId>;

export const ColorToken = z.enum(COLOR_TOKENS);
export type ColorToken = z.infer<typeof ColorToken>;

export const HexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex color like #1a73e8");

export const ColorRef = z
  .union([ColorToken, HexColor])
  .describe('Theme color token (preferred, e.g. "accent") or a hex color "#rrggbb".');
export type ColorRef = z.infer<typeof ColorRef>;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
export const Id = z.string().regex(ID_PATTERN, "Ids use letters, digits, _ or - (max 40 chars)");

export const AssetRef = z
  .string()
  .refine(
    (s) =>
      /^asset:[A-Za-z0-9_-]{1,64}$/.test(s) ||
      /^https?:\/\/\S+$/i.test(s) ||
      /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/.test(s),
    'Use "asset:<id>" (returned by add_image), an http(s) URL or a base64 data URI',
  )
  .describe(
    'Image reference: "asset:<id>", an http(s) URL (downloaded by the server) or data URI.',
  );

export const LinkHref = z
  .string()
  .max(2048)
  .refine(
    (s) => /^(?:https?:\/\/|mailto:)\S+$/i.test(s),
    "Links must start with http(s):// or mailto:",
  );

// ---------------------------------------------------------------------------
// Rich text (restricted, never HTML)
// ---------------------------------------------------------------------------

export const Marks = z
  .object({
    bold: z.literal(true).optional(),
    italic: z.literal(true).optional(),
    underline: z.literal(true).optional(),
    strike: z.literal(true).optional(),
    color: ColorRef.optional(),
    highlight: ColorRef.optional().describe('Background highlight. Usually "highlight".'),
    link: z.object({ href: LinkHref }).strict().optional(),
    script: z.enum(["sup", "sub"]).optional(),
  })
  .strict();
export type Marks = z.infer<typeof Marks>;

export const Run = z
  .object({
    text: z.string().max(5000).describe("Plain text. A \\n is a line break inside the paragraph."),
    marks: Marks.optional(),
  })
  .strict();
export type Run = z.infer<typeof Run>;

export const Paragraph = z
  .object({
    runs: z.array(Run).max(200),
    align: z.enum(["left", "center", "right", "justify"]).optional(),
    list: z
      .object({
        kind: z.enum(["bullet", "ordered"]),
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      })
      .strict()
      .optional(),
    size: z
      .enum(PARAGRAPH_SIZES)
      .optional()
      .describe("Relative to the slot's base size (theme scale)."),
  })
  .strict();
export type Paragraph = z.infer<typeof Paragraph>;

export const RichText = z
  .object({ paragraphs: z.array(Paragraph).max(200) })
  .strict()
  .describe("Structured rich text.");
export type RichText = z.infer<typeof RichText>;

export const RichTextInput = z
  .union([z.string().max(20000), RichText])
  .describe(
    "Markdown string (recommended: **bold**, *italic*, ~~strike~~, ++underline++, ==highlight==, " +
      "[text](https://link), [text]{color=accent}, ^sup^, ~sub~, lists with - or 1.) " +
      "or a structured {paragraphs:[...]} object.",
  );
export type RichTextInput = z.infer<typeof RichTextInput>;

// ---------------------------------------------------------------------------
// Transitions, backgrounds, animations
// ---------------------------------------------------------------------------

export const Transition = z
  .object({
    type: z.enum(TRANSITION_TYPES),
    direction: z
      .enum(["left", "right", "up", "down"])
      .optional()
      .describe("For slide, push, reveal, flip3d and cube3d. Default: left."),
    durationMs: z.number().int().min(150).max(2000).optional().describe("Default 600."),
  })
  .strict()
  .describe("Transition used when entering the slide.");
export type Transition = z.infer<typeof Transition>;

export const Point = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .strict();
export type Point = z.infer<typeof Point>;

export const Rect = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().gt(0).max(1),
    h: z.number().gt(0).max(1),
  })
  .strict()
  .describe("Fractions (0–1) of the original image.");
export type Rect = z.infer<typeof Rect>;

export const Background = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("color"), color: ColorRef }).strict(),
    z
      .object({
        type: z.literal("gradient"),
        from: ColorRef,
        to: ColorRef,
        angle: z.number().int().min(0).max(360).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("image"),
        asset: AssetRef,
        overlay: z
          .number()
          .min(0)
          .max(0.9)
          .optional()
          .describe("Dark overlay opacity. Default 0.45."),
        focal: Point.optional(),
        kenBurns: z.boolean().optional(),
      })
      .strict(),
  ])
  .describe("Slide background. Omit to use the theme default.");
export type Background = z.infer<typeof Background>;

export const Animation = z
  .object({
    type: z.enum(["fade", "rise", "zoom", "wipe"]),
    order: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Elements with the same order appear together. Default: element order."),
    by: z
      .enum(["element", "paragraph"])
      .optional()
      .describe('"paragraph" reveals each paragraph/list item on its own click.'),
  })
  .strict()
  .describe("Entrance animation, revealed one step per 'next'.");
export type Animation = z.infer<typeof Animation>;

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

const IconName = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lucide icon name in kebab-case, e.g. rocket, bar-chart-3")
  .describe("Lucide icon name (kebab-case), e.g. rocket, users, shield-check.");

function elementVariants<B extends z.ZodRawShape, R extends z.ZodType>(base: B, rt: R) {
  return z.discriminatedUnion("type", [
    z.object({ ...base, type: z.literal("title"), text: rt }).strict(),
    z
      .object({ ...base, type: z.literal("text"), text: rt })
      .strict()
      .describe("Paragraphs and/or lists."),
    z
      .object({
        ...base,
        type: z.literal("image"),
        asset: AssetRef,
        alt: z.string().max(500).describe("Accessible description of the image."),
        fit: z.enum(["cover", "contain"]).optional().describe("Default cover."),
        crop: Rect.optional(),
        focal: Point.optional().describe("Point kept visible when cropping (cover)."),
        kenBurns: z.boolean().optional().describe("Slow zoom/pan while the slide is shown."),
        caption: rt.optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("icon"),
        name: IconName,
        color: ColorRef.optional(),
        size: z.enum(["sm", "md", "lg"]).optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("chart"),
        kind: z.enum(["bar", "line", "pie", "donut"]),
        title: z.string().max(200).optional(),
        labels: z
          .array(z.string().max(80))
          .min(1)
          .max(24)
          .describe("Category labels (x axis / slices)."),
        series: z
          .array(
            z
              .object({
                name: z.string().max(80),
                values: z.array(z.number()).max(24).describe("One value per label."),
                color: ColorRef.optional(),
              })
              .strict(),
          )
          .min(1)
          .max(6)
          .describe("Pie/donut use only the first series."),
        unit: z.string().max(12).optional().describe('Appended to values, e.g. "%" or " mi".'),
        showValues: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("table"),
        header: z.array(rt).min(1).max(8),
        rows: z.array(z.array(rt).max(8)).max(20),
        highlightFirstColumn: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("quote"),
        text: rt,
        author: z.string().max(120).optional(),
        role: z.string().max(160).optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("stat"),
        value: z.string().max(24).describe('Short figure, e.g. "87%", "R$ 2,4 mi", "3x".'),
        label: rt,
        icon: IconName.optional(),
        trend: z.enum(["up", "down"]).optional(),
      })
      .strict()
      .describe("A KPI / big number. Use 2–4 of them in the stats layout."),
    z
      .object({
        ...base,
        type: z.literal("timeline"),
        items: z
          .array(
            z
              .object({
                date: z.string().max(40),
                title: z.string().max(120),
                text: rt.optional(),
              })
              .strict(),
          )
          .min(1)
          .max(8),
      })
      .strict(),
  ]);
}

const SlotName = z.string().regex(/^[a-zA-Z]{1,20}$/);

const storedElementBase = {
  id: Id,
  slot: SlotName.describe("Slot of the layout this element occupies."),
  animation: Animation.optional(),
};

const inputElementBase = {
  id: Id.optional().describe("Stable id. Omit when creating; the server assigns one."),
  slot: SlotName.optional().describe(
    "Slot of the layout. Optional when the element type fits only one free slot.",
  ),
  animation: Animation.optional(),
};

export const Element = elementVariants(storedElementBase, RichText);
export type Element = z.infer<typeof Element>;
export const ElementInput = elementVariants(inputElementBase, RichTextInput);
export type ElementInput = z.infer<typeof ElementInput>;

export type ElementOf<T extends ElementType> = Extract<Element, { type: T }>;

// ---------------------------------------------------------------------------
// Slides and presentation
// ---------------------------------------------------------------------------

function slideShape<E extends z.ZodType, R extends z.ZodType, I extends z.ZodType>(
  id: I,
  element: E,
  rt: R,
) {
  return z
    .object({
      id,
      layout: LayoutId,
      variant: z
        .string()
        .max(20)
        .optional()
        .describe('Layout variant, e.g. "left"/"right" for image-text.'),
      elements: z.array(element).max(30),
      background: Background.optional(),
      transition: Transition.optional().describe("Overrides the presentation default."),
      notes: rt.optional().describe("Speaker notes: what to say on this slide."),
      hidden: z.boolean().optional(),
    })
    .strict();
}

export const Slide = slideShape(Id, Element, RichText);
export type Slide = z.infer<typeof Slide>;
export const SlideInput = slideShape(
  Id.optional().describe("Stable id. Omit when creating."),
  ElementInput,
  RichTextInput,
);
export type SlideInput = z.infer<typeof SlideInput>;

export const BrandLogo = z
  .object({
    asset: AssetRef.describe("The logo, preferably a PNG/WebP with a transparent background."),
    assetOnDark: AssetRef.optional().describe(
      "Variant for dark slides (e.g. a white logo). Without it the main logo is used everywhere.",
    ),
    alt: z.string().max(200).optional(),
    position: z.enum(LOGO_POSITIONS).optional().describe('Default "bottom-right".'),
    size: z
      .enum(["s", "m", "l"])
      .optional()
      .describe('Height in the slide margin: "s" 40px, "m" 56px (default), "l" 80px.'),
  })
  .strict()
  .describe(
    "Company logo shown in a corner of every slide (inside the margin, never over content); slides with their own logo element skip it.",
  );
export type BrandLogo = z.infer<typeof BrandLogo>;

export const ThemeOverrides = z
  .object({
    accent: HexColor.optional().describe(
      "Main brand color: highlights, buttons, first chart series.",
    ),
    accent2: HexColor.optional().describe("Secondary brand color (second chart series, details)."),
    cover: HexColor.optional().describe(
      "Background of cover, section and closing slides (often the brand's dark color).",
    ),
    fontHeading: FontId.optional(),
    fontBody: FontId.optional(),
    logo: BrandLogo.optional(),
  })
  .strict()
  .describe("Brand customization on top of the theme: colors, fonts and logo.");
export type ThemeOverrides = z.infer<typeof ThemeOverrides>;

export const Brand = z
  .object({
    theme: ThemeId.optional().describe("Base theme the brand is applied on."),
    ...ThemeOverrides.shape,
  })
  .strict()
  .describe(
    "The user's saved brand: base theme, colors, fonts and logo applied to new presentations.",
  );
export type Brand = z.infer<typeof Brand>;

const metaShape = {
  title: z.string().min(1).max(200),
  author: z.string().max(120).optional(),
  lang: z
    .string()
    .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/, 'Use a BCP 47 tag like "pt-BR" or "en"')
    .describe("Language of the content (BCP 47)."),
  aspectRatio: z.enum(["16:9", "4:3"]),
  theme: ThemeId,
  themeOverrides: ThemeOverrides.optional(),
  defaultTransition: Transition,
};

export const Meta = z.object(metaShape).strict();
export type Meta = z.infer<typeof Meta>;

export const PresentationSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    id: Id,
    version: z.number().int().min(1),
    meta: Meta,
    slides: z.array(Slide).max(200),
  })
  .strict();
export type Presentation = z.infer<typeof PresentationSchema>;

export const MetaInput = z
  .object({
    ...metaShape,
    lang: metaShape.lang.optional().describe('Default "pt-BR".'),
    aspectRatio: metaShape.aspectRatio.optional().describe('Default "16:9".'),
    theme: ThemeId.optional().describe('Default "executivo".'),
    defaultTransition: Transition.optional().describe('Default {"type":"fade"}.'),
  })
  .strict();

export const PresentationInputSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION).optional(),
    id: Id.optional(),
    version: z.number().int().min(1).optional(),
    meta: MetaInput,
    slides: z.array(SlideInput).min(1).max(200),
  })
  .strict()
  .describe("A presentation to create.");
export type PresentationInput = z.infer<typeof PresentationInputSchema>;
