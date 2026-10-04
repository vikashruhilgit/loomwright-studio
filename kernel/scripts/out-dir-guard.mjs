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
//      (a kernel/dist symlink to a directory inside kernel/ lands here)
//   3b. the kernel/dist ENTRY is not a real directory (a regular file, or a
//      symlink of any kind: dangling, or live to a directory or file inside
//      or outside kernel/) and the out dir resolves to it or through it
//                                                           -> refuse
//      Decided by walking the out dir's path one entry at a time, following
//      symlinks as realpath does, and comparing each entry's own lstat
//      identity to kernel/dist's, so every spelling of the entry ("dist",
//      "./dist/sub", a case-altered or firmlink alias, a symlink to it) is
//      caught. The build may create kernel/dist only when NOTHING is there and
//      may write through kernel/dist only when it is a real directory: this is
//      the guard's own fail-closed contract, whatever the caller would do next.
//      An out dir that reaches the same target WITHOUT passing through the
//      kernel/dist entry is judged by layers 1-5 like any other path.
//   4. the out dir exists and is not a directory            -> refuse
//   5. the out dir is an existing non-empty dir other than kernel/dist that
//      does not carry the build marker                      -> refuse
// Layer 5 is a backstop: it holds even if 1-3 were ever wrong, and it is the
// only layer that catches a mount or firmlink ancestor of kernel/.
import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

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

// Linux's own limit; a longer chain is a loop (realpath reports ELOOP).
const MAX_SYMLINKS = 40;

// True when resolving `p` (absolute) visits the directory entry whose OWN
// lstat identity is `entryId`: as the final entry, as an intermediate one, or
// as any entry a symlink along the way points at. Follows symlinks as realpath
// does (".." in a link target applies to the symlink-free path walked so far).
// A missing entry (ENOENT) or a non-directory parent (ENOTDIR) ends the walk:
// nothing below it exists, so the entry cannot be reached. Any other error,
// and a symlink loop, throws: the caller fails closed.
function resolvesThrough(p, entryId) {
  let cur = parse(p).root;
  const todo = p.slice(cur.length).split(sep).filter(Boolean);
  let links = 0;
  while (todo.length > 0) {
    const seg = todo.shift();
    if (seg === ".") continue;
    if (seg === "..") {
      cur = dirname(cur);
      continue;
    }
    const next = join(cur, seg);
    let st;
    try {
      st = lstatSync(next, { bigint: true });
    } catch (err) {
      if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return false;
      throw err;
    }
    if (st.dev === entryId.dev && st.ino === entryId.ino) return true;
    if (st.isSymbolicLink()) {
      if (++links > MAX_SYMLINKS) throw new Error(`too many symbolic links resolving ${p}`);
      const target = readlinkSync(next);
      todo.unshift(...target.split(sep).filter(Boolean));
      if (isAbsolute(target)) cur = parse(target).root;
      continue;
    }
    cur = next;
  }
  return false;
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
  // `distEntry`: the lstat identity of ANYTHING at kernel/dist (a directory,
  // file or symlink, dangling or not), else null. `distId`: the same, only
  // when it is a real directory.
  const distPath = join(realKernel, "dist");
  let distId = null;
  let distEntry = null;
  try {
    const st = lstatSync(distPath, { bigint: true });
    distEntry = { dev: st.dev, ino: st.ino };
    if (st.isDirectory()) distId = distEntry;
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  const distExists = distEntry !== null;

  const target = resolve(realKernel, outDirArg);
  const { existing, missing } = splitExisting(target);
  // For messages only; no decision below reads this string.
  const outDir = missing.length === 0 ? existing : join(existing, ...missing);
  const refuse = (why) => {
    throw new Error(`refusing to use ${outDir} as the build output directory: ${why}`);
  };
  const outId = missing.length === 0 ? identity(existing) : null;
  // Layer 3b's question, asked once: is a non-directory kernel/dist entry on
  // the out dir's resolution path?
  const viaBadDist = distExists && distId === null && resolvesThrough(target, distEntry);
  const refuseBadDist = () =>
    refuse(
      "kernel/dist exists but is not a directory (it is a file or a symlink, dangling or live); " +
        "remove kernel/dist, then build again",
    );

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
      // checkout) may the build create exactly kernel/dist. This name check
      // only narrows an identity-decided "inside kernel/"; any other spelling
      // is refused.
      isDist = !distExists && missing.length === 1 && missing[0] === "dist";
    }
    if (!isDist) {
      // 3b inside kernel/: the out dir IS the bad entry (a regular file at
      // kernel/dist) or lies below a dangling kernel/dist symlink. A kernel/dist
      // symlink to a directory inside kernel/ keeps the layer-3 message.
      if (viaBadDist && (missing.length > 0 || sameIdentity(outId, distEntry))) refuseBadDist();
      refuse("it is inside the kernel directory (only kernel/dist is allowed there)");
    }
  }

  // 3b outside kernel/: a kernel/dist symlink to a directory (or file) outside
  // kernel/. The build would wipe the link's target, so fail closed.
  if (viaBadDist) refuseBadDist();

  // 4 and 5. An existing out dir must be a directory this build owns.
  if (outId !== null) {
    if (!statSync(existing).isDirectory()) refuse("it exists and is not a directory");
    const owned = isDist || readdirSync(existing).length === 0 || existsSync(join(existing, BUILD_MARKER));
    if (!owned) refuse(`it is a non-empty directory without the ${BUILD_MARKER} marker`);
  }
  return outDir;
}
