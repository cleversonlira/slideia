import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConflictError,
  createMcpServer,
  fetchImage,
  isPrivateAddress,
  loadConfig,
  startRuntime,
  type Runtime,
} from "../src/index.js";
import { fetchPublic } from "../src/images.js";

const example = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../assets/examples/relatorio-q3.json"), "utf8"),
) as unknown;

let home: string;
let rt: Runtime;
let client: Client;

type ToolText = {
  content: Array<{ type: string; text?: string; data?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolText> {
  return (await client.callTool({ name, arguments: args })) as ToolText;
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "apresenta-test-"));
  rt = await startRuntime({ ...loadConfig({ APRESENTA_HOME: home }), port: 0 });
  const server = createMcpServer(rt.service, rt.previewer);
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterAll(async () => {
  await client.close();
  await rt.close();
  rmSync(home, { recursive: true, force: true });
});

describe("MCP tools", () => {
  it("publishes schemas in the subset Gemini accepts", async () => {
    const { tools } = await client.listTools();
    const bad: string[] = [];
    const walk = (n: unknown, path: string) => {
      if (!n || typeof n !== "object") return;
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (
          ["$schema", "propertyNames", "additionalProperties", "$ref", "oneOf", "allOf"].includes(k)
        )
          bad.push(`${path}.${k}`);
        if ((k === "maximum" || k === "minimum") && Math.abs(Number(v)) > 2 ** 31)
          bad.push(`${path}.${k}`);
        walk(v, `${path}.${k}`);
      }
    };
    for (const t of tools) walk(t.inputSchema, t.name);
    expect(bad).toEqual([]);
    // Loose objects still accept their extra fields (validation is done by the full schema).
    const created = await call("create_presentation", {
      presentation: {
        meta: { title: "Esquema portátil" },
        slides: [{ layout: "cover", elements: [{ type: "title", text: "Olá" }] }],
      },
    });
    expect(created.isError).toBeFalsy();
  });

  it("lists the tools with honest annotations", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([
      "add_image",
      "apply_edits",
      "create_presentation",
      "get_changes",
      "get_guide",
      "get_presentation",
      "list_presentations",
      "open_editor",
      "preview",
      "render",
    ]);
    expect(byName.get_guide!.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.apply_edits!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    // Tool schemas stay small: they are sent to the model on every turn.
    expect(JSON.stringify(tools).length).toBeLessThan(16_000);
  });

  it("returns the guide with every layout", async () => {
    const r = await call("get_guide");
    expect(r.content[0]!.text).toContain("- two-columns —");
    expect(r.content[0]!.text).toContain("update_text{slide,element,text}");
  });

  it("creates, reads, edits and describes manual changes", async () => {
    const created = await call("create_presentation", { presentation: example });
    expect(created.isError).toBeFalsy();
    const id = created.structuredContent!.id as string;
    expect(created.structuredContent!.editorUrl).toMatch(new RegExp(`/p/${id}\\?t=`));

    const outline = (await call("get_presentation", { id })).content[0]!.text!;
    expect(outline).toContain("## 2 ·");
    const titleId = /## 2 · \S+ · stats\n- (e_\w+) title/.exec(outline)![1]!;

    const edited = await call("apply_edits", {
      id,
      expectedVersion: 1,
      operations: [
        { op: "update_text", slide: 2, element: titleId, text: "Trimestre **recorde**" },
        { op: "update_presentation", patch: { theme: "noturno" } },
      ],
    });
    expect(edited.structuredContent).toMatchObject({ version: 2, changed: true });

    // The user edits another element in the editor; the AI's stale batch on the same title conflicts.
    const p = await rt.service.get(id);
    const subtitle = p.slides[0]!.elements.find((e) => e.type === "text")!;
    await rt.service.apply(
      id,
      2,
      [{ op: "update_text", slide: 1, element: subtitle.id, text: "Reunião extraordinária" }],
      "user",
      "editor",
    );
    const conflict = await call("apply_edits", {
      id,
      expectedVersion: 2,
      operations: [{ op: "update_text", slide: 1, element: subtitle.id, text: "x" }],
    });
    expect(conflict.isError).toBe(true);
    expect(conflict.content[0]!.text).toContain("Conflict");
    const merged = await call("apply_edits", {
      id,
      expectedVersion: 2,
      operations: [{ op: "update_text", slide: 2, element: titleId, text: "Trimestre histórico" }],
    });
    expect(merged.structuredContent).toMatchObject({ version: 4, rebased: true });

    const changes = await call("get_changes", { id, sinceVersion: 2 });
    expect(changes.content[0]!.text).toContain(
      'changed from "Reunião de conselho · 14 de outubro de 2026" to "Reunião extraordinária"',
    );
    expect(changes.structuredContent).toMatchObject({ userEdits: 1 });
  });

  it("explains invalid input with field paths", async () => {
    const r = await call("create_presentation", {
      presentation: {
        meta: { title: "x" },
        slides: [{ layout: "stats", elements: [{ type: "stat", value: "1" }] }],
      },
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("slides[0].elements[0].label");
  });

  it("stores images from data URIs and replaces broken URLs by a placeholder", async () => {
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#f00" } })
      .png()
      .toBuffer();
    const added = await call("add_image", {
      source: `data:image/png;base64,${png.toString("base64")}`,
    });
    expect(added.structuredContent!.asset).toMatch(/^asset:a_/);

    const r = await call("create_presentation", {
      presentation: {
        meta: { title: "Imagens" },
        slides: [
          {
            layout: "full-image",
            elements: [{ type: "image", asset: "http://127.0.0.1:1/x.png", alt: "x" }],
          },
        ],
      },
    });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]!.text).toContain("placeholder");
  });

  it("renders the HTML file and a preview", async () => {
    const list = await call("list_presentations");
    const id = (list.structuredContent!.presentations as Array<{ id: string }>)[0]!.id;
    const rendered = await call("render", { id });
    expect(rendered.structuredContent!.path).toMatch(new RegExp(`^${home}/.+\\.html$`));
    const preview = await call("preview", { id });
    if (preview.isError) {
      expect(preview.content[0]!.text).toContain("Chrome");
    } else {
      expect(preview.content[0]!.type).toBe("image");
      expect(preview.content[1]!.text).toContain("Slides shown");
    }
  }, 60_000);

  it("does not lose the stale-version error type", () => {
    expect(new ConflictError("x", [], 1)).toBeInstanceOf(Error);
  });
});

