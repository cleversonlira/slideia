import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PresentationError } from "@slideia/core";
import { createMcpServer, loadConfig, startRuntime, type Runtime } from "../src/index.js";

let home: string;
let rt: Runtime;
let client: Client;

type ToolText = {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as ToolText;

const deck = (meta: Record<string, unknown> = {}) => ({
  meta: { title: "Com marca", ...meta },
  slides: [{ layout: "cover", elements: [{ type: "title", text: "Olá" }] }],
});

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "apresenta-brand-"));
  rt = await startRuntime({ ...loadConfig({ APRESENTA_HOME: home }), port: 0 }, { http: false });
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

describe("saved brand", () => {
  it("validates with field paths and stores the logo as an asset", async () => {
    await expect(rt.service.saveBrand({ accent: "blue" })).rejects.toThrow(PresentationError);
    await expect(rt.service.saveBrand({ accent: "blue" })).rejects.toThrow(/brand\.accent/);
    const png = await sharp({
      create: { width: 120, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const saved = await rt.service.saveBrand({
      theme: "tech",
      accent: "#0057b8",
      logo: { asset: `data:image/png;base64,${png.toString("base64")}`, alt: "ACME" },
    });
    expect(saved!.logo!.asset).toMatch(/^asset:/);
    expect(await rt.service.getBrand()).toEqual(saved);
  });

  it("applies to new presentations unless they bring their own overrides", async () => {
    const branded = await rt.service.create(deck({ theme: "minimal" }), "ai", "mcp");
    expect(branded.presentation.meta.theme).toBe("tech");
    expect(branded.presentation.meta.themeOverrides).toMatchObject({ accent: "#0057b8" });
    expect(branded.notes.join(" ")).toContain("saved brand was applied");

    const own = await rt.service.create(
      deck({ themeOverrides: { accent: "#ff0000" } }),
      "ai",
      "mcp",
    );
    expect(own.presentation.meta.themeOverrides).toEqual({ accent: "#ff0000" });

    const plain = await rt.service.create(
      deck({ theme: "minimal", themeOverrides: {} }),
      "ai",
      "mcp",
    );
    expect(plain.presentation.meta.theme).toBe("minimal");
    expect(plain.presentation.meta.themeOverrides ?? {}).toEqual({});
  });

  it("is shown in get_guide and managed with save_brand", async () => {
    expect((await call("get_guide")).content[0]!.text).toContain('"accent":"#0057b8"');

    const own = await rt.service.create(
      deck({ theme: "editorial", themeOverrides: { accent: "#123456", fontBody: "lora" } }),
      "user",
      "editor",
    );
    const saved = await call("save_brand", { fromPresentation: own.presentation.id });
    expect(saved.isError).toBeFalsy();
    expect(saved.structuredContent!.brand).toEqual({
      theme: "editorial",
      accent: "#123456",
      fontBody: "lora",
    });

    const bad = await call("save_brand", { brand: { accent: "nope" } });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toContain("brand.accent");

    await call("save_brand", { clear: true });
    expect(await rt.service.getBrand()).toBeNull();
    expect((await call("get_guide")).content[0]!.text).toContain("call save_brand");
    const after = await rt.service.create(deck({ theme: "minimal" }), "ai", "mcp");
    expect(after.presentation.meta.theme).toBe("minimal");
  });
});
