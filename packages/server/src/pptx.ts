import { createHash } from "node:crypto";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import sharp from "sharp";
import { plainText, type ElementOf, type Presentation } from "@slideia/core";
import type { Previewer } from "./preview.js";
import type {
  Box,
  ScanCell,
  ScanChart,
  ScanImage,
  ScanItem,
  ScanParagraph,
  ScanRun,
  ScanTable,
} from "./pptx-scan.js";

/*
 * PowerPoint export. The standalone HTML is laid out in the headless browser (Previewer.scanDeck),
 * so positions, autofit font sizes and colors are exactly the ones the player shows. Text, images,
 * icons, tables and charts become native, editable objects; backgrounds and decorations become
 * the slide's background picture. Fonts are referenced by name (not embedded).
 */

/** The canvas is 1920 px (16:9) or 1440 px (4:3) wide for 13.333 in or 10 in: 144 px per inch. */
const inch = (px: number) => Math.round((px / 144) * 1000) / 1000;
/** 1 px = 0.5 pt. */
const pt = (px: number) => Math.round(px * 50) / 100;
const hex = (c: string) => c.replace(/^#/, "").toUpperCase();

type TextProps = PptxGenJS.TextProps;
type TextOptions = NonNullable<TextProps["options"]>;

/**
 * PowerPoint and the browser wrap lines slightly differently; a little extra width keeps a line
 * that just fits in the browser from wrapping (centered text grows on both sides).
 */
function textBox(box: Box, align: ScanParagraph["align"]): Box {
  const extra = Math.min(box.w * 0.04, 24);
  const x = align === "center" ? box.x - extra / 2 : align === "right" ? box.x - extra : box.x;
  return { x, y: box.y, w: box.w + extra, h: box.h };
}

function runOptions(r: ScanRun, lang: string): TextOptions {
  const o: TextOptions = {
    lang,
    fontFace: r.font,
    fontSize: pt(r.size),
    color: hex(r.color),
  };
  if (r.bold) o.bold = true;
  if (r.italic) o.italic = true;
  if (r.underline) o.underline = { style: "sng" };
  if (r.strike) o.strike = "sngStrike";
  if (r.alpha < 0.99) o.transparency = Math.round((1 - r.alpha) * 100);
  if (r.highlight) o.highlight = hex(r.highlight);
  if (r.href) o.hyperlink = { url: r.href };
  if (r.script === "sup") o.superscript = true;
  if (r.script === "sub") o.subscript = true;
  if (Math.abs(r.spacing) > 0.05) o.charSpacing = pt(r.spacing);
  return o;
}

/** Paragraphs → pptxgenjs runs (a paragraph ends with breakLine; bullets only on its first run). */
export function textRuns(paragraphs: ScanParagraph[], lang: string): TextProps[] {
  const out: TextProps[] = [];
  paragraphs.forEach((para, pi) => {
    const shared: TextOptions = {
      align: para.align,
      lineSpacing: pt(para.lineHeight),
    };
    if (para.before > 0.5) shared.paraSpaceBefore = pt(para.before);
    const first: TextOptions = {};
    if (para.list) {
      const indent = pt(para.indent / para.list.level);
      first.bullet =
        para.list.kind === "ordered"
          ? {
              type: "number",
              indent,
              ...(para.list.start && para.list.start > 1 ? { numberStartAt: para.list.start } : {}),
            }
          : { indent, ...(para.list.level > 1 ? { characterCode: "2013" } : {}) };
      if (para.list.level > 1) shared.indentLevel = para.list.level - 1;
    }
    const runs = para.runs.length ? para.runs : null;
    const last = pi === paragraphs.length - 1;
    if (!runs) {
      out.push({
        text: "",
        options: { ...shared, lang, fontSize: pt(para.size), breakLine: !last },
      });
      return;
    }
    runs.forEach((r, ri) => {
      const o: TextOptions = { ...shared, ...runOptions(r, lang) };
      if (ri === 0) Object.assign(o, first);
      if (r.breakBefore && ri > 0) o.softBreakBefore = true;
      if (ri === runs.length - 1 && !last) o.breakLine = true;
      out.push({ text: r.text, options: o });
    });
  });
  return out;
}

/**
 * pptxgenjs takes the file extension from `path` (PNG when absent) and reuses media with the same
 * path, so each distinct picture gets its own "preencoded-<hash>.<ext>" name (never read from disk).
 */
function media(mime: "image/png" | "image/jpeg", buf: Buffer): { data: string; path: string } {
  const ext = mime === "image/png" ? "png" : "jpeg";
  const hash = createHash("sha1").update(buf).digest("hex").slice(0, 16);
  return { data: `${mime};base64,${buf.toString("base64")}`, path: `preencoded-${hash}.${ext}` };
}

async function imageData(it: ScanImage): Promise<{ data: string; path: string } | null> {
  const m = /^data:[^;,]+;base64,(.*)$/s.exec(it.src);
  if (!m) return null;
  let img = sharp(Buffer.from(m[1]!, "base64"), { limitInputPixels: 80_000_000, pages: 1 });
  const meta = await img.metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) return null;
  const c = it.crop;
  if (c.x > 0.001 || c.y > 0.001 || c.w < 0.999 || c.h < 0.999) {
    const left = Math.max(0, Math.round(c.x * w));
    const top = Math.max(0, Math.round(c.y * h));
    img = img.extract({
      left,
      top,
      width: Math.max(1, Math.min(w - left, Math.round(c.w * w))),
      height: Math.max(1, Math.min(h - top, Math.round(c.h * h))),
    });
  }
  // WebP/AVIF/GIF are not read by every PowerPoint version: PNG keeps transparency, JPEG the rest.
  const buf = meta.hasAlpha
    ? await img.png().toBuffer()
    : await img.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return media(meta.hasAlpha ? "image/png" : "image/jpeg", buf);
}

