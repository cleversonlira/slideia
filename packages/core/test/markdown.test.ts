import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { markdownToRichText, richTextToMarkdown } from "../src/markdown.js";
import { normalizeRichText } from "../src/richtext.js";
import type { Marks, Paragraph, RichText } from "../src/schema.js";

const md = (s: string) => markdownToRichText(s);

describe("markdownToRichText (lenient input)", () => {
  it("parses inline marks", () => {
    expect(md("a **b** *c* ~~d~~ ++e++ ==f== x^2^ H~2~O").paragraphs[0]!.runs).toEqual([
      { text: "a " },
      { text: "b", marks: { bold: true } },
      { text: " " },
      { text: "c", marks: { italic: true } },
      { text: " " },
      { text: "d", marks: { strike: true } },
      { text: " " },
      { text: "e", marks: { underline: true } },
      { text: " " },
      { text: "f", marks: { highlight: "highlight" } },
      { text: " x" },
      { text: "2", marks: { script: "sup" } },
      { text: " H" },
      { text: "2", marks: { script: "sub" } },
      { text: "O" },
    ]);
  });

  it("parses bold+italic written as ***x***", () => {
    expect(md("***x***").paragraphs[0]!.runs).toEqual([
      { text: "x", marks: { bold: true, italic: true } },
    ]);
  });

  it("parses links and colored spans", () => {
    expect(md("[site](https://ex.com) e [alerta]{color=danger u}").paragraphs[0]!.runs).toEqual([
      { text: "site", marks: { link: { href: "https://ex.com" } } },
      { text: " e " },
      { text: "alerta", marks: { underline: true, color: "danger" } },
    ]);
  });

  it("rejects unsafe link schemes", () => {
    const runs = md("[x](javascript:alert(1))").paragraphs[0]!.runs;
    expect(runs.some((r) => r.marks?.link)).toBe(false);
  });

  it("keeps everyday punctuation literal", () => {
    for (const s of [
      "2 * 3 = 6",
      "C++ e Java",
      "a == b",
      "snake_case_name",
      "~20 a ~30 pessoas",
      "<3",
      "[beta]",
      "x^2",
    ]) {
      expect(md(s).paragraphs[0]!.runs).toEqual([{ text: s }]);
    }
  });

  it("parses lists with nesting by indentation", () => {
    const rt = md("- um\n    - dois\n        - três\n- quatro\n1. a\n2. b");
    expect(rt.paragraphs.map((p) => p.list)).toEqual([
      { kind: "bullet", level: 1 },
      { kind: "bullet", level: 2 },
      { kind: "bullet", level: 3 },
      { kind: "bullet", level: 1 },
      { kind: "ordered", level: 1 },
      { kind: "ordered", level: 1 },
    ]);
  });

  it("treats each line as a paragraph and blank lines as separators", () => {
    expect(md("A\nB\n\n\nC").paragraphs.map((p) => p.runs[0]?.text)).toEqual(["A", "B", "C"]);
  });

  it("parses paragraph attributes and headings", () => {
    const rt = md("# Título\nTexto {align=center size=small}");
    expect(rt.paragraphs[0]).toMatchObject({ size: "display", runs: [{ text: "Título" }] });
    expect(rt.paragraphs[1]).toMatchObject({
      align: "center",
      size: "small",
      runs: [{ text: "Texto" }],
    });
  });

  it("does not interpret HTML", () => {
    expect(md("<b>oi</b><script>x</script>").paragraphs[0]!.runs).toEqual([
      { text: "<b>oi</b><script>x</script>" },
    ]);
  });
});

describe("richTextToMarkdown", () => {
  it("emits readable canonical markdown", () => {
    const rt = md("Olá **mundo** e *todos*\n- item 1\n  - item 2\n1. primeiro");
    expect(richTextToMarkdown(rt)).toBe(
      "Olá **mundo** e *todos*\n- item 1\n  - item 2\n1. primeiro",
    );
  });

  it("escapes special characters", () => {
    const rt: RichText = { paragraphs: [{ runs: [{ text: "- 1. *a* [b] {c}" }] }] };
    const out = richTextToMarkdown(rt);
    expect(markdownToRichText(out)).toEqual(rt);
  });
});

// ---------------------------------------------------------------------------
// Property: parse(serialize(rt)) == normalize(rt)
// ---------------------------------------------------------------------------

const chars = fc.constantFrom(..."ab Z9 ãç-*_~+=^[](){}<>`\\#.!|\t\n1".split(""));
const text = fc.array(chars, { minLength: 1, maxLength: 8 }).map((a) => a.join(""));
const color = fc.constantFrom("accent", "muted", "highlight", "#ff0000", "danger");

const marks: fc.Arbitrary<Marks | undefined> = fc.option(
  fc.record(
    {
      bold: fc.constant(true as const),
      italic: fc.constant(true as const),
      underline: fc.constant(true as const),
      strike: fc.constant(true as const),
      color,
      highlight: color,
      link: fc.constantFrom({ href: "https://ex.com/a_(b)" }, { href: "mailto:x@y.z" }),
      script: fc.constantFrom("sup" as const, "sub" as const),
    },
    { requiredKeys: [] },
  ),
  { nil: undefined },
);

const paragraph: fc.Arbitrary<Paragraph> = fc.record(
  {
    runs: fc.array(fc.record({ text, marks }, { requiredKeys: ["text"] }), { maxLength: 5 }),
    align: fc.constantFrom(
      "left" as const,
      "center" as const,
      "right" as const,
      "justify" as const,
    ),
    list: fc.record({
      kind: fc.constantFrom("bullet" as const, "ordered" as const),
      level: fc.constantFrom(1 as const, 2 as const, 3 as const),
    }),
    size: fc.constantFrom(
      "small" as const,
      "normal" as const,
      "large" as const,
      "display" as const,
    ),
  },
  { requiredKeys: ["runs"] },
);

const richText: fc.Arbitrary<RichText> = fc.record({
  paragraphs: fc.array(paragraph, { maxLength: 6 }),
});

describe("markdown round trip (property)", () => {
  it("is lossless", () => {
    fc.assert(
      fc.property(richText, (rt) => {
        const clean = (x: RichText) =>
          JSON.parse(JSON.stringify(x, (k, v) => (v === undefined ? undefined : v))) as RichText;
        const norm = normalizeRichText(clean(rt));
        const out = richTextToMarkdown(norm);
        expect(markdownToRichText(out), out).toEqual(norm);
      }),
      { numRuns: 3000 },
    );
  });
});
