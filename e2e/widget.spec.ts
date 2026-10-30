import { readFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { normalizePresentation } from "../packages/core/src/index.js";
import {
  allFontFiles,
  buildWidgetHtml,
  widgetAssets,
} from "../packages/renderer/src/node/index.js";

/* The chat widget (MCP Apps view) inside a fake host: sandboxed iframe + JSON-RPC over postMessage. */

let fonts: http.Server;
let base = "";

test.beforeAll(async () => {
  const files = new Map(allFontFiles().map((f) => [f.name, f.path]));
  fonts = http.createServer((req, res) => {
    const path = files.get((req.url ?? "").replace(/^\/fonts\//, ""));
    if (!path) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "font/woff2", "access-control-allow-origin": "*" });
    res.end(readFileSync(path));
  });
  await new Promise<void>((r) => fonts.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(fonts.address() as { port: number }).port}`;
});

test.afterAll(() => fonts?.close());

function payload() {
  const deck = JSON.parse(
    readFileSync(join(import.meta.dirname, "../assets/examples/relatorio-q3.json"), "utf8"),
  ) as unknown;
  const presentation = normalizePresentation(deck);
  return {
    presentation,
    ...widgetAssets(presentation, base),
    links: {
      editor: "https://slideia.test/p/abc",
      present: "https://slideia.test/v/abc",
      download: "https://slideia.test/d/abc",
    },
  };
}

async function mountHost(page: Page, width: number, theme: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(`<!doctype html><body style="margin:0;background:${theme === "dark" ? "#111" : "#fff"}">
<iframe id="w" sandbox="allow-scripts" style="border:0;width:100%;height:300px"></iframe></body>`);
  const view = payload();
  await page.evaluate(
    ({ html, view, theme }) => {
      const log: Array<{ method: string; params: unknown }> = [];
      (window as unknown as { hostLog: typeof log }).hostLog = log;
      const frame = document.getElementById("w") as HTMLIFrameElement;
      const send = (m: object) => frame.contentWindow!.postMessage({ jsonrpc: "2.0", ...m }, "*");
      window.addEventListener("message", (e) => {
        const m = e.data as { id?: number; method?: string; params?: { height?: number } };
        if (!m?.method) return;
        log.push({ method: m.method, params: m.params });
        if (m.method === "ui/initialize")
          send({
            id: m.id,
            result: {
              protocolVersion: "2026-01-26",
              hostInfo: { name: "fake-host", version: "1" },
              hostCapabilities: {},
              hostContext: {
                theme,
                displayMode: "inline",
                availableDisplayModes: ["inline", "fullscreen"],
              },
            },
          });
        else if (m.method === "ui/notifications/initialized") {
          send({ method: "ui/notifications/tool-input", params: { arguments: {} } });
          send({
            method: "ui/notifications/tool-result",
            params: { content: [{ type: "text", text: "ok" }], _meta: { "slideia/view": view } },
          });
        } else if (m.method === "ui/notifications/size-changed" && m.params?.height)
          frame.style.height = `${m.params.height}px`;
        else if (m.id !== undefined) send({ id: m.id, result: {} });
      });
      frame.srcdoc = html;
    },
    { html: await buildWidgetHtml(), view, theme },
  );
  return {
    frame: page.frameLocator("#w"),
    slides: view.presentation.slides.filter((s) => !s.hidden).length,
  };
}

const hostLog = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { hostLog: Array<{ method: string; params: unknown }> }).hostLog,
  );

test("widget shows the deck, navigates and opens links through the host", async ({
  page,
}, info) => {
  const { frame, slides } = await mountHost(page, 420, "light");
  await expect(frame.locator(".stage > .slide")).toHaveCount(slides);
  await expect(frame.locator(".count")).toHaveText(`1 / ${slides}`);
  await expect(frame.locator(".title strong")).toHaveText("Relatório Trimestral — 3º tri 2026");
  await page.screenshot({ path: info.outputPath("widget-mobile-light.png") });

  await frame.getByRole("button", { name: "Próximo slide" }).click();
  await expect(frame.locator(".count")).toHaveText(`2 / ${slides}`);
  await expect(frame.locator(".stage > .slide.is-active")).toHaveCount(1);
  await frame.locator(".viewport").press("ArrowRight");
  await expect(frame.locator(".count")).toHaveText(`3 / ${slides}`);
  await frame.getByRole("tab", { name: "Slide 1" }).click();
  await expect(frame.locator(".count")).toHaveText(`1 / ${slides}`);
  await expect(frame.getByRole("button", { name: "Slide anterior" })).toBeDisabled();

  await frame.getByRole("button", { name: "Abrir no editor" }).click();
  await frame.getByRole("button", { name: "Baixar HTML" }).click();
  await expect
    .poll(async () =>
      (await hostLog(page)).filter((m) => m.method === "ui/open-link").map((m) => m.params),
    )
    .toEqual([{ url: "https://slideia.test/p/abc" }, { url: "https://slideia.test/d/abc" }]);

  const log = await hostLog(page);
  expect(log[0]!.method).toBe("ui/initialize");
  expect(log.some((m) => m.method === "ui/notifications/initialized")).toBe(true);
  const sizes = log.filter((m) => m.method === "ui/notifications/size-changed");
  expect((sizes.at(-1)!.params as { height: number }).height).toBeGreaterThan(250);
  // Fonts load from the declared server (the host CSP would allow only that domain).
  await expect
    .poll(() => frame.locator("body").evaluate(() => document.fonts.check('16px "Inter"')))
    .toBe(true);
});

test("widget follows the host theme and offers fullscreen", async ({ page }, info) => {
  const { frame } = await mountHost(page, 720, "dark");
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(frame.getByRole("button", { name: "Tela cheia" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: info.outputPath("widget-desktop-dark.png") });
  await frame.getByRole("button", { name: "Tela cheia" }).click();
  await expect
    .poll(
      async () => (await hostLog(page)).find((m) => m.method === "ui/request-display-mode")?.params,
    )
    .toEqual({ mode: "fullscreen" });
});
