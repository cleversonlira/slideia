import { execSync } from "node:child_process";

/** Builds the example presentations (out/examples) and the local server bundle with the editor. */
export default function globalSetup(): void {
  execSync("pnpm --filter @apresenta/renderer run examples", { stdio: "inherit" });
  execSync("pnpm --filter @apresenta/server run build", { stdio: "inherit" });
}
