// Builds the kernel with tsc. Plain Node, no dependency, no shell.
//
//   node scripts/build.mjs [--out-dir <dir>]
//
// STUDIO_DISTRIBUTION=1 selects tsconfig.distribution.json, which leaves the
// subscription-token provider out of the output (D29); otherwise the personal
// build (tsconfig.build.json). The out dir (default: dist) is removed first, so
// a stale personal-build file can never survive into a distribution build.
// A relative --out-dir resolves against kernel/, whatever the cwd. What may be
// removed is decided by scripts/out-dir-guard.mjs.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_MARKER, resolveBuildOutDir } from "./out-dir-guard.mjs";

const kernelDir = fileURLToPath(new URL("..", import.meta.url));

function parseOutDirArg(argv) {
  let outDir = "dist";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (value === undefined || value === "") throw new Error("--out-dir needs a value");
      outDir = value;
      i++;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return outDir;
}

const outDir = resolveBuildOutDir(kernelDir, parseOutDirArg(process.argv.slice(2)));

const distribution = process.env.STUDIO_DISTRIBUTION === "1";
const project = join(kernelDir, distribution ? "tsconfig.distribution.json" : "tsconfig.build.json");
const tscBin = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
// Before tsc, so a failed build still leaves a dir the next build may wipe.
writeFileSync(join(outDir, BUILD_MARKER), "Output of loomwright-studio kernel/scripts/build.mjs; safe to delete.\n");
execFileSync(process.execPath, [tscBin, "-p", project, "--outDir", outDir], { stdio: "inherit" });
console.log(`built ${distribution ? "distribution" : "personal"} kernel into ${outDir}`);
