import {
  LAYOUTS,
  OVERFLOW_SLOT,
  markdownToRichText,
  plainText,
  type Element,
  type ElementOf,
  type Slide,
} from "@apresenta/core/browser";
import { resolveAsset } from "../api.js";
import { ANIMATION_LABELS, ELEMENT_LABELS, SLOT_LABELS } from "../defaults.js";
import { mutate, selectElement, useEditor } from "../state.js";
import { ColorPicker, Field, IconButton, Select, TextInput, Toggle } from "../ui.js";
import { IconPicker } from "./IconPicker.js";

function patch(slide: Slide, el: Element, p: Record<string, unknown>) {
  return mutate([{ op: "update_element", slide: slide.id, element: el.id, patch: p }]);
}

export function ElementProps({ slide, el }: { slide: Slide; el: Element }) {
  const layout = LAYOUTS[slide.layout];
  const slots = layout.slots.filter((s) => s.accepts.includes(el.type));
  const idx = slide.elements.findIndex((e) => e.id === el.id);

  return (
    <div className="props-section">
      <div className="props-title">
        <strong>{ELEMENT_LABELS[el.type]}</strong>
        <span className="muted">{el.id}</span>
      </div>

      {el.slot === OVERFLOW_SLOT && (
        <p className="warn">
          Este elemento não cabe no layout atual e está oculto. Mova-o para um espaço livre ou
          exclua.
        </p>
      )}

      <TypeProps slide={slide} el={el} />

      <Field label="Posição no layout">
        <Select
          value={el.slot}
          options={[
            ...slots.map((s) => ({ value: s.name, label: SLOT_LABELS[s.name] ?? s.name })),
            ...(el.slot === OVERFLOW_SLOT
              ? [{ value: OVERFLOW_SLOT, label: SLOT_LABELS.overflow! }]
              : []),
          ]}
          onChange={(v) => patch(slide, el, { slot: v })}
        />
      </Field>

      <Field label="Animação de entrada" hint="Revela o elemento a cada clique ao apresentar.">
        <div className="row">
          <Select
            value={el.animation?.type ?? "none"}
            options={[
              { value: "none", label: "Nenhuma" },
              ...Object.entries(ANIMATION_LABELS).map(([value, label]) => ({ value, label })),
            ]}
            onChange={(v) =>
              patch(slide, el, { animation: v === "none" ? null : { ...el.animation, type: v } })
            }
          />
          {el.animation &&
            (el.type === "text" || el.type === "timeline" || el.type === "quote") && (
              <Select
                value={el.animation.by ?? "element"}
                options={[
                  { value: "element", label: "Tudo de uma vez" },
                  {
                    value: "paragraph",
                    label: el.type === "timeline" ? "Item a item" : "Parágrafo a parágrafo",
                  },
                ]}
                onChange={(v) => patch(slide, el, { animation: { ...el.animation, by: v } })}
              />
            )}
        </div>
        {el.animation && (
          <label className="inline-num">
            Ordem
            <input
              type="number"
              min={1}
              max={50}
              value={el.animation.order ?? idx + 1}
              onChange={(e) =>
                patch(slide, el, {
                  animation: { ...el.animation, order: Math.max(1, Number(e.target.value) || 1) },
                })
              }
            />
          </label>
        )}
      </Field>

      <div className="row">
        <IconButton
          icon="arrow-up"
          label="Mover para trás (ordem)"
          disabled={idx <= 0}
          onClick={() => {
            const order = slide.elements.map((e) => e.id);
            order.splice(idx - 1, 0, ...order.splice(idx, 1));
            mutate([{ op: "reorder_elements", slide: slide.id, order }]);
          }}
        />
        <IconButton
          icon="arrow-down"
          label="Mover para frente (ordem)"
          disabled={idx >= slide.elements.length - 1}
          onClick={() => {
            const order = slide.elements.map((e) => e.id);
            order.splice(idx + 1, 0, ...order.splice(idx, 1));
            mutate([{ op: "reorder_elements", slide: slide.id, order }]);
          }}
        />
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (mutate([{ op: "remove_element", slide: slide.id, element: el.id }]))
              selectElement(null);
          }}
        >
          Excluir elemento
        </button>
      </div>
    </div>
  );
}

