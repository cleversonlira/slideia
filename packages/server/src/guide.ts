import { LAYOUTS, THEMES, TRANSITION_TYPES } from "@slideia/core";

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
1. Agree on a short outline with the user first (titles + one line per slide) unless they asked you to go ahead.
2. Call create_presentation once with the whole deck (8–15 slides is typical). Do not send HTML.
3. Call preview to check the result visually and fix problems with apply_edits (batch all edits in ONE call).
4. Give the user the editor link (they can edit texts by hand) and the download link.
5. Before editing later, call get_presentation (or get_changes) to see manual edits; never overwrite them.

## Presentation JSON
{ "meta": { "title", "author"?, "lang" (default "pt-BR"), "aspectRatio" ("16:9"|"4:3"), "theme", "themeOverrides"? {accent:"#hex"}, "defaultTransition" {type, direction?, durationMs?} },
  "slides": [ { "layout", "variant"?, "elements": [ … ], "background"?, "transition"?, "notes"? } ] }
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
