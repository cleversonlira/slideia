import type { Presentation, Theme } from "@apresenta/core/browser";
import { fontStack } from "./fonts.js";
import { canvasSize } from "./render.js";

/** CSS custom properties of a theme, scoped to `.deck`. */
export function themeVars(theme: Theme, aspect: Presentation["meta"]["aspectRatio"]): string {
  const c = theme.colors;
  const { width, height } = canvasSize(aspect);
  const vars: Record<string, string | number> = {
    "--W": `${width}px`,
    "--H": `${height}px`,
    "--c-bg": c.bg,
    "--c-surface": c.surface,
    "--c-text": c.text,
    "--c-muted": c.muted,
    "--c-accent": c.accent,
    "--c-accent2": c.accent2,
    "--c-highlight": c.highlight,
    "--c-success": c.success,
    "--c-danger": c.danger,
    "--c-border": c.border,
    "--c-on-accent": c.onAccent,
    "--c-inverse-bg": c.inverseBg,
    "--c-inverse-surface": c.inverseSurface,
    "--c-inverse-text": c.inverseText,
    "--c-inverse-muted": c.inverseMuted,
    "--c-inverse-accent": c.inverseAccent,
    "--c-inverse-highlight": c.inverseHighlight,
    "--f-heading": fontStack(theme.fonts.heading),
    "--f-body": fontStack(theme.fonts.body),
    "--fw-heading": theme.fonts.headingWeight,
    "--tt-heading": theme.fonts.headingTransform,
    "--ls-heading": theme.fonts.headingLetterSpacing,
    "--fs-display": `${theme.scale.display}px`,
    "--fs-title": `${theme.scale.title}px`,
    "--fs-subtitle": `${theme.scale.subtitle}px`,
    "--fs-body": `${theme.scale.body}px`,
    "--fs-small": `${theme.scale.small}px`,
    "--radius": `${theme.radius}px`,
    "--pad": `${theme.pad}px`,
  };
  theme.colors.chart.forEach((col, i) => {
    vars[`--c-chart${i + 1}`] = col;
  });
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return `.deck{${body}}`;
}

