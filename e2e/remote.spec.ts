import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { loadRemoteConfig } from "../packages/server/src/remote/config.js";
import { startRemote, type RemoteRuntime } from "../packages/server/src/remote/main.js";
import { ConsoleMailer } from "../packages/server/src/remote/mailer.js";

/* Remote mode in a real browser: sign-up, e-mail verification, editor with login, OAuth consent. */

const PORT = 47931;
let rt: RemoteRuntime;
let dir: string;
const base = `http://127.0.0.1:${PORT}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "apresenta-e2e-remote-"));
  rt = await startRemote(
    loadRemoteConfig({
      NODE_ENV: "test",
      PORT: String(PORT),
      HOST: "127.0.0.1",
      PUBLIC_URL: base,
      DATABASE_URL: "pglite:memory",
      DATA_DIR: dir,
    }),
    { mailer: new ConsoleMailer() },
  );
});

test.afterAll(async () => {
  await rt?.close();
  rmSync(dir, { recursive: true, force: true });
});

test("sign up, verify e-mail and create a presentation in the editor", async ({ page }, info) => {
  await page.goto(base);
  await expect(page).toHaveURL(/\/entrar/);
  await page.screenshot({ path: info.outputPath("login.png") });
  await page.getByRole("link", { name: "Criar conta" }).click();
  await page.getByLabel("Nome").fill("Joana");
  await page.getByLabel("E-mail").fill("joana@exemplo.com");
  await page.getByLabel(/Senha/).fill("senha-forte-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Confirme seu e-mail" })).toBeVisible();
  // Dev mode shows the link that was e-mailed.
  await page.locator(".dev a").click();
  await expect(page.getByRole("heading", { name: "E-mail confirmado" })).toBeVisible();
  // Signup started at /entrar?next=/ so the confirmation page offers "Continuar" back there.
  await page.getByRole("link", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Minhas apresentações" })).toBeVisible();
  await page.getByRole("button", { name: "+ Nova apresentação" }).click();
  await expect(page.locator(".slide-item")).toHaveCount(2);
  await page.locator(".editor-stage .el-title .rt").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" remota");
  await page.keyboard.press("Escape");
  await expect(page.locator(".editor-stage .el-title")).toContainText("Nova apresentação remota");
  await expect(page.locator(".save-status")).toHaveText("Salvo", { timeout: 10_000 });
  await page.reload();
  await expect(page.locator(".editor-stage .el-title")).toContainText("Nova apresentação remota");
  await page.screenshot({ path: info.outputPath("editor.png") });
});

test("OAuth consent screen authorizes an app and the account page lists it", async ({
  page,
}, info) => {
  // Same browser context is not shared between tests: sign in first.
  await page.goto(`${base}/entrar`);
  await page.getByLabel("E-mail").fill("joana@exemplo.com");
  await page.getByLabel("Senha").fill("senha-forte-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Minhas apresentações" })).toBeVisible();

  const reg = (await (
    await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "ChatGPT (teste)",
        redirect_uris: ["https://chat.example/connector/oauth/callback"],
      }),
    })
  ).json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: reg.client_id,
    redirect_uri: "https://chat.example/connector/oauth/callback",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "s1",
    scope: "presentations:read presentations:write",
    resource: `${base}/mcp`,
  });
  let redirected = "";
  await page.route("https://chat.example/**", (route) => {
    redirected = route.request().url();
    return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Conectado</h1>" });
  });
  await page.goto(`${base}/oauth/authorize?${q}`);
  await expect(page.getByRole("heading", { name: "Autorizar acesso" })).toBeVisible();
  await expect(page.getByText("ChatGPT (teste)")).toBeVisible();
  await expect(page.getByText("Criar e editar apresentações em seu nome")).toBeVisible();
  await page.screenshot({ path: info.outputPath("consent.png") });
  await page.getByRole("button", { name: "Permitir" }).click();
  await expect(page.getByRole("heading", { name: "Conectado" })).toBeVisible();
  const url = new URL(redirected);
  expect(url.searchParams.get("state")).toBe("s1");
  expect(url.searchParams.get("iss")).toBe(base);
  expect(url.searchParams.get("code")).toBeTruthy();

  await page.goto(`${base}/conta`);
  await expect(page.getByText("ChatGPT (teste)")).toBeVisible();
  await expect(page.getByText(`${base}/mcp`)).toBeVisible();
  await page.screenshot({ path: info.outputPath("account.png"), fullPage: true });
  await page.getByRole("button", { name: "Desconectar" }).click();
  await expect(page.getByText("Aplicativo desconectado.")).toBeVisible();
});

test("editor switches light/dark theme and signs out", async ({ page }) => {
  await page.goto(base);
  await page.getByLabel("E-mail").fill("joana@exemplo.com");
  await page.getByLabel("Senha").fill("senha-forte-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Minhas apresentações" })).toBeVisible();

  const html = page.locator("html");
  await page.getByRole("button", { name: "Usar tema escuro" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Usar tema claro" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: "Conta: joana@exemplo.com" }).click();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar/);
  expect(await page.evaluate(async () => (await fetch("/api/me")).status)).toBe(401);
  await page.goto(base);
  await expect(page).toHaveURL(/\/entrar/);
});
