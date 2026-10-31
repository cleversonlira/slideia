import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "@playwright/test";

/*
 * Phase 2 acceptance: an MCP client (stdio, like Claude Code) creates a 10-slide presentation,
 * the user edits a text in the editor, and downloads the standalone HTML.
 */

const server = fileURLToPath(new URL("../packages/server/dist/stdio.js", import.meta.url));
let home: string;
let client: Client;

type Result = {
  content: Array<{ type: string; text?: string; data?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as Result;

test.beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "apresenta-e2e-"));
  client = new Client({ name: "e2e", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [server],
      env: { ...process.env, APRESENTA_HOME: home, APRESENTA_PORT: "47891" } as Record<
        string,
        string
      >,
      stderr: "pipe",
    }),
  );
});

test.afterAll(async () => {
  await client?.close();
  rmSync(home, { recursive: true, force: true });
});

function tenSlides() {
  const slides = [
    {
      layout: "cover",
      elements: [
        { type: "title", text: "Plano de Marketing 2027" },
        { type: "text", text: "Equipe de Marketing · Janeiro" },
      ],
      notes: "Boas-vindas.",
    },
    {
      layout: "section",
      elements: [
        { type: "title", text: "Onde estamos" },
        { type: "text", text: "Diagnóstico de 2026" },
        { type: "text", text: "01" },
      ],
    },
    {
      layout: "stats",
      elements: [
        { type: "title", text: "2026 em números" },
        { type: "stat", value: "+32%", label: "leads" },
        { type: "stat", value: "4,1%", label: "conversão" },
        { type: "stat", value: "R$ 87", label: "CAC" },
      ],
    },
    {
      layout: "chart",
      elements: [
        { type: "title", text: "Leads por canal" },
        {
          type: "chart",
          kind: "bar",
          labels: ["Busca", "Social", "E-mail", "Eventos"],
          series: [{ name: "Leads", values: [420, 310, 180, 90] }],
          showValues: true,
        },
      ],
    },
    {
      layout: "title-content",
      elements: [
        { type: "title", text: "O que aprendemos" },
        {
          type: "text",
          text: "- Conteúdo educativo converte mais\n- Vídeo curto supera texto\n- Eventos têm o maior ticket",
        },
      ],
    },
    {
      layout: "section",
      elements: [
        { type: "title", text: "Para onde vamos" },
        { type: "text", text: "Estratégia 2027" },
        { type: "text", text: "02" },
      ],
    },
    {
      layout: "two-columns",
      elements: [
        { type: "title", text: "Prioridades" },
        { type: "text", text: "**Aquisição**\n- SEO\n- Parcerias" },
        { type: "text", text: "**Retenção**\n- Comunidade\n- Onboarding" },
      ],
    },
    {
      layout: "timeline",
      elements: [
        { type: "title", text: "Calendário" },
        {
          type: "timeline",
          items: [
            { date: "T1", title: "Rebranding" },
            { date: "T2", title: "Lançamento" },
            { date: "T3", title: "Evento anual" },
            { date: "T4", title: "Black Friday" },
          ],
        },
      ],
    },
    {
      layout: "quote",
      elements: [
        {
          type: "quote",
          text: "Marketing é contar a verdade de forma memorável.",
          author: "Equipe",
        },
      ],
    },
    {
      layout: "closing",
      elements: [
        { type: "title", text: "Obrigado!" },
        { type: "text", text: "Perguntas?" },
      ],
    },
  ];
  return { meta: { title: "Plano de Marketing 2027", theme: "vibrante" }, slides };
}

