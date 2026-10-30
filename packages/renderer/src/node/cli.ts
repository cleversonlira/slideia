#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PresentationError, checkDesign, loadPresentation } from "@slideia/core";
import { directoryAssetLoader } from "./assets.js";
import { buildStandaloneHtml, extractPresentationJson } from "./export.js";

const USAGE = `Uso: render <entrada.json|entrada.html> [-o saida.html] [--assets pasta]

Gera um único arquivo .html autocontido a partir de uma apresentação JSON
(formato salvo ou formato de entrada da IA) ou de um HTML exportado.

  -o, --out      arquivo de saída (padrão: mesmo nome com .html)
  --assets       pasta com imagens "asset:<id>" (padrão: <pasta da entrada>/assets)`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      assets: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const input = positionals[0];
  if (values.help || !input) {
    console.log(USAGE);
    process.exit(input ? 0 : 1);
  }
  // `pnpm render` runs inside the package; resolve paths from where the user typed the command.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const path = resolve(cwd, input);
  const raw = await readFile(path, "utf8");
  const data = path.endsWith(".html") ? extractPresentationJson(raw) : (JSON.parse(raw) as unknown);
  const pres = loadPresentation(data);

  for (const w of checkDesign(pres)) console.warn(`aviso de design: ${w.message}`);

  const assetsDir = values.assets ? resolve(cwd, values.assets) : join(dirname(path), "assets");
  const { html, warnings, bytes } = await buildStandaloneHtml(pres, {
    loadAsset: directoryAssetLoader(assetsDir),
  });
  for (const w of warnings) console.warn(`aviso: ${w}`);

  const out = values.out
    ? resolve(cwd, values.out)
    : join(dirname(path), `${basename(path).replace(/\.(json|html)$/, "")}.html`);
  if (out === path) throw new Error("A saída sobrescreveria a entrada; use -o.");
  await writeFile(out, html);
  console.log(`${out} (${(bytes / 1024).toFixed(0)} KB, ${pres.slides.length} slides)`);
}

main().catch((err: unknown) => {
  if (err instanceof PresentationError) {
    console.error(`Apresentação inválida:\n${err.message}`);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
