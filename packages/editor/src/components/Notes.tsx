import { currentSlide, mutate, useEditor } from "../state.js";
import { MiniEditor } from "./MiniEditor.js";

export function Notes() {
  const slide = useEditor((s) => currentSlide(s));
  const lang = useEditor((s) => s.pres?.meta.lang);
  if (!slide) return null;
  return (
    <section className="notes" aria-label="Anotações do apresentador">
      <div className="notes-label">Anotações do apresentador</div>
      <MiniEditor
        key={slide.id}
        value={slide.notes}
        lang={lang ?? "pt-BR"}
        ariaLabel="Anotações do apresentador"
        placeholder="O que falar neste slide…"
        onCommit={(notes) =>
          mutate([
            {
              op: "update_slide",
              slide: slide.id,
              patch: { notes: notes.paragraphs.length ? notes : null },
            },
          ])
        }
      />
    </section>
  );
}
