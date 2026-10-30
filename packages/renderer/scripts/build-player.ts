import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Browser bundles: the standalone player (exported HTML) and the chat widget (MCP Apps view). */
for (const [entry, out] of [
  ["src/player/main.ts", "dist/player.js"],
  ["src/widget/main.ts", "dist/widget.js"],
] as const) {
  const result = await build({
    entryPoints: [`${root}${entry}`],
    outfile: `${root}${out}`,
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2022", "chrome110", "firefox115", "safari16"],
    legalComments: "none",
    metafile: true,
    logLevel: "warning",
  });

  await mkdir(`${root}dist`, { recursive: true });
  const file = Object.values(result.metafile.outputs)[0]!;
  const zod = Object.keys(result.metafile.inputs).some((f) => f.includes("node_modules/zod"));
  console.log(
    `${out.slice(5)}: ${(file.bytes / 1024).toFixed(1)} KB${zod ? " (WARNING: zod is bundled)" : ""}`,
  );
}
