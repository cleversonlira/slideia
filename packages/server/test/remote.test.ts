import sharp from "sharp";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernHttpTransport,
} from "@modelcontextprotocol/client";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRemoteConfig, type RemoteConfig } from "../src/remote/config.js";
import { generateJwtKeyPem } from "../src/remote/crypto.js";
import { startRemote, type RemoteRuntime } from "../src/remote/main.js";
import { ConsoleMailer } from "../src/remote/mailer.js";

/*
 * Remote mode end to end, in process: PGlite (Postgres in WASM), real HTTP, the official MCP SDK
 * OAuth client (discovery → DCR → PKCE → consent → token → MCP over Streamable HTTP).
 */

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

async function makeConfig(extra: Record<string, string> = {}): Promise<RemoteConfig> {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "apresenta-remote-"));
  dirs.push(dir);
  return loadRemoteConfig({
    NODE_ENV: "test",
    PORT: String(port),
    HOST: "127.0.0.1",
    PUBLIC_URL: `http://127.0.0.1:${port}`,
    DATABASE_URL: "pglite:memory",
    DATA_DIR: dir,
    OPENAI_APPS_CHALLENGE_TOKEN: "challenge-123",
    ...extra,
  });
}

const dirs: string[] = [];
let rt: RemoteRuntime;
let base: string;
const mailer = new ConsoleMailer();

/** Minimal cookie jar for fetch. */
class Browser {
  cookies = new Map<string, string>();
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: {
        ...(init.headers as Record<string, string>),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, ...v] = pair!.split("=");
      const value = v.join("=");
      if (/Max-Age=0/.test(c)) this.cookies.delete(k!);
      else this.cookies.set(k!, value);
    }
    return res;
  }
  async form(url: string, data: Record<string, string>): Promise<Response> {
    return this.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(data).toString(),
    });
  }
}

function hidden(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) {
    out[m[1]!] = m[2]!
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
  return out;
}

async function signupAndVerify(
  b: Browser,
  email: string,
  password = "senha-forte-123",
): Promise<void> {
  const page = await (await b.fetch(`${base}/cadastro`)).text();
  const res = await b.form(`${base}/cadastro`, { ...hidden(page), name: "Teste", email, password });
  expect(res.status).toBe(200);
  const mail = mailer.outbox.find((m) => m.to === email)!;
  const link = /https?:\/\/\S+/.exec(mail.text)![0];
  const verified = await b.fetch(link);
  expect(verified.status).toBe(200);
  expect(b.cookies.has("apz_sid")).toBe(true);
}

/** OAuth client provider that "opens the browser" with our cookie jar and approves consent. */
class TestProvider implements OAuthClientProvider {
  info?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = "";
  code?: string;
  constructor(
    private readonly browser: Browser,
    readonly redirectUrl: string,
  ) {}
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Cliente de teste",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(i: OAuthClientInformationMixed) {
    this.info = i;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(t: OAuthTokens) {
    this.saved = t;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
  async redirectToAuthorization(url: URL) {
    const consent = await this.browser.fetch(url.toString());
    expect(consent.status).toBe(200);
    const html = await consent.text();
    expect(html).toContain("Autorizar acesso");
    const back = await this.browser.form(`${base}/oauth/authorize`, {
      ...hidden(html),
      decision: "allow",
    });
    expect(back.status).toBe(302);
    const loc = new URL(back.headers.get("location")!);
    expect(loc.searchParams.get("iss")).toBe(base);
    this.code = loc.searchParams.get("code")!;
  }
}

// The SDK types do not satisfy exactOptionalPropertyTypes; the objects are fine at runtime.
const transportFor = (provider: TestProvider) =>
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    authProvider: provider as unknown as OAuthClientProvider,
  });

async function connectWithOAuth(provider: TestProvider): Promise<Client> {
  const client = new Client({ name: "test", version: "1" });
  try {
    await client.connect(transportFor(provider) as unknown as Transport);
    return client;
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
  }
  await transportFor(provider).finishAuth(provider.code!);
  const c2 = new Client({ name: "test", version: "1" });
  await c2.connect(transportFor(provider) as unknown as Transport);
  return c2;
}

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

