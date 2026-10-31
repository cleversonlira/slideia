import { contrastRatio, isHex, mixHex, normalizeHex } from "./color.js";
import type {
  Background,
  Brand,
  ColorRef,
  ColorToken,
  FontId,
  LayoutId,
  Meta,
  Slide,
  ThemeId,
} from "./schema.js";

export interface ThemeColors {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  /** Background behind highlighted text. */
  highlight: string;
  success: string;
  danger: string;
  border: string;
  /** Text on top of an accent-colored surface. */
  onAccent: string;
  /** Palette used on slides whose background contrasts with `bg` (e.g. dark cover). */
  inverseBg: string;
  inverseSurface: string;
  inverseText: string;
  inverseMuted: string;
  inverseAccent: string;
  inverseHighlight: string;
  chart: readonly [string, string, string, string, string, string];
}

export interface Theme {
  id: ThemeId;
  label: string;
  description: string;
  dark: boolean;
  colors: ThemeColors;
  fonts: {
    heading: FontId;
    body: FontId;
    headingWeight: 600 | 700 | 800;
    headingTransform: "none" | "uppercase";
    headingLetterSpacing: string;
  };
  /** Font sizes in px on the 1080px-tall canvas. */
  scale: { display: number; title: number; subtitle: number; body: number; small: number };
  radius: number;
  /** Slide padding in px. */
  pad: number;
  /** Default background of cover, section and closing slides. */
  emphasis: Background;
}

const SCALE = { display: 112, title: 64, subtitle: 44, body: 40, small: 28 };

