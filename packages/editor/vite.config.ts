import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the editor runs on Vite and talks to a running local server
// (`pnpm --filter @apresenta/server dev -- --editor`), on APRESENTA_PORT (default 47800).
const target = `http://127.0.0.1:${process.env.APRESENTA_PORT ?? 47800}`;

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: true, chunkSizeWarningLimit: 2500 },
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: true },
      "/media/": { target, changeOrigin: true },
    },
  },
});
