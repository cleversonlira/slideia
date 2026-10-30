import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorPage } from "./pages/EditorPage.js";
import { ListPage } from "./pages/ListPage.js";
import { useRoute } from "./router.js";
import { useEditor } from "./state.js";
import "./styles.css";

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast-item ${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function App() {
  const { path, query } = useRoute();
  const m = /^\/p\/([A-Za-z0-9_-]+)/.exec(path);
  const slide = Number(query.get("slide")) || undefined;
  return (
    <>
      {m ? <EditorPage key={m[1]} id={m[1]!} slide={slide} /> : <ListPage />}
      <Toasts />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
