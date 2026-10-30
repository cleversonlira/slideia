import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PresentationError,
  applyOps,
  checkDesign,
  contrastRatio,
  diffToOps,
  normalizePresentation,
  stripUndefined,
  THEMES,
  type Presentation,
} from "../src/index.js";

const examplesDir = join(import.meta.dirname, "../../../assets/examples");
const examples = readdirSync(examplesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({
    name: f,
    input: JSON.parse(readFileSync(join(examplesDir, f), "utf8")) as unknown,
  }));

function sample(): Presentation {
  return normalizePresentation({
    meta: { title: "Teste" },
    slides: [
      { id: "s1", layout: "cover", elements: [{ id: "t1", type: "title", text: "Capa" }] },
      {
        id: "s2",
        layout: "title-content",
        elements: [
          { id: "t2", type: "title", text: "Título **forte**" },
          { id: "b2", type: "text", text: "- um\n- dois" },
        ],
        notes: "fale sobre um e dois",
      },
      {
        id: "s3",
        layout: "two-columns",
        elements: [
          { id: "t3", type: "title", text: "Colunas" },
          { id: "l3", type: "text", text: "esquerda" },
          { id: "r3", type: "text", text: "direita" },
        ],
      },
    ],
  });
}

describe("normalizePresentation", () => {
  it("normalizes every example", () => {
    for (const ex of examples) {
      const p = normalizePresentation(ex.input);
      expect(p.slides.length, ex.name).toBeGreaterThan(5);
      expect(p.version).toBe(1);
    }
  });

  it("applies defaults and infers slots", () => {
    const p = sample();
    expect(p.meta).toMatchObject({
      lang: "pt-BR",
      aspectRatio: "16:9",
      theme: "executivo",
      defaultTransition: { type: "fade" },
    });
    expect(p.slides[2]!.elements.map((e) => e.slot)).toEqual(["title", "left", "right"]);
    expect(p.slides[1]!.elements[1]).toMatchObject({
      type: "text",
      text: { paragraphs: [{ list: { kind: "bullet", level: 1 } }, {}] },
    });
  });

  it("generates ids when missing", () => {
    const p = normalizePresentation({
      meta: { title: "x" },
      slides: [{ layout: "section", elements: [{ type: "title", text: "A" }] }],
    });
    expect(p.id).toMatch(/^p_/);
    expect(p.slides[0]!.id).toMatch(/^s_/);
    expect(p.slides[0]!.elements[0]!.id).toMatch(/^e_/);
  });

  it("reports precise, fixable errors", () => {
    try {
      normalizePresentation({
        meta: { title: "x", theme: "rosa" },
        slides: [
          {
            layout: "title-content",
            elements: [
              { type: "title", text: "a" },
              { type: "stat", value: "1", label: "x", slot: "body" },
            ],
          },
        ],
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PresentationError);
      expect((e as Error).message).toContain("meta.theme");
    }
    try {
      normalizePresentation({
        meta: { title: "x" },
        slides: [
          {
            layout: "title-content",
            elements: [
              { type: "title", text: "a" },
              { type: "stat", value: "1", label: "x", slot: "body" },
            ],
          },
        ],
      });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain(
        'slides[0].elements[1].slot: Slot "body" does not accept "stat"',
      );
    }
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      normalizePresentation({
        meta: { title: "x" },
        slides: [{ id: "a", layout: "section", elements: [{ id: "a", type: "title", text: "A" }] }],
      }),
    ).toThrow(/Duplicate id "a"/);
  });
});

describe("applyOps", () => {
  it("applies a batch atomically and bumps the version", () => {
    const p = sample();
    const r = applyOps(p, [
      { op: "update_text", slide: 2, element: "t2", text: "Novo título" },
      {
        op: "add_slide",
        slide: {
          layout: "quote",
          elements: [{ type: "quote", text: "Uma frase", author: "Alguém" }],
        },
        after: "s1",
      },
      { op: "update_presentation", patch: { theme: "noturno" } },
    ]);
    expect(r.changed).toBe(true);
    expect(r.presentation.version).toBe(2);
    expect(r.presentation.slides[1]!.layout).toBe("quote");
    expect(r.presentation.slides[2]!.elements[0]).toMatchObject({
      text: { paragraphs: [{ runs: [{ text: "Novo título" }] }] },
    });
    expect(r.presentation.meta.theme).toBe("noturno");
    expect(r.touched).toEqual(expect.arrayContaining(["t2", "meta", "order"]));
    expect(p.version).toBe(1);
  });

  it("resolves slide numbers before applying", () => {
    const r = applyOps(sample(), [
      { op: "move_slide", slide: 3, after: "start" },
      { op: "update_text", slide: 3, element: "t3", text: "ainda o slide 3 original" },
    ]);
    expect(r.presentation.slides[0]!.id).toBe("s3");
  });

  it("fails without side effects and points to the operation", () => {
    const p = sample();
    expect(() =>
      applyOps(p, [
        { op: "update_text", slide: "s2", element: "t2", text: "ok" },
        { op: "remove_element", slide: "s2", element: "nao-existe" },
      ]),
    ).toThrow(/operations\[1\]\.element: Element "nao-existe" not found/);
    expect(p.slides[1]!.elements[0]).toMatchObject({
      text: { paragraphs: [{ runs: [{ text: "Título " }, { text: "forte" }] }] },
    });
  });

  it("find_replace across runs keeps marks of the first char", () => {
    const r = applyOps(sample(), [
      { op: "find_replace", find: "título forte", replace: "Headline" },
    ]);
    expect(r.presentation.slides[1]!.elements[0]).toMatchObject({
      text: { paragraphs: [{ runs: [{ text: "Headline" }] }] },
    });
    expect(r.summary[0]).toContain("1 replacement");
  });

  it("changing layout remaps elements and hides what does not fit", () => {
    const r = applyOps(sample(), [
      { op: "update_slide", slide: "s3", patch: { layout: "title-content" } },
    ]);
    expect(r.presentation.slides[2]!.elements.map((e) => e.slot)).toEqual([
      "title",
      "body",
      "overflow",
    ]);
    expect(r.notes[0]).toContain("overflow");
  });

  it("no-op batch keeps the version", () => {
    const r = applyOps(sample(), [{ op: "find_replace", find: "zzz", replace: "y" }]);
    expect(r.changed).toBe(false);
    expect(r.presentation.version).toBe(1);
  });
});