export const THEMES: Record<ThemeId, Theme> = {
  executivo: {
    id: "executivo",
    label: "Executivo",
    description: "Azul-marinho sóbrio, para diretoria e negócios.",
    dark: false,
    colors: {
      bg: "#ffffff",
      surface: "#f2f5fa",
      text: "#0f1c33",
      muted: "#4a5873",
      accent: "#1d4ed8",
      accent2: "#b45309",
      highlight: "#fde68a",
      success: "#15803d",
      danger: "#b91c1c",
      border: "#d9dee8",
      onAccent: "#ffffff",
      inverseBg: "#0f1c33",
      inverseSurface: "#1b2a47",
      inverseText: "#ffffff",
      inverseMuted: "#b6c2d9",
      inverseAccent: "#93b4ff",
      inverseHighlight: "#3d4f7a",
      chart: ["#1d4ed8", "#b45309", "#0e7490", "#7c3aed", "#15803d", "#be185d"],
    },
    fonts: {
      heading: "montserrat",
      body: "inter",
      headingWeight: 700,
      headingTransform: "none",
      headingLetterSpacing: "-0.01em",
    },
    scale: SCALE,
    radius: 12,
    pad: 96,
    emphasis: { type: "gradient", from: "#0f1c33", to: "#1e3a8a", angle: 135 },
  },
  minimal: {
    id: "minimal",
    label: "Minimal",
    description: "Preto e branco com um toque de cor. Limpo e direto.",
    dark: false,
    colors: {
      bg: "#ffffff",
      surface: "#f4f4f5",
      text: "#111111",
      muted: "#555555",
      accent: "#e11d48",
      accent2: "#404040",
      highlight: "#fef08a",
      success: "#15803d",
      danger: "#b91c1c",
      border: "#e4e4e7",
      onAccent: "#ffffff",
      inverseBg: "#111111",
      inverseSurface: "#222222",
      inverseText: "#ffffff",
      inverseMuted: "#b5b5b5",
      inverseAccent: "#fb7185",
      inverseHighlight: "#4a4a4a",
      chart: ["#111111", "#e11d48", "#737373", "#f59e0b", "#0ea5e9", "#a3a3a3"],
    },
    fonts: {
      heading: "inter",
      body: "inter",
      headingWeight: 800,
      headingTransform: "none",
      headingLetterSpacing: "-0.03em",
    },
    scale: SCALE,
    radius: 4,
    pad: 104,
    emphasis: { type: "color", color: "#111111" },
  },
  noturno: {
    id: "noturno",
    label: "Noturno",
    description: "Fundo escuro elegante, ótimo para auditórios.",
    dark: true,
    colors: {
      bg: "#0b1020",
      surface: "#161d36",
      text: "#f1f4fb",
      muted: "#a3aec8",
      accent: "#7aa2ff",
      accent2: "#f5b84b",
      highlight: "#3b4a7a",
      success: "#4ade80",
      danger: "#f87171",
      border: "#27304f",
      onAccent: "#0b1020",
      inverseBg: "#f1f4fb",
      inverseSurface: "#e2e7f3",
      inverseText: "#0b1020",
      inverseMuted: "#3c4766",
      inverseAccent: "#2747a8",
      inverseHighlight: "#fde68a",
      chart: ["#7aa2ff", "#f5b84b", "#5eead4", "#c4b5fd", "#4ade80", "#f9a8d4"],
    },
    fonts: {
      heading: "dm-sans",
      body: "inter",
      headingWeight: 700,
      headingTransform: "none",
      headingLetterSpacing: "-0.02em",
    },
    scale: SCALE,
    radius: 16,
    pad: 96,
    emphasis: { type: "gradient", from: "#0b1020", to: "#1f2b63", angle: 160 },
  },
  corporativo: {
    id: "corporativo",
    label: "Corporativo",
    description: "Cinza e verde-petróleo, neutro para relatórios.",
    dark: false,
    colors: {
      bg: "#f7f8fa",
      surface: "#ffffff",
      text: "#1f2933",
      muted: "#52606d",
      accent: "#0b6e6a",
      accent2: "#b4400b",
      highlight: "#ccfbf1",
      success: "#15803d",
      danger: "#b91c1c",
      border: "#dde2e8",
      onAccent: "#ffffff",
      inverseBg: "#0b4f4c",
      inverseSurface: "#0f625e",
      inverseText: "#ffffff",
      inverseMuted: "#c4e3e1",
      inverseAccent: "#99f6e4",
      inverseHighlight: "#13807a",
      chart: ["#0b6e6a", "#b4400b", "#3e4c59", "#2563eb", "#9333ea", "#ca8a04"],
    },
    fonts: {
      heading: "ibm-plex-sans",
      body: "ibm-plex-sans",
      headingWeight: 700,
      headingTransform: "none",
      headingLetterSpacing: "-0.01em",
    },
    scale: SCALE,
    radius: 8,
    pad: 96,
    emphasis: { type: "gradient", from: "#0b4f4c", to: "#0b6e6a", angle: 135 },
  },
  vibrante: {
    id: "vibrante",
    label: "Vibrante",
    description: "Roxo e rosa, energia para marketing e eventos.",
    dark: false,
    colors: {
      bg: "#fffaf5",
      surface: "#f6efff",
      text: "#1a1033",
      muted: "#5b4f73",
      accent: "#6d28d9",
      accent2: "#be185d",
      highlight: "#fde68a",
      success: "#15803d",
      danger: "#b91c1c",
      border: "#eadff7",
      onAccent: "#ffffff",
      inverseBg: "#2e1065",
      inverseSurface: "#3b1584",
      inverseText: "#ffffff",
      inverseMuted: "#e0d4fb",
      inverseAccent: "#f9a8d4",
      inverseHighlight: "#6b3fb8",
      chart: ["#6d28d9", "#db2777", "#f59e0b", "#0891b2", "#16a34a", "#9333ea"],
    },
    fonts: {
      heading: "poppins",
      body: "poppins",
      headingWeight: 700,
      headingTransform: "none",
      headingLetterSpacing: "-0.01em",
    },
    scale: { ...SCALE, body: 38 },
    radius: 24,
    pad: 96,
    emphasis: { type: "gradient", from: "#4c1d95", to: "#be185d", angle: 135 },
  },
  editorial: {
    id: "editorial",
    label: "Editorial",
    description: "Serifas clássicas, estilo revista. Para narrativas.",
    dark: false,
    colors: {
      bg: "#fbf8f3",
      surface: "#f1ebe0",
      text: "#1c1917",
      muted: "#57534e",
      accent: "#9a3412",
      accent2: "#1e40af",
      highlight: "#fde2c4",
      success: "#166534",
      danger: "#b91c1c",
      border: "#e5ddd0",
      onAccent: "#ffffff",
      inverseBg: "#1c1917",
      inverseSurface: "#292524",
      inverseText: "#fbf8f3",
      inverseMuted: "#c9c1b6",
      inverseAccent: "#fdba74",
      inverseHighlight: "#57412f",
      chart: ["#9a3412", "#1e40af", "#57534e", "#b45309", "#166534", "#7e22ce"],
    },
    fonts: {
      heading: "playfair-display",
      body: "source-serif-4",
      headingWeight: 700,
      headingTransform: "none",
      headingLetterSpacing: "0",
    },
    scale: { ...SCALE, title: 68, display: 120 },
    radius: 2,
    pad: 112,
    emphasis: { type: "color", color: "#1c1917" },
  },
  natureza: {
    id: "natureza",
    label: "Natureza",
    description: "Verdes terrosos, para sustentabilidade e educação.",
    dark: false,
    colors: {
      bg: "#f6f7f2",
      surface: "#eaede1",
      text: "#1f2a1f",
      muted: "#4d5a4a",
      accent: "#2f6b3a",
      accent2: "#94570f",
      highlight: "#dcebbd",
      success: "#2f6b3a",
      danger: "#b42318",
      border: "#d9ddcc",
      onAccent: "#ffffff",
      inverseBg: "#1d3b23",
      inverseSurface: "#26492d",
      inverseText: "#f6f7f2",
      inverseMuted: "#c8d5c3",
      inverseAccent: "#bef264",
      inverseHighlight: "#3f6b46",
      chart: ["#2f6b3a", "#94570f", "#4d7c8a", "#7a8b2e", "#b45309", "#5b5f97"],
    },
    fonts: {
      heading: "lora",
      body: "source-sans-3",
      headingWeight: 700,
      headingTransform: "none",
      headingLetterSpacing: "0",
    },
    scale: SCALE,
    radius: 14,
    pad: 96,
    emphasis: { type: "gradient", from: "#1d3b23", to: "#2f6b3a", angle: 135 },
  },
  tech: {
    id: "tech",
    label: "Tech",
    description: "Escuro com ciano, para produto e engenharia.",
    dark: true,
    colors: {
      bg: "#0a0f14",
      surface: "#121b24",
      text: "#e6edf3",
      muted: "#9fb0c0",
      accent: "#22d3ee",
      accent2: "#a3e635",
      highlight: "#134e4a",
      success: "#4ade80",
      danger: "#f87171",
      border: "#1f2b37",
      onAccent: "#0a0f14",
      inverseBg: "#e6edf3",
      inverseSurface: "#d5dee7",
      inverseText: "#0a0f14",
      inverseMuted: "#3b4a59",
      inverseAccent: "#0e7490",
      inverseHighlight: "#a5f3fc",
      chart: ["#22d3ee", "#a3e635", "#f472b6", "#fbbf24", "#a78bfa", "#fb923c"],
    },
    fonts: {
      heading: "space-grotesk",
      body: "dm-sans",
      headingWeight: 700,
      headingTransform: "none",
      headingLetterSpacing: "-0.02em",
    },
    scale: SCALE,
    radius: 10,
    pad: 96,
    emphasis: { type: "gradient", from: "#0a0f14", to: "#0c2f3a", angle: 150 },
  },
};

