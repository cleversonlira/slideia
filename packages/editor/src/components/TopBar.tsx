import { exportUrls } from "../api.js";
import { navigate } from "../router.js";
import { flush, resolveKeepMine, resolveReload } from "../sync.js";
import { mutate, redo, toast, undo, useEditor, type SaveStatus } from "../state.js";
import { IconButton, Menu, TextInput } from "../ui.js";
import { AccountMenu } from "./AccountMenu.js";

const STATUS: Record<SaveStatus, { label: string; cls: string }> = {
  loading: { label: "Carregando…", cls: "muted" },
  saved: { label: "Salvo", cls: "ok" },
  dirty: { label: "Alterações não salvas", cls: "muted" },
  saving: { label: "Salvando…", cls: "muted" },
  offline: { label: "Sem conexão — tentando de novo", cls: "warn" },
  conflict: { label: "Conflito", cls: "danger" },
  error: { label: "Erro ao salvar", cls: "danger" },
};

export async function present(fromCurrent = true): Promise<void> {
  const { pres, slideId } = useEditor.getState();
  if (!pres) return;
  const win = window.open("about:blank", "_blank");
  if (!(await flush())) toast("Apresentando a última versão salva.", "error");
  const visible = pres.slides.filter((s) => !s.hidden);
  const n = Math.max(1, visible.findIndex((s) => s.id === slideId) + 1);
  const url = `${exportUrls.html(pres.id)}${fromCurrent ? `#${n}` : ""}`;
  if (win) win.location.href = url;
  else window.open(url, "_blank");
}

/** The .pptx takes a few seconds (every slide is laid out on the server): fetched with feedback. */
async function downloadPptx(): Promise<void> {
  const pres = useEditor.getState().pres;
  if (!pres) return;
  await flush();
  toast("Gerando o PowerPoint…");
  try {
    const res = await fetch(exportUrls.pptx(pres.id), { credentials: "same-origin" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `HTTP ${res.status}`);
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name ?? "apresentacao.pptx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    toast(`Não foi possível gerar o PowerPoint: ${(err as Error).message}`, "error");
  }
}

async function download(kind: "html" | "json" | "print"): Promise<void> {
  const pres = useEditor.getState().pres;
  if (!pres) return;
  await flush();
  if (kind === "print") window.open(`${exportUrls.html(pres.id)}#print`, "_blank");
  else
    window.location.href =
      kind === "html" ? exportUrls.download(pres.id) : exportUrls.json(pres.id);
}

export function TopBar() {
  const pres = useEditor((s) => s.pres)!;
  const status = useEditor((s) => s.status);
  const conflict = useEditor((s) => s.conflict);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const mode = useEditor((s) => s.mode);
  const st = STATUS[status];
  return (
    <>
      <header className="topbar">
        <IconButton
          icon="arrow-left"
          label="Minhas apresentações"
          onClick={() => void flush().then(() => navigate("/"))}
        />
        <div className="title-input">
          <TextInput
            ariaLabel="Título da apresentação"
            value={pres.meta.title}
            maxLength={200}
            onCommit={(v) =>
              v.trim() && mutate([{ op: "update_presentation", patch: { title: v.trim() } }])
            }
          />
        </div>
        <span className={`save-status ${st.cls}`} role="status" aria-live="polite">
          {st.label}
        </span>
        <div className="spacer" />
        <IconButton icon="undo-2" label="Desfazer (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo-2" label="Refazer (Ctrl+Y)" disabled={!canRedo} onClick={redo} />
        <div className="seg" role="group" aria-label="Modo">
          <button
            type="button"
            className={mode === "canvas" ? "on" : ""}
            onClick={() => useEditor.setState({ mode: "canvas" })}
          >
            Slides
          </button>
          <button
            type="button"
            className={mode === "outline" ? "on" : ""}
            onClick={() => useEditor.setState({ mode: "outline" })}
          >
            Roteiro
          </button>
        </div>
        <IconButton
          icon="search"
          label="Localizar e substituir (Ctrl+F)"
          onClick={() => useEditor.setState({ dialog: "find" })}
        />
        <IconButton
          icon="history"
          label="Histórico de versões"
          onClick={() => useEditor.setState({ dialog: "history" })}
        />
        <IconButton
          icon="keyboard"
          label="Atalhos"
          onClick={() => useEditor.setState({ dialog: "help" })}
        />
        <Menu
          trigger={(open) => (
            <button type="button" className="btn" onClick={open}>
              Baixar ▾
            </button>
          )}
        >
          {(close) => (
            <>
              <button type="button" onClick={() => (close(), void download("html"))}>
                HTML (apresentação offline)
              </button>
              <button type="button" onClick={() => (close(), void downloadPptx())}>
                PowerPoint (.pptx, editável)
              </button>
              <button type="button" onClick={() => (close(), void download("print"))}>
                Imprimir / PDF
              </button>
              <button type="button" onClick={() => (close(), void download("json"))}>
                Exportar JSON
              </button>
            </>
          )}
        </Menu>
        <button
          type="button"
          className="btn primary"
          onClick={() => void present()}
          title="Apresentar a partir deste slide (F5)"
        >
          ▶ Apresentar
        </button>
        <AccountMenu />
      </header>
      {status === "conflict" && (
        <div className="banner danger" role="alert">
          <span>{conflict ?? "Esta apresentação foi alterada em outro lugar."}</span>
          <button type="button" onClick={() => void resolveReload()}>
            Recarregar (descartar minhas alterações)
          </button>
          <button type="button" onClick={() => void resolveKeepMine()}>
            Manter minhas alterações
          </button>
        </div>
      )}
    </>
  );
}
