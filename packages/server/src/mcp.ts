import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  LAYOUT_IDS,
  PresentationError,
  PresentationInputSchema,
  THEME_IDS,
  TRANSITION_TYPES,
  formatIssues,
  type DesignWarning,
} from "@apresenta/core";
import { DESIGN_RULES, buildGuide } from "./guide.js";
import { PreviewUnavailableError, type Previewer } from "./preview.js";
import { ConflictError, LimitError, NotFoundError, type PresentationService } from "./service.js";
import { ImageError } from "./images.js";

const VERSION = "0.1.0";

// Compact input schemas: enough structure for the model, details in get_guide. The server
// validates everything again and answers with field paths + how to fix.
const ElementIn = z
  .looseObject({
    type: z.enum(["title", "text", "image", "icon", "chart", "table", "quote", "stat", "timeline"]),
    slot: z.string().optional().describe("Layout slot; optional when obvious."),
  })
  .describe("Element; fields depend on type (see get_guide). Text fields accept Markdown.");

const SlideIn = z.looseObject({
  layout: z.enum(LAYOUT_IDS),
  variant: z.string().optional(),
  elements: z.array(ElementIn),
  notes: z.string().optional().describe("Speaker notes (Markdown)."),
  transition: z
    .object({
      type: z.enum(TRANSITION_TYPES),
      direction: z.enum(["left", "right", "up", "down"]).optional(),
      durationMs: z.number().optional(),
    })
    .optional(),
  background: z.record(z.string(), z.unknown()).optional(),
});

const PresentationIn = z.object({
  meta: z.looseObject({
    title: z.string(),
    theme: z.enum(THEME_IDS).optional(),
    lang: z.string().optional().describe('BCP 47, default "pt-BR".'),
    aspectRatio: z.enum(["16:9", "4:3"]).optional(),
    defaultTransition: z.record(z.string(), z.unknown()).optional(),
  }),
  slides: z.array(SlideIn).min(1),
});

const OperationIn = z
  .looseObject({
    op: z.enum([
      "update_text",
      "update_element",
      "add_element",
      "remove_element",
      "reorder_elements",
      "update_slide",
      "add_slide",
      "remove_slide",
      "duplicate_slide",
      "replace_slide",
      "move_slide",
      "reorder_slides",
      "update_presentation",
      "find_replace",
      "set_image",
    ]),
  })
  .describe(
    "One edit; fields per op are listed in get_guide (e.g. {op:'update_text', slide:2, element:'e_x', text:'…'}).",
  );

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function errorResult(err: unknown): CallToolResult {
  let message: string;
  if (err instanceof PresentationError) message = `Invalid input:\n${formatIssues(err.issues)}`;
  else if (err instanceof ConflictError) message = err.message;
  else if (
    err instanceof NotFoundError ||
    err instanceof LimitError ||
    err instanceof ImageError ||
    err instanceof PreviewUnavailableError
  ) {
    message = err.message;
  } else {
    console.error(err);
    message = `Unexpected error: ${(err as Error).message}`;
  }
  return { content: [{ type: "text", text: message }], isError: true };
}

