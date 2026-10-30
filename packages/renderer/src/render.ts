import {
  LAYOUTS,
  OVERFLOW_SLOT,
  effectiveBackground,
  isEmptyRichText,
  resolveTheme,
  slideTone,
  type BrandLogo,
  type Element,
  type LayoutId,
  type Presentation,
  type Slide,
  type Theme,
} from "@slideia/core/browser";
import { chartSvg } from "./chart.js";
import { esc, safeImageSrc } from "./escape.js";
import { TREND_ICONS, iconSvg, type IconMap } from "./icons.js";
import { cssColor, richTextToHtml } from "./richtext-html.js";

export interface RenderContext {
  theme: Theme;
  lang: string;
  icons: IconMap;
  /** Resolves an AssetRef ("asset:<id>", URL or data URI) to an <img> src. */
  resolveAsset: (ref: string) => string;
  /** Brand logo drawn in a corner of every slide (meta.themeOverrides.logo). */
  logo?: BrandLogo | undefined;
}

export function createContext(
  p: Presentation,
  opts: { icons?: IconMap; resolveAsset?: (ref: string) => string } = {},
): RenderContext {
  return {
    theme: resolveTheme(p.meta),
    lang: p.meta.lang,
    icons: opts.icons ?? {},
    resolveAsset: opts.resolveAsset ?? ((ref) => ref),
    logo: p.meta.themeOverrides?.logo,
  };
}

// ---------------------------------------------------------------------------
// Layout templates: how slots are grouped into regions
// ---------------------------------------------------------------------------

type Region = string | { cls: string; children: Region[] };

const TEMPLATES: Record<LayoutId, Region[]> = {
  cover: ["image", "logo", { cls: "r-main", children: ["title", "subtitle"] }],
  section: [{ cls: "r-main", children: ["number", "title", "subtitle"] }],
  "title-content": ["title", "body"],
  "two-columns": ["title", { cls: "r-cols", children: ["left", "right"] }],
  "full-image": ["image", { cls: "r-main", children: ["title", "caption"] }],
  "image-text": ["image", { cls: "r-main", children: ["title", "body"] }],
  quote: [{ cls: "r-main", children: ["image", "quote"] }],
  stats: ["title", "stats", "footnote"],
  timeline: ["title", "timeline"],
  comparison: [
    "title",
    {
      cls: "r-cols",
      children: [
        { cls: "r-card r-card-a", children: ["leftTitle", "left"] },
        { cls: "r-card r-card-b", children: ["rightTitle", "right"] },
      ],
    },
  ],
  chart: ["title", { cls: "r-chart", children: ["chart", "body"] }],
  table: ["title", "table", "footnote"],
  closing: ["logo", { cls: "r-main", children: ["title", "body", "contact"] }],
};

// ---------------------------------------------------------------------------
// Animation steps
// ---------------------------------------------------------------------------

export interface StepInfo {
  start: number;
  mode: "element" | "paragraph";
  anim: string;
}

/** Assigns reveal steps to animated elements. Returns per-element info and the step count. */
export function computeSteps(slide: Slide): { steps: Map<string, StepInfo>; count: number } {
  const steps = new Map<string, StepInfo>();
  const animated = slide.elements
    .map((e, i) => ({ e, order: e.animation?.order ?? i + 1, i }))
    .filter((x) => x.e.animation && x.e.slot !== OVERFLOW_SLOT)
    .sort((a, b) => a.order - b.order || a.i - b.i);
  let step = 0;
  let k = 0;
  while (k < animated.length) {
    const order = animated[k]!.order;
    const groupStart = step + 1;
    let span = 1;
    while (k < animated.length && animated[k]!.order === order) {
      const { e } = animated[k]!;
      const blocks = e.animation!.by === "paragraph" ? paragraphBlocks(e) : 0;
      if (blocks > 0) {
        steps.set(e.id, { start: groupStart, mode: "paragraph", anim: e.animation!.type });
        span = Math.max(span, blocks);
      } else {
        steps.set(e.id, { start: groupStart, mode: "element", anim: e.animation!.type });
      }
      k++;
    }
    step = groupStart + span - 1;
  }
  return { steps, count: step };
}