export const EMPHASIS_LAYOUTS: readonly LayoutId[] = ["cover", "section", "closing"];

/** Theme with the presentation's overrides applied. */
/** `color` itself, or mixed toward `toward` until it reaches `min` contrast against `bg`. */
function readableOn(color: string, bg: string, toward: string, min = 3): string {
  for (const t of [0, 0.25, 0.5, 0.75]) {
    const c = t ? mixHex(color, toward, t) : color;
    if (contrastRatio(c, bg) >= min) return c;
  }
  return toward;
}

export function resolveTheme(meta: Pick<Meta, "theme" | "themeOverrides">): Theme {
  const base = THEMES[meta.theme];
  const o = meta.themeOverrides;
  if (!o) return base;
  const colors = { ...base.colors };
  const chart = [...base.colors.chart];
  let emphasis = base.emphasis;
  if (o.accent) {
    const accent = normalizeHex(o.accent);
    colors.accent = accent;
    colors.onAccent =
      contrastRatio(accent, "#ffffff") >= contrastRatio(accent, "#111111") ? "#ffffff" : "#111111";
    chart[0] = accent;
  }
  if (o.accent2) chart[1] = colors.accent2 = normalizeHex(o.accent2);
  if (o.cover) {
    const cover = normalizeHex(o.cover);
    emphasis = { type: "color", color: cover };
    // A cover that needs the inverse palette also becomes the inverse background.
    if (contrastRatio(colors.inverseText, cover) > contrastRatio(colors.text, cover)) {
      colors.inverseBg = cover;
      colors.inverseSurface = mixHex(cover, colors.inverseText, 0.08);
    }
  }
  if (o.accent || o.cover)
    colors.inverseAccent = readableOn(colors.accent, colors.inverseBg, colors.inverseText);
  return {
    ...base,
    colors: { ...colors, chart: chart as unknown as ThemeColors["chart"] },
    emphasis,
    fonts: {
      ...base.fonts,
      heading: o.fontHeading ?? base.fonts.heading,
      body: o.fontBody ?? base.fonts.body,
    },
  };
}

