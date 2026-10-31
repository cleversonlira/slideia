import { FONT_IDS, LAYOUTS, THEMES, TRANSITION_TYPES } from "@slideia/core";

/** Design rules shared by get_guide, the MCP prompt and the design-guide resource. */
export const DESIGN_RULES = `## Design rules
- One slide = one idea. Title states the takeaway ("Revenue grew 18%"), not a topic ("Revenue").
- Lists: at most ~6 items, short phrases (≤ 10 words). Prefer 3–5.
- Vary layouts: alternate title-content with two-columns, stats, image-text, quote, chart, timeline, comparison. Avoid 3 equal layouts in a row.
- Start with "cover", use "section" to open parts of long talks, end with "closing".
- Use real numbers with "stats" (2–4 KPIs) and charts for trends; keep tables ≤ 7×5.
- One consistent defaultTransition (fade, push or slide). Use special transitions (zoom, cube3d, flip3d, dissolve) only on 1–2 key moments.
- Reveal list items step by step with animation {"type":"rise","by":"paragraph"} only where suspense helps.
- Always write speaker notes: what to say on the slide, 2–4 sentences.
- Write in the audience's language (meta.lang). Brazilian Portuguese by default.`;

/** How to reproduce the look of a deck the user already has (pptx, pdf, template). */
export const MATCH_EXISTING = `## Matching an existing deck (pptx, potx, pdf, Google Slides export)
When the user asks to follow the look of a file they attached, extract its identity first (run code if you can) and map it; do not just pick a theme by eye.
1. Colors: in a .pptx/.potx read ppt/theme/theme1.xml <a:clrScheme>: accent1 → "accent", accent2 → "accent2"; the dark color used on title/section slides (often dk2 or the cover background) → "cover". Pick the base theme whose light/dark matches the body slides.
2. Fonts: <a:majorFont>/<a:minorFont> (heading/body). Available ids: ${FONT_IDS.join(", ")}. Use the same family if listed, otherwise the closest: Calibri/Arial/Helvetica/Segoe UI → inter or source-sans-3; Aptos → dm-sans; Gotham/Proxima Nova → montserrat; Futura/Century Gothic → poppins; Georgia/Cambria/Times → source-serif-4 or lora; Garamond/Didot/Bodoni → playfair-display.
3. Logo: take it from ppt/media (the image repeated on most slides or on the master). Send it with add_image as a data URI (PNG/WebP; convert EMF/WMF/SVG to PNG first) and use the "asset:<id>" in themeOverrides.logo; match its corner. If you cannot extract it, ask the user to upload it in the editor (Apresentação → Marca).
4. Structure: map every source slide to the closest layout (title slide → cover, divider → section, bullets → title-content, side-by-side → two-columns/comparison, picture + text → image-text, KPIs → stats, dates → timeline, graphs → chart with the real numbers, grids → table). Keep the order, texts and speaker notes; split overcrowded slides.
5. Tell the user what could not be reproduced: free positioning, decorative shapes, bars and footers drawn in the master, fonts replaced by a similar one. Layouts use slots, never x/y coordinates; a full-bleed picture can become an image background.`;

const MARKDOWN = `## Text fields (Markdown)
Every text field accepts Markdown: **bold**, *italic*, ~~strike~~, ++underline++, ==highlight==, [link](https://…), [text]{color=accent} (tokens: text muted accent accent2 highlight success danger, or #hex), ^sup^, ~sub~.
One line = one paragraph. Lists: "- item" or "1. item", indent 2 spaces per level (max 3). "# " makes a paragraph display-size, "## " large. Paragraph options at line end: "Text {align=center size=large}".`;

function layoutsTable(): string {
  return Object.values(LAYOUTS)
    .map((l) => {
      const slots = l.slots
        .map(
          (s) =>
            `${s.name}${s.required ? "*" : ""}:${s.accepts.join("|")}${(s.max ?? 1) > 1 ? `×${s.max}` : ""}`,
        )
        .join(", ");
      const variants = l.variants ? ` variants: ${l.variants.join("/")}.` : "";
      return `- ${l.id} — ${l.description}${variants} Slots: ${slots}`;
    })
    .join("\n");
}

function themesList(): string {
  return Object.values(THEMES)
    .map((t) => `${t.id} (${t.dark ? "dark" : "light"}: ${t.description})`)
    .join("; ");
}

