import type { FontId } from "@apresenta/core/browser";

export interface FontDef {
  family: string;
  fallback: string;
  /** Fontsource package name. */
  pkg: string;
  /** Weights embedded (normal style). */
  weights: readonly number[];
  /** Whether an italic file exists for the regular weight. */
  italic: boolean;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

export const FONTS: Record<FontId, FontDef> = {
  inter: {
    family: "Inter",
    fallback: SANS,
    pkg: "@fontsource/inter",
    weights: [400, 700, 800],
    italic: true,
  },
  montserrat: {
    family: "Montserrat",
    fallback: SANS,
    pkg: "@fontsource/montserrat",
    weights: [400, 700],
    italic: true,
  },
  "space-grotesk": {
    family: "Space Grotesk",
    fallback: SANS,
    pkg: "@fontsource/space-grotesk",
    weights: [400, 700],
    italic: false,
  },
  "ibm-plex-sans": {
    family: "IBM Plex Sans",
    fallback: SANS,
    pkg: "@fontsource/ibm-plex-sans",
    weights: [400, 700],
    italic: true,
  },
  poppins: {
    family: "Poppins",
    fallback: SANS,
    pkg: "@fontsource/poppins",
    weights: [400, 700],
    italic: true,
  },
  "playfair-display": {
    family: "Playfair Display",
    fallback: SERIF,
    pkg: "@fontsource/playfair-display",
    weights: [400, 700],
    italic: true,
  },
  "source-serif-4": {
    family: "Source Serif 4",
    fallback: SERIF,
    pkg: "@fontsource/source-serif-4",
    weights: [400, 700],
    italic: true,
  },
  lora: {
    family: "Lora",
    fallback: SERIF,
    pkg: "@fontsource/lora",
    weights: [400, 700],
    italic: true,
  },
  "source-sans-3": {
    family: "Source Sans 3",
    fallback: SANS,
    pkg: "@fontsource/source-sans-3",
    weights: [400, 700],
    italic: true,
  },
  "dm-sans": {
    family: "DM Sans",
    fallback: SANS,
    pkg: "@fontsource/dm-sans",
    weights: [400, 700],
    italic: true,
  },
};

export function fontStack(id: FontId): string {
  const f = FONTS[id];
  return `"${f.family}", ${f.fallback}`;
}
