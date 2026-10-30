import { icons as lucide } from "lucide";
import { resolveTheme, type Presentation, type Slide } from "@apresenta/core/browser";
import {
  SLIDE_CSS,
  createContext,
  renderSlide,
  themeVars,
  type IconMap,
  type RenderContext,
} from "@apresenta/renderer";
import { resolveAsset } from "./api.js";

/* Same fonts the exported HTML embeds (FONTS in the renderer). */
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-400-italic.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/montserrat/latin-400.css";
import "@fontsource/montserrat/latin-400-italic.css";
import "@fontsource/montserrat/latin-700.css";
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-400-italic.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-400-italic.css";
import "@fontsource/poppins/latin-700.css";
import "@fontsource/playfair-display/latin-400.css";
import "@fontsource/playfair-display/latin-400-italic.css";
import "@fontsource/playfair-display/latin-700.css";
import "@fontsource/source-serif-4/latin-400.css";
import "@fontsource/source-serif-4/latin-400-italic.css";
import "@fontsource/source-serif-4/latin-700.css";
import "@fontsource/lora/latin-400.css";
import "@fontsource/lora/latin-400-italic.css";
import "@fontsource/lora/latin-700.css";
import "@fontsource/source-sans-3/latin-400.css";
import "@fontsource/source-sans-3/latin-400-italic.css";
import "@fontsource/source-sans-3/latin-700.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-400-italic.css";
import "@fontsource/dm-sans/latin-700.css";

type IconNode = Array<[string, Record<string, string | number>]>;

function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Za-z])([0-9])/g, "$1-$2")
    .toLowerCase();
}

let iconMap: IconMap | null = null;
/** Every Lucide icon (kebab-case name → inner SVG). */
export function allIcons(): IconMap {
  if (iconMap) return iconMap;
  const map: IconMap = {};
  for (const [key, node] of Object.entries(lucide as unknown as Record<string, IconNode>)) {
    map[kebab(key)] = node
      .map(
        ([tag, attrs]) =>
          `<${tag} ${Object.entries(attrs)
            .map(([k, v]) => `${k}="${String(v)}"`)
            .join(" ")}/>`,
      )
      .join("");
  }
  iconMap = map;
  return map;
}

let injected = false;
/** Slide styles are global; theme values are applied per container (see deckStyle). */
export function ensureSlideCss(): void {
  if (injected) return;
  const style = document.createElement("style");
  style.id = "slide-css";
  style.textContent = SLIDE_CSS;
  document.head.appendChild(style);
  injected = true;
}

/** Theme custom properties as an inline style string for a `.deck` container. */
export function deckStyle(p: Pick<Presentation, "meta">): string {
  const css = themeVars(resolveTheme(p.meta), p.meta.aspectRatio);
  return css.slice(css.indexOf("{") + 1, css.lastIndexOf("}"));
}

export function styleObject(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

const ctxCache = new WeakMap<Presentation["meta"], RenderContext>();
export function renderContext(p: Presentation): RenderContext {
  let ctx = ctxCache.get(p.meta);
  if (!ctx) {
    ctx = createContext(p, { icons: allIcons(), resolveAsset });
    ctxCache.set(p.meta, ctx);
  }
  return ctx;
}

export function slideHtml(slide: Slide, p: Presentation): string {
  return renderSlide(slide, renderContext(p));
}

export function canvasSize(p: Pick<Presentation, "meta">): { width: number; height: number } {
  return p.meta.aspectRatio === "4:3"
    ? { width: 1440, height: 1080 }
    : { width: 1920, height: 1080 };
}
