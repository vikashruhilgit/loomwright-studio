import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { SessionError } from "./types.js";

/** Where Claude Code caches installed versions of the Loomwright plugin. */
export function defaultPluginCacheRoot(home: string = homedir()): string {
  return join(home, ".claude", "plugins", "cache", "atelier", "loomwright");
}

const MANIFEST = join(".claude-plugin", "plugin.json");
const VERSION_DIR = /^(\d+)\.(\d+)\.(\d+)$/;

function hasManifest(dir: string): boolean {
  return existsSync(join(dir, MANIFEST));
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export interface ResolveLoomwrightPathOptions {
  /** The configured plugin dir. Non-empty wins, and must hold `.claude-plugin/plugin.json`. */
  readonly configured?: string;
  /** Defaults to `defaultPluginCacheRoot()`. */
  readonly cacheRoot?: string;
}

/**
 * The absolute Loomwright plugin dir a session loads (AC8).
 *
 * A non-empty `configured` path wins; it must contain
 * `.claude-plugin/plugin.json`, and a bad configured path is an error — never
 * a silent fallback to the cache. Otherwise: the numerically newest
 * `<major>.<minor>.<patch>` directory under `cacheRoot` that has the manifest
 * (the cache keeps stale leftovers without one, and a lexical sort would put
 * 15.98.0 above 15.115.0). Throws `SessionError` (`loomwright_not_found`).
 */
export function resolveLoomwrightPath(options: ResolveLoomwrightPathOptions = {}): string {
  const configured = options.configured;
  if (configured !== undefined && configured !== "") {
    const path = resolve(configured);
    if (!hasManifest(path)) {
      throw new SessionError(
        "loomwright_not_found",
        `configured Loomwright path ${path} has no ${MANIFEST}`,
      );
    }
    return path;
  }

  const cacheRoot = resolve(options.cacheRoot ?? defaultPluginCacheRoot());
  let names: string[];
  try {
    names = readdirSync(cacheRoot);
  } catch {
    names = [];
  }

  let best: { path: string; version: [number, number, number] } | undefined;
  for (const name of names) {
    const m = VERSION_DIR.exec(name);
    if (m === null) continue;
    const path = join(cacheRoot, name);
    if (!isDirectory(path) || !hasManifest(path)) continue;
    const version: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (best === undefined || compareVersions(version, best.version) > 0) best = { path, version };
  }
  if (best === undefined) {
    throw new SessionError(
      "loomwright_not_found",
      `no Loomwright install with ${MANIFEST} under ${cacheRoot}, and no configured path`,
    );
  }
  return best.path;
}

function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
