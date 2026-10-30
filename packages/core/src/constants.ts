/* Zod-free constants, so browser bundles that only need them do not pull in the schema. */

export const THEME_IDS = [
  "executivo",
  "minimal",
  "noturno",
  "corporativo",
  "vibrante",
  "editorial",
  "natureza",
  "tech",
] as const;

export const FONT_IDS = [
  "inter",
  "montserrat",
  "space-grotesk",
  "ibm-plex-sans",
  "poppins",
  "playfair-display",
  "source-serif-4",
  "lora",
  "source-sans-3",
  "dm-sans",
] as const;

export const LAYOUT_IDS = [
  "cover",
  "section",
  "title-content",
  "two-columns",
  "full-image",
  "image-text",
  "quote",
  "stats",
  "timeline",
  "comparison",
  "chart",
  "table",
  "closing",
] as const;

export const COLOR_TOKENS = [
  "text",
  "muted",
  "accent",
  "accent2",
  "highlight",
  "success",
  "danger",
  "bg",
  "surface",
] as const;

export const PARAGRAPH_SIZES = ["small", "normal", "large", "display"] as const;

export const TRANSITION_TYPES = [
  "none",
  "fade",
  "slide",
  "push",
  "zoom",
  "dissolve",
  "flip3d",
  "cube3d",
  "reveal",
] as const;

export const ELEMENT_TYPES = [
  "title",
  "text",
  "image",
  "icon",
  "chart",
  "table",
  "quote",
  "stat",
  "timeline",
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];

export const CURRENT_SCHEMA_VERSION = 1;

/** Corners where the brand logo (meta.themeOverrides.logo) can sit. */
export const LOGO_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