beforeAll(async () => {
  // Two boots on the same database, like a deploy: the first one published another surface, so
  // this one must announce the changed tool list (see "announces a changed tool list").
  const dbDir = mkdtempSync(join(tmpdir(), "apresenta-remote-db-"));
  dirs.push(dbDir);
  const config = await makeConfig({
    JWT_PRIVATE_KEY: generateJwtKeyPem(),
    DATABASE_URL: `pglite:${dbDir}`,
  });
  const previous = await startRemote(config, { mailer, listen: false });
  await previous.ctx.sql.query(
    "INSERT INTO meta (key, value) VALUES ('mcp_surface', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [JSON.stringify({ hash: "previous-deploy", changedAt: null })],
  );
  await previous.close();
  rt = await startRemote(config, { mailer });
  base = rt.ctx.config.publicUrl;
}, 60_000);

afterAll(async () => {
  await rt?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("discovery", () => {
  it("publishes RFC 9728 and RFC 8414 metadata", async () => {
    const prm = (await (
      await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)
    ).json()) as Record<string, unknown>;
    expect(prm).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [base] });
    const as = (await (
      await fetch(`${base}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>;
    expect(as).toMatchObject({
      issuer: base,
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
    });
  });

  it("challenges unauthenticated MCP calls with resource metadata", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      `resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("offers the Claude Desktop extension on the connect page only when it exists", async () => {
    const page = async () => (await fetch(`${base}/como-conectar`)).text();
    expect(await page()).not.toContain("/baixar/slideia.mcpb");
    expect((await fetch(`${base}/baixar/slideia.mcpb`)).status).toBe(404);

    const dir = rt.ctx.config.downloadsDir;
    mkdirSync(dir, { recursive: true });
    const bytes = Buffer.alloc(3 * 1048576, 7);
    writeFileSync(join(dir, "slideia.mcpb"), bytes);
    try {
      const html = await page();
      expect(html).toContain('href="/baixar/slideia.mcpb" download');
      expect(html).toContain("Baixar a extensão (3 MB)");
      const res = await fetch(`${base}/baixar/slideia.mcpb`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toBe("attachment; filename=slideia.mcpb");
      expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    } finally {
      rmSync(join(dir, "slideia.mcpb"));
    }
  });

  it("serves the OpenAI domain verification token", async () => {
    expect(await (await fetch(`${base}/.well-known/openai-apps-challenge`)).text()).toBe(
      "challenge-123",
    );
  });
});

describe("accounts", () => {
  it("requires e-mail verification and rate-limits wrong passwords", async () => {
    const b = new Browser();
    const page = await (await b.fetch(`${base}/cadastro`)).text();
    await b.form(`${base}/cadastro`, {
      ...hidden(page),
      email: "nova@exemplo.com",
      password: "senha-forte-123",
    });
    const login = await (await b.fetch(`${base}/entrar`)).text();
    const res = await b.form(`${base}/entrar`, {
      ...hidden(login),
      email: "nova@exemplo.com",
      password: "senha-forte-123",
    });
    expect(await res.text()).toContain("Confirme seu e-mail");
    expect(b.cookies.has("apz_sid")).toBe(false);

    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (
        await b.form(`${base}/entrar`, {
          ...hidden(login),
          email: "nova@exemplo.com",
          password: "errada",
        })
      ).status;
    }
    expect(last).toBe(429);
  });

  it("rejects forms without the CSRF token", async () => {
    const b = new Browser();
    await b.fetch(`${base}/entrar`);
    const res = await b.form(`${base}/entrar`, { email: "x@y.com", password: "12345678" });
    expect(await res.text()).toContain("Sessão expirada");
  });
});

describe("OAuth + MCP with the official SDK client", () => {
  let browser: Browser;
  let provider: TestProvider;
  let client: Client;

  beforeAll(async () => {
    browser = new Browser();
    await signupAndVerify(browser, "ana@exemplo.com");
    provider = new TestProvider(browser, "http://127.0.0.1:9/callback");
    client = await connectWithOAuth(provider);
  }, 60_000);

  it("announces a changed tool list once per client, on listen and on GET streams", async () => {
    const connect = async (n: number) => {
      const p = new TestProvider(browser, `http://127.0.0.1:9/callback-${n}`);
      await (await connectWithOAuth(p)).close();
      return p.saved!.access_token;
    };
    const firstChunk = async (token: string) => {
      const ctrl = new AbortController();
      const res = await fetch(`${base}/mcp`, {
        headers: { accept: "text/event-stream", authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
      const reader = res.body!.getReader();
      let text = "";
      const until = Date.now() + 400;
      while (Date.now() < until) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<null>((r) => setTimeout(() => r(null), until - Date.now())),
        ]);
        if (!chunk || chunk.done) break;
        text += new TextDecoder().decode(chunk.value);
      }
      ctrl.abort();
      return text;
    };

    // 2026-07-28 client: the notice arrives on its subscriptions/listen stream.
    const modernToken = await connect(1);
    const modern = new ModernClient(
      { name: "modern", version: "1" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await modern.connect(
      new ModernHttpTransport(new URL(`${base}/mcp`), {
        authProvider: { token: async () => modernToken },
      }),
    );
    const changed = new Promise<string>((resolve) =>
      modern.setNotificationHandler("notifications/tools/list_changed", (n) => resolve(n.method)),
    );
    try {
      const sub = await modern.listen({ toolsListChanged: true });
      expect(sub.honoredFilter.toolsListChanged).toBe(true);
      expect(await changed).toBe("notifications/tools/list_changed");
      await sub.close();
    } finally {
      await modern.close();
    }
    // Already told: its GET stream stays quiet.
    expect(await firstChunk(modernToken)).not.toContain("list_changed");

    // 2025-era client: the notice is the first thing on its GET stream, only once.
    const legacyToken = await connect(2);
    const first = await firstChunk(legacyToken);
    expect(first).toContain('"method":"notifications/tools/list_changed"');
    expect(first).toContain('"method":"notifications/resources/list_changed"');
    expect(await firstChunk(legacyToken)).not.toContain("list_changed");
  });

  it("GET /mcp asks for a token, then opens an idle SSE stream", async () => {
    const anon = await fetch(`${base}/mcp`, { headers: { accept: "text/event-stream" } });
    expect(anon.status).toBe(401);
    expect(anon.headers.get("www-authenticate")).toContain("resource_metadata=");
    const ctrl = new AbortController();
    const res = await fetch(`${base}/mcp`, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${provider.saved!.access_token}`,
      },
      signal: ctrl.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const first = await res.body!.getReader().read();
    expect(new TextDecoder().decode(first.value)).toContain(": slideia");
    ctrl.abort();
  });

  it("serves a 2026-07-28 client (v2 SDK) with the same token", async () => {
    // The v1 client above negotiates 2025-11-25 (initialize handshake); the v2 client speaks the
    // 2026-07-28 revision, which the v1 server SDK rejected with 400 before the migration.
    const modern = new ModernClient(
      { name: "modern", version: "1" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await modern.connect(
      new ModernHttpTransport(new URL(`${base}/mcp`), {
        authProvider: { token: async () => provider.saved!.access_token },
      }),
    );
    try {
      expect(modern.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      const { tools } = await modern.listTools();
      const create = tools.find((t) => t.name === "create_presentation")!;
      // The portable-schema rewrite (Gemini) also applies to this protocol revision.
      expect(JSON.stringify(tools.map((t) => t.inputSchema))).not.toMatch(
        /"\$schema"|"propertyNames"|"additionalProperties"/,
      );
      expect((create._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri).toBe(
        "ui://slideia/viewer-v1.html",
      );
      const r = (await modern.callTool({
        name: "create_presentation",
        arguments: {
          presentation: {
            slides: [{ layout: "cover", elements: [{ type: "title", text: "2026" }] }],
          },
        },
      })) as ToolResult;
      expect(r.isError).toBeFalsy();
      expect(r.content[0]!.text).toContain('Created "2026"');
      const view = await modern.readResource({ uri: "ui://slideia/viewer-v1.html" });
      expect(view.contents[0]!.mimeType).toBe("text/html;profile=mcp-app");
    } finally {
      await modern.close();
    }
  });

  it("registered dynamically and got tokens for the MCP resource", () => {
    expect(String(provider.info!.client_id)).toMatch(/^c_/);
    const payload = JSON.parse(
      Buffer.from(provider.saved!.access_token.split(".")[1]!, "base64url").toString(),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      iss: base,
      aud: `${base}/mcp`,
      scope: "presentations:read presentations:write",
    });
  });

  it("gives the chat widget signed image links scoped to the owner", async () => {
    const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#00a" } })
      .png()
      .toBuffer();
    const r = (await client.callTool({
      name: "create_presentation",
      arguments: {
        presentation: {
          meta: { title: "Widget remoto" },
          slides: [
            {
              layout: "full-image",
              elements: [
                {
                  type: "image",
                  asset: `data:image/png;base64,${png.toString("base64")}`,
                  alt: "x",
                },
              ],
            },
          ],
        },
      },
    })) as ToolResult & { _meta?: Record<string, unknown> };
    const view = r._meta?.["slideia/view"] as {
      presentation: { slides: Array<{ elements: Array<{ asset?: string }> }> };
      fontCss: string;
    };
    const src = view.presentation.slides[0]!.elements[0]!.asset!;
    expect(src).toMatch(new RegExp(`^${base}/m/a_[^?]+\\?o=`));
    const img = await fetch(src);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toMatch(/^image\//);
    expect((await fetch(src.replace(/s=[^&]+/, "s=abc"))).status).toBe(403);
    // The signature binds the owner: someone else's id with the same signature is refused.
    expect((await fetch(src.replace(/o=[^&]+/, "o=u_outro"))).status).toBe(403);
    expect(view.fontCss).toContain(`${base}/fonts/`);
  });

  it("creates a presentation and returns working signed links", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("create_presentation");
    const r = (await client.callTool({
      name: "create_presentation",
      arguments: {
        presentation: {
          meta: { title: "Remota" },
          slides: [
            { layout: "cover", elements: [{ type: "title", text: "Olá do servidor remoto" }] },
          ],
        },
      },
    })) as ToolResult;
    expect(r.isError).toBeFalsy();
    const { downloadUrl, editorUrl } = r.structuredContent as {
      downloadUrl: string;
      editorUrl: string;
    };
    expect(editorUrl).toMatch(new RegExp(`^${base}/p/p_`));
    const dl = await fetch(downloadUrl);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    expect(await dl.text()).toContain("Olá do servidor remoto");
    const tampered = await fetch(downloadUrl.replace(/s=[^&]+/, "s=abc"));
    expect(tampered.status).toBe(403);

    const rendered = (await client.callTool({
      name: "render",
      arguments: { id: (r.structuredContent as { id: string }).id },
    })) as ToolResult;
    expect(rendered.content[0]!.text).toContain("Download HTML (link valid for 24 h)");
    // Signed PowerPoint link (laid out in the headless browser; 503 without Chrome).
    const { pptxUrl } = rendered.structuredContent as { pptxUrl: string };
    expect(pptxUrl).toMatch(new RegExp(`^${base}/x/p_`));
    const px = await fetch(pptxUrl);
    if (px.status !== 503) {
      expect(px.status).toBe(200);
      expect(px.headers.get("content-type")).toContain("presentationml.presentation");
    }
    expect((await fetch(pptxUrl.replace(/s=[^&]+/, "s=abc"))).status).toBe(403);

    // The same account sees it in the editor API (session cookie) — and CSRF is enforced.
    const list = (await (await browser.fetch(`${base}/api/presentations`)).json()) as {
      presentations: Array<{ title: string }>;
    };
    expect(list.presentations.map((p) => p.title)).toContain("Remota");
    expect(
      (
        await browser.fetch(`${base}/api/presentations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
  });

  it("isolates users", async () => {
    const own = (await client.callTool({
      name: "list_presentations",
      arguments: {},
    })) as ToolResult;
    const id = (own.structuredContent as { presentations: Array<{ id: string }> }).presentations[0]!
      .id;
    const other = new Browser();
    await signupAndVerify(other, "bruno@exemplo.com");
    const c2 = await connectWithOAuth(new TestProvider(other, "http://127.0.0.1:9/callback"));
    const r = (await c2.callTool({ name: "get_presentation", arguments: { id } })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("not found");
    expect((await other.fetch(`${base}/api/presentations/${id}`)).status).toBe(404);
    await c2.close();
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const clientId = String(provider.info!.client_id);
    const refresh = provider.saved!.refresh_token!;
    const tok = (params: Record<string, string>) =>
      fetch(`${base}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
      });
    const first = await tok({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
    });
    expect(first.status).toBe(200);
    const fresh = (await first.json()) as { access_token: string; refresh_token: string };
    expect(fresh.refresh_token).not.toBe(refresh);

    const reuse = await tok({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
    });
    expect(reuse.status).toBe(400);
    expect(((await reuse.json()) as { error: string }).error).toBe("invalid_grant");
    // The whole family is gone: the new refresh token and access token stop working.
    expect(
      (
        await tok({
          grant_type: "refresh_token",
          refresh_token: fresh.refresh_token,
          client_id: clientId,
        })
      ).status,
    ).toBe(400);
    const mcp = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fresh.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(mcp.status).toBe(401);
  });
});

describe("authorization code protections", () => {
  async function manualFlow(b: Browser, verifierOverride?: string) {
    const reg = (await (
      await fetch(`${base}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://cliente.example/cb"],
          client_name: "Manual",
        }),
      })
    ).json()) as { client_id: string };
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const q = new URLSearchParams({
      response_type: "code",
      client_id: reg.client_id,
      redirect_uri: "https://cliente.example/cb",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
      resource: `${base}/mcp`,
    });
    const consent = await (await b.fetch(`${base}/oauth/authorize?${q}`)).text();
    const back = await b.form(`${base}/oauth/authorize`, { ...hidden(consent), decision: "allow" });
    const loc = new URL(back.headers.get("location")!);
    expect(loc.searchParams.get("state")).toBe("xyz");
    const code = loc.searchParams.get("code")!;
    const exchange = () =>
      fetch(`${base}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: "https://cliente.example/cb",
          client_id: reg.client_id,
          code_verifier: verifierOverride ?? verifier,
        }).toString(),
      });
    return { exchange, clientId: reg.client_id };
  }

  it("rejects a wrong PKCE verifier", async () => {
    const b = new Browser();
    await signupAndVerify(b, "carla@exemplo.com");
    const { exchange } = await manualFlow(b, randomBytes(32).toString("base64url"));
    const res = await exchange();
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_description: string }).error_description).toContain(
      "PKCE",
    );
  });

  it("rejects a reused code and revokes what it issued", async () => {
    const b = new Browser();
    await signupAndVerify(b, "dani@exemplo.com");
    const { exchange } = await manualFlow(b);
    const ok = await exchange();
    expect(ok.status).toBe(200);
    const tokens = (await ok.json()) as { access_token: string };
    expect((await exchange()).status).toBe(400);
    expect(await rt.ctx.oauth.verifyAccess(tokens.access_token)).toBeNull();
  });

  it("refuses unregistered redirect URIs without redirecting", async () => {
    const reg = (await (
      await fetch(`${base}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["https://a.example/cb"] }),
      })
    ).json()) as { client_id: string };
    const res = await fetch(
      `${base}/oauth/authorize?client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}&response_type=code`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(400);
    const bad = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }),
    });
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_redirect_uri");
  });

  it("rejects tokens issued for another resource (RFC 8707 audience)", async () => {
    const pem = generateJwtKeyPem();
    const a = await startRemote(await makeConfig({ JWT_PRIVATE_KEY: pem }), {
      mailer: new ConsoleMailer(),
    });
    const bServer = await startRemote(await makeConfig({ JWT_PRIVATE_KEY: pem }), {
      mailer: new ConsoleMailer(),
    });
    try {
      const user = await a.ctx.accounts.ensureDemo("eva@exemplo.com", "senha-forte-123");
      await bServer.ctx.accounts.ensureDemo("eva@exemplo.com", "senha-forte-123");
      const browser = new Browser();
      const login = await (await browser.fetch(`${a.ctx.config.publicUrl}/entrar`)).text();
      await browser.form(`${a.ctx.config.publicUrl}/entrar`, {
        ...hidden(login),
        email: "eva@exemplo.com",
        password: "senha-forte-123",
      });
      const reg = (await (
        await fetch(`${a.ctx.config.publicUrl}/oauth/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ redirect_uris: ["https://c.example/cb"] }),
        })
      ).json()) as { client_id: string };
      const verifier = randomBytes(32).toString("base64url");
      const q = new URLSearchParams({
        response_type: "code",
        client_id: reg.client_id,
        redirect_uri: "https://c.example/cb",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      });
      const consent = await (
        await browser.fetch(`${a.ctx.config.publicUrl}/oauth/authorize?${q}`)
      ).text();
      const back = await browser.form(`${a.ctx.config.publicUrl}/oauth/authorize`, {
        ...hidden(consent),
        decision: "allow",
      });
      const code = new URL(back.headers.get("location")!).searchParams.get("code")!;
      const tokens = (await (
        await fetch(`${a.ctx.config.publicUrl}/oauth/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: "https://c.example/cb",
            client_id: reg.client_id,
            code_verifier: verifier,
          }).toString(),
        })
      ).json()) as { access_token: string };
      expect(await a.ctx.oauth.verifyAccess(tokens.access_token)).toMatchObject({
        userId: user.user.id,
      });
      expect(await bServer.ctx.oauth.verifyAccess(tokens.access_token)).toBeNull();
    } finally {
      await a.close();
      await bServer.close();
    }
  }, 60_000);
});