/** Excel number format with the chart unit as a literal suffix. */
function numberFormat(unit: string | undefined): string {
  return unit ? `General"${unit.replace(/"/g, "")}"` : "General";
}

function addChart(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  it: ScanChart,
  chart: ElementOf<"chart">,
  lang: string,
): void {
  const pie = chart.kind === "pie" || chart.kind === "donut";
  const data = (pie ? chart.series.slice(0, 1) : chart.series).map((s) => ({
    name: s.name,
    labels: chart.labels,
    values: chart.labels.map((_, i) => s.values[i] ?? 0),
  }));
  const colors = pie
    ? chart.labels.map((_, i) => hex(it.colors[i % it.colors.length]!))
    : chart.series.map((s, i) => hex(seriesColor(s.color, it, i)));
  const font = it.font;
  const fmt = numberFormat(chart.unit);
  const opts: PptxGenJS.IChartOpts = {
    x: inch(it.box.x),
    y: inch(it.box.y),
    w: inch(it.box.w),
    h: inch(it.box.h),
    chartColors: colors,
    lang,
    showLegend: pie || chart.series.length > 1,
    legendPos: pie ? "r" : "t",
    legendColor: hex(it.text),
    legendFontFace: font,
    legendFontSize: 12,
    // One label position for every series: two lines with labels would overlap.
    showValue: pie
      ? !!chart.unit
      : !!chart.showValues && (chart.kind === "bar" || chart.series.length === 1),
    showPercent: pie && !chart.unit,
    dataLabelColor: hex(pie ? "#ffffff" : it.text),
    dataLabelFontFace: font,
    dataLabelFontSize: pie ? 12 : 11,
    dataLabelFontBold: true,
    dataLabelFormatCode: fmt,
  };
  if (pie) {
    if (chart.kind === "donut") opts.holeSize = 58;
    opts.dataLabelPosition = chart.kind === "donut" ? "ctr" : "bestFit";
    opts.firstSliceAng = 0;
  } else {
    Object.assign(opts, {
      catAxisLabelColor: hex(it.text),
      catAxisLabelFontFace: font,
      catAxisLabelFontSize: 12,
      valAxisLabelColor: hex(it.muted),
      valAxisLabelFontFace: font,
      valAxisLabelFontSize: 11,
      valAxisLabelFormatCode: fmt,
      valAxisLineShow: false,
      catAxisLineShow: true,
      catAxisLineColor: hex(it.muted),
      valGridLine: { color: hex(it.grid), size: 0.75 },
      catAxisMajorTickMark: "none",
      valAxisMajorTickMark: "none",
    } satisfies Partial<PptxGenJS.IChartOpts>);
    if (chart.kind === "bar") {
      opts.barDir = "col";
      opts.barGrouping = "clustered";
      opts.barGapWidthPct = Math.round(((1 - 0.72) / 0.72) * 100);
      opts.dataLabelPosition = "outEnd";
    } else {
      opts.lineSize = 3;
      opts.lineDataSymbol = "circle";
      opts.lineDataSymbolSize = 8;
      opts.dataLabelPosition = "t";
    }
  }
  if (chart.title) opts.altText = chart.title;
  slide.addChart(
    pie
      ? chart.kind === "donut"
        ? pptx.ChartType.doughnut
        : pptx.ChartType.pie
      : chart.kind === "bar"
        ? pptx.ChartType.bar
        : pptx.ChartType.line,
    data,
    opts,
  );
}

