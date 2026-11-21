// Shared by the phase 8 probes that drive a real Loomwright install (`phase-8-walk-order-probe.test.ts`,
// `phase-8-triage-fix-probe.test.ts`): the install gate, the table-driven stub `gh`, and the ONE environment every
// child process they spawn is given.
//
// Every child gets `probeEnv`, never `process.env`: an allow-list (PATH, a sandboxed HOME, a fixed git identity,
// GIT_CONFIG_NOSYSTEM, plus what the caller names). Git exports GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE to hooks,
// so a suite run from a hook in a worktree lane would otherwise point a scratch `git commit` (or the driver's own git
// calls) at the lane's real repository. Nothing here holds state: each call builds a fresh object.
import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLoomwrightInstall } from "../../src/loomwright/active-install.js";

/** The fixed git identity and config isolation every probe child gets. */
export const PROBE_GIT_IDENTITY = Object.freeze({
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "probe",
  GIT_AUTHOR_EMAIL: "probe@example.invalid",
  GIT_COMMITTER_NAME: "probe",
  GIT_COMMITTER_EMAIL: "probe@example.invalid",
});

/**
 * The environment for a probe's child process, built from an allow-list. Only `PATH` is read from the parent
 * (`bin`, when given, goes first); `home` sandboxes HOME; `extra` adds the caller's named seams (stub tables, logs,
 * `LOOMWRIGHT_GH_BIN`, the driver's test hooks). No other parent variable, and no GIT_* beyond the identity, reaches
 * the child.
 */
export function probeEnv(home: string, opts: { readonly bin?: string; readonly extra?: Readonly<Record<string, string>> } = {}): Record<string, string> {
  const parentPath = process.env.PATH ?? "/usr/bin:/bin";
  return {
    PATH: opts.bin === undefined ? parentPath : `${opts.bin}:${parentPath}`,
    HOME: home,
    ...PROBE_GIT_IDENTITY,
    ...opts.extra,
  };
}

/** The Loomwright plugin dir at `version`, or why the install-gated cases skip. */
export function probeInstall(version: string): { readonly root: string } | { readonly skip: string } {
  const forced = process.env.STUDIO_PROBE_LOOMWRIGHT;
  if (forced === "none") return { skip: "STUDIO_PROBE_LOOMWRIGHT=none" };
  let root: string;
  let found: string;
  try {
    const install = resolveLoomwrightInstall(forced === undefined || forced === "" ? {} : { configured: forced });
    root = install.installPath;
    found = install.contract.plugin_version;
  } catch (err) {
    return { skip: `no Loomwright install resolves (${err instanceof Error ? err.message.split("\n")[0] : String(err)})` };
  }
  if (found !== version) return { skip: `the resolved Loomwright is ${found}, not ${version}` };
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  for (const tool of ["bash", "git", "jq"]) {
    if (spawnSync(tool, ["--version"], { stdio: "ignore", env }).status !== 0) return { skip: `${tool} is not on PATH` };
  }
  return { root };
}

/** The stub: the first row whose glob matches the whole argv answers; no row ⇒ `UNMATCHED` logged and exit 1. */
const GH_STUB = `#!/usr/bin/env bash
all="$*"; printf 'gh %s\\n' "$all" >> "$GH_LOG"
while IFS="\t" read -r rc pat out || [ -n "$rc" ]; do
  case "$rc" in ""|"#"*) continue ;; esac
  case "$all" in $pat) [ -n "$out" ] && printf "%s\\n" "$out"; exit "$rc" ;; esac
done < "$GH_TABLE"
echo "gh-stub: unmatched: $all" >&2; printf 'UNMATCHED %s\\n' "$all" >> "$GH_LOG"; exit 1
`;

/** Writes the stub `gh` into `bin` (executable); it reads `$GH_TABLE` and appends to `$GH_LOG`. */
export function writeGhStub(bin: string): string {
  const path = join(bin, "gh");
  writeFileSync(path, GH_STUB);
  chmodSync(path, 0o755);
  return path;
}

/** One stub row: exit code, a glob over the whole argv, and the output. */
export type GhRow = readonly [number, string, string];

/** Replaces the stub's table at `path`: first match wins. */
export function writeGhTable(path: string, rows: readonly GhRow[]): void {
  writeFileSync(path, rows.map(([rc, pat, out]) => `${rc}\t${pat}\t${out}\n`).join(""));
}
