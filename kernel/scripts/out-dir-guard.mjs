// Decides whether scripts/build.mjs may wipe a build output directory. The
// build removes its out dir recursively, so this check is the only thing
// between a mistyped --out-dir and a deleted tree.
//
// Containment is decided by IDENTITY, never by comparing path strings. Two
// spellings of one directory (a symlink, macOS /var -> /private/var, a
// case-altered name on a case-insensitive volume, a /System/Volumes/Data
// firmlink, a bind mount) can differ as strings, and no realpath reliably
// canonicalises all of them. They always share {dev, ino}, so every
// "is X this directory?" question below is a stat identity comparison, and
// every "is X inside Y?" question is answered by walking X's real parent chain
// (dirname of a symlink-free path) and comparing each step's identity to Y's.
//
// Layers, in order:
//   1. the out dir is a filesystem root                    -> refuse
//   2. the out dir is kernel/ or one of its ancestors       -> refuse
//   3. the out dir is inside kernel/ and is not kernel/dist -> refuse
//   4. the out dir exists and is not a directory            -> refuse
//   5. the out dir is an existing non-empty dir other than kernel/dist that
//      does not carry the build marker                      -> refuse
// Layer 5 is a backstop: it holds even if 1-3 were ever wrong.
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, parse, resolve } from "node:path";

// Written into the out dir by every build, before tsc runs. An existing
// non-empty dir other than kernel/dist is wiped only when it carries this
// marker, so --out-dir can never delete a directory this script did not create.
export const BUILD_MARKER = ".studio-kernel-build";

// The {dev, ino} identity of `p` (symlinks followed), as bigints so a large
// inode number never loses precision.
function identity(p) {
  const st = statSync(p, { bigint: true });
  return { dev: st.dev, ino: st.ino };
}

function sameIdentity(a, b) {
  return a !== null && b !== null && a.dev === b.dev && a.ino === b.ino;
}

// Splits `p` (which need not exist) into the real path of its nearest existing
// ancestor and the missing segments below it. The returned `existing` contains
// no symlinks, so dirname() walks its true parent chain. Only ENOENT counts as
// "missing": any other error (e.g. ENOTDIR for "<file>/sub") is rethrown.
function splitExisting(p) {
  const missing = [];
  let cur = p;
  for (;;) {
    try {
      return { existing: realpathSync.native(cur), missing: missing.reverse() };
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
      const parent = dirname(cur);
      if (parent === cur) throw err;
      missing.push(basename(cur));
      cur = parent;
    }
  }
}

// The real parent chain of a symlink-free path: [p, dirname(p), ..., root].
function parentChain(p) {
  const chain = [p];
  for (let cur = p; dirname(cur) !== cur; cur = dirname(cur)) chain.push(dirname(cur));
  return chain;
}

// Resolves `outDirArg` (relative to kernelDir) to the real path the build
// will remove and write, or throws if removing it could destroy anything the
// build does not own.
export function resolveBuildOutDir(kernelDir, outDirArg) {
  const realKernel = realpathSync.native(kernelDir);
  const kernelId = identity(realKernel);
  // lstat, not stat: a kernel/dist symlink (say, to kernel/src) must never be
  // mistaken for the real kernel/dist.
  const distPath = join(realKernel, "dist");
  let distId = null;
  try {
    const st = lstatSync(distPath, { bigint: true });
    if (st.isDirectory()) distId = { dev: st.dev, ino: st.ino };
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }

  const { existing, missing } = splitExisting(resolve(realKernel, outDirArg));
  // For messages only; no decision below reads this string.
  const outDir = missing.length === 0 ? existing : join(existing, ...missing);
  const refuse = (why) => {
    throw new Error(`refusing to use ${outDir} as the build output directory: ${why}`);
  };
  const outId = missing.length === 0 ? identity(existing) : null;

  // 1. A filesystem root (by identity, so an alias of "/" is caught too).
  if (sameIdentity(outId, identity("/")) || sameIdentity(outId, identity(parse(existing).root))) {
    refuse("it is a filesystem root");
  }

  // 2. kernel/ or an ancestor of it: walk kernel/'s real parent chain. A path
  // that does not exist yet cannot contain kernel/.
  if (outId !== null && parentChain(realKernel).some((p) => sameIdentity(identity(p), outId))) {
    refuse("it is the kernel directory or contains it");
  }

  // 3. Inside kernel/: walk the out dir's real parent chain (from its nearest
  // existing ancestor) looking for kernel/'s identity.
  const chain = parentChain(existing);
  const kernelAt = chain.findIndex((p) => sameIdentity(identity(p), kernelId));
  let isDist = false;
  if (kernelAt !== -1) {
    if (kernelAt === 1 && missing.length === 0) {
      // The out dir sits directly under kernel/: allowed only if it IS the
      // real kernel/dist directory.
      isDist = sameIdentity(outId, distId);
    } else if (kernelAt === 0 && distId === null) {
      // The nearest existing ancestor is kernel/ itself and kernel/dist does
      // not exist yet (a fresh checkout): the build may create exactly
      // kernel/dist. This name check only narrows an identity-decided
      // "inside kernel/"; any other spelling is refused.
      isDist = missing.length === 1 && missing[0] === "dist";
    }
    if (!isDist) refuse("it is inside the kernel directory (only kernel/dist is allowed there)");
  }

  // 4 and 5. An existing out dir must be a directory this build owns.
  if (outId !== null) {
    if (!statSync(existing).isDirectory()) refuse("it exists and is not a directory");
    const owned = isDist || readdirSync(existing).length === 0 || existsSync(join(existing, BUILD_MARKER));
    if (!owned) refuse(`it is a non-empty directory without the ${BUILD_MARKER} marker`);
  }
  return outDir;
}
