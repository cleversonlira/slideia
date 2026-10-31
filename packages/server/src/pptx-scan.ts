/*
 * Measures one rendered slide in the headless browser for the PowerPoint export (pptx.ts).
 *
 * `scanSlide` runs inside the page (page.evaluate), so it must be self-contained: no imports and
 * no references to anything outside its body. Text, images, icons, charts and tables become
 * native PowerPoint objects at the measured boxes; whatever is left (backgrounds, cards, accent
 * bars, timeline dots, full-bleed photos with their overlay) is screenshotted as the slide
 * background after the scanned elements are hidden with the `HIDE_CLASS` class.
 */

/** Canvas pixels, relative to the slide's top-left corner. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScanRun {
  text: string;
  font: string;
  /** px */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  /** 0–1 */
  alpha: number;
  highlight?: string;
  href?: string;
  script?: "sup" | "sub";
  /** Letter spacing in px. */
  spacing: number;
  /** A line break comes before this run. */
  breakBefore?: boolean;
}

export interface ScanParagraph {
  runs: ScanRun[];
  align: "left" | "center" | "right" | "justify";
  list?: { kind: "bullet" | "ordered"; level: number; start?: number };
  /** Space before, px. */
  before: number;
  /** Line height, px. */
  lineHeight: number;
  /** Left indent of the text (list items), px. */
  indent: number;
  /** Font size of the paragraph, px (for empty paragraphs). */
  size: number;
}

export interface ScanText {
  kind: "text";
  box: Box;
  paragraphs: ScanParagraph[];
}

export interface ScanImage {
  kind: "image";
  box: Box;
  /** data: URI (the export inlines every image; icons are rasterized). */
  src: string;
  /** Visible part of the image, fractions of its natural size. */
  crop: Box;
  round: boolean;
  alt: string;
}

export interface ScanChart {
  kind: "chart";
  box: Box;
  elementId: string;
  /** Series (bar/line) or slice (pie/donut) colors, hex. */
  colors: string[];
  text: string;
  muted: string;
  grid: string;
  font: string;
}

export interface ScanCell {
  paragraphs: ScanParagraph[];
  fill?: string;
  border?: { color: string; width: number };
  /** px: top, right, bottom, left */
  pad: [number, number, number, number];
  valign: "top" | "middle" | "bottom";
}

export interface ScanTable {
  kind: "table";
  box: Box;
  cols: number[];
  rows: number[];
  cells: ScanCell[][];
}

export type ScanItem = ScanText | ScanImage | ScanChart | ScanTable;

export const HIDE_CLASS = "pptx-hide";