/** Slide styles: base, rich text, elements and layouts. Independent of the theme values. */
export const SLIDE_CSS = String.raw`
.deck .slide{position:absolute;left:0;top:0;width:var(--W);height:var(--H);overflow:hidden;background:var(--c-bg);color:var(--c-text);font-family:var(--f-body);font-size:var(--fs-body);line-height:1.38;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-kerning:normal;contain:layout paint}
.deck .slide *,.deck .slide *::before,.deck .slide *::after{box-sizing:border-box}
.deck .slide.tone-inverse{--c-bg:var(--c-inverse-bg);--c-surface:var(--c-inverse-surface);--c-text:var(--c-inverse-text);--c-muted:var(--c-inverse-muted);--c-accent:var(--c-inverse-accent);--c-highlight:var(--c-inverse-highlight);--c-border:color-mix(in srgb,var(--c-inverse-text) 18%,transparent);--c-on-accent:var(--c-inverse-bg)}
.deck .slide-bg{position:absolute;inset:0;z-index:0;overflow:hidden}
.deck .slide-bg img{width:100%;height:100%;object-fit:cover;display:block}
.deck .slide-bg .overlay{position:absolute;inset:0;background:#000}
.deck .slide-body{position:relative;z-index:1;width:100%;height:100%;padding:var(--pad);display:flex;flex-direction:column;gap:calc(var(--pad)*.42)}
.deck .region{display:flex;min-width:0;min-height:0;gap:calc(var(--pad)*.42)}
.deck .slot{display:flex;flex-direction:column;min-width:0;min-height:0;gap:calc(var(--pad)*.28)}
.deck .el{--fit:1;min-width:0;min-height:0;flex:0 1 auto;overflow:hidden;position:relative}
.deck .el.is-overflowing{outline:3px dashed var(--c-danger);outline-offset:6px}

.deck .rt{overflow-wrap:break-word;hyphens:manual}
.deck .rt p{margin:0}
.deck .rt p+p,.deck .rt ul+p,.deck .rt ol+p,.deck .rt p+ul,.deck .rt p+ol{margin-top:.5em}
.deck .rt p:empty::before{content:"\200b"}
.deck .rt ul,.deck .rt ol{margin:0;padding-left:1.25em}
.deck .rt li{margin:.32em 0;padding-left:.2em}
.deck .rt li>p+p{margin-top:.2em}
.deck .rt li::marker{color:var(--c-accent);font-weight:700}
.deck .rt ul ul,.deck .rt ol ul,.deck .rt ul ol,.deck .rt ol ol{font-size:.86em;margin-top:.2em}
.deck .rt ul ul li::marker{content:"– "}
.deck .rt .a-left{text-align:left}.deck .rt .a-center{text-align:center}.deck .rt .a-right{text-align:right}.deck .rt .a-justify{text-align:justify}
.deck .rt .s-small{font-size:.78em}.deck .rt .s-large{font-size:1.3em;line-height:1.22}.deck .rt .s-display{font-size:1.85em;line-height:1.08;font-family:var(--f-heading);font-weight:var(--fw-heading);letter-spacing:var(--ls-heading)}
.deck .rt strong{font-weight:700}
.deck .rt a{color:var(--c-accent);text-decoration:underline;text-decoration-thickness:.07em;text-underline-offset:.14em}
.deck .rt mark{color:inherit;padding:0 .14em;border-radius:.18em;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.deck .rt sup,.deck .rt sub{font-size:.62em;line-height:0}

.deck .el-title{font-family:var(--f-heading);font-weight:var(--fw-heading);letter-spacing:var(--ls-heading);text-transform:var(--tt-heading);font-size:calc(var(--fs-title)*var(--fit));line-height:1.12;flex:none;max-height:calc(var(--fs-title)*1.12*3 + 40px);text-wrap:balance}
.deck .el-title .rt strong{color:var(--c-accent)}
.deck .el-text{font-size:calc(var(--fs-body)*var(--fit))}
.deck .el-text .rt{text-wrap:pretty}

.deck .el-image{margin:0;display:flex;flex-direction:column;gap:14px;flex:1 1 auto;min-height:120px}
.deck .el-image .img-wrap{flex:1 1 auto;min-height:0;overflow:hidden;border-radius:var(--radius);position:relative}
.deck .el-image img{width:100%;height:100%;display:block;object-fit:cover;user-select:none}
.deck .el-image.fit-contain img{object-fit:contain}
.deck .el-image img.cropped{position:absolute;max-width:none;object-fit:fill}
.deck .el-image figcaption{font-size:var(--fs-small);color:var(--c-muted);flex:none}

.deck .el-icon{color:var(--c-accent);display:flex;flex:none;overflow:visible}
.deck .el-icon .icon{width:96px;height:96px}
.deck .el-icon.size-sm .icon{width:56px;height:56px}
.deck .el-icon.size-lg .icon{width:180px;height:180px;stroke-width:1.5}

.deck .el-chart{flex:1 1 auto;display:flex;flex-direction:column;min-height:240px}
.deck .el-chart .chart-title{font-size:var(--fs-small);color:var(--c-muted);font-weight:700;margin-bottom:8px}
.deck .el-chart .chart{flex:1 1 auto;width:100%;height:100%;min-height:0;overflow:visible}
.deck .chart text{font-family:var(--f-body);fill:var(--c-muted);font-size:22px}
.deck .chart .c-label{font-size:24px;fill:var(--c-text)}
.deck .chart .c-legend{font-size:24px;fill:var(--c-text)}
.deck .chart .c-value{font-size:22px;font-weight:700;fill:var(--c-text)}
.deck .chart .c-strong{font-size:28px}
.deck .chart .c-grid{stroke:var(--c-border);stroke-width:1.5}
.deck .chart .c-zero{stroke:var(--c-muted);stroke-width:2}
.deck .chart .c-point{stroke:var(--c-bg);stroke-width:4}
.deck .chart .c-slice{stroke:var(--c-bg);stroke-width:4}
.deck .chart .c-hole{fill:var(--c-bg)}

.deck .el-table{font-size:calc(30px*var(--fit));flex:0 1 auto}
.deck .el-table table{width:100%;border-collapse:separate;border-spacing:0;line-height:1.3}
.deck .el-table th{background:var(--c-accent);color:var(--c-on-accent);font-weight:700;text-align:left;padding:.6em .9em}
.deck .el-table th:first-child{border-top-left-radius:var(--radius)}
.deck .el-table th:last-child{border-top-right-radius:var(--radius)}
.deck .el-table td{padding:.55em .9em;border-bottom:2px solid var(--c-border);vertical-align:top}
.deck .el-table tbody tr:nth-child(even) td{background:var(--c-surface)}
.deck .el-table.first-col td:first-child{font-weight:700}
.deck .el-table .rt li{margin:.1em 0}

.deck .el-quote{margin:0;display:flex;flex-direction:column;gap:28px}
.deck .el-quote .q-mark{font-family:var(--f-heading);font-size:200px;line-height:.7;height:100px;color:var(--c-accent);font-weight:700}
.deck .el-quote .rt{font-family:var(--f-heading);font-size:calc(56px*var(--fit));line-height:1.22;font-weight:500;letter-spacing:var(--ls-heading);text-wrap:balance}
.deck .el-quote footer{display:flex;flex-direction:column;gap:6px;font-size:var(--fs-small)}
.deck .el-quote footer::before{content:"";width:64px;height:5px;border-radius:3px;background:var(--c-accent);margin-bottom:14px}
.deck .el-quote .q-author{font-weight:700;font-size:30px}
.deck .el-quote .q-role{color:var(--c-muted)}

.deck .el-stat{display:flex;flex-direction:column;gap:14px;padding:48px 44px;background:var(--c-surface);border-radius:calc(var(--radius)*1.5);flex:1 1 0;justify-content:center;overflow:visible;container-type:inline-size}
.deck .el-stat .stat-icon{color:var(--c-accent)}
.deck .el-stat .stat-icon .icon{width:56px;height:56px}
.deck .el-stat .stat-value{font-family:var(--f-heading);font-weight:var(--fw-heading);font-size:min(96px,calc(100cqi / (var(--chars,4) * .62)));line-height:1;color:var(--c-accent);letter-spacing:-.02em;display:flex;align-items:center;gap:16px;white-space:nowrap}
.deck .el-stat .stat-trend{display:flex}
.deck .el-stat .stat-trend .icon{width:.55em;height:.55em;stroke-width:2.5}
.deck .el-stat .stat-label{font-size:30px;color:var(--c-muted);line-height:1.3}

.deck .el-timeline{flex:1 1 auto;display:flex;align-items:center;overflow:visible}
.deck .el-timeline .tl{list-style:none;margin:0;padding:0;display:flex;width:100%;position:relative}
.deck .el-timeline .tl::before{content:"";position:absolute;left:0;right:0;top:15px;height:6px;border-radius:3px;background:var(--c-border)}
.deck .el-timeline .tl-item{flex:1 1 0;position:relative;padding-right:32px;display:flex;flex-direction:column;gap:10px}
.deck .el-timeline .tl-dot{width:36px;height:36px;border-radius:50%;background:var(--c-accent);border:8px solid var(--c-bg);box-shadow:0 0 0 3px var(--c-accent);position:relative;margin-bottom:22px}
.deck .el-timeline .tl-date{font-weight:700;color:var(--c-accent);font-size:26px;text-transform:uppercase;letter-spacing:.06em}
.deck .el-timeline .tl-title{font-family:var(--f-heading);font-weight:var(--fw-heading);font-size:38px;line-height:1.15}
.deck .el-timeline .tl-text{font-size:26px;color:var(--c-muted)}
.deck .el-timeline.n-6 .tl-title,.deck .el-timeline.n-7 .tl-title,.deck .el-timeline.n-8 .tl-title{font-size:30px}

/* slot defaults */
.deck .slot-subtitle .el-text,.deck .slot-caption .el-text{font-size:calc(var(--fs-subtitle)*var(--fit));color:var(--c-muted);line-height:1.3}
.deck .slot-footnote{margin-top:auto}
.deck .slot-footnote .el-text,.deck .slot-contact .el-text{font-size:calc(var(--fs-small)*var(--fit));color:var(--c-muted)}
.deck .slot-body,.deck .slot-left,.deck .slot-right{flex:1 1 auto}

/* content titles get an accent bar */
.deck .layout-title-content .slot-title .el-title::before,.deck .layout-two-columns .slot-title .el-title::before,.deck .layout-stats .slot-title .el-title::before,.deck .layout-timeline .slot-title .el-title::before,.deck .layout-comparison .slot-title .el-title::before,.deck .layout-chart .slot-title .el-title::before,.deck .layout-table .slot-title .el-title::before,.deck .layout-image-text .slot-title .el-title::before{content:"";display:block;width:72px;height:8px;border-radius:4px;background:var(--c-accent);margin-bottom:28px}

/* cover */
.deck .layout-cover .slide-body{justify-content:center}
.deck .layout-cover .r-main{flex-direction:column;max-width:88%;gap:36px}
.deck .layout-cover .slot-title .el-title{font-size:calc(var(--fs-display)*var(--fit));line-height:1.04;max-height:calc(var(--fs-display)*1.04*3 + 10px)}
.deck .layout-cover .slot-subtitle .el-text{color:var(--c-text);opacity:.82}
.deck .layout-cover .slot-logo,.deck .layout-closing .slot-logo{position:absolute;top:var(--pad);left:var(--pad);z-index:1}
.deck .layout-closing .slot-logo{left:50%;transform:translateX(-50%)}
.deck .slot-logo .el-image{min-height:0;height:96px;width:auto}
.deck .slot-logo .el-image .img-wrap{border-radius:0}
.deck .slot-logo .el-image img{object-fit:contain;height:96px;width:auto}
.deck .slot-logo .el-icon .icon{width:84px;height:84px}
.deck .layout-cover .slot-image,.deck .layout-full-image .slot-image{position:absolute;inset:0;z-index:0}
.deck .layout-cover .slot-image .el-image,.deck .layout-full-image .slot-image .el-image{height:100%;gap:0}
.deck .layout-cover .slot-image .img-wrap,.deck .layout-full-image .slot-image .img-wrap{border-radius:0}
.deck .layout-cover .slot-image figcaption,.deck .layout-full-image .slot-image figcaption{display:none}
.deck .layout-cover .slot-image::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,rgba(0,0,0,.72) 0%,rgba(0,0,0,.45) 55%,rgba(0,0,0,.2) 100%)}
.deck .layout-cover .region,.deck .layout-full-image .region{position:relative;z-index:1}

/* section */
.deck .layout-section .slide-body{justify-content:center}
.deck .layout-section .r-main{flex-direction:column;gap:30px;max-width:82%}
.deck .layout-section .slot-number .el-text{font-family:var(--f-heading);font-weight:var(--fw-heading);font-size:180px;line-height:.9;color:var(--c-accent);letter-spacing:-.04em}
.deck .layout-section .slot-title .el-title{font-size:calc(96px*var(--fit));line-height:1.06;max-height:calc(96px*1.06*3 + 10px)}

/* two columns */
.deck .r-cols{flex:1 1 auto;gap:calc(var(--pad)*.7)}
.deck .r-cols>.slot,.deck .r-cols>.region{flex:1 1 0}
.deck .layout-two-columns .r-cols>.slot{justify-content:flex-start}
.deck .layout-two-columns .el-text .rt>p:first-child strong:only-child{color:var(--c-accent);font-family:var(--f-heading)}

/* full image */
.deck .layout-full-image .slot-image::after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.78) 0%,rgba(0,0,0,.35) 45%,rgba(0,0,0,0) 75%)}
.deck .layout-full-image .slide-body{justify-content:flex-end}
.deck .layout-full-image .r-main{flex-direction:column;gap:20px;max-width:78%}
.deck .layout-full-image .slot-title .el-title{font-size:calc(88px*var(--fit));line-height:1.06}
.deck .layout-full-image .slot-caption .el-text{color:var(--c-text);opacity:.88}

/* image + text */
.deck .layout-image-text .slide-body{flex-direction:row;padding:0;gap:0}
.deck .layout-image-text.variant-right .slide-body{flex-direction:row-reverse}
.deck .layout-image-text .slot-image{width:46%;flex:none;height:100%}
.deck .layout-image-text .slot-image .el-image{height:100%;gap:0}
.deck .layout-image-text .slot-image .img-wrap{border-radius:0}
.deck .layout-image-text .slot-image figcaption{position:absolute;left:24px;bottom:20px;right:24px;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.6)}
.deck .layout-image-text .r-main{flex:1 1 0;flex-direction:column;justify-content:center;padding:var(--pad);gap:calc(var(--pad)*.4)}
.deck .layout-image-text .slot-body{flex:0 1 auto}

/* quote */
.deck .layout-quote .slide-body{justify-content:center;align-items:center}
.deck .layout-quote .r-main{align-items:center;gap:72px;max-width:84%}
.deck .layout-quote .slot-image{flex:none}
.deck .layout-quote .slot-image .el-image{width:300px;height:300px;flex:none;min-height:0}
.deck .layout-quote .slot-image .img-wrap{border-radius:50%}
.deck .layout-quote .slot-image figcaption{display:none}

/* stats */
.deck .layout-stats .slot-stats{flex:0 0 auto;margin-block:auto;flex-direction:row;align-items:stretch;gap:40px}
.deck .layout-stats .slot-stats .el-stat{min-height:320px}
.deck .layout-stats .slot-footnote{margin-top:0}

/* timeline */
.deck .layout-timeline .slot-timeline{flex:1 1 auto;justify-content:center}

/* comparison */
.deck .r-card{flex-direction:column;background:var(--c-surface);border-radius:calc(var(--radius)*1.5);padding:52px 56px;gap:24px;border-top:10px solid var(--c-border)}
.deck .r-card-b{border-top-color:var(--c-accent)}
.deck .r-card .slot-leftTitle .el-text,.deck .r-card .slot-rightTitle .el-text{font-family:var(--f-heading);font-weight:var(--fw-heading);font-size:calc(46px*var(--fit));line-height:1.1}
.deck .r-card-b .slot-rightTitle .el-text{color:var(--c-accent)}
.deck .r-card .slot-left .el-text,.deck .r-card .slot-right .el-text{font-size:calc(34px*var(--fit))}

/* chart */
.deck .r-chart{flex:1 1 auto;gap:calc(var(--pad)*.6)}
.deck .r-chart .slot-chart{flex:2 1 0}
.deck .r-chart .slot-body{flex:1 1 0;justify-content:center}
.deck .r-chart .slot-body .el-text{font-size:calc(34px*var(--fit))}

/* comparison cards keep their natural height */
.deck .layout-comparison .r-cols{flex:0 1 auto}

/* table */
.deck .layout-table .slot-table{flex:0 1 auto}

/* closing */
.deck .layout-closing .slide-body{justify-content:center;align-items:center;text-align:center}
.deck .layout-closing .r-main{flex-direction:column;align-items:center;gap:32px;max-width:84%}
.deck .layout-closing .slot-title .el-title{font-size:calc(var(--fs-display)*var(--fit));line-height:1.04}
.deck .layout-closing .slot-body .el-text{font-size:calc(var(--fs-subtitle)*var(--fit))}
.deck .layout-closing .slot-contact .el-text{font-size:calc(30px*var(--fit))}
.deck .layout-closing.has-logo .slot-logo{top:calc(var(--pad)*.9)}


/* animations & ken burns */
.deck [data-step]:not(.revealed){opacity:0}
.deck .slide.is-active .kb{animation:kb 16s ease-out forwards}
@keyframes kb{from{transform:scale(1)}to{transform:scale(1.14)}}
@media (prefers-reduced-motion:reduce){.deck .slide.is-active .kb{animation:none}}
`;

export function deckCss(theme: Theme, aspect: Presentation["meta"]["aspectRatio"]): string {
  return themeVars(theme, aspect) + SLIDE_CSS;
}
