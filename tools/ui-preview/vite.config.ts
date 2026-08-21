import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Browser-only preview of `src/renderer`. Not used by electron-vite, electron-builder,
 * or `npm start`. Do not move this under `src/renderer/` — that folder is the real panel.
 */
export default defineConfig({
  root: here,
  publicDir: false,
  server: {
    port: 5199,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
});
