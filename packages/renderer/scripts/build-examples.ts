import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkDesign, normalizePresentation } from "@apresenta/core";
import { directoryAssetLoader } from "../src/node/assets.js";
import { buildStandaloneHtml } from "../src/node/export.js";

const examples = fileURLToPath(new URL("../../../assets/examples/", import.meta.url));
const out = fileURLToPath(new URL("../../../out/examples/", import.meta.url));
await mkdir(out, { recursive: true });

const loadAsset = directoryAssetLoader(`${examples}assets`);
for (const file of (await readdir(examples)).filter((f) => f.endsWith(".json")).sort()) {
  const pres = normalizePresentation(JSON.parse(await readFile(examples + file, "utf8")), {
    id: `p_${file.replace(/\.json$/, "").replace(/[^a-z0-9]/g, "")}`.slice(0, 40),
  });
  const { html, warnings, bytes } = await buildStandaloneHtml(pres, { loadAsset });
  const target = `${out}${file.replace(/\.json$/, ".html")}`;
  await writeFile(target, html);
  console.log(`${target}  ${(bytes / 1024).toFixed(0)} KB`);
  for (const w of [...warnings, ...checkDesign(pres).map((d) => d.message)])
    console.log(`  aviso: ${w}`);
}
