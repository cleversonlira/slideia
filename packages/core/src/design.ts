import { contrastRatio, isHex, mixHex } from "./color.js";
import { elementRichTexts } from "./content.js";
import { LAYOUTS, OVERFLOW_SLOT } from "./layouts.js";
import { countListItems, isEmptyRichText, plainText } from "./richtext.js";
import type { Presentation, Slide } from "./schema.js";
import {
  effectiveBackground,
  resolveColor,
  resolveTheme,
  slideTone,
  type Theme,
} from "./themes.js";

export interface DesignWarning {
  code:
    | "missing_required"
    | "too_much_text"
    | "too_many_items"
    | "hidden_overflow"
    | "layout_streak"
    | "too_many_transitions"
    | "missing_notes"
    | "missing_alt"
    | "chart_data"
    | "table_size"
    | "low_contrast"
    | "few_stats"
    | "empty_text";
  /** For the AI (English). */
  message: string;
  /** For the editor (Brazilian Portuguese). */
  pt: string;
  slideId?: string;
  slideNumber?: number;
  elementId?: string;
}

/** Static design checks (no browser needed). Messages are written for the AI. */
export function checkDesign(p: Presentation): DesignWarning[] {
  const theme = resolveTheme(p.meta);
  const out: DesignWarning[] = [];
  p.slides.forEach((slide, i) => out.push(...checkSlide(slide, i + 1, theme)));

  // Same layout three times in a row.
  let streak = 1;
  for (let i = 1; i <= p.slides.length; i++) {
    const same = i < p.slides.length && p.slides[i]!.layout === p.slides[i - 1]!.layout;
    if (same) streak++;
    else {
      if (streak >= 3) {
        const first = i - streak + 1;
        out.push({
          code: "layout_streak",
          message: `Slides ${first}–${i} all use "${p.slides[i - 1]!.layout}". Vary layouts (two-columns, stats, image-text, quote…) to keep attention.`,
          pt: `Os slides ${first}–${i} usam o mesmo layout. Varie (duas colunas, números, imagem e texto, citação…) para manter a atenção.`,
        });
      }
      streak = 1;
    }
  }

  const special = p.slides.filter(
    (s) => s.transition && s.transition.type !== p.meta.defaultTransition.type,
  ).length;
  if (special > Math.max(2, Math.round(p.slides.length * 0.2))) {
    out.push({
      code: "too_many_transitions",
      message: `${special} slides override the default transition. Keep one consistent transition and reserve special effects for 1–2 key moments.`,
      pt: `${special} slides usam transição diferente da padrão. Mantenha uma transição e reserve efeitos especiais para 1–2 momentos-chave.`,
    });
  }

  if (p.slides.length >= 4) {
    const withoutNotes = p.slides.filter((s) => isEmptyRichText(s.notes)).length;
    if (withoutNotes > p.slides.length / 2) {
      out.push({
        code: "missing_notes",
        message: `${withoutNotes} of ${p.slides.length} slides have no speaker notes. Add a short talk track to each slide.`,
        pt: `${withoutNotes} de ${p.slides.length} slides estão sem anotações do apresentador.`,
      });
    }
  }
  return out;
}

