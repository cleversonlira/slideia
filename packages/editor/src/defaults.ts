import type { ElementType, LayoutId, TRANSITION_TYPES } from "@slideia/core/browser";

/** Neutral gray image used until the user picks one (stored as an asset by the server). */
export const PLACEHOLDER_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWM4ffUhSYhhVMPVwRBKAJeLaKCDMNoeAAAAAElFTkSuQmCC";

export const ELEMENT_LABELS: Record<ElementType, string> = {
  title: "Título",
  text: "Texto",
  image: "Imagem",
  icon: "Ícone",
  chart: "Gráfico",
  table: "Tabela",
  quote: "Citação",
  stat: "Número (KPI)",
  timeline: "Linha do tempo",
};

export const SLOT_LABELS: Record<string, string> = {
  title: "Título",
  subtitle: "Subtítulo",
  body: "Conteúdo",
  left: "Coluna esquerda",
  right: "Coluna direita",
  image: "Imagem",
  logo: "Logo",
  number: "Número",
  caption: "Legenda",
  quote: "Citação",
  stats: "Números",
  footnote: "Nota de rodapé",
  timeline: "Linha do tempo",
  leftTitle: "Título esquerdo",
  rightTitle: "Título direito",
  chart: "Gráfico",
  table: "Tabela",
  contact: "Contato",
  overflow: "Oculto (não cabe no layout)",
};

export const TRANSITION_LABELS: Record<(typeof TRANSITION_TYPES)[number], string> = {
  none: "Nenhuma",
  fade: "Esmaecer",
  slide: "Deslizar",
  push: "Empurrar",
  zoom: "Zoom",
  dissolve: "Dissolver",
  flip3d: "Virar (3D)",
  cube3d: "Cubo (3D)",
  reveal: "Revelar",
};

export const DIRECTION_LABELS = {
  left: "Para a esquerda",
  right: "Para a direita",
  up: "Para cima",
  down: "Para baixo",
} as const;

export const COLOR_LABELS: Record<string, string> = {
  text: "Texto",
  muted: "Secundário",
  accent: "Destaque",
  accent2: "Destaque 2",
  highlight: "Marca-texto",
  success: "Positivo",
  danger: "Negativo",
  bg: "Fundo",
  surface: "Superfície",
};

export const ANIMATION_LABELS = {
  fade: "Esmaecer",
  rise: "Subir",
  zoom: "Zoom",
  wipe: "Revelar",
} as const;

export function defaultElement(type: ElementType): Record<string, unknown> {
  switch (type) {
    case "title":
      return { type, text: "Título" };
    case "text":
      return { type, text: "Texto" };
    case "image":
      return { type, asset: PLACEHOLDER_IMAGE, alt: "" };
    case "icon":
      return { type, name: "star" };
    case "chart":
      return {
        type,
        kind: "bar",
        labels: ["A", "B", "C"],
        series: [{ name: "Série 1", values: [3, 5, 4] }],
        showValues: true,
      };
    case "table":
      return {
        type,
        header: ["Coluna 1", "Coluna 2", "Coluna 3"],
        rows: [
          ["", "", ""],
          ["", "", ""],
        ],
      };
    case "quote":
      return { type, text: "Uma frase marcante.", author: "Autor" };
    case "stat":
      return { type, value: "100%", label: "descrição" };
    case "timeline":
      return {
        type,
        items: [
          { date: "Etapa 1", title: "Início" },
          { date: "Etapa 2", title: "Meio" },
          { date: "Etapa 3", title: "Fim" },
        ],
      };
  }
}

/** Starter content for a new slide of each layout. */
export function defaultSlide(layout: LayoutId): Record<string, unknown> {
  const el = (type: ElementType, slot: string, extra: Record<string, unknown> = {}) => ({
    ...defaultElement(type),
    slot,
    ...extra,
  });
  const elements: Array<Record<string, unknown>> = (() => {
    switch (layout) {
      case "cover":
        return [
          el("title", "title", { text: "Título da apresentação" }),
          el("text", "subtitle", { text: "Subtítulo" }),
        ];
      case "section":
        return [
          el("text", "number", { text: "01" }),
          el("title", "title", { text: "Nova seção" }),
          el("text", "subtitle", { text: "Descrição da seção" }),
        ];
      case "title-content":
        return [
          el("title", "title"),
          el("text", "body", { text: "- Primeiro ponto\n- Segundo ponto\n- Terceiro ponto" }),
        ];
      case "two-columns":
        return [
          el("title", "title"),
          el("text", "left", { text: "**Esquerda**\n- Ponto\n- Ponto" }),
          el("text", "right", { text: "**Direita**\n- Ponto\n- Ponto" }),
        ];
      case "full-image":
        return [el("image", "image"), el("title", "title", { text: "Título sobre a imagem" })];
      case "image-text":
        return [
          el("image", "image"),
          el("title", "title"),
          el("text", "body", { text: "Texto explicativo." }),
        ];
      case "quote":
        return [el("quote", "quote")];
      case "stats":
        return [
          el("title", "title", { text: "Números" }),
          el("stat", "stats", { value: "87%", label: "indicador" }),
          el("stat", "stats", { value: "3x", label: "indicador" }),
          el("stat", "stats", { value: "R$ 1 mi", label: "indicador" }),
        ];
      case "timeline":
        return [el("title", "title", { text: "Cronograma" }), el("timeline", "timeline")];
      case "comparison":
        return [
          el("title", "title", { text: "Comparação" }),
          el("text", "leftTitle", { text: "Antes" }),
          el("text", "left", { text: "- Ponto\n- Ponto" }),
          el("text", "rightTitle", { text: "Depois" }),
          el("text", "right", { text: "- Ponto\n- Ponto" }),
        ];
      case "chart":
        return [el("title", "title", { text: "Título do gráfico" }), el("chart", "chart")];
      case "table":
        return [el("title", "title", { text: "Tabela" }), el("table", "table")];
      case "closing":
        return [
          el("title", "title", { text: "Obrigado!" }),
          el("text", "body", { text: "Perguntas?" }),
          el("text", "contact", { text: "email@exemplo.com" }),
        ];
    }
  })();
  return { layout, elements };
}
