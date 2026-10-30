import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { PresentationError, formatIssues } from "@slideia/core";
import { allFontFiles } from "@slideia/renderer/node";
import { ImageError } from "./images.js";
import {
  ConflictError,
  LimitError,
  NotFoundError,
  fileSlug,
  type ChangeEvent,
  type PresentationService,
} from "./service.js";

export interface EditorAuth {
  /** User id of this request, or null. */
  user(req: Request, res: Response): Promise<string | null> | string | null;
  /** What to do when an anonymous visitor opens an editor page (login redirect, message). */
  onAnonymousPage(req: Request, res: Response): void;
  /** Signed-in account shown in the editor (remote mode). Absent in local mode, which has no login. */
  account?(req: Request): Promise<{ email: string; name: string | null } | null>;
}

export interface EditorOptions {
  auth: EditorAuth;
  /** Service scoped to a user. */
  serviceFor(userId: string): PresentationService;
  editorDist?: string | undefined;
}

export function editorDistPath(): string | undefined {
  for (const rel of ["../../editor/dist/", "./editor/"]) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(`${p}index.html`)) return p;
  }
  return undefined;
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(v.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function blankPresentation(title = "Nova apresentação") {
  return {
    meta: {
      title,
      theme: "executivo",
      lang: "pt-BR",
      aspectRatio: "16:9",
      defaultTransition: { type: "fade" },
    },
    slides: [
      {
        layout: "cover",
        elements: [
          { type: "title", text: title },
          { type: "text", text: "Subtítulo" },
        ],
      },
      {
        layout: "title-content",
        elements: [
          { type: "title", text: "Título do slide" },
          { type: "text", text: "- Primeiro ponto\n- Segundo ponto" },
        ],
      },
    ],
  };
}

type Handler = (req: Request, res: Response, svc: PresentationService) => Promise<void> | void;

/** Express error handler for API/JSON errors. */
export function apiErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;
  if (err instanceof PresentationError)
    res.status(400).json({ error: formatIssues(err.issues), issues: err.issues });
  else if (err instanceof ConflictError)
    res
      .status(409)
      .json({ error: err.message, conflicts: err.conflicts, currentVersion: err.currentVersion });
  else if (err instanceof NotFoundError) res.status(404).json({ error: err.message });
  else if (err instanceof LimitError || err instanceof ImageError)
    res.status(422).json({ error: err.message });
  else if ((err as { type?: string }).type === "entity.too.large")
    res.status(413).json({ error: "Arquivo grande demais." });
  else if ((err as { type?: string }).type === "entity.parse.failed")
    res.status(400).json({ error: "JSON inválido." });
  else {
    console.error(err);
    res.status(500).json({ error: "Erro interno." });
  }
}

