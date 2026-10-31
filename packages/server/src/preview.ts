import { chromium, type Browser } from "playwright-core";
import sharp from "sharp";
import { HIDE_CLASS, scanSlide, type ScanItem } from "./pptx-scan.js";

export class PreviewUnavailableError extends Error {}

export interface PreviewIssue {
  slide: number;
  elementId: string;
  message: string;
}

export interface PreviewResult {
  image: Buffer;
  mime: "image/jpeg";
  issues: PreviewIssue[];
  slides: number[];
}

const MAX_SHEET = 24;

/**
 * Renders slides with a headless browser (installed Google Chrome, or Playwright's Chromium) to
 * show the AI exactly what the user will see, and to measure problems such as text that does not
 * fit even after autofit.
 */
export class Previewer {
  private browser: Promise<Browser> | null = null;
  /** PowerPoint exports lay out every slide at full size: a few at a time. */
  private scans = 0;
  private readonly waiting: Array<() => void> = [];
  static readonly MAX_SCANS = 2;

  private async launch(): Promise<Browser> {
    this.browser ??= (async () => {
      const errors: string[] = [];
      for (const opts of [{ channel: "chrome" }, { channel: "msedge" }, {}] as const) {
        try {
          return await chromium.launch({ ...opts, headless: true });
        } catch (err) {
          errors.push((err as Error).message.split("\n")[0] ?? "");
        }
      }
      this.browser = null;
      throw new PreviewUnavailableError(
        `Preview needs Google Chrome or Playwright's Chromium (npx playwright install chromium). ${errors.at(-1) ?? ""}`,
      );
    })();
    return this.browser;
  }

  async render(
    html: string,
    opts: { slideNumber?: number; aspect: "16:9" | "4:3" },
  ): Promise<PreviewResult> {
    const browser = await this.launch();
    const width = opts.aspect === "4:3" ? 720 : 960;
    const page = await browser.newPage({
      viewport: { width, height: 540 },
      reducedMotion: "reduce",
    });
    try {
      await page.setContent(html, { waitUntil: "load" });
      await page.waitForFunction(() => "apresenta" in window, null, { timeout: 15_000 });
      await page.evaluate(async () => {
        await document.fonts.ready;
        const p = (window as unknown as { apresenta: { fit(): void } }).apresenta;
        p.fit();
      });

      const issues = await page.evaluate(() => {
        const slides = [...document.querySelectorAll<HTMLElement>(".stage > .slide")];
        return [...document.querySelectorAll<HTMLElement>(".is-overflowing")].map((el) => ({
          slide: slides.indexOf(el.closest<HTMLElement>(".slide")!) + 1,
          elementId: el.dataset.elId ?? "",
          message: "text does not fit even at the minimum font size: shorten it or split the slide",
        }));
      });
      const total = await page.evaluate(() => document.querySelectorAll(".stage > .slide").length);
      const wanted = opts.slideNumber
        ? [Math.min(Math.max(opts.slideNumber, 1), total)]
        : Array.from({ length: Math.min(total, MAX_SHEET) }, (_, i) => i + 1);

      const shots: Buffer[] = [];
      for (const n of wanted) {
        await page.evaluate((i) => {
          const p = (
            window as unknown as {
              apresenta: {
                slides: HTMLElement[];
                root: HTMLElement;
                activate(i: number, s: number): void;
              };
            }
          ).apresenta;
          p.activate(i, 0);
          p.slides[i]?.querySelectorAll("[data-step]").forEach((s) => s.classList.add("revealed"));
          p.root.classList.add("idle");
          for (const el of document.querySelectorAll<HTMLElement>(".chrome, .toast, .hud-goto"))
            el.style.display = "none";
          for (const a of document.getAnimations()) a.finish();
        }, n - 1);
        shots.push(await page.screenshot({ type: "png" }));
      }

      const image =
        shots.length === 1
          ? await sharp(shots[0]).jpeg({ quality: 82 }).toBuffer()
          : await contactSheet(shots, wanted, width / 2, 270);
      return { image, mime: "image/jpeg", issues, slides: wanted };
    } finally {
      await page.close();
    }
  }

  /**
   * Measures every slide for the PowerPoint export: native objects (see pptx-scan.ts) plus a
   * picture of what is left (backgrounds and decorations) at the canvas size.
   */
  async scanDeck(
    html: string,
    aspect: "16:9" | "4:3",
  ): Promise<Array<{ items: ScanItem[]; background: Buffer }>> {
    if (this.scans >= Previewer.MAX_SCANS)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.scans++;
    try {
      return await this.scan(html, aspect);
    } finally {
      this.scans--;
      this.waiting.shift()?.();
    }
  }

  private async scan(
    html: string,
    aspect: "16:9" | "4:3",
  ): Promise<Array<{ items: ScanItem[]; background: Buffer }>> {
    const browser = await this.launch();
    const width = aspect === "4:3" ? 1440 : 1920;
    const page = await browser.newPage({
      viewport: { width, height: 1080 },
      reducedMotion: "reduce",
    });
    try {
      await page.setContent(html, { waitUntil: "load" });
      // Bundlers that keep function names wrap them in __name(); the page has no such helper.
      await page.evaluate("globalThis.__name = (f) => f");
      await page.waitForFunction(() => "apresenta" in window, null, { timeout: 15_000 });
      await page.addStyleTag({
        content: `.${HIDE_CLASS}{visibility:hidden!important}.deck .el.is-overflowing{outline:none!important}.chrome,.toast,.hud-goto{display:none!important}`,
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
        (window as unknown as { apresenta: { fit(): void } }).apresenta.fit();
      });
      const total = await page.evaluate(() => document.querySelectorAll(".stage > .slide").length);
      const out: Array<{ items: ScanItem[]; background: Buffer }> = [];
      for (let i = 0; i < total; i++) {
        const box = await page.evaluate((n) => {
          const p = (
            window as unknown as {
              apresenta: { slides: HTMLElement[]; activate(i: number, s: number): void };
            }
          ).apresenta;
          p.activate(n, 0);
          const el = p.slides[n]!;
          el.querySelectorAll("[data-step]").forEach((s) => s.classList.add("revealed"));
          for (const a of document.getAnimations()) a.finish();
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height };
        }, i);
        const items = await page.evaluate(scanSlide, i);
        const background = await page.screenshot({ type: "jpeg", quality: 90, clip: box });
        out.push({ items, background });
      }
      return out;
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    const b = await this.browser?.catch(() => null);
    await b?.close();
    this.browser = null;
  }
}

async function contactSheet(
  shots: Buffer[],
  numbers: number[],
  tileW: number,
  tileH: number,
): Promise<Buffer> {
  const cols = 4;
  const gap = 8;
  const rows = Math.ceil(shots.length / cols);
  const width = cols * tileW + (cols + 1) * gap;
  const height = rows * tileH + (rows + 1) * gap;
  const tiles = await Promise.all(
    shots.map(async (s, i) => {
      const label = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="30"><rect width="44" height="30" rx="6" fill="#e11d48"/><text x="22" y="21" font-family="sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${numbers[i]}</text></svg>`,
      );
      const tile = await sharp(s)
        .resize(tileW, tileH)
        .composite([{ input: label, left: 6, top: 6 }])
        .toBuffer();
      return {
        input: tile,
        left: gap + (i % cols) * (tileW + gap),
        top: gap + Math.floor(i / cols) * (tileH + gap),
      };
    }),
  );
  return sharp({ create: { width, height, channels: 3, background: "#6b7280" } })
    .composite(tiles)
    .jpeg({ quality: 80 })
    .toBuffer();
}
