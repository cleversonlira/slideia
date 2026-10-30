import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import type { FontId } from "@apresenta/core";
import { icons as lucide } from "lucide";
import { FONTS } from "../fonts.js";
import type { IconMap } from "../icons.js";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/** File name of an embedded font (also used by the server bundle, which ships them in ./fonts). */
export function fontFileName(id: FontId, weight: number, style: "normal" | "italic"): string {
  return `${FONTS[id].pkg.split("/")[1]!}-latin-${weight}-${style}.woff2`;
}

function fontFile(id: FontId, weight: number, style: "normal" | "italic"): string {
  const bundled = fileURLToPath(
    new URL(`./fonts/${fontFileName(id, weight, style)}`, import.meta.url),
  );
  if (existsSync(bundled)) return bundled;
  const dir = dirname(require.resolve(`${FONTS[id].pkg}/package.json`));
  return join(dir, "files", fontFileName(id, weight, style));
}

/** Every font file the export may embed, with its absolute path (for bundling). */
export function allFontFiles(): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = [];
  for (const id of Object.keys(FONTS) as FontId[]) {
    const def = FONTS[id];
    const faces: Array<[number, "normal" | "italic"]> = def.weights.map((w) => [w, "normal"]);
    if (def.italic) faces.push([400, "italic"]);
    for (const [w, st] of faces)
      out.push({ name: fontFileName(id, w, st), path: fontFile(id, w, st) });
  }
  return out;
}

/** @font-face rules with the woff2 files embedded as data URIs. */
export async function fontFaceCss(ids: Iterable<FontId>): Promise<string> {
  const rules: string[] = [];
  for (const id of new Set(ids)) {
    const def = FONTS[id];
    const faces: Array<[number, "normal" | "italic"]> = def.weights.map((w) => [w, "normal"]);
    if (def.italic) faces.push([400, "italic"]);
    for (const [weight, style] of faces) {
      const data = await readFile(fontFile(id, weight, style));
      rules.push(
        `@font-face{font-family:"${def.family}";font-style:${style};font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data.toString("base64")}) format("woff2")}`,
      );
    }
  }
  return rules.join("\n");
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

type IconNode = Array<[string, Record<string, string | number>]>;

function pascal(name: string): string {
  return name
    .split("-")
    .map((p) => (p ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join("");
}

function nodeToSvg(node: IconNode): string {
  return node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== "key")
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
}

export function hasIcon(name: string): boolean {
  return pascal(name) in lucide;
}

/** Inner SVG markup for the requested Lucide icons; unknown names are reported. */
export function lucideIconMap(names: Iterable<string>): { icons: IconMap; missing: string[] } {
  const icons: IconMap = {};
  const missing: string[] = [];
  for (const name of names) {
    const node = (lucide as unknown as Record<string, IconNode | undefined>)[pascal(name)];
    if (node) icons[name] = nodeToSvg(node);
    else missing.push(name);
  }
  return { icons, missing };
}

/** Every Lucide icon, for the editor's icon picker. */
export function allLucideIcons(): IconMap {
  const out: IconMap = {};
  for (const [key, node] of Object.entries(lucide as unknown as Record<string, IconNode>)) {
    out[
      key
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/([A-Za-z])([0-9])/g, "$1-$2")
        .toLowerCase()
    ] = nodeToSvg(node);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

export interface AssetData {
  mime: string;
  data: Uint8Array;
}

export type AssetLoader = (id: string) => Promise<AssetData | null>;

/** Loads `asset:<id>` from files named `<id>.<ext>` in a directory. */
export function directoryAssetLoader(dir: string): AssetLoader {
  let listing: Promise<string[]> | null = null;
  return async (id) => {
    listing ??= readdir(dir).catch(() => []);
    const file = (await listing).find(
      (f) => f.slice(0, -extname(f).length) === id && MIME[extname(f).toLowerCase()],
    );
    if (!file) return null;
    return { mime: MIME[extname(file).toLowerCase()]!, data: await readFile(join(dir, file)) };
  };
}

export function toDataUri(a: AssetData): string {
  return `data:${a.mime};base64,${Buffer.from(a.data).toString("base64")}`;
}
