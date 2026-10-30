/*
 * Exported HTML files embed the presentation JSON with its original image references and, next
 * to it, one data URI per distinct reference (`<script type="application/json" id="images">`),
 * so an image used on several slides is stored once. Browser-safe: the editor uses it to import.
 */

import { mapImageRefs } from "@slideia/core/browser";

export type ImageMap = Record<string, string>;

const scriptRe = (id: string) =>
  new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`);

/** `resolveAsset` for the renderer: the embedded data for a reference, or the reference itself. */
export function imageResolver(images: ImageMap): (ref: string) => string {
  return (ref) => (Object.hasOwn(images, ref) ? images[ref]! : ref);
}

/** Replaces every image reference found in `images` by its data (see `mapImageRefs`). */
export function inlineImages<T>(pres: T, images: ImageMap): T {
  return mapImageRefs(pres, imageResolver(images));
}

/**
 * The presentation embedded in an exported HTML file, with its images inlined as data URIs
 * (self-contained, ready to import anywhere). Throws when the file has no presentation.
 */
export function readEmbeddedPresentation(html: string): unknown {
  const m = scriptRe("presentation").exec(html);
  if (!m) throw new Error("No embedded presentation found in this HTML file.");
  const images = scriptRe("images").exec(html);
  const data = JSON.parse(m[1]!) as unknown;
  return images ? inlineImages(data, JSON.parse(images[1]!) as ImageMap) : data;
}