export function resolveColor(ref: ColorRef, theme: Theme, tone: Tone = "base"): string {
  if (isHex(ref)) return normalizeHex(ref);
  const c = theme.colors;
  if (tone === "inverse") {
    switch (ref) {
      case "bg":
        return c.inverseBg;
      case "surface":
        return c.inverseSurface;
      case "text":
        return c.inverseText;
      case "muted":
        return c.inverseMuted;
      case "accent":
        return c.inverseAccent;
      case "highlight":
        return c.inverseHighlight;
      default:
        break;
    }
  }
  return c[ref as ColorToken];
}

export type Tone = "base" | "inverse";

/** Effective background of a slide (explicit, or the theme emphasis for cover/section/closing). */
export function effectiveBackground(
  slide: Pick<Slide, "background" | "layout">,
  theme: Theme,
): Background | undefined {
  if (slide.background) return slide.background;
  if (EMPHASIS_LAYOUTS.includes(slide.layout)) return theme.emphasis;
  return undefined;
}

/** Whether a slide must use the base or the inverse palette to keep text readable. */
export function slideTone(
  slide: Pick<Slide, "background" | "layout" | "elements">,
  theme: Theme,
): Tone {
  const bg = effectiveBackground(slide, theme);
  const hasCoverImage =
    (slide.layout === "cover" || slide.layout === "full-image") &&
    slide.elements.some((e) => e.type === "image" && e.slot === "image");
  if (hasCoverImage || bg?.type === "image") {
    // Text sits on a darkened photo: needs light text.
    return theme.dark ? "base" : "inverse";
  }
  if (!bg) return "base";
  const color =
    bg.type === "color"
      ? resolveColor(bg.color, theme)
      : mixHex(resolveColor(bg.from, theme), resolveColor(bg.to, theme), 0.5);
  return contrastRatio(theme.colors.text, color) >= contrastRatio(theme.colors.inverseText, color)
    ? "base"
    : "inverse";
}

// ---------------------------------------------------------------------------
// Saved brand (account level)
// ---------------------------------------------------------------------------

/** The theme fields of a presentation that make up its brand. */
export function brandOf(meta: Meta): Brand {
  const out: Brand = { theme: meta.theme };
  for (const [k, v] of Object.entries(meta.themeOverrides ?? {}))
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** `meta` with the brand applied: its base theme (when set) and its overrides. */
export function withBrand<M extends object>(meta: M, brand: Brand): M {
  const { theme, ...overrides } = brand;
  return { ...meta, ...(theme ? { theme } : {}), themeOverrides: overrides };
}