/** Mounts the editor API (/api), user images (/media) and the editor SPA on `app`. */
export function mountEditor(app: Express, opts: EditorOptions): void {
  const { auth } = opts;

  const withService = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await auth.user(req, res);
      if (!user) {
        res.status(401).json({ error: "Sessão inválida. Entre novamente." });
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-apresenta"] !== "1") {
        res.status(403).json({ error: "Requisição bloqueada (CSRF)." });
        return;
      }
      await fn(req, res, opts.serviceFor(user));
    } catch (err) {
      next(err);
    }
  };

  const api = express.Router();
  const json = express.json({ limit: "20mb" });

  api.get(
    "/me",
    withService(async (req, res) => {
      res.json({ account: auth.account ? await auth.account(req) : null });
    }),
  );

  api.get(
    "/presentations",
    withService(async (req, res, svc) => {
      res.json({
        presentations: await svc.list(
          typeof req.query.q === "string" ? req.query.q : undefined,
          200,
        ),
      });
    }),
  );

  api.post(
    "/presentations",
    json,
    withService(async (req, res, svc) => {
      const body = (req.body ?? {}) as { presentation?: unknown; import?: unknown; title?: string };
      if (body.import !== undefined) {
        res.status(201).json({ presentation: await svc.import(body.import) });
        return;
      }
      const { presentation, warnings } = await svc.create(
        body.presentation ?? blankPresentation(body.title),
        "user",
        "editor",
      );
      res.status(201).json({ presentation, warnings });
    }),
  );

  api.get(
    "/presentations/:id",
    withService(async (req, res, svc) => {
      res.json({ presentation: await svc.get(String(req.params.id)) });
    }),
  );

  api.delete(
    "/presentations/:id",
    withService(async (req, res, svc) => {
      await svc.delete(String(req.params.id));
      res.status(204).end();
    }),
  );

  api.post(
    "/presentations/:id/duplicate",
    withService(async (req, res, svc) => {
      res.status(201).json({ presentation: await svc.duplicate(String(req.params.id)) });
    }),
  );

  api.post(
    "/presentations/:id/ops",
    json,
    withService(async (req, res, svc) => {
      const { expectedVersion, operations } = req.body as {
        expectedVersion: number;
        operations: unknown;
      };
      const r = await svc.apply(
        String(req.params.id),
        Number(expectedVersion),
        operations,
        "user",
        "editor",
      );
      res.json({
        presentation: r.presentation,
        changed: r.changed,
        rebased: r.rebased,
        warnings: r.warnings,
        notes: r.notes,
      });
    }),
  );

  api.get(
    "/presentations/:id/versions",
    withService(async (req, res, svc) => {
      await svc.get(String(req.params.id));
      res.json({ versions: await svc.repo.versions(String(req.params.id)) });
    }),
  );

  api.get(
    "/presentations/:id/versions/:version",
    withService(async (req, res, svc) => {
      const doc = await svc.repo.versionDoc(String(req.params.id), Number(req.params.version));
      if (!doc) throw new NotFoundError("Versão não encontrada.");
      res.json({ presentation: doc });
    }),
  );

  api.post(
    "/presentations/:id/restore",
    json,
    withService(async (req, res, svc) => {
      const r = await svc.restore(
        String(req.params.id),
        Number((req.body as { version: number }).version),
        "user",
        "editor",
      );
      res.json({ presentation: r.presentation, changed: r.changed });
    }),
  );

  api.get(
    "/presentations/:id/events",
    withService(async (req, res, svc) => {
      const id = String(req.params.id);
      let last = await svc.repo.version(id);
      if (last === null) throw new NotFoundError("Apresentação não encontrada.");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ version: last })}\n\n`);
      const send = (e: ChangeEvent) => {
        if (e.version === last) return;
        last = e.version;
        res.write(`event: change\ndata: ${JSON.stringify(e)}\n\n`);
      };
      const onChange = (e: ChangeEvent & { owner?: string }) => {
        if (e.id === id && (!e.owner || e.owner === svc.repo.owner)) send(e);
      };
      svc.events.on("change", onChange);
      // Other processes/instances write to the same database: poll the version too.
      let polling = false;
      const poll = setInterval(() => {
        if (polling) return;
        polling = true;
        void (async () => {
          try {
            const v = await svc.repo.version(id);
            if (v === null || v === last) return;
            const row = (await svc.repo.versions(id, 1))[0];
            send({
              id,
              version: v,
              author: row?.author ?? "ai",
              channel: row?.channel ?? "mcp",
              touched: row?.touched ?? ["*"],
            });
          } catch {
            // database temporarily unavailable: try again on the next tick
          } finally {
            polling = false;
          }
        })();
      }, 1200);
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(poll);
        clearInterval(ping);
        svc.events.off("change", onChange);
      });
    }),
  );

  api.post(
    "/assets",
    express.raw({ type: "image/*", limit: "12mb" }),
    json,
    withService(async (req, res, svc) => {
      let asset;
      if (Buffer.isBuffer(req.body) && req.body.byteLength) {
        if (req.body.byteLength > svc.config.limits.imageBytes)
          throw new LimitError("Imagem grande demais.");
        asset = await svc.storeImage(req.body);
      } else if (
        req.is("application/json") &&
        typeof (req.body as { url?: unknown }).url === "string"
      ) {
        asset = await svc.addImage((req.body as { url: string }).url);
      } else throw new ImageError('Envie uma imagem (corpo image/*) ou {"url": "https://…"}.');
      res
        .status(201)
        .json({ asset: `asset:${asset.id}`, width: asset.width, height: asset.height });
    }),
  );

  api.get(
    "/presentations/:id/export.html",
    withService(async (req, res, svc) =>
      sendPresentationHtml(svc, String(req.params.id), res, !!req.query.download),
    ),
  );

  api.get(
    "/presentations/:id/export.json",
    withService(async (req, res, svc) => {
      const p = await svc.get(String(req.params.id));
      res.setHeader("Content-Disposition", `attachment; filename="${fileSlug(p.meta.title)}.json"`);
      res.json(p);
    }),
  );

  app.use("/api", api);

  // Theme fonts (OFL), public: the chat widget loads them from another origin.
  const fontFiles = new Map(allFontFiles().map((f) => [f.name, f.path]));
  app.get("/fonts/:file", (req, res) => {
    const path = fontFiles.get(String(req.params.file));
    if (!path) {
      res.status(404).end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    // Paths come from the font list, never from the request; in dev they live under node_modules/.pnpm.
    res.type("font/woff2").sendFile(path, { dotfiles: "allow" });
  });

  app.get(
    "/media/:id",
    withService(async (req, res, svc) => {
      const a = await svc.repo.getAsset(String(req.params.id).replace(/\.[a-z]+$/, ""));
      if (!a) throw new NotFoundError("Imagem não encontrada.");
      res.setHeader("Content-Type", a.mime);
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.send(Buffer.from(a.data));
    }),
  );

  const dist = opts.editorDist ?? editorDistPath();
  const page = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await auth.user(req, res);
      if (res.headersSent) return;
      if (!user) return auth.onAnonymousPage(req, res);
      if (!dist) {
        res
          .status(503)
          .type("text")
          .send("O editor ainda não foi compilado: rode `pnpm --filter @slideia/editor build`.");
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(`${dist}index.html`);
    } catch (err) {
      next(err);
    }
  };
  app.get(["/", "/p/:id"], page);
  if (dist) app.use(express.static(dist, { index: false, maxAge: "1h" }));

  app.use("/api", apiErrorHandler);
  app.use("/media", apiErrorHandler);
}

/** Sends the standalone HTML of a presentation (inline or as a download). */
export async function sendPresentationHtml(
  svc: PresentationService,
  id: string,
  res: Response,
  download: boolean,
): Promise<void> {
  const { html, presentation } = await svc.renderHtml(id);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (download)
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileSlug(presentation.meta.title)}.html"`,
    );
  res.send(html);
}

