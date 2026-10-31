import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PresentationInput } from "@slideia/core";
import { loadConfig, startRuntime, type Runtime } from "../src/index.js";
import { PreviewUnavailableError } from "../src/preview.js";
import { renderPptx } from "../src/pptx.js";

let home: string;
let rt: Runtime;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "apresenta-pptx-"));
  rt = await startRuntime({ ...loadConfig({ APRESENTA_HOME: home }), port: 0 });
});

afterAll(async () => {
  await rt.close();
  rmSync(home, { recursive: true, force: true });
});

const dataUri = async (fmt: "png" | "jpeg", w: number, h: number) => {
  const img = sharp({
    create: {
      width: w,
      height: h,
      channels: fmt === "png" ? 4 : 3,
      background: fmt === "png" ? { r: 20, g: 90, b: 200, alpha: 0.6 } : "#3366aa",
    },
  });
  const buf = await (fmt === "png" ? img.png() : img.jpeg()).toBuffer();
  return `data:image/${fmt};base64,${buf.toString("base64")}`;
};

async function deck(): Promise<PresentationInput> {
  return {
    meta: {
      title: "Exportação PowerPoint",
      theme: "executivo",
      themeOverrides: { logo: { asset: await dataUri("png", 200, 80), alt: "Logo" } },
    },
    slides: [
      {
        layout: "cover",
        elements: [
          { type: "title", text: "Plano **2027**" },
          { type: "text", text: "Diretoria" },
        ],
        notes: "Boas-vindas à diretoria.",
      },
      {
        layout: "title-content",
        elements: [
          { type: "title", text: "Prioridades" },
          {
            type: "text",
            text: "1. Crescer [rápido](https://slideia.site)\n2. Contratar\n  - Engenharia",
          },
        ],
      },
      { layout: "section", hidden: true, elements: [{ type: "title", text: "Escondido" }] },
      {
        layout: "chart",
        elements: [
          { type: "title", text: "Receita" },
          {
            type: "chart",
            kind: "bar",
            labels: ["T1", "T2"],
            series: [{ name: "Receita", values: [12, 15] }],
            unit: "%",
            showValues: true,
          },
        ],
      },
      {
        layout: "table",
        elements: [
          { type: "title", text: "Planos" },
          { type: "table", header: ["Plano", "Preço"], rows: [["Essencial", "R$ 990"]] },
        ],
      },
      {
        layout: "image-text",
        elements: [
          { type: "image", asset: await dataUri("jpeg", 1600, 900), alt: "Foto azul" },
          { type: "title", text: "Imagem" },
          { type: "text", text: "Texto ao lado" },
        ],
      },
      {
        layout: "stats",
        elements: [
          { type: "title", text: "Números" },
          { type: "stat", value: "+18%", label: "receita", trend: "up" },
          { type: "stat", value: "312", label: "clientes", icon: "users" },
        ],
      },
    ],
  };
}

describe("PowerPoint export", () => {
  it("builds native text, images, charts, tables and notes", async () => {
    const { presentation } = await rt.service.create(await deck(), "ai", "mcp");
    const { html } = await rt.service.renderHtml(presentation.id);
    let buf: Buffer;
    try {
      buf = await renderPptx(rt.previewer, presentation, html);
    } catch (err) {
      // No Chrome on this machine: same as the preview test.
      expect(err).toBeInstanceOf(PreviewUnavailableError);
      return;
    }
    const zip = await JSZip.loadAsync(buf);
    const read = (f: string) => zip.file(f)!.async("string");
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides).toHaveLength(6); // the hidden slide is left out, like in the player

    const s1 = await read("ppt/slides/slide1.xml");
    expect(s1).toContain("<a:t>Plano </a:t>");
    expect(s1).toMatch(/<a:rPr[^>]*lang="pt-BR"[^>]*b="1"[^>]*>[\s\S]*?<a:t>2027<\/a:t>/);
    expect(s1).toContain("Montserrat"); // theme heading font, by name
    expect(s1).toContain('descr="Logo"'); // brand logo as a native picture

    // One <a:pPr> per paragraph (pptxgenjs writes one per run; PowerPoint would "repair" it).
    for (const f of slides)
      for (const [, body] of (await read(f)).matchAll(/<a:p>([\s\S]*?)<\/a:p>/g))
        expect(body!.match(/<a:pPr\b/g)?.length ?? 0).toBeLessThanOrEqual(1);

    const s2 = await read("ppt/slides/slide2.xml");
    expect(s2).toContain("<a:buAutoNum");
    expect(s2).toContain("Engenharia");
    expect(await read("ppt/slides/_rels/slide2.xml.rels")).toContain("https://slideia.site");

    const charts = Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f));
    expect(charts).toHaveLength(1);
    const chart = await read(charts[0]!);
    expect(chart).toContain("<c:barChart>");
    expect(chart).toContain("General&quot;%&quot;");

    expect(await read("ppt/slides/slide4.xml")).toContain("<a:tbl>");
    expect(await read("ppt/slides/slide5.xml")).toContain('descr="Foto azul"');
    // Stat icons are rasterized pictures; the values stay text.
    const s6 = await read("ppt/slides/slide6.xml");
    expect(s6).toContain("<a:t>+18%</a:t>");
    expect(s6.match(/<p:pic>/g)!.length).toBeGreaterThanOrEqual(2);

    const notes = Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/.+\.xml$/.test(f));
    const allNotes = await Promise.all(notes.map(read));
    expect(allNotes.join("")).toContain("Boas-vindas à diretoria.");

    // Pictures are re-encoded for PowerPoint (no WebP).
    const media = Object.keys(zip.files).filter((f) => /^ppt\/media\/.+/.test(f));
    expect(media.some((f) => f.endsWith(".jpeg"))).toBe(true);
    expect(media.every((f) => /\.(png|jpe?g)$/.test(f))).toBe(true);
  }, 60_000);

  it("serves the .pptx from the editor API", async () => {
    const [first] = await rt.service.list();
    const res = await fetch(rt.service.links.pptx(first!.id));
    if (res.status === 503) return; // no Chrome
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("presentationml.presentation");
    expect(res.headers.get("content-disposition")).toContain('.pptx"');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
  }, 60_000);
});
