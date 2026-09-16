import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: "target/electron/main" },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "target/electron/preload",
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: { outDir: "target/electron/renderer" },
  },
});
