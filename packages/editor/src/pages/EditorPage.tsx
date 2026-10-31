import { useEffect, useState } from "react";
import { ApiError } from "../api.js";
import { Canvas } from "../components/Canvas.js";
import { FindReplace, Help, History, ShareDialog } from "../components/Dialogs.js";
import { ImageDialog } from "../components/ImageDialog.js";
import { LayoutPicker } from "../components/LayoutPicker.js";
import { Notes } from "../components/Notes.js";
import { Outline } from "../components/Outline.js";
import { Properties } from "../components/Properties.js";
import { SlideList } from "../components/SlideList.js";
import { TopBar, present } from "../components/TopBar.js";
import { ensureSlideCss } from "../deck.js";
import { navigate } from "../router.js";
import { mutate, redo, selectElement, selectSlide, undo, useEditor } from "../state.js";
import { startSync, stopSync } from "../sync.js";

function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function EditorPage({ id, slide }: { id: string; slide?: number | undefined }) {
  const pres = useEditor((s) => s.pres);
  const mode = useEditor((s) => s.mode);
  const dialog = useEditor((s) => s.dialog);
  const [error, setError] = useState<string | null>(null);
  const [panels, setPanels] = useState({ props: true });

  useEffect(() => {
    ensureSlideCss();
    useEditor.setState({ pres: null, saved: null });
    startSync(id)
      .then(() => {
        const p = useEditor.getState().pres;
        if (slide && p?.slides[slide - 1]) selectSlide(p.slides[slide - 1]!.id);
        if (p) document.title = `${p.meta.title} · Editor`;
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError && err.status === 401 ? "sessao" : (err as Error).message),
      );
    return () => stopSync();
  }, [id, slide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const state = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        useEditor.setState({ dialog: "find" });
        return;
      }
      if (e.key === "F5") {
        e.preventDefault();
        void present(!e.shiftKey);
        return;
      }
      if (typingIn(e.target) || state.editing || state.dialog) return;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        mod &&
        (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        state.elementId &&
        state.slideId
      ) {
        e.preventDefault();
        if (mutate([{ op: "remove_element", slide: state.slideId, element: state.elementId }]))
          selectElement(null);
      } else if (e.key === "Escape") {
        selectElement(null);
      } else if ((e.key === "PageDown" || e.key === "PageUp") && state.pres) {
        e.preventDefault();
        const i = state.pres.slides.findIndex((s) => s.id === state.slideId);
        const next = state.pres.slides[i + (e.key === "PageDown" ? 1 : -1)];
        if (next) selectSlide(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error === "sessao") {
    return (
      <div className="center-msg">
        <h1>Sessão expirada</h1>
        <p>Abra o editor pelo link fornecido pela IA (ele contém a chave de acesso).</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="center-msg">
        <h1>Não foi possível abrir</h1>
        <p>{error}</p>
        <button type="button" onClick={() => navigate("/")}>
          Minhas apresentações
        </button>
      </div>
    );
  }
  if (!pres) return <div className="center-msg muted">Carregando…</div>;

  const close = () => useEditor.setState({ dialog: null, imageTarget: null });
  return (
    <div className={`editor ${panels.props ? "" : "no-props"} mode-${mode}`}>
      <TopBar />
      <SlideList />
      <main className="workspace">
        {mode === "canvas" ? (
          <>
            <Canvas />
            <Notes />
          </>
        ) : (
          <Outline />
        )}
      </main>
      {mode === "canvas" && <Properties />}
      <button
        type="button"
        className="props-toggle"
        aria-label={panels.props ? "Ocultar propriedades" : "Mostrar propriedades"}
        onClick={() => setPanels((p) => ({ props: !p.props }))}
      >
        {panels.props ? "›" : "‹"}
      </button>
      {dialog === "layouts" && <LayoutPicker onClose={close} />}
      {dialog === "image" && <ImageDialog onClose={close} />}
      {dialog === "find" && <FindReplace onClose={close} />}
      {dialog === "history" && <History onClose={close} />}
      {dialog === "help" && <Help onClose={close} />}
      {dialog === "share" && <ShareDialog onClose={close} />}
    </div>
  );
}
