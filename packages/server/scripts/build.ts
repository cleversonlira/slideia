/*
 * Bundles the server into dist/ (run with `node`):
 *   stdio.js   local mode (MCP over stdio + editor on 127.0.0.1)
 *   remote.js  remote mode (MCP over HTTP + OAuth + accounts)
 * next to the files they need: player.js, fonts/, editor/ (built SPA), examples/ and a
 * package.json with the external dependencies (`npm install --omit=dev` inside dist/).
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { allFontFiles } from "../../renderer/src/node/assets.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const dist = `${root}dist/`;
rmSync(dist, { recursive: true, force: true });
mkdirSync(`${dist}fonts`, { recursive: true });

execSync("pnpm --filter @slideia/renderer build", { stdio: "inherit", cwd: repo });
if (!process.argv.includes("--skip-editor"))
  execSync("pnpm --filter @slideia/editor build", { stdio: "inherit", cwd: repo });

// Native, WASM or very large packages stay external; dist/package.json lists them.
const EXTERNAL = ["sharp", "playwright-core", "@electric-sql/pglite", "pg", "@aws-sdk/client-s3"];
for (const [entry, out] of [
  ["src/stdio.ts", "stdio.js"],
  ["src/remote/main.ts", "remote.js"],
] as const) {
  await build({
    entryPoints: [`${root}${entry}`],
    outfile: `${dist}${out}`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: EXTERNAL,
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    legalComments: "none",
    logLevel: "warning",
  });
}

const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8")) as {
  dependencies: Record<string, string>;
};
writeFileSync(
  `${dist}package.json`,
  `${JSON.stringify(
    {
      name: "apresenta-server-dist",
      private: true,
      type: "module",
      engines: { node: ">=24" },
      bin: { "apresenta-mcp": "./stdio.js" },
      dependencies: Object.fromEntries(EXTERNAL.map((d) => [d, pkg.dependencies[d]])),
    },
    null,
    2,
  )}\n`,
);

cpSync(`${repo}packages/renderer/dist/player.js`, `${dist}player.js`);
cpSync(`${repo}packages/renderer/dist/widget.js`, `${dist}widget.js`);
for (const f of allFontFiles()) cpSync(f.path, `${dist}fonts/${f.name}`);
const editor = `${repo}packages/editor/dist`;
if (existsSync(editor))
  cpSync(editor, `${dist}editor`, { recursive: true, filter: (p) => !p.endsWith(".map") });
cpSync(`${repo}assets/examples`, `${dist}examples`, { recursive: true });
console.log(`server bundle: ${dist}stdio.js, ${dist}remote.js`);
