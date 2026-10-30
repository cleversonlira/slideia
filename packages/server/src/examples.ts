import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PresentationService } from "./service.js";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** Folder with the example presentations: next to the bundle, or in the source tree. */
export function examplesDir(): string | undefined {
  return [
    new URL("./examples/", import.meta.url),
    new URL("../../../assets/examples/", import.meta.url),
  ]
    .map((u) => fileURLToPath(u))
    .find((d) => existsSync(d));
}

/** Imports the example presentations (with their images) for a user. Returns how many. */
export async function importExamples(service: PresentationService): Promise<number> {
  const dir = examplesDir();
  if (!dir) return 0;
  const images = new Map<string, string>();
  const assets = join(dir, "assets");
  if (existsSync(assets)) {
    for (const f of readdirSync(assets)) {
      const type = MIME[extname(f).toLowerCase()];
      if (type)
        images.set(
          f.slice(0, -extname(f).length),
          `data:${type};base64,${readFileSync(join(assets, f)).toString("base64")}`,
        );
    }
  }
  const files = readdirSync(dir)
    .filter((x) => x.endsWith(".json"))
    .sort()
    .reverse();
  for (const f of files) {
    const json = readFileSync(join(dir, f), "utf8").replace(
      /"asset:([A-Za-z0-9_-]+)"/g,
      (m, id: string) => (images.has(id) ? JSON.stringify(images.get(id)) : m),
    );
    await service.create(JSON.parse(json), "user", "import");
  }
  return files.length;
}