function checkSlide(slide: Slide, n: number, theme: Theme): DesignWarning[] {
  const out: DesignWarning[] = [];
  const at = { slideId: slide.id, slideNumber: n };
  const layout = LAYOUTS[slide.layout];

  for (const def of layout.slots) {
    if (def.required && !slide.elements.some((e) => e.slot === def.name)) {
      out.push({
        ...at,
        code: "missing_required",
        message: `Slide ${n} (${slide.layout}) has nothing in required slot "${def.name}" (${def.description}).`,
        pt: `O espaço obrigatório "${def.name}" está vazio.`,
      });
    }
  }

  const tone = slideTone(slide, theme);
  const bg = slideBgColor(slide, theme, tone);

  for (const el of slide.elements) {
    const where = { ...at, elementId: el.id };
    if (el.slot === OVERFLOW_SLOT) {
      out.push({
        ...where,
        code: "hidden_overflow",
        message: `Slide ${n}: ${el.type} ${el.id} is hidden because it does not fit the layout. Move it or remove it.`,
        pt: `Um elemento (${el.type}) está oculto porque não cabe no layout. Mova-o ou exclua.`,
      });
      continue;
    }
    const def = layout.slots.find((s) => s.name === el.slot);
    const texts = elementRichTexts(el);
    if (def?.capacity?.chars) {
      const chars = texts.reduce((sum, t) => sum + plainText(t.value).length, 0);
      if (chars > def.capacity.chars * 1.15) {
        out.push({
          ...where,
          code: "too_much_text",
          message: `Slide ${n}: "${el.slot}" has ${chars} characters (comfortable: ≤ ${def.capacity.chars}). Shorten it or split the slide.`,
          pt: `Texto longo (${chars} caracteres; confortável até ${def.capacity.chars}). Encurte ou divida o slide.`,
        });
      }
    }
    if (el.type === "text") {
      const items = countListItems(el.text);
      const max = def?.capacity?.items ?? 6;
      if (items > max) {
        out.push({
          ...where,
          code: "too_many_items",
          message: `Slide ${n}: list with ${items} items (max ~${max}). Keep one idea per slide.`,
          pt: `Lista com ${items} itens (recomendado até ${max}). Uma ideia por slide.`,
        });
      }
      if (isEmptyRichText(el.text)) {
        out.push({
          ...where,
          code: "empty_text",
          message: `Slide ${n}: text element ${el.id} is empty.`,
          pt: `Há um texto vazio neste slide.`,
        });
      }
    }
    if (el.type === "image" && !el.alt.trim()) {
      out.push({
        ...where,
        code: "missing_alt",
        message: `Slide ${n}: image ${el.id} has no alt text.`,
        pt: `Imagem sem descrição (texto alternativo).`,
      });
    }
    if (el.type === "chart") {
      const bad = el.series.find((s) => s.values.length !== el.labels.length);
      if (bad) {
        out.push({
          ...where,
          code: "chart_data",
          message: `Slide ${n}: series "${bad.name}" has ${bad.values.length} values for ${el.labels.length} labels.`,
          pt: `A série "${bad.name}" tem ${bad.values.length} valores para ${el.labels.length} rótulos.`,
        });
      }
      if ((el.kind === "pie" || el.kind === "donut") && el.labels.length > 7) {
        out.push({
          ...where,
          code: "chart_data",
          message: `Slide ${n}: pie chart with ${el.labels.length} slices is hard to read (max ~6). Group small slices into "Outros".`,
          pt: `Gráfico de pizza com ${el.labels.length} fatias é difícil de ler. Agrupe as menores em "Outros".`,
        });
      }
      if ((el.kind === "pie" || el.kind === "donut") && el.series[0]?.values.some((v) => v < 0)) {
        out.push({
          ...where,
          code: "chart_data",
          message: `Slide ${n}: pie chart values must be positive.`,
          pt: `Valores de gráfico de pizza devem ser positivos.`,
        });
      }
    }
    if (el.type === "table") {
      const cols = el.header.length;
      if (el.rows.length > 8 || cols > 6) {
        out.push({
          ...where,
          code: "table_size",
          message: `Slide ${n}: table ${el.rows.length}×${cols} is too dense for a slide (max ~7×5).`,
          pt: `Tabela ${el.rows.length}×${cols} é densa demais para um slide (até ~7×5).`,
        });
      }
      if (el.rows.some((r) => r.length !== cols)) {
        out.push({
          ...where,
          code: "table_size",
          message: `Slide ${n}: some table rows do not have ${cols} cells.`,
          pt: `Algumas linhas da tabela não têm ${cols} células.`,
        });
      }
    }
    for (const t of texts) {
      for (const p of t.value.paragraphs) {
        for (const r of p.runs) {
          const c = r.marks?.color;
          if (c && isHex(c) && !r.marks?.highlight && contrastRatio(c, bg) < 3) {
            out.push({
              ...where,
              code: "low_contrast",
              message: `Slide ${n}: text color ${c} has low contrast on this background. Use a theme token like "accent".`,
              pt: `A cor ${c} tem pouco contraste com o fundo. Prefira uma cor do tema.`,
            });
          }
        }
      }
    }
  }

  if (slide.layout === "stats" && slide.elements.filter((e) => e.type === "stat").length < 2) {
    out.push({
      ...at,
      code: "few_stats",
      message: `Slide ${n}: the stats layout works best with 2–4 numbers.`,
      pt: `O layout de números funciona melhor com 2 a 4 valores.`,
    });
  }
  return out;
}

function slideBgColor(slide: Slide, theme: Theme, tone: "base" | "inverse"): string {
  const bg = effectiveBackground(slide, theme);
  if (!bg || bg.type === "image")
    return tone === "inverse" ? theme.colors.inverseBg : theme.colors.bg;
  if (bg.type === "color") return resolveColor(bg.color, theme);
  return mixHex(resolveColor(bg.from, theme), resolveColor(bg.to, theme), 0.5);
}