function paragraphBlocks(e: Element): number {
  if (e.type === "text" || e.type === "title" || e.type === "quote")
    return e.text.paragraphs.length;
  if (e.type === "timeline") return e.items.length;
  return 0;
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

export interface RenderSlideOptions {
  /** Extra classes for the <section>. */
  className?: string;
}

export function renderSlide(
  slide: Slide,
  ctx: RenderContext,
  opts: RenderSlideOptions = {},
): string {
  const { steps, count } = computeSteps(slide);
  const tone = slideTone(slide, ctx.theme);
  const bySlot = new Map<string, Element[]>();
  for (const e of slide.elements) {
    if (e.slot === OVERFLOW_SLOT) continue;
    const list = bySlot.get(e.slot) ?? [];
    list.push(e);
    bySlot.set(e.slot, list);
  }

  const renderRegion = (r: Region): string => {
    if (typeof r === "string") {
      const els = bySlot.get(r);
      if (!els?.length) return "";
      const inner = els.map((e) => renderElement(e, ctx, steps.get(e.id))).join("");
      return `<div class="slot slot-${r}" data-slot="${r}"${statSizing(els)}>${inner}</div>`;
    }
    const inner = r.children.map(renderRegion).join("");
    return inner ? `<div class="region ${r.cls}">${inner}</div>` : "";
  };

  const filled = LAYOUTS[slide.layout].slots
    .filter((s) => bySlot.get(s.name)?.length)
    .map((s) => `has-${s.name}`);
  const classes = [
    "slide",
    `layout-${slide.layout}`,
    slide.variant ? `variant-${slide.variant}` : "",
    `tone-${tone}`,
    ...filled,
    opts.className ?? "",
  ].filter(Boolean);

  return (
    `<section class="${classes.join(" ")}" data-slide-id="${esc(slide.id)}" data-steps="${count}">` +
    renderBackground(slide, ctx) +
    `<div class="slide-body">${TEMPLATES[slide.layout].map(renderRegion).join("")}</div>` +
    (bySlot.get("logo")?.length ? "" : renderBrandLogo(ctx, tone)) +
    `</section>`
  );
}

/** Stats sharing a slot use one font size, sized for the longest value (see .stat-value). */
function statSizing(els: Element[]): string {
  const stats = els.filter((e): e is Extract<Element, { type: "stat" }> => e.type === "stat");
  if (!stats.length) return "";
  const chars = Math.max(4, ...stats.map((s) => [...s.value].length + (s.trend ? 1.5 : 0)));
  return ` style="--chars:${chars}"`;
}

function renderBrandLogo(ctx: RenderContext, tone: "base" | "inverse"): string {
  const logo = ctx.logo;
  if (!logo) return "";
  const ref = tone === "inverse" && logo.assetOnDark ? logo.assetOnDark : logo.asset;
  const src = safeImageSrc(ctx.resolveAsset(ref));
  if (!src) return "";
  const cls = `brand-logo pos-${logo.position ?? "bottom-right"} size-${logo.size ?? "m"}`;
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(logo.alt ?? "")}" draggable="false">`;
}

function renderBackground(slide: Slide, ctx: RenderContext): string {
  const bg = effectiveBackground(slide, ctx.theme);
  if (!bg) return "";
  if (bg.type === "color")
    return `<div class="slide-bg" style="background:${cssColor(bg.color)}"></div>`;
  if (bg.type === "gradient") {
    return `<div class="slide-bg" style="background:linear-gradient(${bg.angle ?? 135}deg, ${cssColor(bg.from)}, ${cssColor(bg.to)})"></div>`;
  }
  const src = safeImageSrc(ctx.resolveAsset(bg.asset));
  const pos = bg.focal
    ? `${(bg.focal.x * 100).toFixed(1)}% ${(bg.focal.y * 100).toFixed(1)}%`
    : "50% 50%";
  return (
    `<div class="slide-bg">` +
    `<img src="${esc(src)}" alt="" class="${bg.kenBurns ? "kb" : ""}" style="object-position:${pos};transform-origin:${pos}">` +
    `<div class="overlay" style="opacity:${bg.overlay ?? 0.45}"></div></div>`
  );
}

function elAttrs(
  e: Element,
  cls: string,
  step: StepInfo | undefined,
  fit = false,
  style = "",
): string {
  const stepAttrs =
    step?.mode === "element" ? ` data-step="${step.start}" data-anim="${esc(step.anim)}"` : "";
  const styleAttr = style ? ` style="${style}"` : "";
  return `class="el el-${e.type}${cls ? ` ${cls}` : ""}" data-el-id="${esc(e.id)}"${fit ? " data-fit" : ""}${stepAttrs}${styleAttr}`;
}

function paragraphSteps(step: StepInfo | undefined) {
  return step?.mode === "paragraph" ? { start: step.start, anim: step.anim } : undefined;
}

