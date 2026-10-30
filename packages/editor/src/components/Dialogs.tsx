import { useEffect, useMemo, useState } from "react";
import { applyOps, type Presentation } from "@slideia/core";
import { api, type VersionInfo } from "../api.js";
import { flush } from "../sync.js";
import { loadPresentation, mutate, toast, useEditor } from "../state.js";
import { Modal, Toggle } from "../ui.js";
import { Thumbnail } from "./Thumbnail.js";

export function FindReplace({ onClose }: { onClose: () => void }) {
  const pres = useEditor((s) => s.pres)!;
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [notes, setNotes] = useState(true);
  const op = { op: "find_replace", find, replace, matchCase, wholeWord, includeNotes: notes };
  const count = useMemo(() => {
    if (!find) return 0;
    try {
      const r = applyOps(pres, [{ ...op, replace: find }]);
      return Number(/: (\d+) replacement/.exec(r.summary[0] ?? "")?.[1] ?? 0);
    } catch {
      return 0;
    }
  }, [pres, find, matchCase, wholeWord, notes]);
  return (
    <Modal title="Localizar e substituir" onClose={onClose}>
      <div className="form">
        <input
          autoFocus
          placeholder="Localizar"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          aria-label="Localizar"
        />
        <input
          placeholder="Substituir por"
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          aria-label="Substituir por"
        />
        <div className="row wrap">
          <Toggle label="Diferenciar maiúsculas" checked={matchCase} onChange={setMatchCase} />
          <Toggle label="Palavra inteira" checked={wholeWord} onChange={setWholeWord} />
          <Toggle label="Incluir anotações" checked={notes} onChange={setNotes} />
        </div>
        <div className="row">
          <span className="muted">{find ? `${count} ocorrência(s)` : ""}</span>
          <button
            type="button"
            className="primary"
            disabled={!count}
            onClick={() => {
              if (mutate([op])) toast(`${count} ocorrência(s) substituída(s)`);
              onClose();
            }}
          >
            Substituir tudo
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function History({ onClose }: { onClose: () => void }) {
  const pres = useEditor((s) => s.pres)!;
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [preview, setPreview] = useState<{ v: number; doc: Presentation } | null>(null);
  useEffect(() => {
    void flush().then(() => api.versions(pres.id).then((r) => setVersions(r.versions)));
  }, [pres.id]);
  const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
  return (
    <Modal title="Histórico de versões" onClose={onClose} wide>
      <div className="history">
        <ol className="version-list">
          {!versions && <li className="muted">Carregando…</li>}
          {versions?.map((v) => (
            <li key={v.version} className={preview?.v === v.version ? "on" : ""}>
              <button
                type="button"
                onClick={() =>
                  void api
                    .version(pres.id, v.version)
                    .then((r) => setPreview({ v: v.version, doc: r.presentation }))
                }
              >
                <span className={`who ${v.author}`}>{v.author === "ai" ? "IA" : "Você"}</span>
                <span className="when">
                  v{v.version} · {fmt.format(new Date(v.createdAt))}
                </span>
                <span className="what">{v.summary.slice(0, 3).join(" · ") || "—"}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="version-preview">
          {!preview && <p className="muted">Escolha uma versão para ver como estava.</p>}
          {preview && (
            <>
              <div className="row">
                <strong>Versão {preview.v}</strong>
                {preview.v !== pres.version && (
                  <button
                    type="button"
                    className="primary"
                    onClick={async () => {
                      await flush();
                      const r = await api.restore(pres.id, preview.v);
                      loadPresentation(r.presentation);
                      toast(`Versão ${preview.v} restaurada (como nova versão)`);
                      onClose();
                    }}
                  >
                    Restaurar esta versão
                  </button>
                )}
              </div>
              <div className="thumb-grid">
                {preview.doc.slides.map((s) => (
                  <Thumbnail key={s.id} slide={s} pres={preview.doc} width={200} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["Clique no texto", "Editar no lugar"],
  ["Ctrl+B / I / U", "Negrito / itálico / sublinhado"],
  ["Ctrl+K", "Link"],
  ["Tab / Shift+Tab", "Recuo em listas"],
  ["Esc", "Concluir edição / tirar seleção"],
  ["Ctrl+Z / Ctrl+Y", "Desfazer / refazer"],
  ["Delete", "Excluir elemento selecionado"],
  ["PageUp / PageDown", "Slide anterior / próximo"],
  ["Ctrl+F", "Localizar e substituir"],
  ["F5", "Apresentar"],
];

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Atalhos do editor" onClose={onClose}>
      <table className="kbd-table">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
