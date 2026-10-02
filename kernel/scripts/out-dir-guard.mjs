// Decides whether scripts/build.mjs may wipe a build output directory. The
// build removes its out dir recursively, so this check is the only thing
// between a mistyped --out-dir and a deleted tree.
//
// Every comparison is between REAL paths (symlinks and aliases such as macOS
// /var -> /private/var resolved), split into path segments, never a raw string
// prefix: "/a/..evil" is not inside "/a/..", and "/a/link" may be "/b".
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

// Written into the out dir by every build, before tsc runs. An existing
// non-empty dir outside kernel/ is wiped only when it carries this marker, so
// --out-dir can never delete a directory this script did not create.
export const BUILD_MARKER = ".studio-kernel-build";

// The real path of `p`, which need not exist yet: the nearest existing
// ancestor is realpathed and the missing segments are appended unchanged.
function realpathAllowMissing(p) {
  const missing = [];
  let cur = p;
  for (;;) {
    try {
      return join(realpathSync(cur), ...missing.reverse());
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
      const parent = dirname(cur);
      if (parent === cur) throw err;
      missing.push(basename(cur));
      cur = parent;
    }
  }
}

// True when `child` is `parent` itself or lies inside it, by path segments.
function isWithin(parent, child) {
  const rel = relative(parent, child);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}

// Resolves `outDirArg` (relative to kernelDir) to the real path the build
// will remove and write, or throws if removing it could destroy anything the
// build does not own.
export function resolveBuildOutDir(kernelDir, outDirArg) {
  const realKernel = realpathSync(kernelDir);
  const outDir = realpathAllowMissing(resolve(realKernel, outDirArg));
  const refuse = (why) => {
    throw new Error(`refusing to use ${outDir} as the build output directory: ${why}`);
  };

  if (outDir === parse(outDir).root) refuse("it is a filesystem root");
  if (isWithin(outDir, realKernel)) refuse("it is the kernel directory or contains it");
  const defaultDist = join(realKernel, "dist");
  if (isWithin(realKernel, outDir) && outDir !== defaultDist) {
    refuse("it is inside the kernel directory (only kernel/dist is allowed there)");
  }

  if (existsSync(outDir)) {
    if (!statSync(outDir).isDirectory()) refuse("it exists and is not a directory");
    const owned =
      outDir === defaultDist ||
      readdirSync(outDir).length === 0 ||
      existsSync(join(outDir, BUILD_MARKER));
    if (!owned) refuse(`it is a non-empty directory without the ${BUILD_MARKER} marker`);
  }
  return outDir;
}
