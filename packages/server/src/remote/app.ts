import type { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { BlobStore } from "../blobs.js";
import { mountEditor, readCookie, sendPresentationHtml } from "../http.js";
import { createMcpServer } from "../mcp.js";
import type { Previewer } from "../preview.js";
import { NotFoundError, PresentationService, type Links } from "../service.js";
import { AccountError, type Accounts, type User } from "./accounts.js";
import type { RemoteConfig } from "./config.js";
import { hmac, randomToken, safeEqual, verifyHmac } from "./crypto.js";
import type { Mailer } from "./mailer.js";
import { OAuthError, SCOPE_LABELS, type OAuthServer } from "./oauth.js";
import { anon, log, type Metrics, type RateLimiter } from "./observability.js";
import {
  accountPage,
  checkEmailPage,
  consentPage,
  forgotPage,
  loginPage,
  messagePage,
  resetPage,
  signupPage,
  type PageContext,
} from "./pages.js";
import {
  connectPage,
  landingPage,
  privacyPage,
  supportPage,
  termsPage,
  type PublicInfo,
} from "./public-pages.js";
import { PgPresentationRepo } from "./pg-repo.js";
import type { Sql } from "./sql.js";

export interface RemoteContext {
  config: RemoteConfig;
  sql: Sql;
  blobs: BlobStore;
  accounts: Accounts;
  oauth: OAuthServer;
  mailer: Mailer;
  signingKey: string;
  /** Public key of the access-token signer (JWKS). */
  jwk: Record<string, unknown>;
  previewer: Previewer;
  events: EventEmitter;
  metrics: Metrics;
  limiter: RateLimiter;
}

const SESSION = "apz_sid";
const CSRF = "apz_csrf";
const GOOGLE_STATE = "apz_g";

type Req = Request & { user?: User | null };

export function createRemoteApp(ctx: RemoteContext): Express {
  const { config, accounts, oauth, limiter, metrics } = ctx;
  const secure = config.publicUrl.startsWith("https://");
  const pc: PageContext = { productName: config.productName };
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  if (config.trustProxy) app.set("trust proxy", 1);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const cookie = (res: Response, name: string, value: string, maxAge: number) =>
    res.append(
      "Set-Cookie",
      `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`,
    );

  const csrfToken = (req: Request, res: Response): string => {
    let t = readCookie(req, CSRF);
    if (!t || t.length < 20) {
      t = randomToken(18);
      cookie(res, CSRF, t, 7 * 24 * 3600);
    }
    return t;
  };

  const csrfOk = (req: Request): boolean => {
    const c = readCookie(req, CSRF);
    const f = (req.body as Record<string, unknown> | undefined)?.csrf;
    return !!c && typeof f === "string" && safeEqual(c, f);
  };

  const currentUser = async (req: Req): Promise<User | null> => {
    if (req.user !== undefined) return req.user;
    req.user = await accounts.sessionUser(readCookie(req, SESSION));
    return req.user;
  };

  /** Only same-site relative paths are accepted as "next" (no open redirects). */
  const safeNext = (next: unknown): string | undefined =>
    typeof next === "string" &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.startsWith("/\\")
      ? next
      : undefined;

  const ip = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "?";

  const tooMany = (res: Response) =>
    res
      .status(429)
      .type("html")
      .send(messagePage(pc, "Muitas tentativas", "Aguarde alguns minutos e tente de novo."));

  const form = express.urlencoded({ extended: false, limit: "100kb" });

  const startSession = async (res: Response, user: User) => {
    cookie(res, SESSION, await accounts.createSession(user.id), 30 * 24 * 3600);
    log("login", { user: anon(user.id) });
  };

  const linksFor = (owner: string): Links => {
    const signed = (kind: "d" | "v", id: string) => {
      const exp = Math.floor(Date.now() / 1000) + config.linkTtl;
      const sig = hmac(ctx.signingKey, `${kind}:${owner}:${id}:${exp}`);
      return `${config.publicUrl}/${kind}/${id}?o=${encodeURIComponent(owner)}&e=${exp}&s=${sig}`;
    };
    return {
      editor: (id, slide) => `${config.publicUrl}/p/${id}${slide ? `?slide=${slide}` : ""}`,
      download: (id) => signed("d", id),
      present: (id) => signed("v", id),
    };
  };

  const serviceFor = (owner: string) =>
    new PresentationService(
      new PgPresentationRepo(ctx.sql, ctx.blobs, owner),
      config,
      linksFor(owner),
      {
        events: ctx.events,
        writeFiles: false,
      },
    );

  // ---------------------------------------------------------------------------
  // Global middleware
  // ---------------------------------------------------------------------------

  app.use((req, res, next) => {
    res.on("finish", () => metrics.request(res.statusCode));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // Exported presentations carry their own (hash-based) CSP; everything else gets this one.
    const exported = /^\/(?:d|v)\//.test(req.path) || /\/export\.html$/.test(req.path);
    if (
      !exported &&
      !req.path.startsWith("/mcp") &&
      !req.path.startsWith("/.well-known") &&
      !req.path.startsWith("/oauth/")
    ) {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
      );
    }
    next();
  });

  const cors = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
    );
    res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };

  // ---------------------------------------------------------------------------
  // Health, metrics, discovery
  // ---------------------------------------------------------------------------

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/readyz", async (_req, res) => {
    try {
      await ctx.sql.query("SELECT 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.get("/metrics", (req, res) => {
    const auth = req.headers.authorization ?? "";
    if (!config.metricsToken || !safeEqual(auth, `Bearer ${config.metricsToken}`)) {
      res.status(404).end();
      return;
    }
    res.type("text/plain; version=0.0.4").send(metrics.render());
  });

  app.get("/.well-known/openai-apps-challenge", (_req, res) => {
    if (!config.openaiChallenge) {
      res.status(404).type("text").send("not configured");
      return;
    }
    res.type("text/plain").send(config.openaiChallenge);
  });

  app.use("/.well-known", cors);
  app.get(
    ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
    (_req, res) => {
      res.json(oauth.protectedResourceMetadata());
    },
  );
  app.get(
    ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/mcp"],
    (_req, res) => {
      res.json(oauth.authorizationServerMetadata());
    },
  );

  // ---------------------------------------------------------------------------
  // OAuth endpoints
  // ---------------------------------------------------------------------------

  const oauthApi = express.Router();
  oauthApi.use(cors);
  oauthApi.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    next();
  });
  const bodyParams = [
    express.urlencoded({ extended: false, limit: "50kb" }),
    express.json({ limit: "50kb" }),
  ];
  const oauthError = (res: Response, err: unknown) => {
    if (err instanceof OAuthError) {
      if (err.status === 401) res.setHeader("WWW-Authenticate", 'Basic realm="oauth"');
      res.status(err.status).json({ error: err.error, error_description: err.description });
    } else {
      console.error(err);
      res.status(500).json({ error: "server_error", error_description: "Internal error." });
    }
  };

  oauthApi.get("/jwks", (_req, res) => {
    res.json({ keys: [ctx.jwk] });
  });

  oauthApi.post("/register", ...bodyParams, async (req, res) => {
    if (!limiter.hit(`dcr:${ip(req)}`, 30, 3600_000)) {
      res.status(429).json({ error: "too_many_requests" });
      return;
    }
    try {
      const client = await oauth.register(req.body);
      log("oauth_register", { client: client.client_id, name: client.client_name });
      res.status(201).json(client);
    } catch (err) {
      oauthError(res, err);
    }
  });

  oauthApi.post("/token", ...bodyParams, async (req, res) => {
    if (!limiter.hit(`token:${ip(req)}`, 120, 60_000)) {
      res.status(429).json({ error: "too_many_requests" });
      return;
    }
    try {
      res.json(await oauth.token(stringParams(req.body), req.headers.authorization));
    } catch (err) {
      oauthError(res, err);
    }
  });

  oauthApi.post("/revoke", ...bodyParams, async (req, res) => {
    try {
      await oauth.revoke(stringParams(req.body), req.headers.authorization);
      res.status(200).end();
    } catch (err) {
      oauthError(res, err);
    }
  });

  /** Validates an authorization request. Errors before the redirect URI is trusted are shown, not redirected. */
  const authorizeRequest = async (q: Record<string, string>, res: Response) => {
    const clientId = q.client_id;
    const client = clientId ? await oauth.getClient(clientId) : null;
    if (!client) {
      res
        .status(400)
        .type("html")
        .send(
          messagePage(
            pc,
            "Aplicativo desconhecido",
            "Este aplicativo não está registrado. Tente conectar novamente pelo aplicativo.",
          ),
        );
      return null;
    }
    const redirectUri =
      q.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0]! : "");
    if (!redirectUri || !oauth.redirectAllowed(client, redirectUri)) {
      res
        .status(400)
        .type("html")
        .send(
          messagePage(
            pc,
            "Endereço de retorno inválido",
            "O endereço de retorno informado pelo aplicativo não foi registrado.",
          ),
        );
      return null;
    }
    const fail = (error: string, description: string) => {
      const u = new URL(redirectUri);
      u.searchParams.set("error", error);
      u.searchParams.set("error_description", description);
      if (q.state) u.searchParams.set("state", q.state);
      u.searchParams.set("iss", oauth.issuer);
      res.redirect(302, u.toString());
      return null;
    };
    if (q.response_type !== "code")
      return fail("unsupported_response_type", "Only response_type=code is supported.");
    if (!q.code_challenge || q.code_challenge_method !== "S256")
      return fail("invalid_request", "PKCE with S256 is required.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge))
      return fail("invalid_request", "Invalid code_challenge.");
    let scope: string;
    let resource: string;
    try {
      scope = oauth.parseScope(q.scope);
      resource = oauth.checkResource(q.resource);
    } catch (err) {
      const e = err as OAuthError;
      return fail(e.error, e.description);
    }
    return { client, redirectUri, scope, resource, state: q.state };
  };

  const redirectWithCode = async (
    res: Response,
    user: User,
    a: NonNullable<Awaited<ReturnType<typeof authorizeRequest>>>,
    challenge: string,
  ) => {
    const code = await oauth.issueCode({
      clientId: a.client.clientId,
      userId: user.id,
      redirectUri: a.redirectUri,
      codeChallenge: challenge,
      scope: a.scope,
      resource: a.resource,
    });
    const u = new URL(a.redirectUri);
    u.searchParams.set("code", code);
    if (a.state) u.searchParams.set("state", a.state);
    u.searchParams.set("iss", oauth.issuer);
    log("oauth_authorize", { user: anon(user.id), client: a.client.clientId });
    res.redirect(302, u.toString());
  };

  app.get("/oauth/authorize", async (req: Req, res, next) => {
    try {
      const q = stringParams(req.query);
      const a = await authorizeRequest(q, res);
      if (!a) return;
      const user = await currentUser(req);
      if (!user) {
        res.redirect(302, `/entrar?next=${encodeURIComponent(req.originalUrl)}`);
        return;
      }
      if (!user.emailVerified) {
        res.type("html").send(
          checkEmailPage(pc, {
            email: user.email,
            csrf: csrfToken(req, res),
            next: req.originalUrl,
          }),
        );
        return;
      }
      if (await oauth.hasConsent(user.id, a.client.clientId, a.scope)) {
        await redirectWithCode(res, user, a, q.code_challenge!);
        return;
      }
      const params: Record<string, string> = {};
      for (const k of [
        "client_id",
        "redirect_uri",
        "response_type",
        "code_challenge",
        "code_challenge_method",
        "scope",
        "state",
        "resource",
      ]) {
        if (q[k]) params[k] = q[k]!;
      }
      res.type("html").send(
        consentPage(pc, {
          csrf: csrfToken(req, res),
          clientName: a.client.name,
          clientHost: new URL(a.redirectUri).host || a.redirectUri,
          logo: a.client.logoUri,
          scopes: a.scope.split(" ").map((s) => SCOPE_LABELS[s] ?? s),
          userEmail: user.email,
          params,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  app.post("/oauth/authorize", form, async (req: Req, res, next) => {
    try {
      if (!csrfOk(req)) {
        res
          .status(403)
          .type("html")
          .send(messagePage(pc, "Sessão expirada", "Recarregue a página e tente de novo."));
        return;
      }
      const user = await currentUser(req);
      if (!user?.emailVerified) {
        res.redirect(302, "/entrar");
        return;
      }
      const q = stringParams(req.body);
      const a = await authorizeRequest(q, res);
      if (!a) return;
      if (q.decision !== "allow") {
        const u = new URL(a.redirectUri);
        u.searchParams.set("error", "access_denied");
        u.searchParams.set("error_description", "O usuário não autorizou o acesso.");
        if (a.state) u.searchParams.set("state", a.state);
        u.searchParams.set("iss", oauth.issuer);
        res.redirect(302, u.toString());
        return;
      }
      await oauth.saveConsent(user.id, a.client.clientId, a.scope);
      await redirectWithCode(res, user, a, q.code_challenge!);
    } catch (err) {
      next(err);
    }
  });

  app.use("/oauth", oauthApi);

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  const devLink = (url: string) =>
    config.dev && config.mail.driver === "console" ? url : undefined;

  app.get("/entrar", async (req: Req, res) => {
    const next = safeNext(req.query.next);
    if (await currentUser(req)) {
      res.redirect(302, next ?? "/");
      return;
    }
    res.type("html").send(
      loginPage(pc, {
        csrf: csrfToken(req, res),
        ...(next ? { next } : {}),
        google: !!config.google,
      }),
    );
  });

  app.post("/entrar", form, async (req: Req, res) => {
    const b = stringParams(req.body);
    const next = safeNext(b.next);
    const render = (error: string) =>
      res
        .status(400)
        .type("html")
        .send(
          loginPage(pc, {
            csrf: csrfToken(req, res),
            ...(next ? { next } : {}),
            error,
            email: b.email ?? "",
            google: !!config.google,
          }),
        );
    if (!csrfOk(req)) return render("Sessão expirada. Tente de novo.");
    if (
      !limiter.hit(`login:${ip(req)}`, 20, 15 * 60_000) ||
      !limiter.hit(`login:${(b.email ?? "").toLowerCase()}`, 10, 15 * 60_000)
    ) {
      return tooMany(res);
    }
    const user = await accounts.authenticate(b.email ?? "", b.password ?? "");
    if (!user) return render("E-mail ou senha incorretos.");
    if (!user.emailVerified) {
      res.type("html").send(
        checkEmailPage(pc, {
          email: user.email,
          csrf: csrfToken(req, res),
          ...(next ? { next } : {}),
        }),
      );
      return;
    }
    await startSession(res, user);
    res.redirect(303, next ?? "/");
  });

  app.get("/cadastro", async (req: Req, res) => {
    const next = safeNext(req.query.next);
    res.type("html").send(
      signupPage(pc, {
        csrf: csrfToken(req, res),
        ...(next ? { next } : {}),
        google: !!config.google,
      }),
    );
  });

  app.post("/cadastro", form, async (req: Req, res) => {
    const b = stringParams(req.body);
    const next = safeNext(b.next);
    const render = (error: string) =>
      res
        .status(400)
        .type("html")
        .send(
          signupPage(pc, {
            csrf: csrfToken(req, res),
            ...(next ? { next } : {}),
            error,
            email: b.email ?? "",
            name: b.name ?? "",
            google: !!config.google,
          }),
        );
    if (!csrfOk(req)) return render("Sessão expirada. Tente de novo.");
    if (!limiter.hit(`signup:${ip(req)}`, 10, 3600_000)) return tooMany(res);
    try {
      const user = await accounts.signup(b.email ?? "", b.password ?? "", b.name, next);
      log("signup", { user: anon(user.id) });
      const mail = ctx.mailer.outbox?.[0];
      res.type("html").send(
        checkEmailPage(pc, {
          email: user.email,
          csrf: csrfToken(req, res),
          devLink: devLink(/https?:\/\/\S+/.exec(mail?.text ?? "")?.[0] ?? ""),
          ...(next ? { next } : {}),
        }),
      );
    } catch (err) {
      if (err instanceof AccountError) return render(err.message);
      throw err;
    }
  });

  app.post("/reenviar-confirmacao", form, async (req: Req, res) => {
    const b = stringParams(req.body);
    const next = safeNext(b.next);
    if (!csrfOk(req) || !limiter.hit(`resend:${ip(req)}`, 5, 3600_000)) return tooMany(res);
    const user = await accounts.byEmail(b.email ?? "");
    let link: string | undefined;
    if (user && !user.emailVerified) link = await accounts.sendVerification(user, next);
    res.type("html").send(
      checkEmailPage(pc, {
        email: b.email ?? "",
        csrf: csrfToken(req, res),
        devLink: link ? devLink(link) : undefined,
        ...(next ? { next } : {}),
      }),
    );
  });

  app.get("/verificar", async (req: Req, res) => {
    const user =
      typeof req.query.token === "string" ? await accounts.verifyEmail(req.query.token) : null;
    if (!user) {
      res
        .status(400)
        .type("html")
        .send(
          messagePage(
            pc,
            "Link inválido ou expirado",
            "Peça um novo e-mail de confirmação ao entrar.",
            { href: "/entrar", label: "Entrar" },
          ),
        );
      return;
    }
    await startSession(res, user);
    const next = safeNext(req.query.next);
    res.type("html").send(
      messagePage(pc, "E-mail confirmado", "Sua conta está ativa.", {
        href: next ?? "/",
        label: next ? "Continuar" : "Minhas apresentações",
      }),
    );
  });

  app.get("/esqueci-senha", (req, res) => {
    res.type("html").send(forgotPage(pc, { csrf: csrfToken(req, res) }));
  });

  app.post("/esqueci-senha", form, async (req, res) => {
    if (!csrfOk(req)) return tooMany(res);
    if (!limiter.hit(`forgot:${ip(req)}`, 5, 3600_000)) return tooMany(res);
    await accounts.requestPasswordReset(stringParams(req.body).email ?? "");
    res.type("html").send(
      forgotPage(pc, {
        csrf: csrfToken(req, res),
        notice: "Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha.",
      }),
    );
  });

  app.get("/redefinir-senha", (req, res) => {
    res
      .type("html")
      .send(resetPage(pc, { csrf: csrfToken(req, res), token: String(req.query.token ?? "") }));
  });

  app.post("/redefinir-senha", form, async (req, res) => {
    const b = stringParams(req.body);
    if (!csrfOk(req)) return tooMany(res);
    try {
      const user = await accounts.resetPassword(b.token ?? "", b.password ?? "");
      if (!user) {
        res
          .status(400)
          .type("html")
          .send(
            messagePage(pc, "Link inválido ou expirado", "Peça um novo link de recuperação.", {
              href: "/esqueci-senha",
              label: "Recuperar senha",
            }),
          );
        return;
      }
      await oauth.revokeAllForUser(user.id);
      await startSession(res, user);
      res
        .type("html")
        .send(
          messagePage(
            pc,
            "Senha alterada",
            "Por segurança, os aplicativos conectados precisam ser autorizados de novo.",
            { href: "/", label: "Continuar" },
          ),
        );
    } catch (err) {
      if (err instanceof AccountError) {
        res
          .status(400)
          .type("html")
          .send(
            resetPage(pc, { csrf: csrfToken(req, res), token: b.token ?? "", error: err.message }),
          );
        return;
      }
      throw err;
    }
  });

  app.post("/sair", form, async (req, res) => {
    // Forms send the CSRF token; the editor (fetch) sends the same custom header as its API.
    if (csrfOk(req) || req.headers["x-apresenta"] === "1")
      await accounts.endSession(readCookie(req, SESSION));
    cookie(res, SESSION, "", 0);
    res.redirect(
      303,
      `/entrar${safeNext(stringParams(req.body).next) ? `?next=${encodeURIComponent(stringParams(req.body).next!)}` : ""}`,
    );
  });

  const requireUser = async (req: Req, res: Response): Promise<User | null> => {
    const user = await currentUser(req);
    if (!user) res.redirect(302, `/entrar?next=${encodeURIComponent(req.originalUrl)}`);
    return user;
  };

  const renderAccount = async (
    req: Req,
    res: Response,
    user: User,
    extra: { notice?: string; error?: string } = {},
  ) => {
    res.type("html").send(
      accountPage(pc, {
        csrf: csrfToken(req, res),
        email: user.email,
        name: user.name,
        apps: await oauth.connectedApps(user.id),
        mcpUrl: oauth.resource,
        ...extra,
      }),
    );
  };

  app.get("/conta", async (req: Req, res) => {
    const user = await requireUser(req, res);
    if (user) await renderAccount(req, res, user);
  });

  app.post("/conta/desconectar", form, async (req: Req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!csrfOk(req))
      return renderAccount(req, res, user, { error: "Sessão expirada. Tente de novo." });
    await oauth.disconnectApp(user.id, stringParams(req.body).client_id ?? "");
    await renderAccount(req, res, user, { notice: "Aplicativo desconectado." });
  });

  app.post("/conta/exportar", form, async (req: Req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!csrfOk(req))
      return renderAccount(req, res, user, { error: "Sessão expirada. Tente de novo." });
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="meus-dados-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    res.json(await accounts.exportData(user.id));
  });

  app.post("/conta/excluir", form, async (req: Req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!csrfOk(req))
      return renderAccount(req, res, user, { error: "Sessão expirada. Tente de novo." });
    if ((stringParams(req.body).confirm ?? "").trim().toLowerCase() !== user.email) {
      return renderAccount(req, res, user, {
        error: "O e-mail digitado não confere. Nada foi excluído.",
      });
    }
    await accounts.deleteAccount(user.id);
    oauth.forgetUser(user.id);
    log("account_deleted", { user: anon(user.id) });
    cookie(res, SESSION, "", 0);
    res
      .type("html")
      .send(messagePage(pc, "Conta excluída", "Sua conta e todos os seus dados foram apagados."));
  });

  // ---------------------------------------------------------------------------
  // Google sign-in (OpenID Connect, authorization code + PKCE)
  // ---------------------------------------------------------------------------

  app.get("/auth/google", (req, res) => {
    if (!config.google) {
      res.status(404).end();
      return;
    }
    const state = randomToken(16);
    const verifier = randomToken(48);
    const next = safeNext(req.query.next) ?? "/";
    const payload = `${state}|${verifier}|${next}`;
    cookie(res, GOOGLE_STATE, `${payload}|${hmac(ctx.signingKey, payload)}`, 600);
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", config.google.clientId);
    u.searchParams.set("redirect_uri", `${config.publicUrl}/auth/google/callback`);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "openid email profile");
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    u.searchParams.set("code_challenge_method", "S256");
    u.searchParams.set("prompt", "select_account");
    res.redirect(302, u.toString());
  });

  app.get("/auth/google/callback", async (req, res) => {
    const fail = (text: string) =>
      res
        .status(400)
        .type("html")
        .send(
          messagePage(pc, "Não foi possível entrar com o Google", text, {
            href: "/entrar",
            label: "Voltar",
          }),
        );
    if (!config.google) return fail("Login com Google não configurado.");
    const raw = readCookie(req, GOOGLE_STATE) ?? "";
    cookie(res, GOOGLE_STATE, "", 0);
    const parts = raw.split("|");
    const [state, verifier, next, sig] = parts;
    if (
      parts.length !== 4 ||
      !verifyHmac(ctx.signingKey, `${state}|${verifier}|${next}`, sig!) ||
      req.query.state !== state
    ) {
      return fail("A sessão de login expirou. Tente de novo.");
    }
    if (typeof req.query.code !== "string") return fail("O Google não retornou a autorização.");
    try {
      const tr = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: config.google.clientId,
          client_secret: config.google.clientSecret,
          redirect_uri: `${config.publicUrl}/auth/google/callback`,
          grant_type: "authorization_code",
          code_verifier: verifier!,
        }),
      });
      const tokens = (await tr.json()) as { id_token?: string };
      if (!tr.ok || !tokens.id_token) return fail("O Google recusou a autorização.");
      // The ID token came straight from Google's token endpoint over TLS (OIDC Core §3.1.3.7).
      const claims = JSON.parse(
        Buffer.from(tokens.id_token.split(".")[1] ?? "", "base64url").toString(),
      ) as Record<string, unknown>;
      const issOk =
        claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
      if (!issOk || claims.aud !== config.google.clientId || Number(claims.exp) * 1000 < Date.now())
        return fail("Resposta inválida do Google.");
      const user = await accounts.googleLogin({
        sub: String(claims.sub),
        email: String(claims.email ?? ""),
        emailVerified: claims.email_verified === true || claims.email_verified === "true",
        name: typeof claims.name === "string" ? claims.name : undefined,
      });
      await startSession(res, user);
      res.redirect(302, safeNext(next) ?? "/");
    } catch (err) {
      if (err instanceof AccountError) return fail(err.message);
      console.error(err);
      return fail("Erro ao falar com o Google.");
    }
  });

  // ---------------------------------------------------------------------------
  // Public pages (landing at "/" is served below, for anonymous visitors of the editor root)
  // ---------------------------------------------------------------------------

  const publicInfo: PublicInfo = {
    supportEmail: config.supportEmail,
    mcpUrl: oauth.resource,
    operatorName: config.operatorName,
    limits: config.limits,
    linkTtlHours: Math.round(config.linkTtl / 3600),
  };
  const publicPage =
    (render: (ctx: PageContext, p: PublicInfo) => string) => (_req: Request, res: Response) => {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.type("html").send(render(pc, publicInfo));
    };
  app.get("/privacidade", publicPage(privacyPage));
  app.get("/termos", publicPage(termsPage));
  app.get("/suporte", publicPage(supportPage));
  app.get("/como-conectar", publicPage(connectPage));

  // ---------------------------------------------------------------------------
  // Signed links (download / present without a session: they work from the chat)
  // ---------------------------------------------------------------------------

  const signedLink = (kind: "d" | "v") => async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const o = String(req.query.o ?? "");
    const e = Number(req.query.e ?? 0);
    const s = String(req.query.s ?? "");
    if (
      !o ||
      !e ||
      e < Date.now() / 1000 ||
      !verifyHmac(ctx.signingKey, `${kind}:${o}:${id}:${e}`, s)
    ) {
      res
        .status(403)
        .type("html")
        .send(
          messagePage(
            pc,
            "Link expirado",
            "Peça um novo link à IA ou abra a apresentação no editor.",
            { href: "/", label: "Minhas apresentações" },
          ),
        );
      return;
    }
    try {
      await sendPresentationHtml(serviceFor(o), id, res, kind === "d");
    } catch (err) {
      if (err instanceof NotFoundError)
        res
          .status(404)
          .type("html")
          .send(messagePage(pc, "Não encontrada", "Esta apresentação não existe mais."));
      else throw err;
    }
  };
  app.get("/d/:id", signedLink("d"));
  app.get("/v/:id", signedLink("v"));

  // ---------------------------------------------------------------------------
  // MCP endpoint (Streamable HTTP, stateless, OAuth bearer tokens)
  // ---------------------------------------------------------------------------

  const challenge = (error?: string) =>
    `Bearer realm="mcp", resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource/mcp", scope="presentations:read presentations:write"${error ? `, error="${error}"` : ""}`;

  /** Bearer token of an MCP request; answers 401/403 itself and returns null when not allowed. */
  const mcpAccess = async (req: Request, res: Response) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const access = token ? await oauth.verifyAccess(token) : null;
    if (!access) {
      res.setHeader("WWW-Authenticate", challenge(token ? "invalid_token" : undefined));
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Authentication required" },
        id: null,
      });
      return null;
    }
    if (!access.scopes.includes("presentations:read")) {
      res.setHeader("WWW-Authenticate", challenge("insufficient_scope"));
      res
        .status(403)
        .json({ jsonrpc: "2.0", error: { code: -32001, message: "Insufficient scope" }, id: null });
      return null;
    }
    return access;
  };

  app.use("/mcp", cors);

  // Optional server→client SSE stream (Streamable HTTP GET). This stateless server never sends
  // anything on it, but some clients (Gemini) open it before using the tools and give up on a
  // 405, so it answers with an idle stream: a heartbeat comment, closed after 10 minutes.
  app.get("/mcp", async (req, res) => {
    const access = await mcpAccess(req, res);
    if (!access) return;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": slideia\n\n");
    const beat = setInterval(() => res.write(": ping\n\n"), 25_000);
    const end = setTimeout(() => res.end(), 10 * 60_000);
    res.on("close", () => {
      clearInterval(beat);
      clearTimeout(end);
    });
  });

  app.post("/mcp", express.json({ limit: "25mb" }), async (req, res) => {
    const access = await mcpAccess(req, res);
    if (!access) return;
    if (!limiter.hit(`mcp:${access.userId}`, 120, 60_000)) {
      res.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Too many requests; slow down." },
        id: null,
      });
      return;
    }
    const server = createMcpServer(serviceFor(access.userId), ctx.previewer, {
      canWrite: access.scopes.includes("presentations:write"),
      onToolCall: (name, ms, ok, error) => {
        metrics.tool(name, ms, ok);
        log("tool", {
          tool: name,
          ms: Math.round(ms),
          ok,
          user: anon(access.userId),
          client: access.clientId,
          ...(error ? { error } : {}),
        });
      },
    });
    // Stateless: no session id generator; one transport per request.
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    } as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(err);
      if (!res.headersSent)
        res
          .status(500)
          .json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  });
  app.all("/mcp", (_req, res) => {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless server: use POST)." },
      id: null,
    });
  });

  // ---------------------------------------------------------------------------
  // Editor (session cookie)
  // ---------------------------------------------------------------------------

  mountEditor(app, {
    serviceFor,
    auth: {
      async user(req) {
        const user = await currentUser(req as Req);
        return user?.emailVerified ? user.id : null;
      },
      onAnonymousPage(req, res) {
        if (req.path === "/") {
          res.type("html").send(landingPage(pc, publicInfo));
          return;
        }
        res.redirect(302, `/entrar?next=${encodeURIComponent(req.originalUrl)}`);
      },
      async account(req) {
        const user = await currentUser(req as Req);
        return user ? { email: user.email, name: user.name } : null;
      },
    },
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    if (!res.headersSent)
      res
        .status(500)
        .type("html")
        .send(messagePage(pc, "Erro inesperado", "Tente novamente em instantes."));
  });

  return app;
}

function stringParams(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return out;
}