export function renderElement(e: Element, ctx: RenderContext, step?: StepInfo): string {
  switch (e.type) {
    case "title": {
      const steps = paragraphSteps(step);
      return `<div ${elAttrs(e, "", step, true)}>${richTextToHtml(e.text, { field: "text", ...(steps ? { steps } : {}) })}</div>`;
    }
    case "text": {
      const steps = paragraphSteps(step);
      return `<div ${elAttrs(e, "", step, true)}>${richTextToHtml(e.text, { field: "text", ...(steps ? { steps } : {}) })}</div>`;
    }
    case "image": {
      const src = safeImageSrc(ctx.resolveAsset(e.asset));
      const pos = e.focal
        ? `${(e.focal.x * 100).toFixed(1)}% ${(e.focal.y * 100).toFixed(1)}%`
        : "50% 50%";
      // A crop rectangle is mapped onto the frame (the editor locks it to the frame's aspect).
      const style = e.crop
        ? `width:${pct(1 / e.crop.w)};height:${pct(1 / e.crop.h)};left:${pct(-e.crop.x / e.crop.w)};top:${pct(-e.crop.y / e.crop.h)}`
        : `object-position:${pos};transform-origin:${pos}`;
      const cls = [e.kenBurns ? "kb" : "", e.crop ? "cropped" : ""].filter(Boolean).join(" ");
      const caption =
        e.caption && !isEmptyRichText(e.caption)
          ? richTextToHtml(e.caption, { field: "caption", tag: "figcaption" })
          : "";
      return (
        `<figure ${elAttrs(e, `fit-${e.fit ?? "cover"}`, step)}>` +
        `<div class="img-wrap"><img src="${esc(src)}" alt="${esc(e.alt)}" class="${cls}" style="${style}" draggable="false"></div>` +
        caption +
        `</figure>`
      );
    }
    case "icon": {
      const style = e.color ? `color:${cssColor(e.color)}` : "";
      return `<div ${elAttrs(e, `size-${e.size ?? "md"}`, step, false, style)}>${iconSvg(e.name, ctx.icons)}</div>`;
    }
    case "chart": {
      const title = e.title ? `<div class="chart-title">${esc(e.title)}</div>` : "";
      return `<div ${elAttrs(e, "", step)}>${title}${chartSvg(e, ctx.lang)}</div>`;
    }
    case "table": {
      const head = e.header
        .map((c, i) => `<th>${richTextToHtml(c, { field: `header.${i}` })}</th>`)
        .join("");
      const cols = e.header.length;
      const rows = e.rows
        .map(
          (row, r) =>
            `<tr>${Array.from({ length: cols }, (_, i) => {
              const cell = row[i];
              return `<td>${cell ? richTextToHtml(cell, { field: `rows.${r}.${i}` }) : ""}</td>`;
            }).join("")}</tr>`,
        )
        .join("");
      return (
        `<div ${elAttrs(e, e.highlightFirstColumn ? "first-col" : "", step, true)}>` +
        `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
      );
    }
    case "quote": {
      const steps = paragraphSteps(step);
      const footer =
        e.author || e.role
          ? `<footer>${e.author ? `<span class="q-author">${esc(e.author)}</span>` : ""}${e.role ? `<span class="q-role">${esc(e.role)}</span>` : ""}</footer>`
          : "";
      return (
        `<blockquote ${elAttrs(e, "", step, true)}><div class="q-mark" aria-hidden="true">“</div>` +
        richTextToHtml(e.text, { field: "text", ...(steps ? { steps } : {}) }) +
        footer +
        `</blockquote>`
      );
    }
    case "stat": {
      const icon = e.icon ? `<div class="stat-icon">${iconSvg(e.icon, ctx.icons)}</div>` : "";
      const trend = e.trend
        ? `<span class="stat-trend trend-${e.trend}">${iconSvg(TREND_ICONS[e.trend], ctx.icons)}</span>`
        : "";
      return (
        `<div ${elAttrs(e, "", step)}>${icon}` +
        `<div class="stat-value">${esc(e.value)}${trend}</div>` +
        richTextToHtml(e.label, { field: "label", className: "stat-label" }) +
        `</div>`
      );
    }
    case "timeline": {
      const paraStep = step?.mode === "paragraph" ? step : undefined;
      const items = e.items
        .map((it, i) => {
          const s = paraStep
            ? ` data-step="${paraStep.start + i}" data-anim="${esc(paraStep.anim)}"`
            : "";
          const text =
            it.text && !isEmptyRichText(it.text)
              ? richTextToHtml(it.text, { field: `items.${i}.text`, className: "tl-text" })
              : "";
          return `<li class="tl-item"${s}><div class="tl-dot"></div><div class="tl-date">${esc(it.date)}</div><div class="tl-title">${esc(it.title)}</div>${text}</li>`;
        })
        .join("");
      return `<div ${elAttrs(e, `n-${e.items.length}`, step)}><ol class="tl">${items}</ol></div>`;
    }
  }
}

function pct(v: number): string {
  return `${(v * 100).toFixed(3)}%`;
}

/** Canvas size in CSS px. */
export function canvasSize(aspect: Presentation["meta"]["aspectRatio"]): {
  width: number;
  height: number;
} {
  return aspect === "4:3" ? { width: 1440, height: 1080 } : { width: 1920, height: 1080 };
}

/** Renders every visible slide. */
export function renderDeck(p: Presentation, ctx: RenderContext): string {
  return p.slides
    .filter((s) => !s.hidden)
    .map((s) => renderSlide(s, ctx))
    .join("");
}
