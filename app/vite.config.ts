// The renderer's build (`vite build` -> dist/). The main process and the
// preload are built separately by scripts/build-electron.mjs.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths: the packaged app loads dist/index.html from disk.
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
