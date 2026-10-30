import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));

const result = await build({
  entryPoints: [`${root}src/player/main.ts`],
  outfile: `${root}dist/player.js`,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2022", "chrome110", "firefox115", "safari16"],
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});

await mkdir(`${root}dist`, { recursive: true });
const out = Object.values(result.metafile.outputs)[0]!;
const zod = Object.keys(result.metafile.inputs).some((f) => f.includes("node_modules/zod"));
console.log(
  `player.js: ${(out.bytes / 1024).toFixed(1)} KB${zod ? " (WARNING: zod is bundled)" : ""}`,
);