test("MCP creates 10 slides, the user edits in the editor and downloads the HTML", async ({
  page,
}, testInfo) => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toContain("create_presentation");
  expect((await call("get_guide")).content[0]!.text).toContain("Workflow");

  const created = await call("create_presentation", { presentation: tenSlides() });
  expect(created.isError, created.content[0]?.text).toBeFalsy();
  const { id, editorUrl, slides } = created.structuredContent as {
    id: string;
    editorUrl: string;
    slides: unknown[];
  };
  expect(slides).toHaveLength(10);

  const preview = await call("preview", { id, slideNumber: 3 });
  expect(preview.content[0]!.type).toBe("image");
  const rendered = await call("render", { id });
  expect(String(rendered.structuredContent!.path)).toContain(home);

  // The user opens the editor link and edits the title of slide 5.
  await page.goto(editorUrl);
  await expect(page.locator(".slide-item")).toHaveCount(10);
  await page.locator(".slide-item").nth(4).click();
  await page.locator(".editor-stage .el-title .rt").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" em 2026");
  await page.keyboard.press("Escape");
  await expect(page.locator(".save-status")).toHaveText("Salvo", { timeout: 10_000 });

  // The AI sees the manual edit.
  const changes = await call("get_changes", { id, sinceVersion: 1 });
  expect(changes.content[0]!.text).toContain('to "O que aprendemos em 2026"');

  // The AI edits while the editor is open: the change shows up live.
  const outline = (await call("get_presentation", { id })).content[0]!.text!;
  const coverTitle = /## 1 · \S+ · cover\n- (e_\w+) title/.exec(outline)![1]!;
  const v = Number(/version (\d+)/.exec(outline)![1]);
  await call("apply_edits", {
    id,
    expectedVersion: v,
    operations: [
      {
        op: "update_text",
        slide: 1,
        element: coverTitle,
        text: "Plano de Marketing 2027 — versão final",
      },
    ],
  });
  await page.locator(".slide-item").nth(0).click();
  await expect(page.locator(".editor-stage .el-title")).toContainText("versão final", {
    timeout: 10_000,
  });

  // Download the standalone HTML from the editor.
  await page.locator("button", { hasText: "Baixar" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".menu button", { hasText: "HTML" }).click(),
  ]);
  const file = testInfo.outputPath("apresentacao.html");
  await download.saveAs(file);
  const html = readFileSync(file, "utf8");
  expect(html).toContain("O que aprendemos em 2026");
  expect(html).toContain("versão final");

  // And as an editable PowerPoint, with the manual edit.
  await page.locator("button", { hasText: "Baixar" }).click();
  const [pptx] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.locator(".menu button", { hasText: "PowerPoint" }).click(),
  ]);
  expect(pptx.suggestedFilename()).toMatch(/\.pptx$/);
  const pptxFile = testInfo.outputPath("apresentacao.pptx");
  await pptx.saveAs(pptxFile);
  const zip = readFileSync(pptxFile);
  expect(zip.subarray(0, 2).toString()).toBe("PK");
  expect(zip.byteLength).toBeGreaterThan(20_000);

  // It presents offline.
  await page.goto(`file://${file}`);
  await expect(page.locator(".stage > .slide")).toHaveCount(10);
});

test("editor: outline mode, layout picker, undo and theme change", async ({ page }) => {
  const created = await call("create_presentation", { presentation: tenSlides() });
  const { editorUrl } = created.structuredContent as { editorUrl: string };
  await page.goto(editorUrl);
  await expect(page.locator(".slide-item")).toHaveCount(10);

  await page.locator(".add-slide").click();
  await page.locator(".layout-card", { hasText: "Comparação" }).click();
  await expect(page.locator(".slide-item")).toHaveCount(11);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".slide-item")).toHaveCount(10);
  await page.keyboard.press("Control+y");
  await expect(page.locator(".slide-item")).toHaveCount(11);

  await page.locator(".tabs button", { hasText: "Apresentação" }).click();
  await page.locator(".theme-card", { hasText: "Noturno" }).click();
  await expect(page.locator(".editor-stage")).toHaveAttribute("style", /--c-bg:\s*#0b1020/);

  // Brand logo: uploaded in the deck panel, drawn in the corner of the current slide.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Enviar logo" }).click();
  await (
    await chooser
  ).setFiles(fileURLToPath(new URL("../assets/examples/assets/cidade.jpg", import.meta.url)));
  await expect(page.locator(".editor-stage .brand-logo.pos-bottom-right")).toHaveCount(1);
  await page
    .locator(".props-section select")
    .filter({ hasText: "Inferior direito" })
    .selectOption("top-left");
  await expect(page.locator(".editor-stage .brand-logo.pos-top-left")).toHaveCount(1);
  await page
    .locator(".props-scroll")
    .screenshot({ path: test.info().outputPath("brand-panel.png") });

  // Saved on the account, the brand is applied to the next new presentation.
  await page.getByRole("button", { name: "Salvar como minha marca" }).click();
  await expect(page.locator(".saved-brand-ok")).toBeVisible();
  const branded = await call("create_presentation", { presentation: tenSlides() });
  expect(JSON.stringify(branded.content)).toContain("saved brand was applied");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Esquecer marca salva" }).click();
  await expect(page.getByRole("button", { name: "Salvar como minha marca" })).toBeVisible();

  await page.locator(".seg button", { hasText: "Roteiro" }).click();
  const first = page.locator(".outline-slide").first().locator(".mini-editor").first();
  await first.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("!");
  await page.locator(".outline-slide").nth(1).locator(".mini-editor").first().click();
  await expect(page.locator(".save-status")).toHaveText("Salvo", { timeout: 10_000 });
  await page.locator(".seg button", { hasText: "Slides" }).click();
  await page.locator(".slide-item").nth(0).click();
  await expect(page.locator(".editor-stage .el-title")).toContainText("2027!");
});
