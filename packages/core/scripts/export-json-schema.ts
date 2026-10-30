/* Writes the Presentation Schema (AI input and stored formats) as JSON Schema files. */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Operations } from "../src/ops.js";
import { PresentationInputSchema, PresentationSchema } from "../src/schema.js";

const out = fileURLToPath(new URL("../dist/", import.meta.url));
await mkdir(out, { recursive: true });
const files: Record<string, z.ZodType> = {
  "presentation-input.schema.json": PresentationInputSchema,
  "presentation.schema.json": PresentationSchema,
  "operations.schema.json": Operations,
};
for (const [name, schema] of Object.entries(files)) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" });
  await writeFile(out + name, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${name}: ${(JSON.stringify(json).length / 1024).toFixed(1)} KB`);
}
