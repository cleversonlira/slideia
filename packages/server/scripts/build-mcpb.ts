/*
 * Builds out/slideia-<version>.mcpb: the local server as a Claude Desktop extension (MCP Bundle).
 *   pnpm mcpb
 *
 * The bundle is dist/ (scripts/build.ts) plus a launcher, the manifest and node_modules with the
 * native packages for every desktop platform (sharp ships one binary per OS/CPU). The tool list in
 * the manifest comes from the server itself, so it never drifts.
 */
import { execFileSync, execSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { loadConfig } from "../src/config.js";
import { createMcpServer } from "../src/mcp.js";
import { startRuntime } from "../src/runtime.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const stage = `${repo}out/mcpb/`;
const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8")) as {
  version: string;
  dependencies: Record<string, string>;
};
const out = `${repo}out/slideia-${pkg.version}.mcpb`;

/** Minimum Node.js: node:sqlite without a flag. */
const NODE = ">=22.13.0";

if (!process.argv.includes("--skip-build"))
  execSync("pnpm --filter @slideia/server build", { stdio: "inherit", cwd: repo });

rmSync(stage, { recursive: true, force: true });
mkdirSync(`${stage}server`, { recursive: true });
const dist = `${root}dist/`;
for (const f of ["stdio.js", "player.js", "widget.js", "fonts", "editor", "examples"])
  cpSync(`${dist}${f}`, `${stage}server/${f}`, { recursive: true });
cpSync(`${repo}packages/editor/public/icon-512.png`, `${stage}icon.png`);

// Launcher: a clear message instead of a stack trace when the host's Node is too old.
writeFileSync(
  `${stage}server/index.js`,
  `// SlideIA local server launcher (MCP over stdio).
try {
  await import("node:sqlite");
} catch {
  console.error(
    \`[slideia] Node.js \${process.versions.node} não tem node:sqlite; é preciso Node ${NODE.slice(2)} ou mais novo. \` +
      "Atualize o Claude Desktop, ou instale o Node.js atual e, em Configurações → Extensões → Configurações avançadas, desative o Node.js embutido.",
  );
  process.exit(1);
}
await import("./stdio.js");
`,
);

// Native/large dependencies, installed for every desktop OS and CPU.
const EXTERNAL = ["sharp", "playwright-core"];
// Any other package the local entry imports would be missing at runtime (remote-only ones such
// as pg or the AWS SDK must not reach stdio.js).
const imported = new Set(
  [
    ...readFileSync(`${dist}stdio.js`, "utf8").matchAll(
      /(?:\bfrom|\bimport\()\s*"((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.-]+)*|node:[\w/]+)"/g,
    ),
  ]
    .map((m) => m[1]!)
    .filter((spec) => !spec.startsWith("node:"))
    .map((spec) =>
      spec
        .split("/")
        .slice(0, spec.startsWith("@") ? 2 : 1)
        .join("/"),
    ),
);
const missing = [...imported].filter((d) => !EXTERNAL.includes(d));
if (missing.length)
  throw new Error(`stdio.js imports packages missing from the bundle: ${missing}`);
writeFileSync(
  `${stage}package.json`,
  `${JSON.stringify(
    {
      name: "slideia-mcpb",
      version: pkg.version,
      private: true,
      type: "module",
      dependencies: Object.fromEntries(EXTERNAL.map((d) => [d, pkg.dependencies[d]])),
    },
    null,
    2,
  )}\n`,
);
const npmInstall = (cwd: string, os: string, cpu: string) =>
  execFileSync(
    "npm",
    [
      "install",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      `--os=${os}`,
      `--cpu=${cpu}`,
    ],
    { cwd, stdio: "ignore" },
  );
// npm keeps only one --os/--cpu, so each platform's sharp binaries come from its own install.
const TARGETS = [
  ["darwin", "arm64"],
  ["darwin", "x64"],
  ["win32", "x64"],
  ["win32", "arm64"],
  ["linux", "x64"],
] as const;
npmInstall(stage, TARGETS[0][0], TARGETS[0][1]);
for (const [os, cpu] of TARGETS.slice(1)) {
  const tmp = mkdtempSync(join(tmpdir(), `slideia-mcpb-${os}-${cpu}-`));
  cpSync(`${stage}package.json`, `${tmp}/package.json`);
  npmInstall(tmp, os, cpu);
  cpSync(`${tmp}/node_modules/@img`, `${stage}node_modules/@img`, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
}

// The tool list, straight from the server.
const home = mkdtempSync(join(tmpdir(), "slideia-mcpb-"));
const rt = await startRuntime({ ...loadConfig({ APRESENTA_HOME: home }), port: 0 });
const client = new Client({ name: "build-mcpb", version: "1" });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([createMcpServer(rt.service, rt.previewer).connect(a), client.connect(b)]);
const { tools } = await client.listTools();
await client.close();
await rt.close();
rmSync(home, { recursive: true, force: true });

const manifest = {
  manifest_version: "0.3",
  name: "slideia",
  display_name: "SlideIA",
  version: pkg.version,
  description: "Crie, edite e apresente slides com IA, com editor visual no seu computador.",
  long_description:
    "O SlideIA transforma uma conversa em uma apresentação pronta: layouts, tema, gráficos, " +
    "tabelas, ícones e imagens. Tudo fica numa pasta do seu computador; um editor visual local " +
    "(no navegador) permite ajustar textos, imagens e a marca da empresa, e a IA vê suas edições " +
    "sem sobrescrevê-las. Apresente no navegador ou exporte um único arquivo HTML que funciona " +
    "offline. A prévia dos slides usa o Google Chrome ou o Microsoft Edge instalado.",
  author: { name: "Cleverson Lira", url: "https://slideia.site" },
  homepage: "https://slideia.site",
  support: "https://slideia.site/suporte",
  repository: { type: "git", url: "https://github.com/cleversonlira/slideia" },
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js"],
      env: { APRESENTA_HOME: "${user_config.home}" },
    },
  },
  user_config: {
    home: {
      type: "directory",
      title: "Pasta das apresentações",
      description:
        "Onde ficam as apresentações, as imagens e os arquivos HTML exportados (dados internos na subpasta .apresenta).",
      default: "${HOME}/Apresentacoes",
      required: true,
    },
  },
  tools: tools.map((t) => ({ name: t.name, description: t.description ?? "" })),
  prompts_generated: true,
  keywords: ["slides", "apresentação", "presentation", "powerpoint", "editor"],
  compatibility: { platforms: ["darwin", "win32", "linux"], runtimes: { node: NODE } },
};
writeFileSync(`${stage}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

const mcpb = `${repo}node_modules/.bin/mcpb`;
execFileSync(mcpb, ["validate", `${stage}manifest.json`], { stdio: "inherit" });
rmSync(out, { force: true });
execFileSync(mcpb, ["pack", stage, out], { stdio: "inherit" });
console.log(`${out} (${(statSync(out).size / 1048576).toFixed(1)} MB)`);
