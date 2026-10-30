import { useMemo } from "react";
import {
  LAYOUTS,
  LAYOUT_IDS,
  normalizePresentation,
  type LayoutId,
  type Presentation,
} from "@slideia/core";
import { defaultSlide } from "../defaults.js";
import { currentSlide, mutate, selectSlide, useEditor } from "../state.js";
import { Modal } from "../ui.js";
import { Thumbnail } from "./Thumbnail.js";

/** Grid of layouts (rendered with starter content in the current theme) to add a slide. */
export function LayoutPicker({ onClose }: { onClose: () => void }) {
  const pres = useEditor((s) => s.pres)!;
  const samples = useMemo(() => {
    const sample = normalizePresentation({
      meta: { ...pres.meta },
      slides: LAYOUT_IDS.map((l) => defaultSlide(l)),
    }) as Presentation;
    return { ...sample, meta: pres.meta };
  }, [pres.meta]);

  const add = (layout: LayoutId) => {
    const current = currentSlide();
    const before = new Set(pres.slides.map((s) => s.id));
    const ok = mutate([
      { op: "add_slide", slide: defaultSlide(layout), ...(current ? { after: current.id } : {}) },
    ]);
    if (ok) {
      const created = useEditor.getState().pres?.slides.find((s) => !before.has(s.id));
      if (created) selectSlide(created.id);
    }
    onClose();
  };

  return (
    <Modal title="Novo slide" onClose={onClose} wide>
      <div className="layout-grid">
        {samples.slides.map((s, i) => {
          const id = LAYOUT_IDS[i]!;
          return (
            <button type="button" key={id} className="layout-card" onClick={() => add(id)}>
              <Thumbnail slide={s} pres={samples} width={220} />
              <strong>{LAYOUTS[id].label}</strong>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
