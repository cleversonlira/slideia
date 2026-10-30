import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentation, type Presentation } from "@slideia/core";
import {
  computeSteps,
  createContext,
  niceTicks,
  renderSlide,
  richTextToHtml,
} from "../src/index.js";
import {
  buildStandaloneHtml,
  directoryAssetLoader,
  extractPresentationJson,
  lucideIconMap,
} from "../src/node/index.js";

const examples = join(import.meta.dirname, "../../../assets/examples");
const aurora = () =>
  normalizePresentation(
    JSON.parse(readFileSync(join(examples, "lancamento-aurora.json"), "utf8")),
    { id: "p_test" },
  );

const XSS = [
  `<script>alert(1)</script>`,
  `<img src=x onerror=alert(1)>`,
  `"><svg onload=alert(1)>`,
  `javascript:alert(1)`,
  `</div><iframe src="javascript:alert(1)">`,
  `[x](javascript:alert(1))`,
  `[x]{color=red onclick=alert(1)}`,
  `<a href="javascript:alert(1)">x</a>`,
  `' onmouseover='alert(1)`,
];

function deckWith(text: string): Presentation {
  return normalizePresentation({
    meta: { title: text, author: text },
    slides: [
      {
        layout: "title-content",
        elements: [
          { type: "title", text },
          {
            type: "text",
            text: `- ${text}\n- **${text}** [link](https://ex.com/?q=${encodeURIComponent(text)})`,
          },
        ],
        notes: text,
      },
      { layout: "quote", elements: [{ type: "quote", text, author: text, role: text }] },
      {
        layout: "stats",
        elements: [
          { type: "stat", value: text.slice(0, 24), label: text },
          { type: "stat", value: "1", label: text },
        ],
      },
      {
        layout: "chart",
        elements: [
          { type: "title", text },
          {
            type: "chart",
            kind: "bar",
            title: text.slice(0, 200),
            labels: [text.slice(0, 80)],
            series: [{ name: text.slice(0, 80), values: [1] }],
          },
        ],
      },
      {
        layout: "timeline",
        elements: [
          {
            type: "timeline",
            items: [{ date: text.slice(0, 40), title: text.slice(0, 120), text }],
          },
        ],
      },
      {
        layout: "table",
        elements: [
          { type: "title", text },
          { type: "table", header: [text], rows: [[text]] },
        ],
      },
      {
        layout: "full-image",
        elements: [{ type: "image", asset: "https://ex.com/a.png", alt: text }],
      },
    ],
  });
}

describe("rich text HTML", () => {
  it("renders nested lists and marks with the shared markup", () => {
    const html = richTextToHtml(
      {
        paragraphs: [
          { runs: [{ text: "a" }], list: { kind: "bullet", level: 1 } },
          {
            runs: [{ text: "b", marks: { bold: true, color: "accent" } }],
            list: { kind: "bullet", level: 2 },
          },
          { runs: [{ text: "c" }], list: { kind: "ordered", level: 1 } },
          { runs: [{ text: "d\ne" }], align: "center" },
        ],
      },
      { field: "text" },
    );
    expect(html).toBe(
      '<div class="rt" data-field="text"><ul><li><p>a</p><ul><li><p><span data-color="accent" style="color:var(--c-accent)"><strong>b</strong></span></p></li></ul></li></ul>' +
        '<ol><li><p>c</p></li></ol><p class="a-center">d<br>e</p></div>',
    );
  });
});

