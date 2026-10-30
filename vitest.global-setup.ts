import { execSync } from "node:child_process";

/** Builds the player bundle (packages/renderer/dist/player.js) that the HTML export embeds. */
export default function globalSetup(): void {
  execSync("pnpm --filter @slideia/renderer run build", { stdio: "inherit" });
}