describe("diffToOps", () => {
  const strip = (p: Presentation) => stripUndefined({ ...p, version: 0 });

  it("reproduces arbitrary edits", () => {
    const a = sample();
    const b = applyOps(a, [
      { op: "update_text", slide: "s2", element: "b2", text: "- um\n- dois\n- três" },
      { op: "remove_slide", slide: "s1" },
      {
        op: "add_slide",
        slide: { layout: "section", elements: [{ type: "title", text: "Nova" }] },
        after: "s2",
      },
      {
        op: "update_slide",
        slide: "s3",
        patch: { layout: "comparison", background: { type: "color", color: "surface" } },
      },
      { op: "update_presentation", patch: { author: "Ana", aspectRatio: "4:3" } },
      { op: "add_element", slide: "s3", element: { type: "text", text: "nota" }, before: "t3" },
      { op: "remove_element", slide: "s2", element: "b2" },
      {
        op: "add_element",
        slide: "s2",
        element: {
          type: "chart",
          kind: "bar",
          labels: ["a"],
          series: [{ name: "x", values: [1] }],
        },
      },
      { op: "move_slide", slide: "s3", after: "start" },
    ]).presentation;
    const ops = diffToOps(a, b);
    const c = applyOps(a, ops).presentation;
    expect(strip(c)).toEqual(strip(b));
  });

  it("returns no ops for equal documents", () => {
    expect(diffToOps(sample(), sample())).toEqual([]);
  });

  it("uses update_text for pure text edits", () => {
    const a = sample();
    const b = applyOps(a, [
      { op: "update_text", slide: "s2", element: "t2", text: "x" },
    ]).presentation;
    expect(diffToOps(a, b)).toEqual([
      {
        op: "update_text",
        slide: "s2",
        element: "t2",
        text: { paragraphs: [{ runs: [{ text: "x" }] }] },
      },
    ]);
  });
});

describe("checkDesign", () => {
  it("flags crowded lists and streaks", () => {
    const p = normalizePresentation({
      meta: { title: "x" },
      slides: [1, 2, 3].map((i) => ({
        layout: "title-content",
        elements: [
          { type: "title", text: `Slide ${i}` },
          { type: "text", text: Array.from({ length: 9 }, (_, k) => `- item ${k}`).join("\n") },
        ],
      })),
    });
    const codes = checkDesign(p).map((w) => w.code);
    expect(codes).toContain("too_many_items");
    expect(codes).toContain("layout_streak");
  });

  it("examples have no blocking design problems", () => {
    for (const ex of examples) {
      const warnings = checkDesign(normalizePresentation(ex.input)).filter(
        (w) => w.code !== "missing_notes",
      );
      expect(warnings, ex.name).toEqual([]);
    }
  });
});

describe("themes", () => {
  it("meet WCAG AA contrast", () => {
    for (const t of Object.values(THEMES)) {
      const c = t.colors;
      const pairs: Array<[string, string, string, number]> = [
        ["text/bg", c.text, c.bg, 4.5],
        ["muted/bg", c.muted, c.bg, 4.5],
        ["text/surface", c.text, c.surface, 4.5],
        ["accent/bg", c.accent, c.bg, 4.5],
        ["accent2/bg", c.accent2, c.bg, 3],
        ["text/highlight", c.text, c.highlight, 4.5],
        ["onAccent/accent", c.onAccent, c.accent, 4.5],
        ["inverseText/inverseBg", c.inverseText, c.inverseBg, 4.5],
        ["inverseMuted/inverseBg", c.inverseMuted, c.inverseBg, 4.5],
        ["inverseAccent/inverseBg", c.inverseAccent, c.inverseBg, 4.5],
        ["inverseText/inverseHighlight", c.inverseText, c.inverseHighlight, 4.5],
        ["success/bg", c.success, c.bg, 3],
        ["danger/bg", c.danger, c.bg, 3],
      ];
      for (const [name, fg, bg, min] of pairs) {
        expect(contrastRatio(fg, bg), `${t.id} ${name}`).toBeGreaterThanOrEqual(min);
      }
    }
  });
});
