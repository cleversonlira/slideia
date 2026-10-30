import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolveTheme, type FontId, type Presentation } from "@slideia/core";
import { FONTS } from "../fonts.js";
import { collectIconNames, type IconMap } from "../icons.js";
import { fontFileName, lucideIconMap } from "./assets.js";

// Source tree (packages/renderer/dist) or next to a bundled server (dist/widget.js).
const WIDGET_PATHS = [
  fileURLToPath(new URL("../../dist/widget.js", import.meta.url)),
  fileURLToPath(new URL("./widget.js", import.meta.url)),
];
let cachedWidget: string | null = null;

export async function loadWidgetJs(): Promise<string> {
  if (cachedWidget) return cachedWidget;
  for (const path of WIDGET_PATHS) {
    try {
      cachedWidget = await readFile(path, "utf8");
      return cachedWidget;
    } catch {
      // try next location
    }
  }
  throw new Error(`Widget bundle not found. Run "pnpm --filter @slideia/renderer build".`);
}

/** The MCP Apps view (single HTML document with the widget script inlined). */
export async function buildWidgetHtml(): Promise<string> {
  const js = (await loadWidgetJs()).replace(/<\/(script)/gi, "<\\/$1");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SlideIA</title>
</head>
<body>
<div id="app"></div>
<script>${js}</script>
</body>
</html>
`;
}

/** @font-face rules pointing at `${baseUrl}/fonts/<file>` (the widget cannot use data: fonts). */
export function fontUrlCss(ids: Iterable<FontId>, baseUrl: string): string {
  const rules: string[] = [];
  for (const id of new Set(ids)) {
    const def = FONTS[id];
    const faces: Array<[number, "normal" | "italic"]> = def.weights.map((w) => [w, "normal"]);
    if (def.italic) faces.push([400, "italic"]);
    for (const [weight, style] of faces)
      rules.push(
        `@font-face{font-family:"${def.family}";font-style:${style};font-weight:${weight};font-display:swap;src:url(${baseUrl}/fonts/${fontFileName(id, weight, style)}) format("woff2")}`,
      );
  }
  return rules.join("\n");
}

/** Fonts and icons the widget needs to draw this presentation. */
export function widgetAssets(
  p: Presentation,
  baseUrl: string,
): { fontCss: string; icons: IconMap } {
  const theme = resolveTheme(p.meta);
  return {
    fontCss: fontUrlCss([theme.fonts.heading, theme.fonts.body], baseUrl),
    icons: lucideIconMap(collectIconNames(p)).icons,
  };
}
