import { LAYOUTS, type Element } from "@slideia/core/browser";
import { ELEMENT_LABELS, SLOT_LABELS } from "../defaults.js";
import { fieldOp, getField } from "../fields.js";
import { mutate, selectSlide, useEditor } from "../state.js";
import { MiniEditor } from "./MiniEditor.js";

/** Text fields shown in outline mode, per element. */
function textFields(e: Element): Array<{ field: string; label: string }> {
  switch (e.type) {
    case "title":
    case "text":
    case "quote":
      return [{ field: "text", label: SLOT_LABELS[e.slot] ?? ELEMENT_LABELS[e.type] }];
    case "stat":
      return [{ field: "label", label: `${ELEMENT_LABELS.stat} ${e.value}` }];
    case "image":
      return e.caption ? [{ field: "caption", label: "Legenda" }] : [];
    case "timeline":
      return e.items.flatMap((it, i) =>
        it.text ? [{ field: `items.${i}.text`, label: `${it.date} · ${it.title}` }] : [],
      );
    case "table":
      return [];
    default:
      return [];
  }
}

/** Every text of the presentation in sequence, editable like a document. */
export function Outline() {
  const pres = useEditor((s) => s.pres)!;
  const slideId = useEditor((s) => s.slideId);
  return (
    <div className="outline">
      {pres.slides.map((s, i) => (
        <section
          key={s.id}
          className={`outline-slide ${s.id === slideId ? "active" : ""}`}
          onFocusCapture={() => selectSlide(s.id)}
        >
          <header>
            <span className="outline-num">{i + 1}</span>
            <span className="outline-layout">{LAYOUTS[s.layout].label}</span>
            {s.hidden && <span className="badge">oculto</span>}
          </header>
          {s.elements.flatMap((e) =>
            textFields(e).map(({ field, label }) => (
              <div key={`${e.id}:${field}`} className={`outline-field type-${e.type}`}>
                <span className="outline-label">{label}</span>
                <MiniEditor
                  value={getField(e, field)}
                  lang={pres.meta.lang}
                  ariaLabel={`${label}, slide ${i + 1}`}
                  onCommit={(rt) => {
                    const fresh = useEditor
                      .getState()
                      .pres?.slides.find((x) => x.id === s.id)
                      ?.elements.find((x) => x.id === e.id);
                    if (fresh) mutate([fieldOp(s.id, fresh, field, rt)]);
                  }}
                />
              </div>
            )),
          )}
          <div className="outline-field notes-field">
            <span className="outline-label">Anotações</span>
            <MiniEditor
              value={s.notes}
              lang={pres.meta.lang}
              ariaLabel={`Anotações, slide ${i + 1}`}
              placeholder="O que falar neste slide…"
              onCommit={(notes) =>
                mutate([
                  {
                    op: "update_slide",
                    slide: s.id,
                    patch: { notes: notes.paragraphs.length ? notes : null },
                  },
                ])
              }
            />
          </div>
        </section>
      ))}
    </div>
  );
}
