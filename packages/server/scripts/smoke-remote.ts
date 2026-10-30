/*
 * Smoke test of a running remote server (e.g. `docker compose up`), as a real client would use it:
 *   pnpm --filter @slideia/server exec tsx scripts/smoke-remote.ts [http://localhost:8787] [mailpit-url]
 * Signs up (verification e-mail read from Mailpit), connects with the MCP SDK OAuth client,
 * creates a presentation with an image, previews it, downloads the HTML via the signed link.
 */
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import sharp from "sharp";

const base = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const mailpit = (process.argv[3] ?? "http://localhost:8025").replace(/\/$/, "");
const cookies = new Map<string, string>();

async function browse(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: {
      ...(init.headers as Record<string, string>),
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    },
  });
  for (const c of res.headers.getSetCookie()) {
    const [k, ...v] = c.split(";")[0]!.split("=");
    cookies.set(k!, v.join("="));
  }
  return res;
}
const post = (url: string, data: Record<string, string>) =>
  browse(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
  });
const hidden = (html: string) =>
  Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
      m[1]!,
      m[2]!.replace(/&amp;/g, "&"),
    ]),
  );
const step = (s: string) => console.log(`✓ ${s}`);

const email = `smoke-${Date.now()}@exemplo.com`;
const signup = await (await browse(`${base}/cadastro`)).text();
await post(`${base}/cadastro`, {
  ...hidden(signup),
  email,
  password: "senha-forte-123",
  name: "Smoke",
});
let link = "";
for (let i = 0; i < 20 && !link; i++) {
  const list = (await (
    await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
  ).json()) as { messages: Array<{ ID: string }> };
  if (list.messages[0]) {
    const msg = (await (
      await fetch(`${mailpit}/api/v1/message/${list.messages[0].ID}`)
    ).json()) as { Text: string };
    link = /https?:\/\/\S+/.exec(msg.Text)?.[0] ?? "";
  } else await new Promise((r) => setTimeout(r, 500));
}
if (!link) throw new Error("verification e-mail not found in Mailpit");
step(`verification e-mail delivered by SMTP (${email})`);
if ((await browse(link)).status !== 200) throw new Error("verification failed");
step("e-mail verified, session started");

let code = "";
const tokens: { t?: unknown } = {};
let info: unknown;
let verifier = "";
const provider = {
  redirectUrl: "http://127.0.0.1:9/cb",
  clientMetadata: {
    client_name: "Smoke test",
    redirect_uris: ["http://127.0.0.1:9/cb"],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  },
  clientInformation: () => info,
  saveClientInformation: (i: unknown) => void (info = i),
  tokens: () => tokens.t,
  saveTokens: (t: unknown) => void (tokens.t = t),
  saveCodeVerifier: (v: string) => void (verifier = v),
  codeVerifier: () => verifier,
  async redirectToAuthorization(url: URL) {
    const consent = await (await browse(url.toString())).text();
    const back = await post(`${base}/oauth/authorize`, { ...hidden(consent), decision: "allow" });
    code = new URL(back.headers.get("location")!).searchParams.get("code")!;
  },
} as unknown as OAuthClientProvider;
const transport = () =>
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    authProvider: provider,
  }) as unknown as Transport;
let client = new Client({ name: "smoke", version: "1" });
try {
  await client.connect(transport());
} catch (err) {
  if (!(err instanceof UnauthorizedError)) throw err;
  await (transport() as unknown as StreamableHTTPClientTransport).finishAuth(code);
  client = new Client({ name: "smoke", version: "1" });
  await client.connect(transport());
}
step("OAuth: discovery → DCR → PKCE → consent → token");

const png = await sharp({ create: { width: 800, height: 450, channels: 3, background: "#2f6bff" } })
  .png()
  .toBuffer();
type R = {
  content: Array<{ type: string; text?: string; data?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
const created = (await client.callTool({
  name: "create_presentation",
  arguments: {
    presentation: {
      meta: { title: "Smoke remoto", theme: "tech" },
      slides: [
        {
          layout: "cover",
          elements: [
            { type: "title", text: "Servidor remoto" },
            { type: "text", text: "Postgres + S3 + OAuth" },
          ],
        },
        {
          layout: "image-text",
          elements: [
            {
              type: "image",
              asset: `data:image/png;base64,${png.toString("base64")}`,
              alt: "Azul",
            },
            { type: "title", text: "Imagem no S3" },
            { type: "text", text: "Funciona." },
          ],
        },
      ],
    },
  },
})) as R;
if (created.isError) throw new Error(created.content[0]?.text);
const { id, downloadUrl } = created.structuredContent as { id: string; downloadUrl: string };
step(`created ${id} (image stored in S3)`);

const preview = (await client.callTool({
  name: "preview",
  arguments: { id, slideNumber: 2 },
})) as R;
if (preview.content[0]?.type !== "image")
  throw new Error(`preview failed: ${preview.content[0]?.text}`);
step(
  `preview rendered by Chromium in the container (${Math.round(((preview.content[0].data?.length ?? 0) * 0.75) / 1024)} KB JPEG)`,
);

const html = await (await fetch(downloadUrl)).text();
if (!html.includes("Imagem no S3") || !/data:image\/(png|jpeg|webp);base64/.test(html))
  throw new Error("download failed");
step(
  `signed download link works without a session (${Math.round(html.length / 1024)} KB, image embedded)`,
);
console.log(`sha256 ${createHash("sha256").update(html).digest("hex").slice(0, 12)}`);
await client.close();
