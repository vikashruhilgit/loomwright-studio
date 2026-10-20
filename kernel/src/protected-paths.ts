// The macOS-protected folders (D31): a launchd job can't read them (TCC
// answers `EPERM`, and a bare `node` binary can't even be prompted for
// access), so the kernel never runs from one (`studio service install`
// refuses such an install target, H07) and never starts or resumes a session
// whose `cwd` is in one (`SessionManager`, `protected_cwd`). A fixed safety
// mechanism, not a playbook policy: there is no setting that widens it.
//
// A leaf module: it imports nothing from `service/` or `sessions/`.
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

/**
 * The protected locations, relative to the home dir (D31, `docs/DECISIONS.md`):
 * `~/Documents`, `~/Desktop`, `~/Downloads` and iCloud Drive
 * (`~/Library/Mobile Documents`). The ONE list: the install-target check and
 * the session `cwd` check both read it.
 */
export const PROTECTED_LOCATIONS: readonly string[] = ["Documents", "Desktop", "Downloads", join("Library", "Mobile Documents")];

/** The same list as `~/…` for messages. */
export function protectedLocationsText(): string {
  return PROTECTED_LOCATIONS.map((l) => `~/${l}`).join(", ");
}

/**
 * `path` with symlinks resolved as far as it exists: `realpathSync.native` on
 * the longest ancestor it can resolve, then the rest appended as written. Any
 * failure (not there yet, or `EPERM` inside a protected folder under launchd)
 * moves one level up, so the lexical part is still compared.
 */
function resolveExisting(path: string): string {
  const tail: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      return join(realpathSync.native(current), ...tail.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return join(current, ...tail.reverse());
      tail.push(basename(current));
      current = parent;
    }
  }
}

/**
 * The macOS firmlink root of the Data volume: `/System/Volumes/Data/Users/…`
 * names the same folder as `/Users/…` (and TCC protects it the same way), yet
 * `realpathSync.native` returns it unchanged, so a symlink resolution alone
 * never maps one form onto the other.
 */
const FIRMLINK_DATA_ROOT = `${sep}system${sep}volumes${sep}data`;

/**
 * `path` (absolute, normalised) with a leading `/System/Volumes/Data` removed,
 * case-insensitively and only on a path-segment boundary
 * (`/System/Volumes/DataX` is left alone). Anything else is returned as is.
 */
export function withoutFirmlink(path: string): string {
  const lower = path.toLowerCase();
  if (lower === FIRMLINK_DATA_ROOT) return sep;
  return lower.startsWith(`${FIRMLINK_DATA_ROOT}${sep}`) ? path.slice(FIRMLINK_DATA_ROOT.length) : path;
}

/**
 * `path` (absolute, or resolved against the cwd) resolved the way the D31
 * check resolves it: symlinks as far as it exists (`resolveExisting`, the rest
 * kept as written), then a leading `/System/Volumes/Data` removed
 * (`withoutFirmlink`). The ONE resolution for a session's recorded `cwd`
 * (`sessions.cwd`, migration 15) and the resume's comparison against it, so a
 * symlinked or firmlinked spelling of the same folder reads as that folder.
 */
export function resolvedPath(path: string): string {
  return withoutFirmlink(resolveExisting(path));
}

/**
 * Both spellings of `path` (absolute, normalised): without the firmlink prefix
 * (`withoutFirmlink`) and with it, so a pattern that globs the prefix itself
 * (`/Sys*` …) is still compared against the form it could expand to. Pure.
 */
export function firmlinkForms(path: string): string[] {
  const bare = withoutFirmlink(path);
  return [bare, bare === sep ? FIRMLINK_DATA_ROOT : `${FIRMLINK_DATA_ROOT}${bare}`];
}

/** Each path, and each path without its firmlink prefix (`withoutFirmlink`). */
function withAliases(paths: readonly string[]): Set<string> {
  return new Set(paths.flatMap((p) => [p, withoutFirmlink(p)]));
}

/** Case-insensitive (APFS is by default), on a path-segment boundary: `~/Documents2` is not inside `~/Documents`. */
function isInside(path: string, root: string): boolean {
  const p = path.toLowerCase();
  const r = root.toLowerCase().replace(/[\\/]+$/, "");
  return p === r || p.startsWith(`${r}${sep}`);
}

/**
 * Whether `path` is `root` or inside it (each absolute, or resolved against
 * the cwd), the ONE containment check: both are compared as written and with
 * symlinks resolved as far as they exist (`resolveExisting`), so a symlink on
 * either side can't hide it, even to a folder not created yet; the path also
 * with and without a `/System/Volumes/Data` firmlink prefix (`firmlinkForms`)
 * and the root also without it (`withAliases`), so that alias of the same
 * folder can't hide it either, on either side (`/System/Volumes` holds
 * `/Users`). Case-insensitive, on a path-segment boundary (`isInside`). Every
 * caller refuses on `true`, so where the firmlink view over-approximates (`/`
 * reads as inside `/System`) it fails closed.
 */
export function isInsidePath(path: string, root: string): boolean {
  // The candidate in BOTH firmlink forms (`firmlinkForms`), so a root that is
  // an ancestor of the prefix itself (`/System`, `/System/Volumes`) still holds
  // a `/Users/…` path; the root's own prefix is stripped (`withAliases`).
  const candidates = new Set([resolve(path), resolveExisting(path)].flatMap(firmlinkForms));
  for (const r of withAliases([resolve(root), resolveExisting(root)])) {
    for (const candidate of candidates) if (isInside(candidate, r)) return true;
  }
  return false;
}

/**
 * Whether `path` (absolute, or resolved against the cwd) is one of
 * `PROTECTED_LOCATIONS` under `homeDir` or inside one (`isInsidePath`, so
 * after symlink resolution where it exists). Each location is compared both as
 * written and resolved, so a symlinked home or folder can't hide it, and both
 * the path and the location also without a `/System/Volumes/Data` firmlink
 * prefix, so that alias of the same folder can't hide it either.
 */
export function isProtectedPath(path: string, homeDir: string): boolean {
  return PROTECTED_LOCATIONS.some((location) => isInsidePath(path, join(resolve(homeDir), location)));
}
