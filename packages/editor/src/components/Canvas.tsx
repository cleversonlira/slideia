import { Editor } from "@tiptap/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { richTextEquals, type Element, type Slide } from "@slideia/core/browser";
import { autofit, runTransition } from "@slideia/renderer";
import { api } from "../api.js";
import { canvasSize, deckStyle, slideHtml, styleObject } from "../deck.js";
import { fieldOp, getField } from "../fields.js";
import { currentSlide, mutate, selectElement, toast, useEditor } from "../state.js";
import { docToRichText, richTextToDoc } from "../tiptap/convert.js";
import { editorExtensions } from "../tiptap/extensions.js";
import { FormatBar } from "./FormatBar.js";

interface Editing {
  editor: Editor;
  elementId: string;
  field: string;
  slideId: string;
  host: HTMLElement;
}

/** Triggers the transition preview of the current slide (see SlideProps). */
export const transitionTest = { run: () => undefined as void };

export function Canvas() {
  const pres = useEditor((s) => s.pres)!;
  const slide = useEditor((s) => currentSlide(s));
  const selected = useEditor((s) => s.elementId);
  const highlight = useEditor((s) => s.highlight);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef<Editing | null>(null);
  const [tick, setTick] = useState(0);
  const { width, height } = canvasSize(pres);

  // Fit the stage in the available space.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const s = Math.min((wrap.clientWidth - 48) / width, (wrap.clientHeight - 48) / height);
      setScale(Math.max(0.1, s));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [width, height]);

  const commit = useCallback(() => {
    const ed = editingRef.current;
    if (!ed) return;
    editingRef.current = null;
    setEditing(null);
    useEditor.setState({ editing: null });
    const rt = docToRichText(ed.editor.getJSON());
    ed.editor.destroy();
    const state = useEditor.getState();
    const s = state.pres?.slides.find((x) => x.id === ed.slideId);
    const el = s?.elements.find((e) => e.id === ed.elementId);
    if (!s || !el) return;
    if (!richTextEquals(getField(el, ed.field), rt)) mutate([fieldOp(s.id, el, ed.field, rt)]);
    else setTick((t) => t + 1); // re-render the static slide
  }, []);

  // Render the slide (static HTML from the renderer) unless a text is being edited on it.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !slide) return;
    if (editingRef.current && editingRef.current.slideId === slide.id) return;
    if (editingRef.current) commit();
    host.innerHTML = slideHtml(slide, pres);
    const el = host.firstElementChild as HTMLElement | null;
    el?.classList.add("is-active");
    el?.querySelectorAll("[data-step]").forEach((n) => n.classList.add("revealed"));
    markEmpty(el);
    void document.fonts.ready.then(() => {
      if (el?.isConnected) autofit(el);
    });
  }, [slide, pres.meta, tick, commit, pres]);

  // Selection and AI highlight classes.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll(".is-selected").forEach((n) => n.classList.remove("is-selected"));
    if (selected)
      host.querySelector(`[data-el-id="${CSS.escape(selected)}"]`)?.classList.add("is-selected");
    host.querySelectorAll(".ai-flash").forEach((n) => n.classList.remove("ai-flash"));
    for (const id of highlight)
      host.querySelector(`[data-el-id="${CSS.escape(id)}"]`)?.classList.add("ai-flash");
  }, [selected, highlight, slide, tick]);

  const startEditing = useCallback(
    (el: Element, field: string, rtNode: HTMLElement, at?: { x: number; y: number }) => {
      if (!slide) return;
      commit();
      const value = getField(el, field) ?? { paragraphs: [] };
      rtNode.innerHTML = "";
      const elNode = rtNode.closest<HTMLElement>("[data-el-id]")!;
      const editor = new Editor({
        element: rtNode,
        extensions: editorExtensions(),
        content: richTextToDoc(value),
        editorProps: {
          attributes: { spellcheck: "true", lang: pres.meta.lang, "aria-label": "Texto do slide" },
        },
        onUpdate: () => autofit(elNode.parentElement ?? elNode),
        onTransaction: () => setTick((t) => t + 1),
      });
      const ed: Editing = { editor, elementId: el.id, field, slideId: slide.id, host: rtNode };
      editingRef.current = ed;
      setEditing(ed);
      useEditor.setState({ editing: el.id, elementId: el.id, panel: "element" });
      // Focus right away (not on the next frame): keystrokes typed immediately must not be lost.
      const pos = at ? editor.view.posAtCoords({ left: at.x, top: at.y }) : null;
      if (pos) editor.commands.setTextSelection(pos.pos);
      editor.view.focus();
      if (!pos) editor.commands.focus("end");
    },
    [slide, commit, pres.meta.lang],
  );

  // Clicking outside the text being edited commits it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const ed = editingRef.current;
      if (!ed) return;
      const t = e.target as HTMLElement;
      if (ed.host.contains(t) || t.closest(".format-bar, .popover")) return;
      commit();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editingRef.current) {
        e.stopPropagation();
        commit();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [commit]);

  useEffect(() => () => commit(), [commit]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!slide || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (editingRef.current?.host.contains(t)) return;
    const elNode = t.closest<HTMLElement>("[data-el-id]");
    const el = slide.elements.find((x) => x.id === elNode?.dataset.elId);
    if (!el) {
      selectElement(null);
      return;
    }
    const rt = t.closest<HTMLElement>(".rt[data-field]");
    if (rt && elNode?.contains(rt)) {
      e.preventDefault();
      startEditing(el, rt.dataset.field!, rt, { x: e.clientX, y: e.clientY });
      return;
    }
    selectElement(el.id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const elNode = (e.target as HTMLElement).closest<HTMLElement>("[data-el-id]");
    const el = slide?.elements.find((x) => x.id === elNode?.dataset.elId);
    if (el?.type === "image")
      useEditor.setState({ dialog: "image", imageTarget: { kind: "element", elementId: el.id } });
  };

  // Drop an image file on an image element (or anywhere: becomes the selected image).
  const onDrop = async (e: React.DragEvent) => {
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    if (!file || !slide) return;
    e.preventDefault();
    const elNode = (e.target as HTMLElement).closest<HTMLElement>("[data-el-id]");
    const target = slide.elements.find((x) => x.id === elNode?.dataset.elId && x.type === "image");
    try {
      const { asset } = await api.uploadImage(file);
      if (target) mutate([{ op: "set_image", slide: slide.id, element: target.id, asset }]);
      else
        mutate([
          {
            op: "add_element",
            slide: slide.id,
            element: { type: "image", asset, alt: file.name.replace(/\.[^.]+$/, "") },
          },
        ]);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  // Transition preview: previous slide → current slide.
  const previewRef = useRef<HTMLDivElement>(null);
  transitionTest.run = () => {
    const host = previewRef.current;
    if (!slide || !host) return;
    const idx = pres.slides.findIndex((s) => s.id === slide.id);
    const prev: Slide | undefined = pres.slides[idx - 1] ?? pres.slides[idx + 1];
    if (!prev) return toast("Adicione outro slide para testar a transição.");
    host.innerHTML = slideHtml(prev, pres) + slideHtml(slide, pres);
    host.hidden = false;
    const [from, to] = [...host.children] as HTMLElement[];
    for (const n of [from!, to!])
      n.querySelectorAll("[data-step]").forEach((x) => x.classList.add("revealed"));
    autofit(host);
    void runTransition(from!, to!, slide.transition ?? pres.meta.defaultTransition, false).then(
      () => {
        setTimeout(() => {
          host.hidden = true;
          host.innerHTML = "";
        }, 400);
      },
    );
  };

  if (!slide) return <div className="canvas-wrap empty">Nenhum slide.</div>;

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void onDrop(e)}
    >
      <div
        className="canvas-frame"
        style={{ width: width * scale, height: height * scale }}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        <div
          className={`deck editor-stage ${pres.meta.aspectRatio === "4:3" ? "ar-43" : ""}`}
          style={{ ...styleObject(deckStyle(pres)), width, height, transform: `scale(${scale})` }}
        >
          <div ref={hostRef} className="slide-host" />
          <div ref={previewRef} className="transition-preview" hidden />
        </div>
      </div>
      {editing &&
        createPortal(
          <FormatBar editor={editing.editor} anchor={editing.host} pres={pres} tick={tick} />,
          document.body,
        )}
    </div>
  );
}

/** Marks rich texts that are empty so CSS can show a placeholder while editing. */
function markEmpty(slide: HTMLElement | null): void {
  slide?.querySelectorAll<HTMLElement>(".rt[data-field]").forEach((rt) => {
    if (!rt.textContent?.trim()) rt.classList.add("is-empty");
  });
}
