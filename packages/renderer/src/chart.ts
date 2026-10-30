import type { ElementOf } from "@apresenta/core/browser";
import { esc } from "./escape.js";
import { cssColor } from "./richtext-html.js";

type Chart = ElementOf<"chart">;

const W = 1000;
const H = 560;

function seriesColor(chart: Chart, i: number): string {
  const c = chart.series[i]?.color;
  return c ? cssColor(c) : `var(--c-chart${(i % 6) + 1})`;
}

function sliceColor(i: number): string {
  return `var(--c-chart${(i % 6) + 1})`;
}

function formatter(lang: string, unit: string | undefined) {
  const nf = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 });
  return (v: number) => `${nf.format(v)}${unit ?? ""}`;
}

/** "Nice" axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    max = min === 0 ? 1 : min + Math.abs(min);
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function legend(chart: Chart, x: number, y: number): string {
  if (chart.series.length < 2) return "";
  let cx = x;
  let out = "";
  chart.series.forEach((s, i) => {
    out += `<rect x="${cx}" y="${y - 14}" width="18" height="18" rx="4" style="fill:${seriesColor(chart, i)}"/>`;
    out += `<text x="${cx + 26}" y="${y}" class="c-legend">${esc(s.name)}</text>`;
    cx += 26 + s.name.length * 12 + 36;
  });
  return out;
}

export function chartSvg(chart: Chart, lang: string): string {
  const body =
    chart.kind === "pie" || chart.kind === "donut" ? pieChart(chart, lang) : axisChart(chart, lang);
  const label = chart.title ?? chart.series.map((s) => s.name).join(", ");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(label)}">${body}</svg>`;
}

function axisChart(chart: Chart, lang: string): string {
  const fmt = formatter(lang, chart.unit);
  const values = chart.series.flatMap((s) => s.values.slice(0, chart.labels.length));
  // Bars need a zero baseline; lines read better zoomed to their range.
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const ticks =
    chart.kind === "bar" || lo <= 0
      ? niceTicks(Math.min(0, lo), Math.max(0, hi))
      : niceTicks(lo - (hi - lo) * 0.15, hi + (hi - lo) * 0.1);
  const tMin = ticks[0]!;
  const tMax = ticks[ticks.length - 1]!;
  const hasLegend = chart.series.length > 1;
  const top = hasLegend ? 64 : 24;
  const left = 92;
  const right = 16;
  const bottom = 56;
  const pw = W - left - right;
  const ph = H - top - bottom;
  const y = (v: number) => top + ph - ((v - tMin) / (tMax - tMin)) * ph;
  const band = pw / chart.labels.length;

  let out = legend(chart, left, 28);
  for (const t of ticks) {
    const ty = y(t);
    out += `<line x1="${left}" x2="${W - right}" y1="${ty}" y2="${ty}" class="c-grid${t === 0 ? " c-zero" : ""}"/>`;
    out += `<text x="${left - 14}" y="${ty + 8}" text-anchor="end" class="c-tick">${esc(fmt(t))}</text>`;
  }
  chart.labels.forEach((l, i) => {
    out += `<text x="${left + band * i + band / 2}" y="${H - bottom + 40}" text-anchor="middle" class="c-label">${esc(l)}</text>`;
  });

  if (chart.kind === "bar") {
    const n = chart.series.length;
    const groupW = band * 0.72;
    const barW = groupW / n;
    chart.series.forEach((s, si) => {
      s.values.slice(0, chart.labels.length).forEach((v, i) => {
        const x = left + band * i + (band - groupW) / 2 + barW * si;
        const y0 = y(0);
        const y1 = y(v);
        const h = Math.max(Math.abs(y0 - y1), 1);
        const ry = Math.min(y0, y1);
        out += `<rect x="${x + barW * 0.06}" y="${ry}" width="${barW * 0.88}" height="${h}" rx="4" style="fill:${seriesColor(chart, si)}"/>`;
        if (chart.showValues) {
          const ly = v >= 0 ? ry - 10 : ry + h + 26;
          out += `<text x="${x + barW / 2}" y="${ly}" text-anchor="middle" class="c-value">${esc(fmt(v))}</text>`;
        }
      });
    });
  } else {
    chart.series.forEach((s, si) => {
      const pts = s.values
        .slice(0, chart.labels.length)
        .map((v, i) => [left + band * i + band / 2, y(v)] as const);
      const color = seriesColor(chart, si);
      out += `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" style="stroke:${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
      pts.forEach(([px, py], i) => {
        out += `<circle cx="${px}" cy="${py}" r="8" style="fill:${color}" class="c-point"/>`;
        if (chart.showValues) {
          // Alternate series label above/below the point so two close lines stay readable.
          const ly = si % 2 === 0 ? py - 20 : py + 38;
          out += `<text x="${px}" y="${ly}" text-anchor="middle" class="c-value">${esc(fmt(s.values[i]!))}</text>`;
        }
      });
    });
  }
  return out;
}

function pieChart(chart: Chart, lang: string): string {
  const fmt = formatter(lang, chart.unit);
  const values = (chart.series[0]?.values ?? [])
    .slice(0, chart.labels.length)
    .map((v) => Math.max(0, v));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = 280;
  const cy = H / 2;
  const r = 240;
  const inner = chart.kind === "donut" ? r * 0.58 : 0;
  let angle = -Math.PI / 2;
  let out = "";
  values.forEach((v, i) => {
    const sweep = (v / total) * Math.PI * 2;
    if (sweep <= 0) return;
    out += slicePath(cx, cy, r, inner, angle, angle + sweep, sliceColor(i));
    angle += sweep;
  });
  const pct = new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 0 });
  const rowH = Math.min(64, (H - 40) / Math.max(values.length, 1));
  const startY = cy - (rowH * values.length) / 2 + rowH / 2;
  values.forEach((v, i) => {
    const ly = startY + i * rowH;
    out += `<rect x="600" y="${ly - 14}" width="24" height="24" rx="6" style="fill:${sliceColor(i)}"/>`;
    out += `<text x="640" y="${ly + 6}" class="c-legend">${esc(chart.labels[i] ?? "")}</text>`;
    const label = chart.unit ? fmt(v) : pct.format(v / total);
    out += `<text x="${W - 8}" y="${ly + 6}" text-anchor="end" class="c-value c-strong">${esc(label)}</text>`;
  });
  return out;
}

function slicePath(
  cx: number,
  cy: number,
  r: number,
  ri: number,
  a0: number,
  a1: number,
  color: string,
): string {
  const full = a1 - a0 >= Math.PI * 2 - 1e-6;
  if (full) {
    const ring = ri > 0 ? `<circle cx="${cx}" cy="${cy}" r="${ri}" class="c-hole"/>` : "";
    return `<circle cx="${cx}" cy="${cy}" r="${r}" style="fill:${color}"/>${ring}`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad: number, a: number) =>
    `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
  const d =
    ri > 0
      ? `M ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, a1)} L ${p(ri, a1)} A ${ri} ${ri} 0 ${large} 0 ${p(ri, a0)} Z`
      : `M ${cx} ${cy} L ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, a1)} Z`;
  return `<path d="${d}" style="fill:${color}" class="c-slice"/>`;
}
