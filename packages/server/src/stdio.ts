#!/usr/bin/env node
/*
 * Local mode entry point.
 *   apresenta-mcp            MCP over stdio (for Claude Code, Claude Desktop, Gemini CLI, Cursor…)
 *                            plus the editor on http://127.0.0.1:<port>
 *   apresenta-mcp --editor   only the editor (no MCP), prints its link
 *   --seed-examples          with --editor: imports the example presentations into an empty folder
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { importExamples } from "./examples.js";
import { createMcpServer } from "./mcp.js";
import { startRuntime, type Runtime } from "./runtime.js";

// stdout carries the MCP protocol: route any stray logging to stderr.
console.log = console.error;
console.info = console.error;

async function main(): Promise<void> {
  const config = loadConfig();
  const editorOnly = process.argv.includes("--editor");
  const runtime = await startRuntime(config);
  const link = `${runtime.base()}/?t=${runtime.token}`;

  const shutdown = async () => {
    await runtime.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  if (editorOnly) {
    if (process.argv.includes("--seed-examples")) await seedExamples(runtime);
    console.error(`Editor: ${link}`);
    console.error(`Pasta: ${config.home}`);
    return;
  }

  const server = createMcpServer(runtime.service, runtime.previewer);
  await server.connect(new StdioServerTransport());
  process.stdin.on("close", () => void shutdown());
  console.error(`[apresenta] MCP pronto · editor em ${runtime.base()} · pasta ${config.home}`);
}

/** Imports the bundled example presentations (with their images) when the folder is empty. */
async function seedExamples(runtime: Runtime): Promise<void> {
  if ((await runtime.service.repo.count()) > 0) return;
  if (await importExamples(runtime.service))
    console.error(`Exemplos importados em ${runtime.service.config.home}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
