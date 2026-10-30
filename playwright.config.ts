import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    // Uses the installed Google Chrome; run `npx playwright install chromium` and drop this
    // line to use Playwright's bundled browser instead.
    channel: "chrome",
    viewport: { width: 1280, height: 720 },
    acceptDownloads: true,
  },
});
