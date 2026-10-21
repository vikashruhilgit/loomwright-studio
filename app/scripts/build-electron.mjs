#!/usr/bin/env node
// Builds the Electron main process and the preload (dist-electron/main.cjs,
// dist-electron/preload.cjs) with Vite's SSR build. Both are CommonJS: a
// sandboxed preload cannot be an ES module. `electron` and Node's built-ins
// stay external; `ws` (a runtime dependency) is loaded from node_modules.
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

for (const [index, entry] of ["main", "preload"].entries()) {
  await build({
    configFile: false,
    root,
    logLevel: "warn",
    build: {
      outDir: "dist-electron",
      emptyOutDir: index === 0,
      target: "node22",
      minify: false,
      sourcemap: false,
      ssr: `electron/${entry}.ts`,
      rollupOptions: {
        external: ["electron", "ws", /^node:/],
        output: { format: "cjs", entryFileNames: `${entry}.cjs` },
      },
    },
  });
}
