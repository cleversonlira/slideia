import { useEffect, useState } from "react";
import type { Presentation } from "@slideia/core/browser";
import { ApiError, api, exportUrls, type PresentationSummary } from "../api.js";
import { Thumbnail } from "../components/Thumbnail.js";
import { ensureSlideCss } from "../deck.js";
import { navigate } from "../router.js";
import { toast } from "../state.js";
import { Menu } from "../ui.js";

function extractJson(text: string): unknown {
  const m = /<script type="application\/json" id="presentation">([\s\S]*?)<\/script>/.exec(text);
  return JSON.parse(m ? m[1]! : text);
}

export function ListPage() {
  const [items, setItems] = useState<PresentationSummary[] | null>(null);
  const [docs, setDocs] = useState<Record<string, Presentation>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .list()
      .then((r) => {
        setItems(r.presentations);
        for (const p of r.presentations.slice(0, 60)) {
          void api.get(p.id).then((d) => setDocs((cur) => ({ ...cur, [p.id]: d.presentation })));
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError && err.status === 401 ? "sessao" : (err as Error).message),
      );

  useEffect(() => {
    ensureSlideCss();
    document.title = "Minhas apresentações";
    void load();
  }, []);

  const create = async () => {
    const { presentation } = await api.create("Nova apresentação");
    navigate(`/p/${presentation.id}`);
  };

  const importFile = async (file: File) => {
    try {
      const data = extractJson(await file.text());
      const { presentation } = await api.import(data);
      toast("Apresentação importada");
      navigate(`/p/${presentation.id}`);
    } catch (err) {
      toast(`Não foi possível importar: ${(err as Error).message}`, "error");
    }
  };

  if (error === "sessao") {
    return (
      <div className="center-msg">
        <h1>Acesso restrito</h1>
        <p>
          Abra o editor pelo link fornecido pela IA ou pelo terminal (ele contém a chave de acesso).
        </p>
      </div>
    );
  }

  const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="list-page">
      <header className="list-head">
        <h1>Minhas apresentações</h1>
        <div className="row">
          <label className="btn">
            Importar…
            <input
              type="file"
              accept=".json,.html,application/json,text/html"
              hidden
              onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])}
            />
          </label>
          <button type="button" className="btn primary" onClick={() => void create()}>
            + Nova apresentação
          </button>
        </div>
      </header>
      {error && <p className="warn">{error}</p>}
      {items && !items.length && (
        <div className="empty-state">
          <p>Nenhuma apresentação ainda.</p>
          <p className="muted">
            Peça à sua IA (ChatGPT, Claude…) para criar uma, ou comece em branco.
          </p>
        </div>
      )}
      <ul className="cards">
        {items?.map((p) => {
          const doc = docs[p.id];
          return (
            <li key={p.id} className="card">
              <button type="button" className="card-open" onClick={() => navigate(`/p/${p.id}`)}>
                {doc?.slides[0] ? (
                  <Thumbnail slide={doc.slides[0]} pres={doc} width={300} />
                ) : (
                  <div className="thumb placeholder" style={{ width: 300, height: 169 }} />
                )}
                <strong>{p.title}</strong>
                <span className="muted">
                  {p.slides} slides · {fmt.format(new Date(p.updatedAt))}
                </span>
              </button>
              <Menu
                trigger={(open) => (
                  <button
                    type="button"
                    className="card-menu"
                    aria-label="Mais ações"
                    onClick={open}
                  >
                    ⋯
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <button
                      type="button"
                      onClick={() => (close(), window.open(exportUrls.html(p.id), "_blank"))}
                    >
                      Apresentar
                    </button>
                    <button
                      type="button"
                      onClick={() => (close(), (window.location.href = exportUrls.download(p.id)))}
                    >
                      Baixar HTML
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        void api.duplicate(p.id).then(load);
                      }}
                    >
                      Duplicar
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        close();
                        if (confirm(`Excluir "${p.title}"? Esta ação não pode ser desfeita.`))
                          void api.remove(p.id).then(load);
                      }}
                    >
                      Excluir
                    </button>
                  </>
                )}
              </Menu>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