export async function scanSlide(index: number): Promise<ScanItem[]> {
  const HIDE = "pptx-hide";
  const p = (window as unknown as { apresenta: { slides: HTMLElement[] } }).apresenta;
  const slide = p.slides[index]!;
  const W = Number.parseFloat(getComputedStyle(slide).width);
  const sr = slide.getBoundingClientRect();
  const k = sr.width / W;
  const rel = (r: DOMRect): Box => ({
    x: (r.left - sr.left) / k,
    y: (r.top - sr.top) / k,
    w: r.width / k,
    h: r.height / k,
  });

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const c2d = canvas.getContext("2d", { willReadFrequently: true })!;
  /** Any CSS color → [#rrggbb, alpha]. */
  const color = (css: string): [string, number] => {
    c2d.clearRect(0, 0, 1, 1);
    c2d.fillStyle = "#000";
    c2d.fillStyle = css;
    c2d.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = c2d.getImageData(0, 0, 1, 1).data;
    const hex = `#${[r, g, b].map((v) => v!.toString(16).padStart(2, "0")).join("")}`;
    return [hex, a! / 255];
  };
  const visibleColor = (css: string): string | undefined => {
    const [hex, a] = color(css);
    return a > 0.05 ? hex : undefined;
  };
  const opacity = (el: Element | null): number => {
    let o = 1;
    for (let n = el; n && n !== slide.parentElement; n = n.parentElement)
      o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const px = (v: string, fallback = 0) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  // -- text ------------------------------------------------------------------

  const paragraphsOf = (root: HTMLElement): ScanParagraph[] => {
    const blocks = [...root.querySelectorAll<HTMLElement>("p")];
    const list = blocks.length ? blocks : [root];
    const out: ScanParagraph[] = [];
    let prevBottom: number | null = null;
    for (const block of list) {
      const st = getComputedStyle(block);
      const size = px(st.fontSize, 16);
      const r = rel(block.getBoundingClientRect());
      const runs: ScanRun[] = [];
      let pendingBreak = false;
      const walker = document.createTreeWalker(
        block,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (n) =>
            n instanceof Element && n.closest("svg")
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        },
      );
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n instanceof HTMLBRElement) {
          pendingBreak = true;
          continue;
        }
        if (n.nodeType !== Node.TEXT_NODE || !n.textContent) continue;
        const el = n.parentElement!;
        const cs = getComputedStyle(el);
        const script = el.closest("sup") ? "sup" : el.closest("sub") ? "sub" : undefined;
        const sizeEl = script ? el.closest("sup, sub")!.parentElement! : el;
        const [hex, a] = color(cs.color);
        const mark = el.closest("mark");
        const link = el.closest("a");
        let text = n.textContent.replace(/\s+/g, " ");
        if (cs.textTransform === "uppercase") text = text.toUpperCase();
        const run: ScanRun = {
          text,
          font: (cs.fontFamily.split(",")[0] ?? "").replace(/["']/g, "").trim(),
          size: px(getComputedStyle(sizeEl).fontSize, size),
          bold: px(cs.fontWeight, 400) >= 600,
          italic: cs.fontStyle === "italic",
          underline: !!el.closest("u"),
          strike: !!el.closest("s"),
          color: hex,
          alpha: a * opacity(el),
          spacing: cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing),
        };
        const hl = mark ? visibleColor(getComputedStyle(mark).backgroundColor) : undefined;
        if (hl) run.highlight = hl;
        if (link?.href) run.href = link.href;
        if (script) run.script = script;
        if (pendingBreak) run.breakBefore = true;
        pendingBreak = false;
        runs.push(run);
      }
      // Trim the whitespace HTML collapses at the paragraph edges.
      if (runs[0]) runs[0].text = runs[0].text.replace(/^ +/, "");
      const last = runs[runs.length - 1];
      if (last) last.text = last.text.replace(/ +$/, "");

      const li = block.closest("li");
      const para: ScanParagraph = {
        runs: runs.filter((x) => x.text || x.breakBefore),
        align:
          (
            { start: "left", left: "left", center: "center", right: "right", end: "right" } as const
          )[st.textAlign as "left"] ?? (st.textAlign === "justify" ? "justify" : "left"),
        before: prevBottom === null ? 0 : Math.max(0, r.y - prevBottom),
        lineHeight: st.lineHeight === "normal" ? size * 1.2 : px(st.lineHeight, size * 1.2),
        indent: 0,
        size,
      };
      if (li && root.contains(li)) {
        const listEl = li.parentElement!;
        let level = 0;
        for (let n: Element | null = li; n && n !== root; n = n.parentElement)
          if (n.tagName === "UL" || n.tagName === "OL") level++;
        para.indent = r.x - rel(root.getBoundingClientRect()).x;
        if (li.querySelector("p") === block) {
          para.list = { kind: listEl.tagName === "OL" ? "ordered" : "bullet", level };
          if (listEl.tagName === "OL" && listEl.firstElementChild === li)
            para.list.start = (listEl as HTMLOListElement).start || 1;
        }
      }
      out.push(para);
      prevBottom = r.y + r.h;
    }
    return out;
  };

  // -- images ----------------------------------------------------------------

  const imageItem = (img: HTMLImageElement, frameEl: Element): ScanImage | null => {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const src = img.currentSrc || img.src;
    if (!nw || !nh || !src.startsWith("data:")) return null;
    const frame = rel(frameEl.getBoundingClientRect());
    const r = rel(img.getBoundingClientRect());
    const cs = getComputedStyle(img);
    let content = r;
    if (cs.objectFit === "cover" || cs.objectFit === "contain") {
      const s =
        cs.objectFit === "cover" ? Math.max(r.w / nw, r.h / nh) : Math.min(r.w / nw, r.h / nh);
      const cw = nw * s;
      const ch = nh * s;
      const [ox, oy] = cs.objectPosition.split(" ").map((v, i) => {
        if (v.endsWith("%")) return px(v) / 100;
        const free = i === 0 ? r.w - cw : r.h - ch;
        return free ? px(v) / free : 0.5;
      });
      content = {
        x: r.x + (r.w - cw) * (ox ?? 0.5),
        y: r.y + (r.h - ch) * (oy ?? 0.5),
        w: cw,
        h: ch,
      };
    }
    const x0 = Math.max(content.x, frame.x);
    const y0 = Math.max(content.y, frame.y);
    const x1 = Math.min(content.x + content.w, frame.x + frame.w);
    const y1 = Math.min(content.y + content.h, frame.y + frame.h);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    const radius = px(getComputedStyle(frameEl).borderTopLeftRadius);
    return {
      kind: "image",
      box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      src,
      crop: {
        x: (x0 - content.x) / content.w,
        y: (y0 - content.y) / content.h,
        w: (x1 - x0) / content.w,
        h: (y1 - y0) / content.h,
      },
      round: radius >= Math.min(frame.w, frame.h) / 2 - 1,
      alt: img.alt,
    };
  };

  /** Lucide icons as 2× PNG in their computed color. */
  const iconItem = async (svg: SVGSVGElement): Promise<ScanImage | null> => {
    const box = rel(svg.getBoundingClientRect());
    if (box.w < 1 || box.h < 1) return null;
    const cs = getComputedStyle(svg);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const scale = 2;
    clone.setAttribute("width", String(Math.round(box.w * scale)));
    clone.setAttribute("height", String(Math.round(box.h * scale)));
    clone.setAttribute("stroke-width", cs.strokeWidth);
    clone.style.color = cs.color;
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = Math.round(box.w * scale);
    cv.height = Math.round(box.h * scale);
    cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
    return {
      kind: "image",
      box,
      src: cv.toDataURL("image/png"),
      crop: { x: 0, y: 0, w: 1, h: 1 },
      round: false,
      alt: "",
    };
  };

  // -- walk ------------------------------------------------------------------

  const items: ScanItem[] = [];
  const hide: Element[] = [];
  const TEXT = ".rt, .stat-value, .tl-date, .tl-title, .q-author, .q-role, .chart-title";
  const nodes = slide.querySelectorAll<HTMLElement>(
    `${TEXT}, img, svg.icon, svg.chart, .el-table table`,
  );
  for (const el of nodes) {
    if (el.closest(`.${HIDE}`) || el.closest("[hidden]")) continue;
    if (getComputedStyle(el).visibility === "hidden" || getComputedStyle(el).display === "none")
      continue;
    // Tables are handled as a whole; icons inside text are found on their own.
    if (!el.matches(".el-table table") && el.closest(".el-table")) continue;

    if (el instanceof HTMLImageElement) {
      // Full-bleed photos (and their overlay) stay in the background picture.
      if (el.closest(".slide-bg, .layout-cover .slot-image, .layout-full-image .slot-image"))
        continue;
      const frame = el.classList.contains("brand-logo") ? el : (el.closest(".img-wrap") ?? el);
      const it = imageItem(el, frame);
      if (it) items.push(it);
      hide.push(el);
    } else if (el instanceof SVGSVGElement && el.classList.contains("icon")) {
      const it = await iconItem(el);
      if (it) items.push(it);
      hide.push(el);
    } else if (el instanceof SVGSVGElement) {
      const elId = el.closest<HTMLElement>("[data-el-id]")?.dataset.elId ?? "";
      const scs = getComputedStyle(slide);
      const fill = (sel: string, prop: "fill" | "stroke", fb: string) => {
        const n = el.querySelector(sel);
        return n ? color(getComputedStyle(n)[prop])[0] : fb;
      };
      const text = fill(".c-label, .c-legend", "fill", color(scs.color)[0]);
      items.push({
        kind: "chart",
        box: rel(el.getBoundingClientRect()),
        elementId: elId,
        colors: [1, 2, 3, 4, 5, 6].map((i) => color(scs.getPropertyValue(`--c-chart${i}`))[0]),
        text,
        muted: fill(".c-tick", "fill", text),
        grid: fill(".c-grid:not(.c-zero)", "stroke", "#cccccc"),
        font: (scs.fontFamily.split(",")[0] ?? "").replace(/["']/g, "").trim(),
      });
      hide.push(el);
    } else if (el instanceof HTMLTableElement) {
      const trs = [...el.rows];
      const first = trs[0];
      if (!first) continue;
      const cells = trs.map((tr) =>
        [...tr.cells].map((td): ScanCell => {
          const cs = getComputedStyle(td);
          const rt = td.querySelector<HTMLElement>(".rt");
          const cell: ScanCell = {
            paragraphs: rt ? paragraphsOf(rt) : [],
            pad: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
            valign:
              cs.verticalAlign === "top"
                ? "top"
                : cs.verticalAlign === "bottom"
                  ? "bottom"
                  : "middle",
          };
          const bg = visibleColor(cs.backgroundColor);
          if (bg) cell.fill = bg;
          const bw = px(cs.borderBottomWidth);
          if (bw > 0 && cs.borderBottomStyle !== "none") {
            const bc = visibleColor(cs.borderBottomColor);
            if (bc) cell.border = { color: bc, width: bw };
          }
          return cell;
        }),
      );
      items.push({
        kind: "table",
        box: rel(el.getBoundingClientRect()),
        cols: [...first.cells].map((c) => rel(c.getBoundingClientRect()).w),
        rows: trs.map((tr) => rel(tr.getBoundingClientRect()).h),
        cells,
      });
      hide.push(el.closest(".el-table") ?? el);
    } else {
      const paragraphs = paragraphsOf(el);
      if (paragraphs.some((x) => x.runs.length))
        items.push({ kind: "text", box: rel(el.getBoundingClientRect()), paragraphs });
      hide.push(el);
    }
  }
  for (const el of hide) el.classList.add(HIDE);
  return items;
}