// ---------------------------------------------------------------------------
// Local mode: one user, access by the token in the link
// ---------------------------------------------------------------------------

export const COOKIE = "apz_session";

export interface LocalAppOptions {
  service: PresentationService;
  token: string;
  /** Allowed Host header values (DNS-rebinding protection). */
  hosts: () => string[];
  editorDist?: string | undefined;
}

export function createHttpApp(opts: LocalAppOptions): Express {
  const { service, token } = opts;
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);

  app.use((req, res, next) => {
    if (!opts.hosts().includes(req.headers.host ?? "")) {
      res.status(421).type("text").send("Host não permitido.");
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ app: "apresenta", home: service.config.home });
  });

  mountEditor(app, {
    editorDist: opts.editorDist,
    serviceFor: () => service,
    auth: {
      user(req, res) {
        const q = typeof req.query.t === "string" ? req.query.t : undefined;
        if (
          q === token &&
          req.method === "GET" &&
          (req.path === "/" || req.path.startsWith("/p/"))
        ) {
          // Links carry the token once: turn it into an HttpOnly cookie and drop it from the URL.
          res.setHeader(
            "Set-Cookie",
            `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
          );
          const url = new URL(req.originalUrl, "http://x");
          url.searchParams.delete("t");
          res.redirect(302, url.pathname + url.search);
          return null;
        }
        return q === token || readCookie(req, COOKIE) === token ? "local" : null;
      },
      onAnonymousPage(_req, res) {
        res
          .status(401)
          .type("html")
          .send(
            `<!doctype html><meta charset="utf-8"><title>Acesso restrito</title><body style="font:16px system-ui;padding:40px;max-width:560px;margin:auto"><h1>Acesso restrito</h1><p>Abra o editor pelo link fornecido pela IA ou pelo terminal (ele contém a chave de acesso).</p></body>`,
          );
      },
    },
  });
  return app;
}
