import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const examples = fileURLToPath(new URL("../out/examples/", import.meta.url));
const AURORA = `file://${examples}lancamento-aurora.html`;

type State = { index: number; step: number; blank: string | null; total: number };

async function state(page: Page): Promise<State> {
  return page.evaluate(() => {
    const p = (
      window as unknown as {
        apresenta: { index: number; step: number; blank: string | null; slides: unknown[] };
      }
    ).apresenta;
    return { index: p.index, step: p.step, blank: p.blank, total: p.slides.length };
  });
}

async function open(page: Page, url = AURORA): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => "apresenta" in window);
  expect(errors).toEqual([]);
}

/** Waits until no slide transition is running. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => !document.querySelector(".slide.is-entering, .slide.is-leaving"),
  );
}

test("advances and goes back with presenter-remote keys, including steps", async ({ page }) => {
  await open(page);
  expect(await state(page)).toMatchObject({ index: 0, step: 0, total: 13 });

  await page.keyboard.press("PageDown");
  await settle(page);
  expect(await state(page)).toMatchObject({ index: 1, step: 0 });
  await expect(page.locator(".slide.is-active li.revealed")).toHaveCount(0);

  // Slide 2 reveals its four bullets one per click.
  for (let i = 1; i <= 4; i++) {
    await page.keyboard.press(i % 2 ? "ArrowRight" : " ");
    expect(await state(page)).toMatchObject({ index: 1, step: i });
  }
  await expect(page.locator(".slide.is-active li.revealed")).toHaveCount(4);
  await page.keyboard.press("PageDown");
  await settle(page);
  expect(await state(page)).toMatchObject({ index: 2, step: 0 });

  await page.keyboard.press("PageUp");
  await settle(page);
  // Going back lands on the previous slide fully revealed.
  expect(await state(page)).toMatchObject({ index: 1, step: 4 });
  await page.keyboard.press("Backspace");
  expect(await state(page)).toMatchObject({ index: 1, step: 3 });
});

test("ignores key repeat and keeps at most one queued command during a transition", async ({
  page,
}) => {
  await open(page, `${AURORA}#3`);
  expect((await state(page)).index).toBe(2);
  await page.keyboard.down("PageDown");
  await page.keyboard.down("PageDown"); // auto-repeat → ignored
  await page.keyboard.up("PageDown");
  await settle(page);
  expect((await state(page)).index).toBe(3);

  // Three quick presses while the first transition runs: one runs, one is queued, one replaces it.
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await settle(page);
  await page.waitForTimeout(800);
  await settle(page);
  expect((await state(page)).index).toBe(5);
});

test("black/white screens, go to slide by number, F5 restarts", async ({ page }) => {
  await open(page);
  await page.keyboard.press("b");
  expect((await state(page)).blank).toBe("black");
  await expect(page.locator(".deck")).toHaveAttribute("data-blank", "black");
  await page.keyboard.press("PageDown"); // any "next" just unblanks
  expect(await state(page)).toMatchObject({ blank: null, index: 0 });
  await page.keyboard.press("w");
  expect((await state(page)).blank).toBe("white");
  await page.keyboard.press("Escape");
  expect((await state(page)).blank).toBe(null);

  await page.keyboard.press("1");
  await page.keyboard.press("0");
  await expect(page.locator(".hud-goto")).toHaveText("Ir para o slide 10");
  await page.keyboard.press("Enter");
  await settle(page);
  expect((await state(page)).index).toBe(9);

  await page.keyboard.press("F5");
  expect((await state(page)).index).toBe(0);
  expect(page.url()).toMatch(/#1$/);
});

test("key test overlay logs keys without acting and remaps a key", async ({ page }) => {
  await open(page);
  await page.keyboard.press("t");
  const overlay = page.locator(".overlay");
  await expect(overlay).toContainText("Teste do passador");
  await page.keyboard.press("PageDown");
  await expect(overlay.locator("table.log")).toContainText("PageDown");
  expect((await state(page)).index).toBe(0);

  // Bind "x" (stand-in for an unusual remote button) to "next".
  await overlay.locator('button[data-remap="next"]').click();
  await page.keyboard.press("x");
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
  await page.keyboard.press("x");
  await settle(page);
  expect((await state(page)).index).toBe(1);
});

test("presenter view follows the main window and controls it", async ({ page }) => {
  await open(page);
  const [presenter] = await Promise.all([page.waitForEvent("popup"), page.keyboard.press("s")]);
  await presenter.waitForLoadState();
  await expect(presenter.locator(".pv-count")).toHaveText("Slide 1 de 13");
  await expect(presenter.locator(".pv-notes-body")).toContainText("Boas-vindas");

  await page.keyboard.press("PageDown");
  await expect(presenter.locator(".pv-count")).toContainText("Slide 2 de 13");

  await presenter.keyboard.press("PageDown");
  await expect.poll(async () => (await state(page)).step).toBe(1);
  await expect(presenter.locator(".pv-count")).toContainText("passo 1/4");
  await expect(presenter.locator(".pv-next-label")).toHaveText("Próximo passo");
});

test("quick edit saves a new standalone HTML with the change", async ({
  page,
  browser,
}, testInfo) => {
  await open(page);
  await page.evaluate(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.keyboard.press("e");
  const title = page.locator(".slide.is-active .el-title .rt");
  await expect(title).toHaveAttribute("contenteditable", "true");
  await title.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" 2.0");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Control+s"),
  ]);
  const path = testInfo.outputPath("editado.html");
  await download.saveAs(path);
  const html = await readFile(path, "utf8");
  expect(html).toContain("de atendimento 2.0");
  expect(html).toContain('<div id="app" class="deck"></div>'); // runtime DOM is not saved

  const reopened = await browser.newPage();
  await reopened.goto(`file://${path}`);
  await expect(reopened.locator(".slide.is-active .el-title")).toContainText("de atendimento 2.0");
  await reopened.close();
});

test("print layout shows every slide on its own page", async ({ page }) => {
  await open(page);
  await page.emulateMedia({ media: "print" });
  const visible = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>(".stage > .slide")].filter(
        (s) => getComputedStyle(s).visibility === "visible",
      ).length,
  );
  expect(visible).toBe(13);
  const pdf = await page.pdf({ preferCSSPageSize: true });
  expect(pdf.byteLength).toBeGreaterThan(50_000);
});

test("4:3 deck scales with letterbox and every theme renders without overflow", async ({
  page,
}) => {
  await open(page, `file://${examples}workshop-sustentavel.html`);
  const box = await page.locator(".stage").boundingBox();
  expect(Math.round(box!.height)).toBe(720);
  expect(Math.round(box!.width)).toBe(960);
  await expect(page.locator(".is-overflowing")).toHaveCount(0);
});
