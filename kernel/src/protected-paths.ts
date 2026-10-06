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
function withoutFirmlink(path: string): string {
  const lower = path.toLowerCase();
  if (lower === FIRMLINK_DATA_ROOT) return sep;
  return lower.startsWith(`${FIRMLINK_DATA_ROOT}${sep}`) ? path.slice(FIRMLINK_DATA_ROOT.length) : path;
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
 * Whether `path` (absolute, or resolved against the cwd) is one of
 * `PROTECTED_LOCATIONS` under `homeDir` or inside one, after symlink
 * resolution where it exists. Each location is compared both as written and
 * resolved, so a symlinked home or folder can't hide it, and both the path and
 * the location also without a `/System/Volumes/Data` firmlink prefix, so that
 * alias of the same folder can't hide it either.
 */
export function isProtectedPath(path: string, homeDir: string): boolean {
  const candidates = withAliases([resolve(path), resolveExisting(path)]);
  for (const location of PROTECTED_LOCATIONS) {
    const lexical = join(resolve(homeDir), location);
    for (const root of withAliases([lexical, resolveExisting(lexical)])) {
      for (const candidate of candidates) if (isInside(candidate, root)) return true;
    }
  }
  return false;
}
