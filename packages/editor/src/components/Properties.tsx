import {
  FONT_IDS,
  LAYOUTS,
  LOGO_POSITIONS,
  LAYOUT_IDS,
  THEMES,
  TRANSITION_TYPES,
  checkDesign,
  findFreeSlot,
  type BrandLogo,
  type ElementType,
  type Presentation,
  type Slide,
  type Transition,
} from "@slideia/core/browser";
import { FONTS } from "@slideia/renderer";
import { useMemo, useState } from "react";
import { api, resolveAsset } from "../api.js";
import {
  DIRECTION_LABELS,
  ELEMENT_LABELS,
  PLACEHOLDER_IMAGE,
  TRANSITION_LABELS,
  defaultElement,
} from "../defaults.js";
import { currentSlide, mutate, selectElement, toast, useEditor, type Panel } from "../state.js";
import { ColorPicker, Field, Select, TextInput, Toggle } from "../ui.js";
import { transitionTest } from "./Canvas.js";
import { ElementProps } from "./ElementProps.js";

export function Properties() {
  const pres = useEditor((s) => s.pres)!;
  const panel = useEditor((s) => s.panel);
  const slide = useEditor((s) => currentSlide(s));
  const elementId = useEditor((s) => s.elementId);
  const el = slide?.elements.find((e) => e.id === elementId);
  const tabs: Array<{ id: Panel; label: string; disabled?: boolean }> = [
    { id: "slide", label: "Slide" },
    { id: "element", label: "Elemento", disabled: !el },
    { id: "deck", label: "Apresentação" },
  ];
  return (
    <aside className="properties" aria-label="Propriedades">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            type="button"
            role="tab"
            key={t.id}
            aria-selected={panel === t.id}
            disabled={t.disabled}
            className={panel === t.id ? "on" : ""}
            onClick={() => useEditor.setState({ panel: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="props-scroll">
        {panel === "slide" && slide && <SlideProps pres={pres} slide={slide} />}
        {panel === "element" && slide && el && <ElementProps slide={slide} el={el} />}
        {panel === "element" && !el && <p className="hint">Selecione um elemento no slide.</p>}
        {panel === "deck" && <DeckProps pres={pres} />}
      </div>
    </aside>
  );
}

function TransitionFields({
  value,
  onChange,
  allowDefault,
}: {
  value: Transition | undefined;
  onChange: (t: Transition | null) => void;
  allowDefault?: boolean;
}) {
  const type = value?.type ?? (allowDefault ? "default" : "fade");
  const directional = value && ["slide", "push", "reveal", "flip3d", "cube3d"].includes(value.type);
  return (
    <>
      <Select
        value={type}
        ariaLabel="Tipo de transição"
        options={[
          ...(allowDefault ? [{ value: "default", label: "Padrão da apresentação" }] : []),
          ...TRANSITION_TYPES.map((t) => ({ value: t, label: TRANSITION_LABELS[t] })),
        ]}
        onChange={(v) =>
          onChange(v === "default" ? null : { ...value, type: v as Transition["type"] })
        }
      />
      {value && directional && (
        <Select
          value={value.direction ?? "left"}
          ariaLabel="Direção"
          options={Object.entries(DIRECTION_LABELS).map(([v, label]) => ({ value: v, label }))}
          onChange={(v) => onChange({ ...value, direction: v as Transition["direction"] & string })}
        />
      )}
      {value && value.type !== "none" && (
        <label className="inline-num">
          Duração
          <input
            type="range"
            min={150}
            max={2000}
            step={50}
            value={value.durationMs ?? 600}
            onChange={(e) => onChange({ ...value, durationMs: Number(e.target.value) })}
          />
          <span>{((value.durationMs ?? 600) / 1000).toFixed(2)} s</span>
        </label>
      )}
    </>
  );
}

function SlideProps({ pres, slide }: { pres: Presentation; slide: Slide }) {
  const layout = LAYOUTS[slide.layout];
  const warnings = useMemo(
    () => checkDesign(pres).filter((w) => w.slideId === slide.id),
    [pres, slide.id],
  );
  const update = (patch: Record<string, unknown>) =>
    mutate([{ op: "update_slide", slide: slide.id, patch }]);
  const counts = new Map<string, number>();
  for (const e of slide.elements) counts.set(e.slot, (counts.get(e.slot) ?? 0) + 1);
  const addable = (Object.keys(ELEMENT_LABELS) as ElementType[]).filter((t) =>
    findFreeSlot(slide.layout, t, counts),
  );
  const bg = slide.background;

  return (
    <div className="props-section">
      <Field label="Layout">
        <Select
          value={slide.layout}
          options={LAYOUT_IDS.map((l) => ({ value: l, label: LAYOUTS[l].label }))}
          onChange={(v) => update({ layout: v })}
        />
      </Field>
      {layout.variants && (
        <Field label="Variação">
          <Select
            value={slide.variant ?? layout.variants[0]!}
            options={layout.variants.map((v) => ({
              value: v,
              label: v === "left" ? "Imagem à esquerda" : v === "right" ? "Imagem à direita" : v,
            }))}
            onChange={(v) => update({ variant: v })}
          />
        </Field>
      )}

      <Field label="Fundo">
        <Select
          value={bg?.type ?? "default"}
          options={[
            { value: "default", label: "Padrão do tema" },
            { value: "color", label: "Cor" },
            { value: "gradient", label: "Gradiente" },
            { value: "image", label: "Imagem" },
          ]}
          onChange={(v) => {
            if (v === "default") update({ background: null });
            else if (v === "color") update({ background: { type: "color", color: "surface" } });
            else if (v === "gradient")
              update({
                background: { type: "gradient", from: "accent", to: "accent2", angle: 135 },
              });
            else update({ background: { type: "image", asset: PLACEHOLDER_IMAGE, overlay: 0.45 } });
          }}
        />
      </Field>
      {bg?.type === "color" && (
        <ColorPicker
          pres={pres}
          value={bg.color}
          onChange={(c) => c && update({ background: { ...bg, color: c } })}
        />
      )}
      {bg?.type === "gradient" && (
        <>
          <Field label="De">
            <ColorPicker
              pres={pres}
              value={bg.from}
              onChange={(c) => c && update({ background: { ...bg, from: c } })}
            />
          </Field>
          <Field label="Para">
            <ColorPicker
              pres={pres}
              value={bg.to}
              onChange={(c) => c && update({ background: { ...bg, to: c } })}
            />
          </Field>
          <label className="inline-num">
            Ângulo
            <input
              type="range"
              min={0}
              max={360}
              value={bg.angle ?? 135}
              onChange={(e) => update({ background: { ...bg, angle: Number(e.target.value) } })}
            />
          </label>
        </>
      )}
      {bg?.type === "image" && (
        <>
          <div className="image-preview">
            <img src={resolveAsset(bg.asset)} alt="" />
          </div>
          <button
            type="button"
            onClick={() =>
              useEditor.setState({ dialog: "image", imageTarget: { kind: "background" } })
            }
          >
            Escolher imagem
          </button>
          <label className="inline-num">
            Escurecer
            <input
              type="range"
              min={0}
              max={0.9}
              step={0.05}
              value={bg.overlay ?? 0.45}
              onChange={(e) => update({ background: { ...bg, overlay: Number(e.target.value) } })}
            />
          </label>
          <Toggle
            label="Efeito Ken Burns"
            checked={!!bg.kenBurns}
            onChange={(v) => update({ background: { ...bg, kenBurns: v } })}
          />
        </>
      )}

      <Field label="Transição de entrada">
        <TransitionFields
          allowDefault
          value={slide.transition}
          onChange={(t) => update({ transition: t })}
        />
        <button type="button" onClick={() => transitionTest.run()}>
          ▶ Testar transição
        </button>
      </Field>

      <Toggle
        label="Ocultar ao apresentar"
        checked={!!slide.hidden}
        onChange={(v) => update({ hidden: v })}
      />

      <Field label="Adicionar elemento">
        <div className="chip-row">
          {addable.map((t) => (
            <button
              type="button"
              key={t}
              className="chip"
              onClick={() => {
                if (t === "image") {
                  useEditor.setState({ dialog: "image", imageTarget: { kind: "new" } });
                  return;
                }
                const before = new Set(slide.elements.map((e) => e.id));
                if (mutate([{ op: "add_element", slide: slide.id, element: defaultElement(t) }])) {
                  const created = currentSlide()?.elements.find((e) => !before.has(e.id));
                  if (created) selectElement(created.id);
                }
              }}
            >
              + {ELEMENT_LABELS[t]}
            </button>
          ))}
          {!addable.length && <span className="muted">O layout está completo.</span>}
        </div>
      </Field>

      {warnings.length > 0 && (
        <div className="warnings">
          <strong>Sugestões de design</strong>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w.pt}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const LANGS = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "en", label: "Inglês" },
  { value: "es", label: "Espanhol" },
  { value: "fr", label: "Francês" },
  { value: "de", label: "Alemão" },
  { value: "it", label: "Italiano" },
];

function DeckProps({ pres }: { pres: Presentation }) {
  const m = pres.meta;
  const update = (patch: Record<string, unknown>) => mutate([{ op: "update_presentation", patch }]);
  const overrides = m.themeOverrides ?? {};
  const setOverride = (key: string, value: unknown) => {
    const next = { ...overrides } as Record<string, unknown>;
    if (value) next[key] = value;
    else delete next[key];
    update({ themeOverrides: Object.keys(next).length ? next : null });
  };
  const theme = THEMES[m.theme];
  const brandColor = (key: "accent" | "accent2" | "cover", label: string, fallback: string) => (
    <Field label={label}>
      <div className="row">
        <input
          type="color"
          value={overrides[key] ?? fallback}
          onChange={(e) => setOverride(key, e.target.value)}
          aria-label={label}
        />
        {overrides[key] && (
          <button type="button" onClick={() => setOverride(key, null)}>
            Usar a do tema
          </button>
        )}
      </div>
    </Field>
  );
  const warnings = useMemo(() => checkDesign(pres).filter((w) => !w.slideId), [pres]);
  return (
    <div className="props-section">
      <Field label="Título">
        <TextInput
          value={m.title}
          maxLength={200}
          onCommit={(v) => v.trim() && update({ title: v.trim() })}
        />
      </Field>
      <Field label="Autor">
        <TextInput
          value={m.author ?? ""}
          maxLength={120}
          onCommit={(v) => update({ author: v.trim() || null })}
        />
      </Field>
      <div className="row">
        <Field label="Idioma">
          <Select
            value={LANGS.some((l) => l.value === m.lang) ? m.lang : "pt-BR"}
            options={LANGS}
            onChange={(v) => update({ lang: v })}
          />
        </Field>
        <Field label="Proporção">
          <Select
            value={m.aspectRatio}
            options={[
              { value: "16:9", label: "16:9 (widescreen)" },
              { value: "4:3", label: "4:3" },
            ]}
            onChange={(v) => update({ aspectRatio: v })}
          />
        </Field>
      </div>
      <Field label="Tema">
        <div className="theme-grid">
          {Object.values(THEMES).map((t) => (
            <button
              type="button"
              key={t.id}
              className={`theme-card ${m.theme === t.id ? "on" : ""}`}
              onClick={() => update({ theme: t.id })}
              title={t.description}
            >
              <span
                className="theme-swatch"
                style={{ background: t.colors.bg, color: t.colors.text }}
              >
                <span style={{ background: t.colors.accent }} />
                <span style={{ background: t.colors.accent2 }} />
                <b style={{ fontFamily: FONTS[t.fonts.heading].family }}>Aa</b>
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </Field>
      <h4 className="props-sub">Marca</h4>
      {brandColor("accent", "Cor principal", theme.colors.accent)}
      {brandColor("accent2", "Cor secundária", theme.colors.accent2)}
      {brandColor(
        "cover",
        "Fundo da capa e seções",
        theme.emphasis.type === "color"
          ? theme.emphasis.color
          : theme.emphasis.type === "gradient"
            ? theme.emphasis.from
            : theme.colors.inverseBg,
      )}
      <BrandLogoField logo={overrides.logo} onChange={(logo) => setOverride("logo", logo)} />
      <div className="row">
        <Field label="Fonte dos títulos">
          <Select
            value={overrides.fontHeading ?? "theme"}
            options={[
              { value: "theme", label: "Do tema" },
              ...FONT_IDS.map((f) => ({ value: f, label: FONTS[f].family })),
            ]}
            onChange={(v) => setOverride("fontHeading", v === "theme" ? null : v)}
          />
        </Field>
        <Field label="Fonte do texto">
          <Select
            value={overrides.fontBody ?? "theme"}
            options={[
              { value: "theme", label: "Do tema" },
              ...FONT_IDS.map((f) => ({ value: f, label: FONTS[f].family })),
            ]}
            onChange={(v) => setOverride("fontBody", v === "theme" ? null : v)}
          />
        </Field>
      </div>
      <Field label="Transição padrão">
        <TransitionFields
          value={m.defaultTransition}
          onChange={(t) => t && update({ defaultTransition: t })}
        />
      </Field>
      {warnings.length > 0 && (
        <div className="warnings">
          <strong>Sugestões de design</strong>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w.pt}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const LOGO_POSITION_LABELS: Record<(typeof LOGO_POSITIONS)[number], string> = {
  "bottom-right": "Inferior direito",
  "bottom-left": "Inferior esquerdo",
  "top-right": "Superior direito",
  "top-left": "Superior esquerdo",
};

/** Brand logo of the deck: upload, dark-slide variant, corner and size. */
function BrandLogoField({
  logo,
  onChange,
}: {
  logo: BrandLogo | undefined;
  onChange: (logo: BrandLogo | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const pick = (key: "asset" | "assetOnDark") => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/webp,image/jpeg,image/gif,image/avif";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const { asset } = await api.uploadImage(file);
        onChange({ ...(logo ?? { asset }), [key]: asset });
      } catch (err) {
        toast(err instanceof Error ? err.message : "Não foi possível enviar a imagem.", "error");
      } finally {
        setBusy(false);
      }
    };
    input.click();
  };
  if (!logo)
    return (
      <Field
        label="Logo"
        group
        hint="PNG ou WebP com fundo transparente. Aparece no canto de todos os slides."
      >
        <button type="button" disabled={busy} onClick={() => pick("asset")}>
          {busy ? "Enviando…" : "Enviar logo"}
        </button>
      </Field>
    );
  const set = (patch: Record<string, string | undefined>) => {
    const next: Record<string, unknown> = { ...logo, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    onChange(next as BrandLogo);
  };
  return (
    <Field label="Logo" group>
      <div className="logo-pair">
        <button type="button" className="logo-slot" disabled={busy} onClick={() => pick("asset")}>
          <img src={resolveAsset(logo.asset)} alt="" />
          <span>Fundo claro</span>
        </button>
        <button
          type="button"
          className="logo-slot dark"
          disabled={busy}
          onClick={() => pick("assetOnDark")}
        >
          {logo.assetOnDark ? <img src={resolveAsset(logo.assetOnDark)} alt="" /> : <em>+</em>}
          <span>Fundo escuro</span>
        </button>
      </div>
      <div className="row">
        <Select
          value={logo.position ?? "bottom-right"}
          options={LOGO_POSITIONS.map((p) => ({ value: p, label: LOGO_POSITION_LABELS[p] }))}
          onChange={(v) => set({ position: v })}
        />
        <Select
          value={logo.size ?? "m"}
          options={[
            { value: "s", label: "Pequeno" },
            { value: "m", label: "Médio" },
            { value: "l", label: "Grande" },
          ]}
          onChange={(v) => set({ size: v })}
        />
      </div>
      <TextInput
        value={logo.alt ?? ""}
        maxLength={200}
        placeholder="Texto alternativo (nome da empresa)"
        onCommit={(v) => set({ alt: v.trim() || undefined })}
      />
      <div className="row">
        {logo.assetOnDark && (
          <button type="button" onClick={() => set({ assetOnDark: undefined })}>
            Remover versão escura
          </button>
        )}
        <button type="button" onClick={() => onChange(null)}>
          Remover logo
        </button>
      </div>
    </Field>
  );
}
