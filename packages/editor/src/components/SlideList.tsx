import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Presentation, Slide } from "@slideia/core/browser";
import { mutate, selectSlide, useEditor } from "../state.js";
import { IconButton } from "../ui.js";
import { Thumbnail } from "./Thumbnail.js";

function SortableSlide({
  slide,
  index,
  pres,
  active,
  flash,
}: {
  slide: Slide;
  index: number;
  pres: Presentation;
  active: boolean;
  flash: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slide.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`slide-item ${active ? "active" : ""} ${isDragging ? "dragging" : ""} ${slide.hidden ? "is-hidden" : ""} ${flash ? "ai-flash" : ""}`}
      {...attributes}
      {...listeners}
      aria-label={`Slide ${index + 1}`}
      onClick={() => selectSlide(slide.id)}
      onKeyDown={(e) => {
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          if (pres.slides.length > 1) mutate([{ op: "remove_slide", slide: slide.id }]);
        }
        listeners?.onKeyDown?.(e);
      }}
    >
      <span className="slide-num">{index + 1}</span>
      <Thumbnail slide={slide} pres={pres} width={176} />
      <div className="slide-actions" onPointerDown={(e) => e.stopPropagation()}>
        <IconButton
          icon="copy"
          label="Duplicar"
          onClick={() => {
            const before = new Set(pres.slides.map((s) => s.id));
            if (mutate([{ op: "duplicate_slide", slide: slide.id }])) {
              const created = useEditor.getState().pres?.slides.find((s) => !before.has(s.id));
              if (created) selectSlide(created.id);
            }
          }}
        />
        <IconButton
          icon={slide.hidden ? "eye-off" : "eye"}
          label={slide.hidden ? "Mostrar na apresentação" : "Ocultar na apresentação"}
          onClick={() =>
            mutate([{ op: "update_slide", slide: slide.id, patch: { hidden: !slide.hidden } }])
          }
        />
        <IconButton
          icon="trash-2"
          label="Excluir"
          disabled={pres.slides.length <= 1}
          onClick={() => {
            const i = pres.slides.findIndex((s) => s.id === slide.id);
            if (mutate([{ op: "remove_slide", slide: slide.id }])) {
              const next = useEditor.getState().pres?.slides[Math.max(0, i - 1)];
              if (next) selectSlide(next.id);
            }
          }}
        />
      </div>
    </li>
  );
}

export function SlideList() {
  const pres = useEditor((s) => s.pres)!;
  const slideId = useEditor((s) => s.slideId);
  const highlight = useEditor((s) => s.highlight);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = pres.slides.map((s) => s.id);
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    const order = [...ids];
    order.splice(to, 0, ...order.splice(from, 1));
    mutate([{ op: "reorder_slides", order }]);
  };

  return (
    <aside className="slide-list" aria-label="Slides">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={pres.slides.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol>
            {pres.slides.map((s, i) => (
              <SortableSlide
                key={s.id}
                slide={s}
                index={i}
                pres={pres}
                active={s.id === slideId}
                flash={highlight.includes(s.id) || s.elements.some((e) => highlight.includes(e.id))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        className="add-slide"
        onClick={() => useEditor.setState({ dialog: "layouts" })}
      >
        + Novo slide
      </button>
    </aside>
  );
}
