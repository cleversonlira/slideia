import { execSync } from "node:child_process";

/** Builds the example presentations (out/examples) and the local server bundle with the editor. */
export default function globalSetup(): void {
  execSync("pnpm --filter @slideia/renderer run examples", { stdio: "inherit" });
  execSync("pnpm --filter @slideia/server run build", { stdio: "inherit" });
}