describe("XSS", () => {
  it("never emits executable markup from content", () => {
    for (const payload of XSS) {
      const p = deckWith(payload);
      const ctx = createContext(p);
      const html = p.slides.map((s) => renderSlide(s, ctx)).join("");
      expect(html, payload).not.toMatch(/(?:href|src)="\s*javascript:/i);
      // Attribute values cannot break out of their quotes (esc() encodes "), so ignore them.
      const tags = html.replace(/"[^"]*"/g, '""');
      expect(tags, payload).not.toMatch(/<script|<iframe|<[^>]*\son\w+=/i);
    }
  });

  it("blocks unsafe image URLs", () => {
    const p = deckWith("x");
    const slide = {
      ...p.slides[6]!,
      elements: [{ ...p.slides[6]!.elements[0]!, asset: "javascript:alert(1)" }],
    } as Presentation["slides"][number];
    expect(renderSlide(slide, createContext(p))).toContain('src=""');
  });
});

describe("steps", () => {
  it("counts paragraph reveals and shared orders", () => {
    const p = aurora();
    expect(computeSteps(p.slides[1]!).count).toBe(4);
    const custom = normalizePresentation({
      meta: { title: "x" },
      slides: [
        {
          layout: "two-columns",
          elements: [
            { type: "title", text: "t", animation: { type: "fade", order: 1 } },
            { type: "text", text: "a", animation: { type: "rise", order: 2 } },
            {
              type: "text",
              text: "- 1\n- 2\n- 3",
              animation: { type: "rise", order: 2, by: "paragraph" },
            },
          ],
        },
      ],
    });
    const { steps, count } = computeSteps(custom.slides[0]!);
    expect(count).toBe(4);
    expect([...steps.values()].map((s) => s.start)).toEqual([1, 2, 2]);
  });
});

describe("charts", () => {
  it("computes nice ticks", () => {
    expect(niceTicks(0, 71)).toEqual([0, 20, 40, 60, 80]);
    expect(niceTicks(-12, 30)).toEqual([-20, -10, 0, 10, 20, 30]);
  });
});

describe("standalone export", () => {
  it("embeds everything, with a matching CSP hash", async () => {
    const p = aurora();
    const { html, warnings } = await buildStandaloneHtml(p, {
      loadAsset: directoryAssetLoader(join(examples, "assets")),
      playerJs: "console.log('</script> ok')",
    });
    expect(warnings).toEqual([]);
    const script = /<script>([\s\S]*?)<\/script>\n<\/body>/.exec(html)![1]!;
    expect(script).toBe("console.log('<\\/script> ok')");
    const hash = createHash("sha256").update(script).digest("base64");
    expect(html).toContain(`script-src 'sha256-${hash}'`);
    expect(html).toContain('@font-face{font-family:"Montserrat"');
    expect(html).not.toMatch(/src="https?:/);
    const embedded = extractPresentationJson(html) as Presentation;
    expect(embedded.slides[0]!.elements.find((e) => e.type === "image")).toMatchObject({
      asset: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    const icons = JSON.parse(
      /<script type="application\/json" id="icons">([\s\S]*?)<\/script>/.exec(html)![1]!,
    ) as Record<string, string>;
    expect(Object.keys(icons).sort()).toEqual([
      "smile",
      "sparkles",
      "timer",
      "trending-down",
      "trending-up",
      "zap",
    ]);
  });

  it("escapes </script> inside the embedded JSON", async () => {
    const p = deckWith("</script><script>alert(1)</script>");
    const { html } = await buildStandaloneHtml(p, { playerJs: "1" });
    expect(html.match(/<script/g)?.length).toBe(4);
    expect((extractPresentationJson(html) as Presentation).meta.title).toBe(
      "</script><script>alert(1)</script>",
    );
  });

  it("stores an image used on several slides once and inlines it again on extract", async () => {
    const p = aurora();
    const ref = "asset:cidade";
    const image = { type: "image" as const, asset: ref, alt: "Cidade" };
    const deck = {
      ...p,
      slides: p.slides.map((s, i) =>
        i < 3 ? { ...s, background: { type: "image", asset: ref } } : s,
      ),
    } as Presentation;
    deck.slides[0]!.elements.push(image as never);
    const { html } = await buildStandaloneHtml(deck, {
      loadAsset: directoryAssetLoader(join(examples, "assets")),
      playerJs: "1",
    });
    const images = JSON.parse(
      /<script type="application\/json" id="images">([\s\S]*?)<\/script>/.exec(html)![1]!,
    ) as Record<string, string>;
    const data = images[ref]!;
    expect(data).toMatch(/^data:image\//);
    expect(html.split(data).length - 1).toBe(1);
    const back = extractPresentationJson(html) as Presentation;
    expect(back.slides[0]!.background).toEqual({ type: "image", asset: data });
    expect(back.slides[2]!.background).toEqual({ type: "image", asset: data });
    expect(back.slides[0]!.elements.at(-1)).toMatchObject({ asset: data });
    expect(JSON.stringify(back)).not.toContain(ref);
  });

  it("draws the brand logo, with the dark variant on dark slides, and embeds it", async () => {
    const p = normalizePresentation({
      meta: {
        title: "Marca",
        themeOverrides: {
          cover: "#00263e",
          logo: { asset: "asset:cidade", assetOnDark: "asset:cidade2", alt: "ACME", size: "s" },
        },
      },
      slides: [
        { layout: "cover", elements: [{ type: "title", text: "Capa" }] },
        { layout: "title-content", elements: [{ type: "title", text: "Conteúdo" }] },
        {
          layout: "closing",
          elements: [
            { type: "title", text: "Fim" },
            { type: "image", slot: "logo", asset: "asset:cidade", alt: "ACME" },
          ],
        },
      ],
    });
    const ctx = createContext(p, { resolveAsset: (r) => `https://cdn.test/${r.slice(6)}.png` });
    const [cover, content, closing] = p.slides.map((sl) => renderSlide(sl, ctx));
    expect(cover).toContain(
      '<img class="brand-logo pos-bottom-right size-s" src="https://cdn.test/cidade2.png" alt="ACME"',
    );
    expect(content).toContain('src="https://cdn.test/cidade.png" alt="ACME"');
    expect(closing).not.toContain("brand-logo");

    const assets = join(examples, "assets");
    const { html } = await buildStandaloneHtml(p, {
      loadAsset: async (id) => directoryAssetLoader(assets)(id === "cidade2" ? "cidade" : id),
      playerJs: "1",
    });
    const images = JSON.parse(
      /<script type="application\/json" id="images">([\s\S]*?)<\/script>/.exec(html)![1]!,
    ) as Record<string, string>;
    expect(Object.keys(images).sort()).toEqual(["asset:cidade", "asset:cidade2"]);
    const back = extractPresentationJson(html) as Presentation;
    expect(back.meta.themeOverrides?.logo?.asset).toMatch(/^data:image\//);
  });

  it("reports unknown icons", () => {
    expect(lucideIconMap(["rocket", "nao-existe"]).missing).toEqual(["nao-existe"]);
  });
});