describe("Client ID Metadata Documents", () => {
  it("accepts a client identified by its metadata URL", async () => {
    const docServer = http.createServer();
    await new Promise<void>((r) => docServer.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(docServer.address() as AddressInfo).port}/oauth/client.json`;
    docServer.on("request", (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          client_id: url,
          client_name: "Cliente CIMD",
          redirect_uris: ["http://127.0.0.1:9/cb"],
          token_endpoint_auth_method: "none",
        }),
      );
    });
    try {
      // The SDK client only sends https metadata URLs; our dev mode allows http on loopback, so
      // drive the flow by hand with the URL as client_id.
      const b = new Browser();
      await signupAndVerify(b, "fabi@exemplo.com");
      const verifier = randomBytes(32).toString("base64url");
      const q = new URLSearchParams({
        response_type: "code",
        client_id: url,
        redirect_uri: "http://127.0.0.1:9/cb",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      });
      const consent = await (await b.fetch(`${base}/oauth/authorize?${q}`)).text();
      expect(consent).toContain("Cliente CIMD");
      const back = await b.form(`${base}/oauth/authorize`, {
        ...hidden(consent),
        decision: "allow",
      });
      const code = new URL(back.headers.get("location")!).searchParams.get("code")!;
      const res = await fetch(`${base}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: "http://127.0.0.1:9/cb",
          client_id: url,
          code_verifier: verifier,
        }).toString(),
      });
      expect(res.status).toBe(200);
      const tokens = (await res.json()) as { access_token: string };
      expect(await rt.ctx.oauth.verifyAccess(tokens.access_token)).toMatchObject({ clientId: url });
      // A document whose client_id does not match its URL is rejected.
      expect(await rt.ctx.oauth.getClient(`${url}?x=1`)).toBeNull();
    } finally {
      docServer.close();
    }
  }, 60_000);

  it("accepts ChatGPT's document (private_key_jwt that also supports none)", async () => {
    const docServer = http.createServer();
    await new Promise<void>((r) => docServer.listen(0, "127.0.0.1", () => r()));
    const origin = `http://127.0.0.1:${(docServer.address() as AddressInfo).port}`;
    docServer.on("request", (req, res) => {
      const url = `${origin}${req.url}`;
      const methods =
        req.url === "/jwt-only.json" ? ["private_key_jwt"] : ["none", "private_key_jwt"];
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          client_id: url,
          client_name: "ChatGPT",
          redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
          token_endpoint_auth_method: "private_key_jwt",
          token_endpoint_auth_methods_supported: methods,
          jwks_uri: "https://chatgpt.com/oauth/jwks.json",
        }),
      );
    });
    try {
      const client = await rt.ctx.oauth.getClient(`${origin}/client.json`);
      expect(client).toMatchObject({ kind: "cimd", name: "ChatGPT", authMethod: "none" });
      expect(await rt.ctx.oauth.getClient(`${origin}/jwt-only.json`)).toBeNull();
    } finally {
      docServer.close();
    }
  }, 60_000);
});