function TypeProps({ slide, el }: { slide: Slide; el: Element }) {
  const pres = useEditor((s) => s.pres)!;
  switch (el.type) {
    case "title":
    case "text":
      return (
        <p className="hint">
          Clique no texto do slide para editar. Selecione palavras para formatar.
        </p>
      );
    case "quote":
      return (
        <>
          <p className="hint">Clique na citação no slide para editar o texto.</p>
          <Field label="Autor">
            <TextInput
              value={el.author ?? ""}
              onCommit={(v) => patch(slide, el, { author: v || null })}
            />
          </Field>
          <Field label="Cargo / contexto">
            <TextInput
              value={el.role ?? ""}
              onCommit={(v) => patch(slide, el, { role: v || null })}
            />
          </Field>
        </>
      );
    case "image":
      return <ImageProps slide={slide} el={el} />;
    case "icon":
      return (
        <>
          <IconPicker value={el.name} onPick={(name) => patch(slide, el, { name })} />
          <Field label="Cor">
            <ColorPicker
              pres={pres}
              allowNone
              value={el.color}
              onChange={(c) => patch(slide, el, { color: c })}
            />
          </Field>
          <Field label="Tamanho">
            <Select
              value={el.size ?? "md"}
              options={[
                { value: "sm", label: "Pequeno" },
                { value: "md", label: "Médio" },
                { value: "lg", label: "Grande" },
              ]}
              onChange={(v) => patch(slide, el, { size: v })}
            />
          </Field>
        </>
      );
    case "chart":
      return <ChartProps slide={slide} el={el} />;
    case "table":
      return <TableProps slide={slide} el={el} />;
    case "stat":
      return (
        <>
          <Field label="Valor" hint='Curto, ex.: "87%", "R$ 2,4 mi", "3x".'>
            <TextInput
              value={el.value}
              maxLength={24}
              onCommit={(v) => v && patch(slide, el, { value: v })}
            />
          </Field>
          <p className="hint">Clique na descrição no slide para editar.</p>
          <Field label="Tendência">
            <Select
              value={el.trend ?? "none"}
              options={[
                { value: "none", label: "Nenhuma" },
                { value: "up", label: "Alta ↗" },
                { value: "down", label: "Queda ↘" },
              ]}
              onChange={(v) => patch(slide, el, { trend: v === "none" ? null : v })}
            />
          </Field>
          <Field label="Ícone">
            <IconPicker
              value={el.icon}
              onPick={(icon) => patch(slide, el, { icon: icon === el.icon ? null : icon })}
            />
          </Field>
        </>
      );
    case "timeline":
      return <TimelineProps slide={slide} el={el} />;
  }
}

function ImageProps({ slide, el }: { slide: Slide; el: ElementOf<"image"> }) {
  return (
    <>
      <div className="image-preview">
        <img src={resolveAsset(el.asset)} alt="" />
      </div>
      <div className="row">
        <button
          type="button"
          onClick={() =>
            useEditor.setState({
              dialog: "image",
              imageTarget: { kind: "element", elementId: el.id },
            })
          }
        >
          Trocar imagem
        </button>
        <button
          type="button"
          onClick={() =>
            useEditor.setState({
              dialog: "image",
              imageTarget: { kind: "element", elementId: el.id },
            })
          }
        >
          Cortar / posicionar
        </button>
      </div>
      <Field label="Descrição (texto alternativo)" hint="Lida por leitores de tela.">
        <TextInput
          multiline
          value={el.alt}
          maxLength={500}
          onCommit={(v) => patch(slide, el, { alt: v })}
        />
      </Field>
      <Field label="Enquadramento">
        <Select
          value={el.fit ?? "cover"}
          options={[
            { value: "cover", label: "Preencher (cortar sobras)" },
            { value: "contain", label: "Mostrar inteira" },
          ]}
          onChange={(v) => patch(slide, el, { fit: v })}
        />
      </Field>
      <Toggle
        label="Efeito Ken Burns (zoom lento)"
        checked={!!el.kenBurns}
        onChange={(v) => patch(slide, el, { kenBurns: v || null })}
      />
      <Toggle
        label="Legenda"
        checked={!!el.caption}
        onChange={(v) => patch(slide, el, { caption: v ? markdownToRichText("Legenda") : null })}
      />
    </>
  );
}