function seriesColor(c: string | undefined, it: ScanChart, i: number): string {
  if (c?.startsWith("#"))
    return c.length === 4 ? `#${[...c.slice(1)].map((x) => x + x).join("")}` : c;
  // Tokens other than the chart palette are rare in charts; the palette keeps them readable.
  return it.colors[i % it.colors.length]!;
}

function addTable(slide: PptxGenJS.Slide, it: ScanTable, lang: string): void {
  const none = { type: "none" as const };
  const rows: PptxGenJS.TableRow[] = it.cells.map((row) =>
    row.map((c: ScanCell): PptxGenJS.TableCell => {
      const o: PptxGenJS.TableCellProps = {
        valign: c.valign,
        margin: c.pad.map((v) => inch(v)) as [number, number, number, number],
        border: [
          none,
          none,
          c.border ? { type: "solid", pt: pt(c.border.width), color: hex(c.border.color) } : none,
          none,
        ],
      };
      if (c.fill) o.fill = { color: hex(c.fill) };
      return { text: textRuns(c.paragraphs, lang), options: o };
    }),
  );
  slide.addTable(rows, {
    x: inch(it.box.x),
    y: inch(it.box.y),
    w: inch(it.box.w),
    colW: it.cols.map(inch),
    rowH: it.rows.map(inch),
  });
}

export interface PptxSlideScan {
  items: ScanItem[];
  background: Buffer;
}

/** Builds the .pptx from the scanned slides (visible slides of `p`, in order). */
export async function buildPptx(p: Presentation, scans: PptxSlideScan[]): Promise<Buffer> {
  const pptx = new PptxGenJS();
  if (p.meta.aspectRatio === "4:3") {
    pptx.defineLayout({ name: "SLIDEIA_4x3", width: 10, height: 7.5 });
    pptx.layout = "SLIDEIA_4x3";
  } else pptx.layout = "LAYOUT_WIDE";
  pptx.title = p.meta.title;
  if (p.meta.author) pptx.author = p.meta.author;
  pptx.company = "";

  const visible = p.slides.filter((s) => !s.hidden);
  for (const [i, scan] of scans.entries()) {
    const source = visible[i];
    const slide = pptx.addSlide();
    slide.background = media("image/jpeg", scan.background);
    for (const it of scan.items) {
      if (it.kind === "text") {
        const box = textBox(it.box, it.paragraphs[0]?.align ?? "left");
        slide.addText(textRuns(it.paragraphs, p.meta.lang), {
          x: inch(box.x),
          y: inch(box.y),
          w: inch(box.w),
          h: inch(box.h),
          margin: 0,
          valign: "top",
          wrap: true,
          fit: "none",
          isTextBox: true,
        });
      } else if (it.kind === "image") {
        const img = await imageData(it);
        if (!img) continue;
        slide.addImage({
          ...img,
          x: inch(it.box.x),
          y: inch(it.box.y),
          w: inch(it.box.w),
          h: inch(it.box.h),
          ...(it.round ? { rounding: true } : {}),
          ...(it.alt ? { altText: it.alt } : {}),
        });
      } else if (it.kind === "chart") {
        const el = source?.elements.find((e) => e.id === it.elementId);
        if (el?.type === "chart") addChart(pptx, slide, it, el, p.meta.lang);
      } else addTable(slide, it, p.meta.lang);
    }
    const notes = source?.notes ? plainText(source.notes) : "";
    if (notes) slide.addNotes(notes);
  }
  return oneParagraphProps((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
}

/**
 * pptxgenjs writes an <a:pPr> before every run of a paragraph, and the schema allows one (first):
 * PowerPoint would offer to "repair" the file. Keeps the first one of each paragraph.
 */
export async function oneParagraphProps(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const PPR = /<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g;
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    const fixed = xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_m, body: string) => {
      let seen = false;
      return `<a:p>${body.replace(PPR, (ppr) => (seen ? "" : ((seen = true), ppr)))}</a:p>`;
    });
    if (fixed !== xml) zip.file(name, fixed);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Standalone HTML → .pptx (the HTML must be the export of `p`). */
export async function renderPptx(
  previewer: Previewer,
  p: Presentation,
  html: string,
): Promise<Buffer> {
  const scans = await previewer.scanDeck(html, p.meta.aspectRatio);
  return buildPptx(p, scans);
}