describe("LGPD", () => {
  it("exports and deletes the account with all its data", async () => {
    const b = new Browser();
    await signupAndVerify(b, "gabi@exemplo.com");
    const provider = new TestProvider(b, "http://127.0.0.1:9/callback");
    const client = await connectWithOAuth(provider);
    await client.callTool({
      name: "create_presentation",
      arguments: {
        presentation: {
          meta: { title: "Minha" },
          slides: [{ layout: "section", elements: [{ type: "title", text: "A" }] }],
        },
      },
    });

    const account = await (await b.fetch(`${base}/conta`)).text();
    expect(account).toContain("Cliente de teste");
    const exported = await b.form(`${base}/conta/exportar`, hidden(account));
    const data = (await exported.json()) as {
      account: { email: string };
      presentations: unknown[];
    };
    expect(data.account.email).toBe("gabi@exemplo.com");
    expect(data.presentations).toHaveLength(1);

    const deleted = await b.form(`${base}/conta/excluir`, {
      ...hidden(account),
      confirm: "gabi@exemplo.com",
    });
    expect(await deleted.text()).toContain("Conta excluída");
    expect(await rt.ctx.oauth.verifyAccess(provider.saved!.access_token)).toBeNull();
    expect(
      (
        await rt.ctx.sql.query(
          "SELECT 1 FROM presentations p JOIN users u ON u.id = p.owner WHERE u.email = $1",
          ["gabi@exemplo.com"],
        )
      ).length,
    ).toBe(0);
    await client.close().catch(() => undefined);
  }, 60_000);
});

describe("list change detection", () => {
  it("records the surface and reports a change only after a different deploy", async () => {
    const { openSql, migrate } = await import("../src/remote/sql.js");
    const { ListChanges } = await import("../src/remote/list-changes.js");
    const sql = await openSql("pglite:memory");
    await migrate(sql);
    let now = 1_000_000;
    const clock = () => now;
    expect((await ListChanges.init(sql, "a", clock)).changedAt).toBeNull(); // first boot
    expect((await ListChanges.init(sql, "a", clock)).changedAt).toBeNull(); // same surface
    now += 5;
    const changed = await ListChanges.init(sql, "b", clock);
    expect(changed.changedAt).toBe(now);
    expect(changed.needsNotice("u:c")).toBe(true);
    changed.saw("u:c");
    expect(changed.needsNotice("u:c")).toBe(false);
    // A restart without changes keeps the date; the notice expires after 30 days.
    const again = await ListChanges.init(sql, "b", clock);
    expect(again.changedAt).toBe(now);
    now += 31 * 86_400_000;
    expect(again.needsNotice("u:other")).toBe(false);
    await sql.close();
  });
});