function ChartProps({ slide, el }: { slide: Slide; el: ElementOf<"chart"> }) {
  const setData = (labels: string[], series: ElementOf<"chart">["series"]) =>
    patch(slide, el, { labels, series });
  const pie = el.kind === "pie" || el.kind === "donut";
  const series = pie ? el.series.slice(0, 1) : el.series;
  return (
    <>
      <Field label="Tipo">
        <Select
          value={el.kind}
          options={[
            { value: "bar", label: "Barras" },
            { value: "line", label: "Linhas" },
            { value: "pie", label: "Pizza" },
            { value: "donut", label: "Rosca" },
          ]}
          onChange={(v) => patch(slide, el, { kind: v })}
        />
      </Field>
      <Field label="Título do gráfico">
        <TextInput
          value={el.title ?? ""}
          onCommit={(v) => patch(slide, el, { title: v || null })}
        />
      </Field>
      <div className="row">
        <Field label="Unidade">
          <TextInput
            value={el.unit ?? ""}
            maxLength={12}
            placeholder="%"
            onCommit={(v) => patch(slide, el, { unit: v || null })}
          />
        </Field>
        <Toggle
          label="Mostrar valores"
          checked={!!el.showValues}
          onChange={(v) => patch(slide, el, { showValues: v || null })}
        />
      </div>
      <div className="data-grid-wrap">
        <table className="data-grid">
          <thead>
            <tr>
              <th>Rótulo</th>
              {series.map((s, si) => (
                <th key={si}>
                  <input
                    aria-label={`Nome da série ${si + 1}`}
                    defaultValue={s.name}
                    onBlur={(e) => {
                      if (e.target.value === s.name) return;
                      setData(
                        el.labels,
                        el.series.map((x, i) =>
                          i === si ? { ...x, name: e.target.value || `Série ${si + 1}` } : x,
                        ),
                      );
                    }}
                  />
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {el.labels.map((label, li) => (
              <tr key={li}>
                <td>
                  <input
                    aria-label={`Rótulo ${li + 1}`}
                    defaultValue={label}
                    onBlur={(e) =>
                      e.target.value !== label &&
                      setData(
                        el.labels.map((l, i) => (i === li ? e.target.value : l)),
                        el.series,
                      )
                    }
                  />
                </td>
                {series.map((s, si) => (
                  <td key={si}>
                    <input
                      type="number"
                      step="any"
                      aria-label={`${s.name}, ${label}`}
                      defaultValue={s.values[li] ?? 0}
                      onBlur={(e) => {
                        const v = Number(e.target.value.replace(",", "."));
                        if (!Number.isFinite(v) || v === s.values[li]) return;
                        setData(
                          el.labels,
                          el.series.map((x, i) =>
                            i === si
                              ? {
                                  ...x,
                                  values: el.labels.map((_, k) =>
                                    k === li ? v : (x.values[k] ?? 0),
                                  ),
                                }
                              : x,
                          ),
                        );
                      }}
                    />
                  </td>
                ))}
                <td>
                  <IconButton
                    icon="x"
                    label="Remover linha"
                    disabled={el.labels.length <= 1}
                    onClick={() =>
                      setData(
                        el.labels.filter((_, i) => i !== li),
                        el.series.map((s) => ({
                          ...s,
                          values: s.values.filter((_, i) => i !== li),
                        })),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button
          type="button"
          disabled={el.labels.length >= 24}
          onClick={() =>
            setData(
              [...el.labels, `Item ${el.labels.length + 1}`],
              el.series.map((s) => ({ ...s, values: [...s.values, 0] })),
            )
          }
        >
          + Linha
        </button>
        {!pie && (
          <button
            type="button"
            disabled={el.series.length >= 6}
            onClick={() =>
              setData(el.labels, [
                ...el.series,
                { name: `Série ${el.series.length + 1}`, values: el.labels.map(() => 0) },
              ])
            }
          >
            + Série
          </button>
        )}
        {!pie && el.series.length > 1 && (
          <button type="button" onClick={() => setData(el.labels, el.series.slice(0, -1))}>
            − Série
          </button>
        )}
      </div>
    </>
  );
}

function TableProps({ slide, el }: { slide: Slide; el: ElementOf<"table"> }) {
  const empty = { paragraphs: [] };
  const cols = el.header.length;
  return (
    <>
      <p className="hint">Clique em uma célula no slide para editar.</p>
      <div className="row wrap">
        <button
          type="button"
          disabled={el.rows.length >= 20}
          onClick={() =>
            patch(slide, el, { rows: [...el.rows, Array.from({ length: cols }, () => empty)] })
          }
        >
          + Linha
        </button>
        <button
          type="button"
          disabled={!el.rows.length}
          onClick={() => patch(slide, el, { rows: el.rows.slice(0, -1) })}
        >
          − Linha
        </button>
        <button
          type="button"
          disabled={cols >= 8}
          onClick={() =>
            patch(slide, el, {
              header: [...el.header, markdownToRichText(`Coluna ${cols + 1}`)],
              rows: el.rows.map((r) => [...r, empty]),
            })
          }
        >
          + Coluna
        </button>
        <button
          type="button"
          disabled={cols <= 1}
          onClick={() =>
            patch(slide, el, {
              header: el.header.slice(0, -1),
              rows: el.rows.map((r) => r.slice(0, cols - 1)),
            })
          }
        >
          − Coluna
        </button>
      </div>
      <Toggle
        label="Destacar primeira coluna"
        checked={!!el.highlightFirstColumn}
        onChange={(v) => patch(slide, el, { highlightFirstColumn: v || null })}
      />
    </>
  );
}

function TimelineProps({ slide, el }: { slide: Slide; el: ElementOf<"timeline"> }) {
  const set = (items: ElementOf<"timeline">["items"]) => patch(slide, el, { items });
  return (
    <>
      {el.items.map((it, i) => (
        <div className="timeline-item-edit" key={i}>
          <div className="row">
            <TextInput
              ariaLabel="Data"
              value={it.date}
              maxLength={40}
              onCommit={(v) => set(el.items.map((x, k) => (k === i ? { ...x, date: v } : x)))}
            />
            <IconButton
              icon="x"
              label="Remover"
              disabled={el.items.length <= 1}
              onClick={() => set(el.items.filter((_, k) => k !== i))}
            />
          </div>
          <TextInput
            ariaLabel="Título"
            value={it.title}
            maxLength={120}
            onCommit={(v) => set(el.items.map((x, k) => (k === i ? { ...x, title: v } : x)))}
          />
          <TextInput
            ariaLabel="Descrição"
            placeholder="Descrição (opcional)"
            value={it.text ? plainText(it.text) : ""}
            onCommit={(v) =>
              set(
                el.items.map((x, k) => {
                  if (k !== i) return x;
                  const { text: _old, ...rest } = x;
                  return v.trim() ? { ...rest, text: markdownToRichText(v) } : rest;
                }),
              )
            }
          />
        </div>
      ))}
      <button
        type="button"
        disabled={el.items.length >= 8}
        onClick={() =>
          set([...el.items, { date: `Etapa ${el.items.length + 1}`, title: "Novo marco" }])
        }
      >
        + Marco
      </button>
    </>
  );
}