export function buildGuide(): string {
  return `# Presentation guide

## Workflow
1. If the user asked you to go ahead, create the deck right away. Otherwise propose a short outline (titles + one line per slide) and, once approved, create it with these tools — never leave the presentation as text in the chat.
2. Call create_presentation once with the whole deck (8–15 slides is typical). Do not send HTML.
3. Call preview to check the result visually and fix problems with apply_edits (batch all edits in ONE call).
4. Give the user the editor link (they can edit texts by hand) and the download link.
5. Before editing later, call get_presentation (or get_changes) to see manual edits; never overwrite them.

## Presentation JSON
{ "meta": { "title", "author"?, "lang" (default "pt-BR"), "aspectRatio" ("16:9"|"4:3"), "theme", "themeOverrides"? {…}, "defaultTransition" {type, direction?, durationMs?} },
  "slides": [ { "layout", "variant"?, "elements": [ … ], "background"?, "transition"?, "notes"? } ] }
Company brand (when the user gives colors or a logo): pick the closest theme, then "themeOverrides": { "accent": "#main", "accent2"?: "#secondary", "cover"?: "#dark brand color for cover/section/closing backgrounds", "fontHeading"?, "fontBody"?, "logo"?: { "asset": "https://…/logo.png" (transparent PNG/WebP; SVG is not accepted), "assetOnDark"?: white variant for dark slides, "alt", "position"? bottom-right|bottom-left|top-right|top-left, "size"? s|m|l } }. The logo appears on every slide inside the margin; do not also add it as an image element (except a bigger one on the cover, in the "logo" slot).
To copy the look of a file the user has, see "Matching an existing deck" below.
Ids are optional when creating. "slot" is optional when the element type fits only one free slot (elements fill slots in order).

## Elements (field "type")
- title {text}
- text {text} — paragraphs and/or lists
- image {asset, alt, fit? cover|contain, focal? {x,y 0–1}, kenBurns?, caption?} — asset: "https://…" (downloaded by the server), a data URI, or "asset:<id>" from add_image
- icon {name (Lucide, kebab-case: rocket, users, shield-check, chart-line…), color?, size? sm|md|lg}
- chart {kind bar|line|pie|donut, labels[], series[{name, values[], color?}], unit?, showValues?, title?}
- table {header[], rows[][], highlightFirstColumn?} — cells are text
- quote {text, author?, role?}
- stat {value (short: "87%", "R$ 2,4 mi"), label, icon?, trend? up|down}
- timeline {items[{date, title, text?}]} (3–7 items)
All elements accept animation {type fade|rise|zoom|wipe, order?, by? element|paragraph}.

## Layouts (* = required slot; ×N = up to N elements)
${layoutsTable()}

## Themes
${themesList()}

## Backgrounds and transitions
background: {type:"color", color} | {type:"gradient", from, to, angle?} | {type:"image", asset, overlay? 0–0.9, kenBurns?}. cover/section/closing already get a theme background.
Transitions: ${TRANSITION_TYPES.join(", ")}; direction left|right|up|down; durationMs 150–2000.

${MARKDOWN}

${DESIGN_RULES}

${MATCH_EXISTING}

## Editing (apply_edits)
Send several operations in one call with the expectedVersion you last saw. Slides can be referenced by id or 1-based number (numbers refer to the state before the batch). Operations:
update_text{slide,element,text} · update_element{slide,element,patch} · add_element{slide,element,before?} · remove_element{slide,element} · reorder_elements{slide,order[]} · update_slide{slide,patch{layout?,variant?,background?,transition?,notes?,hidden?}} · add_slide{slide,after?} · remove_slide{slide} · duplicate_slide{slide,after?} · replace_slide{slide,with} · move_slide{slide,after} · reorder_slides{order[]} · update_presentation{patch{title?,theme?,aspectRatio?,defaultTransition?,themeOverrides?,…}} · find_replace{find,replace,matchCase?,wholeWord?,slides?} · set_image{slide,element,asset,alt?}
If the version changed because the user edited in the editor, non-overlapping edits are merged automatically; otherwise you get a conflict: call get_presentation and redo the edit.

## Minimal example
{"meta":{"title":"Plano 2027","theme":"executivo"},"slides":[
 {"layout":"cover","elements":[{"type":"title","text":"Plano 2027"},{"type":"text","text":"Diretoria · Janeiro"}],"notes":"Boas-vindas."},
 {"layout":"stats","elements":[{"type":"title","text":"2026 em números"},{"type":"stat","value":"+18%","label":"receita"},{"type":"stat","value":"312","label":"novos clientes"}],"notes":"Os dois números que importam."},
 {"layout":"closing","elements":[{"type":"title","text":"Obrigado!"}]}]}
`;
}