function formatWarnings(w: DesignWarning[], notes: string[] = []): string {
  const lines = [...notes, ...w.map((x) => x.message)];
  return lines.length ? `\nDesign notes:\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
}

async function safely(fn: () => Promise<CallToolResult> | CallToolResult): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return errorResult(err);
  }
}

export interface McpOptions {
  /** False when the access token lacks the presentations:write scope. */
  canWrite?: boolean;
  /** Called after every tool call (metrics, logs). Never receives content. */
  onToolCall?: (name: string, ms: number, ok: boolean) => void;
}

const WRITE_TOOLS = new Set(["create_presentation", "apply_edits", "add_image", "render"]);

export function createMcpServer(
  service: PresentationService,
  previewer: Previewer,
  opts: McpOptions = {},
): McpServer {
  const server = new McpServer(
    { name: "apresenta", title: "Apresentações HTML", version: VERSION },
    {
      instructions:
        "Creates and edits HTML slide presentations stored by this server. Read get_guide before creating a presentation. " +
        "Edits are partial (apply_edits); the user can also edit by hand in the web editor, so read the latest version before editing.",
    },
  );

  // Every tool goes through this wrapper: scope check and timing.
  const register = server.registerTool.bind(server) as (
    name: string,
    config: unknown,
    cb: (...a: unknown[]) => unknown,
  ) => unknown;
  (server as unknown as { registerTool: typeof register }).registerTool = (name, config, cb) =>
    register(name, config, async (...args: unknown[]) => {
      const started = performance.now();
      if (WRITE_TOOLS.has(name) && opts.canWrite === false) {
        opts.onToolCall?.(name, 0, false);
        return text(
          `This connection is read-only (missing scope presentations:write). Reconnect the app granting edit access.`,
        );
      }
      const result = (await cb(...args)) as CallToolResult;
      opts.onToolCall?.(name, performance.now() - started, !result.isError);
      return result;
    });

  server.registerTool(
    "get_guide",
    {
      title: "Guia de criação",
      description:
        "Returns the presentation format (layouts, elements, themes, transitions), design rules and editing operations. Call it once before creating or editing presentations.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => text(buildGuide()),
  );

  server.registerTool(
    "create_presentation",
    {
      title: "Criar apresentação",
      description:
        "Creates a new presentation from JSON (see get_guide; text fields accept Markdown, ids are optional). Image URLs are downloaded and stored. Returns the id, version, design warnings and links to the editor and the downloadable HTML.",
      inputSchema: { presentation: PresentationIn },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ presentation }) =>
      safely(async () => {
        const {
          presentation: p,
          warnings,
          notes,
        } = await service.create(presentation, "ai", "mcp");
        const result = {
          id: p.id,
          version: p.version,
          slides: p.slides.map((s, i) => ({ n: i + 1, id: s.id, layout: s.layout })),
          editorUrl: service.links.editor(p.id),
          downloadUrl: service.links.download(p.id),
          warnings: [...notes, ...warnings.map((w) => w.message)],
        };
        return {
          content: [
            {
              type: "text",
              text:
                `Created "${p.meta.title}" (${p.id}), version ${p.version}, ${p.slides.length} slides.\n` +
                `Editor: ${result.editorUrl}\nDownload HTML: ${result.downloadUrl}` +
                formatWarnings(warnings, notes) +
                `\nNext: call preview to check the slides.`,
            },
          ],
          structuredContent: result,
        };
      }),
  );

  server.registerTool(
    "get_presentation",
    {
      title: "Ler apresentação",
      description:
        'Reads the latest version. format "outline" (default) lists every slide with element ids and texts; "full" returns the JSON with texts as Markdown.',
      inputSchema: { id: z.string(), format: z.enum(["outline", "full"]).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id, format }) =>
      safely(async () => {
        const p = await service.get(id);
        if (format === "full") return text(JSON.stringify(service.fullForAi(p)));
        return text(service.outline(p));
      }),
  );

  server.registerTool(
    "list_presentations",
    {
      title: "Listar apresentações",
      description: "Lists the user's presentations (most recently updated first).",
      inputSchema: {
        query: z.string().optional().describe("Filter by title."),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit }) =>
      safely(async () => {
        const rows = await service.list(query, limit ?? 20);
        if (!rows.length) return text("No presentations yet.");
        return {
          content: [
            {
              type: "text",
              text: rows
                .map(
                  (r) =>
                    `- ${r.id} · "${r.title}" · ${r.slides} slides · v${r.version} · updated ${r.updatedAt}`,
                )
                .join("\n"),
            },
          ],
          structuredContent: { presentations: rows },
        };
      }),
  );

  server.registerTool(
    "apply_edits",
    {
      title: "Editar apresentação",
      description:
        "Applies several edits atomically in ONE call (batch everything you need). Pass the version you last read as expectedVersion; edits that do not overlap with the user's manual changes are merged, otherwise a conflict is reported. Operations: update_text, update_element, add_element, remove_element, reorder_elements, update_slide, add_slide, remove_slide, duplicate_slide, replace_slide, move_slide, reorder_slides, update_presentation, find_replace, set_image (fields in get_guide).",
      inputSchema: {
        id: z.string(),
        expectedVersion: z.number().int().min(1),
        operations: z.array(OperationIn).min(1).max(100),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ id, expectedVersion, operations }) =>
      safely(async () => {
        const r = await service.apply(id, expectedVersion, operations, "ai", "mcp");
        const head = r.changed
          ? `Saved version ${r.presentation.version}${r.rebased ? " (merged with newer manual edits)" : ""}.`
          : `Nothing changed (still version ${r.presentation.version}).`;
        return {
          content: [
            {
              type: "text",
              text: `${head}\n${r.summary.map((s) => `- ${s}`).join("\n")}${formatWarnings(r.warnings, r.notes)}`,
            },
          ],
          structuredContent: {
            id,
            version: r.presentation.version,
            changed: r.changed,
            rebased: r.rebased,
            summary: r.summary,
          },
        };
      }),
  );

  server.registerTool(
    "add_image",
    {
      title: "Adicionar imagem",
      description:
        'Stores an image from a public URL or a base64 data URI (resized and compressed) and returns an "asset:<id>" reference to use in image elements or backgrounds.',
      inputSchema: { source: z.string().describe("https://… or data:image/…;base64,…") },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ source }) =>
      safely(async () => {
        const a = await service.addImage(source);
        return {
          content: [{ type: "text", text: `asset:${a.id} (${a.width}×${a.height})` }],
          structuredContent: { asset: `asset:${a.id}`, width: a.width, height: a.height },
        };
      }),
  );

  server.registerTool(
    "get_changes",
    {
      title: "Ver alterações",
      description:
        "Describes what changed since a version, including texts the user edited by hand in the editor.",
      inputSchema: { id: z.string(), sinceVersion: z.number().int().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id, sinceVersion }) =>
      safely(async () => {
        const c = await service.changesSince(id, sinceVersion);
        return {
          content: [{ type: "text", text: c.text }],
          structuredContent: { version: c.version, userEdits: c.byUser },
        };
      }),
  );

  server.registerTool(
    "preview",
    {
      title: "Pré-visualizar",
      description:
        "Renders the slides as an image exactly as presented (one slide, or a numbered grid of up to 24) and lists text that does not fit. Use it after creating or editing.",
      inputSchema: { id: z.string(), slideNumber: z.number().int().min(1).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id, slideNumber }) =>
      safely(async () => {
        const { html, presentation } = await service.renderHtml(id);
        const r = await previewer.render(html, {
          ...(slideNumber ? { slideNumber } : {}),
          aspect: presentation.meta.aspectRatio,
        });
        const issues = r.issues.length
          ? r.issues.map((i) => `- slide ${i.slide}, ${i.elementId}: ${i.message}`).join("\n")
          : "No layout problems detected.";
        return {
          content: [
            { type: "image", data: r.image.toString("base64"), mimeType: r.mime },
            {
              type: "text",
              text: `Slides shown: ${r.slides.join(", ")} of ${presentation.slides.filter((s) => !s.hidden).length}.\n${issues}`,
            },
          ],
        };
      }),
  );

  server.registerTool(
    "render",
    {
      title: "Gerar HTML",
      description:
        "Generates the standalone .html file (works offline, with presenter-remote support) and returns where to get it.",
      inputSchema: { id: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id }) =>
      safely(async () => {
        const url = service.links.download(id);
        if (!service.writeFiles) {
          await service.get(id);
          return {
            content: [
              {
                type: "text",
                text: `Download (link valid for 24 h): ${url}\nPresent online: ${service.links.present(id)}`,
              },
            ],
            structuredContent: { downloadUrl: url, presentUrl: service.links.present(id) },
          };
        }
        const r = await service.renderToFile(id);
        return {
          content: [
            {
              type: "text",
              text: `Saved ${r.path} (${Math.round(r.bytes / 1024)} KB).\nDownload: ${url}${r.warnings.length ? `\nWarnings:\n${r.warnings.map((w) => `- ${w}`).join("\n")}` : ""}`,
            },
          ],
          structuredContent: { path: r.path, downloadUrl: url, bytes: r.bytes },
        };
      }),
  );

  server.registerTool(
    "open_editor",
    {
      title: "Abrir editor",
      description:
        "Returns the link to the visual editor (optionally at a slide) and the link to present.",
      inputSchema: { id: z.string(), slideNumber: z.number().int().min(1).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id, slideNumber }) =>
      safely(async () => {
        await service.get(id);
        const editorUrl = service.links.editor(id, slideNumber);
        const presentUrl = service.links.present(id);
        return {
          content: [{ type: "text", text: `Editor: ${editorUrl}\nPresent: ${presentUrl}` }],
          structuredContent: { editorUrl, presentUrl },
        };
      }),
  );

  // -------------------------------------------------------------------------
  // Prompts
  // -------------------------------------------------------------------------

  server.registerPrompt(
    "criar_apresentacao",
    {
      title: "Criar apresentação",
      description: "Guided flow: briefing → outline for approval → creation → preview → links.",
      argsSchema: {
        tema: z.string().describe("Assunto da apresentação"),
        publico: z.string().optional().describe("Público-alvo"),
        duracao: z.string().optional().describe("Duração, ex. 15 minutos"),
        tom: z.string().optional().describe("Tom: formal, inspirador, didático…"),
      },
    },
    ({ tema, publico, duracao, tom }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Quero uma apresentação sobre: ${tema}.${publico ? ` Público: ${publico}.` : ""}${duracao ? ` Duração: ${duracao}.` : ""}${tom ? ` Tom: ${tom}.` : ""}

Siga este fluxo:
1. Chame get_guide.
2. Se faltar informação essencial (objetivo, público, dados), pergunte de forma breve.
3. Proponha um roteiro (título e uma linha por slide, ~1 slide por minuto) e espere minha aprovação.
4. Crie com create_presentation, incluindo anotações do apresentador em todos os slides.
5. Confira com preview e corrija problemas com uma única chamada a apply_edits.
6. Me entregue o link do editor e o link para baixar o HTML.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "apresentacao_a_partir_de_documento",
    {
      title: "Apresentação a partir de documento",
      description: "Turns a document (pasted text) into a presentation.",
      argsSchema: {
        documento: z.string().describe("Texto do documento"),
        duracao: z.string().optional(),
      },
    },
    ({ documento, duracao }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Transforme o documento abaixo em uma apresentação${duracao ? ` de ${duracao}` : ""}. Chame get_guide, extraia as ideias principais (uma por slide), use números reais do texto em layouts stats/chart, proponha o roteiro para minha aprovação, depois crie, confira com preview e me envie os links.

---
${documento}`,
          },
        },
      ],
    }),
  );

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------

  server.registerResource(
    "presentation-schema",
    "schema://presentation-input.json",
    {
      title: "Presentation JSON Schema",
      description: "JSON Schema of the create_presentation input.",
      mimeType: "application/schema+json",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/schema+json",
          text: JSON.stringify(z.toJSONSchema(PresentationInputSchema, { unrepresentable: "any" })),
        },
      ],
    }),
  );
  server.registerResource(
    "design-guide",
    "guide://design.md",
    {
      title: "Design guide",
      description: "Design rules for good slides.",
      mimeType: "text/markdown",
    },
    (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "text/markdown", text: `${buildGuide()}\n\n${DESIGN_RULES}` },
      ],
    }),
  );
  for (const ex of loadExamples()) {
    server.registerResource(
      `example-${ex.name}`,
      `example://${ex.name}.json`,
      {
        title: `Example: ${ex.title}`,
        description: "A complete example presentation in the create_presentation format.",
        mimeType: "application/json",
      },
      (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: ex.json }] }),
    );
  }
  return server;
}

function loadExamples(): Array<{ name: string; title: string; json: string }> {
  const candidates = [
    new URL("../../../assets/examples/", import.meta.url),
    new URL("./examples/", import.meta.url),
  ];
  for (const dir of candidates) {
    try {
      const path = fileURLToPath(dir);
      return readdirSync(path)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const json = readFileSync(path + f, "utf8");
          return {
            name: f.replace(/\.json$/, ""),
            title: (JSON.parse(json) as { meta: { title: string } }).meta.title,
            json,
          };
        });
    } catch {
      // try next location (source tree vs. bundled dist)
    }
  }
  return [];
}
