// Decides whether scripts/build.mjs may wipe a build output directory. The
// build removes its out dir recursively, so this check is the only thing
// between a mistyped --out-dir and a deleted tree.
//
// "Is X this directory?" is decided by IDENTITY, never by comparing path
// strings. Two spellings of one directory (a symlink, macOS /var ->
// /private/var, a case-altered name on a case-insensitive volume, a firmlink,
// a bind mount) can differ as strings, and no realpath reliably canonicalises
// all of them. They always share {dev, ino}, so every such question below is a
// stat identity comparison, and every "is X inside Y?" question is answered by
// walking X's real parent chain (dirname of a symlink-free path) and comparing
// each step's identity to Y's.
//
// What identity does NOT give: layers 1 and 2 compare the out dir only with
// the filesystem root and with the steps of kernel/'s OWN real parent chain. A
// directory that is an ancestor of kernel/ only through a mount or a firmlink
// is on no such chain, so neither layer catches it. On macOS kernel/'s real
// chain runs /Users/... -> /Users -> /, while the data volume holding it is
// mounted at /System/Volumes/Data (inside /System/Volumes): both of those
// contain kernel/ through the /Users firmlink, yet they are neither "/" nor on
// kernel/'s chain. Such a directory is caught ONLY by layer 5 (it is non-empty
// and carries no build marker).
//
// Layers, in order:
//   1. the out dir is a filesystem root                    -> refuse
//   2. the out dir is kernel/ or one of its ancestors on
//      kernel/'s real parent chain                          -> refuse
//   3. the out dir is inside kernel/ and is not kernel/dist -> refuse
//      (including when something that is not a real directory, such as a
//      dangling symlink or a file, sits at kernel/dist: the build may create
//      kernel/dist only when NOTHING is there. This is the guard's own
//      fail-closed contract, whatever the caller would do next.)
//   4. the out dir exists and is not a directory            -> refuse
//   5. the out dir is an existing non-empty dir other than kernel/dist that
//      does not carry the build marker                      -> refuse
// Layer 5 is a backstop: it holds even if 1-3 were ever wrong, and it is the
// only layer that catches a mount or firmlink ancestor of kernel/.
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
  // `distExists`: ANYTHING is at kernel/dist (a directory, file or symlink,
  // dangling or not). `distId`: only a real directory there.
  const distPath = join(realKernel, "dist");
  let distId = null;
  let distExists = false;
  try {
    const st = lstatSync(distPath, { bigint: true });
    distExists = true;
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
      // The nearest existing ancestor is kernel/ itself and there is no real
      // kernel/dist directory. Only when NOTHING is at kernel/dist (a fresh
      // checkout) may the build create exactly kernel/dist. A dangling
      // kernel/dist symlink also lands here (realpath reports it missing), so
      // anything at kernel/dist that is not a real directory is refused: fail
      // closed, whatever the caller would do with it next. This name check
      // only narrows an identity-decided "inside kernel/"; any other spelling
      // is refused.
      if (distExists && missing[0] === "dist") {
        refuse("kernel/dist exists but is not a directory (remove the kernel/dist symlink or file, then build again)");
      }
      isDist = !distExists && missing.length === 1 && missing[0] === "dist";
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
