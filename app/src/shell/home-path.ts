// A path as the owner reads it: `~` for their home folder. Pure and free of React so a screen's model
// can import it; the home folder itself comes from the bridge's read-only `homeDir` (`useHomeDir.ts`).

/**
 * `path` with `home` shortened to `~`. A path under home reads `~/…`, home itself reads `~`, and any
 * other path (including one that only starts with home's name, `/Users/o2/x` for home `/Users/o`) reads
 * in full. A trailing slash on `home` is tolerated; an empty or missing `home` returns `path` unchanged.
 */
export function formatHomePath(path: string, home: string | undefined): string {
  if (home === undefined) return path;
  const root = home.replace(/\/+$/, "");
  // "" (no home, or a home of only slashes) has no folder to shorten to.
  if (root === "") return path;
  if (path === root) return "~";
  return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path;
}
