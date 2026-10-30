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
  type Presentation,
} from "@slideia/core";
import { buildWidgetHtml, widgetAssets } from "@slideia/renderer/node";
import { DESIGN_RULES, buildGuide } from "./guide.js";
import { PreviewUnavailableError, type Previewer } from "./preview.js";
import { ConflictError, LimitError, NotFoundError, type PresentationService } from "./service.js";
import { ImageError } from "./images.js";

const VERSION = "0.1.0";

/** MCP Apps view shown in the chat (bump the version when the HTML changes: hosts cache it). */
export const VIEW_URI = "ui://slideia/viewer-v1.html";
export const VIEW_MIME = "text/html;profile=mcp-app";
/** Tool result `_meta` key with the data the widget draws (widget-only, not for the model). */
export const VIEW_KEY = "slideia/view";

/** Tool `_meta` linking it to the view (MCP Apps key + the ChatGPT alias and status texts). */
function viewToolMeta(invoking: string, invoked: string): Record<string, unknown> {
  return {
    ui: { resourceUri: VIEW_URI },
    // Deprecated flat key, still set by the official ext-apps helper (registerAppTool) because
    // some hosts only read it.
    "ui/resourceUri": VIEW_URI,
    "openai/outputTemplate": VIEW_URI,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

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
  meta: z
    .looseObject({
      title: z.string().optional().describe("Default: text of the first title element."),
      theme: z.enum(THEME_IDS).optional(),
      lang: z.string().optional().describe('BCP 47, default "pt-BR".'),
      aspectRatio: z.enum(["16:9", "4:3"]).optional(),
      defaultTransition: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
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
  /**
   * Called after every tool call (metrics, logs). Never receives content: on failure, `error` is
   * the start of the message with quoted values masked (field paths and how to fix remain).
   */
  onToolCall?: (name: string, ms: number, ok: boolean, error?: string) => void;
}

/** First line(s) of a tool error for logs, with anything quoted replaced by "…". */
export function errorSummary(result: CallToolResult): string {
  const first = result.content.find((c) => c.type === "text");
  const text = first && "text" in first ? first.text : "";
  return text
    .replace(/"[^"\n]*"|'[^'\n]*'|“[^”\n]*”/g, '"…"')
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

const WRITE_TOOLS = new Set(["create_presentation", "apply_edits", "add_image", "render"]);

export function createMcpServer(
  service: PresentationService,
  previewer: Previewer,
  opts: McpOptions = {},
): McpServer {
  const server = new McpServer(
    { name: "slideia", title: "SlideIA", version: VERSION },
    {
      instructions:
        "SlideIA creates, edits and presents HTML slide decks. Whenever the user asks for a presentation, slides, a deck or a talk, " +
        "build it with these tools instead of writing the slides as text in the chat: call get_guide, then create_presentation with the whole deck, " +
        "check it with preview, and give the user the editor and download links from the result. " +
        "If the request is very vague you may confirm topic and length in one short question, but do not answer with a text-only outline. " +
        "Edits are partial (apply_edits); the user can also edit by hand in the web editor, so read the latest version before editing.",
    },
  );

  /** Base URL of this server (fonts, images and links the widget loads). */
  const origin = new URL(service.links.editor("x")).origin;

  /** Data for the chat widget: images as signed URLs (or inlined locally), fonts and icons. */
  const viewPayload = async (p: Presentation): Promise<Record<string, unknown>> => {
    const cache = new Map<string, string>();
    const src = async (ref: string): Promise<string> => {
      if (!ref.startsWith("asset:")) return ref;
      const id = ref.slice(6);
      const hit = cache.get(id);
      if (hit) return hit;
      let out = "";
      if (service.links.asset) out = service.links.asset(id);
      else {
        const a = await service.repo.getAsset(id);
        if (a) out = `data:${a.mime};base64,${Buffer.from(a.data).toString("base64")}`;
      }
      cache.set(id, out);
      return out;
    };
    const slides = [];
    for (const sl of p.slides) {
      const elements = [];
      for (const e of sl.elements)
        elements.push(e.type === "image" ? { ...e, asset: await src(e.asset) } : e);
      const background =
        sl.background?.type === "image"
          ? { ...sl.background, asset: await src(sl.background.asset) }
          : sl.background;
      slides.push(background ? { ...sl, elements, background } : { ...sl, elements });
    }
    const presentation = { ...p, slides };
    return {
      [VIEW_KEY]: {
        presentation,
        ...widgetAssets(presentation, origin),
        links: {
          editor: service.links.editor(p.id),
          present: service.links.present(p.id),
          download: service.links.download(p.id),
        },
      },
    };
  };

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
      opts.onToolCall?.(
        name,
        performance.now() - started,
        !result.isError,
        result.isError ? errorSummary(result) : undefined,
      );
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
      _meta: viewToolMeta("Criando a apresentação…", "Apresentação criada"),
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
          _meta: await viewPayload(p),
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
      _meta: viewToolMeta("Editando a apresentação…", "Apresentação atualizada"),
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
          _meta: await viewPayload(r.presentation),
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
        // Remote mode only returns signed links; locally it writes the .html file.
        readOnlyHint: !service.writeFiles,
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
      _meta: viewToolMeta("Abrindo a apresentação…", "Apresentação aberta"),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id, slideNumber }) =>
      safely(async () => {
        const p = await service.get(id);
        const editorUrl = service.links.editor(id, slideNumber);
        const presentUrl = service.links.present(id);
        return {
          content: [{ type: "text", text: `Editor: ${editorUrl}\nPresent: ${presentUrl}` }],
          structuredContent: { editorUrl, presentUrl },
          _meta: await viewPayload(p),
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
    "viewer",
    VIEW_URI,
    {
      title: "SlideIA viewer",
      description: "Interactive slide carousel shown in the chat after creating or editing a deck.",
      mimeType: VIEW_MIME,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: VIEW_MIME,
          text: await buildWidgetHtml(),
          _meta: {
            ui: {
              // Fonts and images come from this server; the widget makes no other requests.
              csp: { resourceDomains: [origin], connectDomains: [] },
              prefersBorder: true,
            },
            "openai/widgetDescription":
              "Carrossel com os slides da apresentação e botões para abrir no editor, apresentar e baixar.",
            "openai/widgetPrefersBorder": true,
            "openai/widgetCSP": { resource_domains: [origin], connect_domains: [] },
          },
        },
      ],
    }),
  );

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
  portableToolSchemas(server);
  return server;
}

/**
 * Gemini's function calling accepts only an OpenAPI-like subset of JSON Schema and ignored our
 * tools (it listed them but never called them). Strips the parts of the Zod output that do not
 * change what is valid: `$schema`, `propertyNames: {type: string}` (JSON keys are strings),
 * `additionalProperties: {}`/`true` (same as absent) and the ±MAX_SAFE_INTEGER integer bounds.
 */
export function portableSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(portableSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "$schema" || k === "propertyNames") continue;
    if (k === "additionalProperties" && (v === true || isEmptyObject(v))) continue;
    if ((k === "maximum" || k === "minimum") && Math.abs(Number(v)) === Number.MAX_SAFE_INTEGER)
      continue;
    out[k] = portableSchema(v);
  }
  return out;
}

const isEmptyObject = (v: unknown) =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0;

/** Rewrites the SDK's tools/list answer with portableSchema (validation still uses Zod). */
function portableToolSchemas(server: McpServer): void {
  type Handler = (
    req: unknown,
    extra: unknown,
  ) => Promise<{ tools: Array<Record<string, unknown>> }>;
  const handlers = (server.server as unknown as { _requestHandlers: Map<string, Handler> })
    ._requestHandlers;
  const list = handlers.get("tools/list");
  if (!list) return;
  handlers.set("tools/list", async (req, extra) => {
    const result = await list(req, extra);
    return {
      ...result,
      tools: result.tools.map((t) => ({
        ...t,
        inputSchema: portableSchema(t.inputSchema),
        ...(t.outputSchema ? { outputSchema: portableSchema(t.outputSchema) } : {}),
      })),
    };
  });
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