describe("SSRF protection", () => {
  it("classifies private addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.10",
      "172.20.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "0.0.0.0",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("refuses local URLs, odd ports and other schemes", async () => {
    await expect(fetchImage("http://localhost/x.png", 1000)).rejects.toThrow(/private or local/);
    await expect(fetchImage("http://[::1]/x.png", 1000)).rejects.toThrow(/private or local/);
    await expect(fetchImage("http://example.com:8080/x.png", 1000)).rejects.toThrow(/ports/);
    await expect(fetchImage("file:///etc/passwd", 1000)).rejects.toThrow(/http/);
  });

  it("downloads from a hostname (pinned DNS answers Node's `all` lookups)", async () => {
    // IP literals skip DNS; a hostname goes through the pinned lookup, which Node calls with
    // { all: true } (autoSelectFamily). Regression: that path failed for every real host.
    const srv = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (srv.address() as { port: number }).port;
      const r = await fetchPublic(`http://localhost:${port}/doc`, {
        maxBytes: 1000,
        accept: "*/*",
        allowPrivate: true,
      });
      expect(Buffer.from(r.data).toString()).toBe("ok");
    } finally {
      srv.close();
    }
  });
});

describe("editor HTTP API", () => {
  const url = (path: string) => `${rt.base()}${path}`;

  it("requires the session token and a CSRF header", async () => {
    expect((await fetch(url("/api/presentations"))).status).toBe(401);
    const page = await fetch(url(`/?t=${rt.token}`), { redirect: "manual" });
    expect(page.status).toBe(302);
    const cookie = page.headers.get("set-cookie")!.split(";")[0]!;
    expect((await fetch(url("/api/presentations"), { headers: { cookie } })).status).toBe(200);
    const blocked = await fetch(url("/api/presentations"), {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
    expect(blocked.status).toBe(403);
    const created = await fetch(url("/api/presentations"), {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-apresenta": "1" },
      body: JSON.stringify({ title: "Em branco" }),
    });
    expect(created.status).toBe(201);
    const { presentation } = (await created.json()) as {
      presentation: { id: string; version: number };
    };
    const html = await fetch(url(`/api/presentations/${presentation.id}/export.html`), {
      headers: { cookie },
    });
    expect(await html.text()).toContain("<title>Em branco</title>");

    const stale = await fetch(url(`/api/presentations/${presentation.id}/ops`), {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-apresenta": "1" },
      body: JSON.stringify({
        expectedVersion: 1,
        operations: [{ op: "update_presentation", patch: { title: "Novo" } }],
      }),
    });
    expect(stale.status).toBe(200);
  });

  it("rejects foreign Host headers (DNS rebinding)", async () => {
    // fetch() cannot override Host, so use node:http.
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(url("/api/health"));
      http
        .get(
          { host: u.hostname, port: u.port, path: u.pathname, headers: { host: "evil.example" } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        )
        .on("error", reject);
    });
    expect(status).toBe(421);
  });
});
