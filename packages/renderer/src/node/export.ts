import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolveTheme, type Presentation } from "@apresenta/core";
import { deckCss } from "../css.js";
import { esc } from "../escape.js";
import { collectIconNames } from "../icons.js";
import { PLAYER_CSS, PRINT_43 } from "../player/styles.js";
import { safeJson } from "../player/quickedit.js";
import { fontFaceCss, lucideIconMap, toDataUri, type AssetLoader } from "./assets.js";

export interface ExportOptions {
  /** Resolves `asset:<id>` references. */
  loadAsset?: AssetLoader;
  /** Download http(s) images and embed them (default false: they are reported as warnings). */
  fetchRemote?: (url: string) => Promise<{ mime: string; data: Uint8Array } | null>;
  /** Player bundle; defaults to dist/player.js built by scripts/build-player.ts. */
  playerJs?: string;
}

export interface ExportResult {
  html: string;
  warnings: string[];
  bytes: number;
}

// Source tree (packages/renderer/dist) or next to a bundled server (dist/player.js).
const PLAYER_PATHS = [
  fileURLToPath(new URL("../../dist/player.js", import.meta.url)),
  fileURLToPath(new URL("./player.js", import.meta.url)),
];
let cachedPlayer: string | null = null;

export async function loadPlayerJs(): Promise<string> {
  if (cachedPlayer) return cachedPlayer;
  for (const path of PLAYER_PATHS) {
    try {
      cachedPlayer = await readFile(path, "utf8");
      return cachedPlayer;
    } catch {
      // try next location
    }
  }
  throw new Error(`Player bundle not found. Run "pnpm --filter @apresenta/renderer build".`);
}

/** A 1×1 transparent GIF used when an image cannot be embedded. */
const PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

async function embedImages(
  p: Presentation,
  opts: ExportOptions,
  warnings: string[],
): Promise<Presentation> {
  const cache = new Map<string, string>();
  const resolve = async (ref: string): Promise<string> => {
    const hit = cache.get(ref);
    if (hit) return hit;
    let out = PLACEHOLDER;
    if (ref.startsWith("data:")) out = ref;
    else if (ref.startsWith("asset:")) {
      const a = opts.loadAsset ? await opts.loadAsset(ref.slice(6)) : null;
      if (a) out = toDataUri(a);
      else warnings.push(`Image ${ref} not found; a blank placeholder was used.`);
    } else if (/^https?:/i.test(ref)) {
      const a = opts.fetchRemote ? await opts.fetchRemote(ref).catch(() => null) : null;
      if (a) out = toDataUri(a);
      else
        warnings.push(
          `Remote image ${ref} was not embedded (the file works offline only with embedded images).`,
        );
    }
    cache.set(ref, out);
    return out;
  };

  const slides = [];
  for (const s of p.slides) {
    const elements = [];
    for (const e of s.elements)
      elements.push(e.type === "image" ? { ...e, asset: await resolve(e.asset) } : e);
    const background =
      s.background?.type === "image"
        ? { ...s.background, asset: await resolve(s.background.asset) }
        : s.background;
    slides.push(background ? { ...s, elements, background } : { ...s, elements });
  }
  return { ...p, slides };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64");
}

/** Builds the single-file, offline HTML presentation. */
export async function buildStandaloneHtml(
  input: Presentation,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  const warnings: string[] = [];
  const p = await embedImages(input, opts, warnings);
  const theme = resolveTheme(p.meta);

  const { icons, missing } = lucideIconMap(collectIconNames(p));
  for (const m of missing)
    warnings.push(`Icon "${m}" does not exist in Lucide; a placeholder is shown.`);

  const fonts = await fontFaceCss([theme.fonts.heading, theme.fonts.body]);
  const css = [
    fonts,
    deckCss(theme, p.meta.aspectRatio),
    PLAYER_CSS,
    p.meta.aspectRatio === "4:3" ? PRINT_43 : "",
  ].join("\n");
  const js = (opts.playerJs ?? (await loadPlayerJs())).replace(/<\/(script)/gi, "<\\/$1");
  const csp = [
    "default-src 'none'",
    "img-src data: blob:",
    "font-src data:",
    "style-src 'unsafe-inline'",
    `script-src 'sha256-${sha256(js)}'`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  const html = `<!doctype html>
<html lang="${esc(p.meta.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="generator" content="Apresenta">
<title>${esc(p.meta.title)}</title>
<style>${css}</style>
</head>
<body>
<div id="app" class="deck"></div>
<noscript><p style="font:18px system-ui;color:#fff;padding:24px">Ative o JavaScript para ver esta apresentação.</p></noscript>
<script type="application/json" id="presentation">${safeJson(p)}</script>
<script type="application/json" id="icons">${safeJson(icons)}</script>
<script>${js}</script>
</body>
</html>
`;
  return { html, warnings, bytes: Buffer.byteLength(html) };
}

/** Extracts the embedded presentation JSON from an exported HTML file (for re-import). */
export function extractPresentationJson(html: string): unknown {
  const m = /<script type="application\/json" id="presentation">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("No embedded presentation found in this HTML file.");
  return JSON.parse(m[1]!);
}
