// The past-the-rail probe (phase 8 item 25a, Part B; evidence in
// docs/evidence/phase-8-25h-past-the-rail.md). The rail sees every command a
// kernel run session asks for, but not what an ADMITTED Loomwright script does
// once it runs: `bash <install>/scripts/review-heal-next-step.sh` is one
// allowed call, and that script may post a PR comment, call a webhook or start
// a detached `claude`. This probe records those outward calls and started
// processes, with the condition that triggers each, so the owner can decide
// which need a kernel-owned path. It changes no run policy (AC 12): it reads
// the four policies from `launch.ts` and nothing else.
//
// Two halves:
//   - STATIC: for every script any of the four run policies admits, read its own
//     text, every file it loads (`. "<f>"`, `source`, the `_ms_source` /
//     `_ah_source` module loaders over `<name>.d/*.sh`) and every sibling script
//     it calls (`bash "$HERE/<x>.sh"`), transitively, and count the outward
//     tokens against the admitted script. A script with none is recorded
//     `no outward call in text (static, loaded files followed)`.
//   - DYNAMIC: run Loomwright's real scripts in a scratch git repo with a bare
//     `origin`, stub `gh` / `claude` / `curl` (and the desktop notifiers) first on
//     `PATH` recording their argv, and the scripts' own seams set to recorders
//     where they exist (`LOOMWRIGHT_GH_BIN`, `RH_POSTMORTEM_CMD`,
//     `NEXT_STEP_WATCH_CMD`).
//
// It never runs in plain `npm test` or CI (the repo convention: no test reads
// the real `~/.claude/plugins/installed_plugins.json` and none runs real
// Loomwright scripts). The live half runs only with STUDIO_LIVE=1 AND an
// install `resolveLoomwrightInstall()` resolves; otherwise every live test is
// skipped with a note naming STUDIO_LIVE=1. The scanner itself is tested in CI
// against a synthetic install written to a temp dir.
//
//   cd kernel && STUDIO_LIVE=1 npx vitest run test/loomwright-past-the-rail-probe.test.ts
//
// SAFETY of the live half: every script runs with a minimal allow-listed env
// (no GH_TOKEN / GITHUB_TOKEN, no webhook URL from the shell, no Claude session
// variables), HOME relocated to the scratch dir, cwd a scratch repo under the OS
// temp dir whose only remote is a local bare repo, and PATH led by the stubs
// (checked with `command -v` before any script runs). The one webhook URL the
// probe sets is a loopback discard address handed to the STUB curl. PR URLs name
// a placeholder repo; `gh` is a stub, so nothing reaches GitHub.
//
// The report (JSON plus the markdown rows the evidence file holds) is written
// to a fresh temp dir whose path is printed at the end of the run.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTOMATE_RUN_POLICY, MERGE_PARKED_RUN_POLICY, MERGE_PARKED_TRUSTED_RUN_POLICY, REVIEW_PR_RUN_POLICY } from "../src/automate/launch.js";
import { resolveLoomwrightInstall } from "../src/loomwright/active-install.js";
import { loomwrightScriptPaths } from "../src/sessions/loomwright-scripts.js";

// ---------------------------------------------------------------------------------------------
// The static scanner
// ---------------------------------------------------------------------------------------------

/** The outward tokens the requirement names (AC 10). */
export type OutwardToken = "gh" | "claude" | "curl" | "nohup" | "background &" | "send-webhook.sh" | "dispatch-*.sh" | "push to origin";

const ZERO_HIT_NOTE = "no outward call in text (static, loaded files followed)";

const TOKEN_PATTERNS: readonly (readonly [OutwardToken, RegExp])[] = [
  // `gh <sub>` as a command word, the overridable binary, the `GH` / `GH_BIN` variables the helpers pass it in,
  // or any quoted `*GH*` variable run with a gh subcommand (`"$LANES_GH" pr create`).
  [
    "gh",
    /(?:^|[\s;&|(`'"])gh\s+[a-z]|\$\{LOOMWRIGHT_GH_BIN:-gh\}|\$\{?GH(?:_BIN)?\b|"\$\{?[A-Za-z_]*GH[A-Za-z_]*(?::-gh)?\}?"\s+(?:pr|api|run|repo|issue|auth|release|workflow|search|label)\b/,
  ],
  // `claude` as a word (not `.claude/`, `claude[bot]`, `claude-review`, `loomwright:…`), or a CLAUDE_BIN variable.
  ["claude", /(?<![\w./:@-])claude(?![\w./[@-])|\$\{?(?:LOOMWRIGHT_)?CLAUDE_BIN\b/],
  ["curl", /(?<![\w./-])curl\s/],
  ["nohup", /\bnohup\b/],
  // A backgrounding `&`: not `&&`, `2>&1`, `&>`, `<&`, `|&`, and followed by a space, `)` or the line end.
  ["background &", /(?<![&><|\\])&(?![&>\d])(?=\s|\)|$)/],
  ["send-webhook.sh", /send-webhook\.sh/],
  ["dispatch-*.sh", /dispatch-[A-Za-z0-9_-]+\.sh/],
];
const PUSH_WORD = /\bpush\b/;
const ORIGIN_WORD = /\borigin\b/;

/** A line that holds no command: a comment (or the shebang). */
function isCommentLine(line: string): boolean {
  return line.trimStart().startsWith("#");
}

/** The outward tokens on one line (empty for a comment line). */
export function outwardTokens(line: string): OutwardToken[] {
  if (isCommentLine(line)) return [];
  const found: OutwardToken[] = [];
  for (const [token, pattern] of TOKEN_PATTERNS) if (pattern.test(line)) found.push(token);
  // A push through any git wrapper (`git push origin`, `g push -q origin`).
  if (PUSH_WORD.test(line) && ORIGIN_WORD.test(line)) found.push("push to origin");
  return found;
}

/** One reference from a scanned file to another file under `scripts/`. */
export interface ScriptEdge {
  readonly kind: "loads" | "calls";
  /** Install-relative, e.g. `scripts/meta-sync.d/commands.sh`. */
  readonly to: string;
  readonly line: number;
}

const LOAD_LINE = /^\s*(?:\.|source)\s+/;
// `_ms_source lock`, `_lanes_source common || { return 1 2>/dev/null || exit 1; }`; never the loader's own `_x_source() {`.
const MODULE_LOADER = /^\s*_[a-z]+_source\s+([a-z][a-z0-9-]*)(?:\s*$|\s+\|\|)/;
// A path built from a directory variable or a `$(…)` directory: `"$HERE/x.sh"`, `"${SELF_DIR}/x.sh"`, `"$(dirname "$0")/x.sh"`.
const SIBLING_REF = /(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\))\/([A-Za-z0-9_.-]+\.sh)\b/g;

/**
 * The files `file` (install-relative, under `scripts/`) loads or calls, resolved
 * against `<installPath>/scripts/` (a module loader line against
 * `scripts/<name>.d/`). Only existing files are returned; comment lines are skipped.
 */
export function scriptEdges(installPath: string, file: string, text: string): ScriptEdge[] {
  const edges: ScriptEdge[] = [];
  const owner = file.replace(/^scripts\//, "").replace(/\.sh$/, "");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (isCommentLine(line)) return;
    const n = i + 1;
    const loader = MODULE_LOADER.exec(line);
    if (loader !== null) {
      const to = `scripts/${owner}.d/${loader[1]}.sh`;
      if (isFile(join(installPath, to))) edges.push({ kind: "loads", to, line: n });
      return;
    }
    const kind = LOAD_LINE.test(line) ? "loads" : "calls";
    for (const m of line.matchAll(SIBLING_REF)) {
      const to = `scripts/${m[1]}`;
      if (to !== file && isFile(join(installPath, to))) edges.push({ kind, to, line: n });
    }
  });
  return edges;
}

/** One outward-token hit in a scanned file. */
export interface StaticHit {
  readonly file: string;
  readonly line: number;
  readonly tokens: readonly OutwardToken[];
  readonly text: string;
}

/** An admitted script's static scan: its closure, how each file was reached, and every hit. */
export interface ScriptScan {
  readonly script: string;
  /** Install-relative, the script first, in the order reached. */
  readonly files: readonly string[];
  /** For each reached file but the script: `<parent>:<line> <loads|calls>`. */
  readonly via: Readonly<Record<string, string>>;
  readonly hits: readonly StaticHit[];
  /** `ZERO_HIT_NOTE` when `hits` is empty, else `null`. */
  readonly note: string | null;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Scan `scripts/<script>` and everything it loads or calls, transitively (each file once). */
export function scanScript(installPath: string, script: string): ScriptScan {
  const start = `scripts/${script}`;
  const files: string[] = [start];
  const via: Record<string, string> = {};
  const hits: StaticHit[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i] as string;
    const text = readFileSync(join(installPath, file), "utf8");
    text.split("\n").forEach((line, j) => {
      const tokens = outwardTokens(line);
      if (tokens.length > 0) hits.push({ file, line: j + 1, tokens, text: line.trim() });
    });
    for (const edge of scriptEdges(installPath, file, text)) {
      if (files.includes(edge.to)) continue;
      files.push(edge.to);
      via[edge.to] = `${file}:${edge.line} ${edge.kind}`;
    }
  }
  return { script, files, via, hits, note: hits.length === 0 ? ZERO_HIT_NOTE : null };
}

/** Every script name any of the four run policies admits, sorted, each once. */
export function admittedScripts(): string[] {
  const all = [AUTOMATE_RUN_POLICY, REVIEW_PR_RUN_POLICY, MERGE_PARKED_RUN_POLICY, MERGE_PARKED_TRUSTED_RUN_POLICY].flatMap(
    (p) => p.loomwrightScripts ?? [],
  );
  return [...new Set(all)].sort();
}

/** Which of the four policies admit `name` (for the report). */
function policiesAdmitting(name: string): string[] {
  const named: readonly (readonly [string, readonly string[] | undefined])[] = [
    ["backlog/resume", AUTOMATE_RUN_POLICY.loomwrightScripts],
    ["review_pr", REVIEW_PR_RUN_POLICY.loomwrightScripts],
    ["merge_parked", MERGE_PARKED_RUN_POLICY.loomwrightScripts],
    ["merge_parked (trusted)", MERGE_PARKED_TRUSTED_RUN_POLICY.loomwrightScripts],
  ];
  return named.filter(([, names]) => (names ?? []).includes(name)).map(([kind]) => kind);
}

// ---------------------------------------------------------------------------------------------
// The live gate
// ---------------------------------------------------------------------------------------------

const LIVE = process.env.STUDIO_LIVE === "1";

function resolveInstall(): { readonly installPath: string | null; readonly version: string | null; readonly why: string } {
  if (!LIVE) return { installPath: null, version: null, why: "" };
  try {
    const install = resolveLoomwrightInstall();
    return { installPath: install.installPath, version: install.contract.plugin_version, why: "" };
  } catch (err) {
    return { installPath: null, version: null, why: err instanceof Error ? err.message : String(err) };
  }
}

const INSTALL = resolveInstall();
const READY = LIVE && INSTALL.installPath !== null;

/** Why the live half is skipped ("" when it runs). Always names STUDIO_LIVE=1. */
export function skipReason(live: boolean, why: string, resolved: boolean): string {
  if (!live) {
    return "skipped: set STUDIO_LIVE=1 (with a resolvable Loomwright install) to run Loomwright's real scripts; plain npm test and CI never run them";
  }
  if (!resolved) return `skipped: STUDIO_LIVE=1 is set but no Loomwright install resolves (${why})`;
  return "";
}

const SKIP_REASON = skipReason(LIVE, INSTALL.why, INSTALL.installPath !== null);

// ---------------------------------------------------------------------------------------------
// The scratch sandbox (live only)
// ---------------------------------------------------------------------------------------------

/** The placeholder PR every dynamic run names: never a real repository. */
const PROBE_PR = "https://github.com/studio-probe/past-the-rail-sandbox/pull/7";
/** A loopback discard address, handed only to the STUB curl. */
const PROBE_WEBHOOK_URL = "http://127.0.0.1:9/studio-past-the-rail-probe";
const STUB_NAMES = ["gh", "claude", "curl", "wget", "osascript", "notify-send", "terminal-notifier", "rec"] as const;
/** The process env keys a script inherits from the test (everything else is dropped: no tokens, no Claude session). */
const ENV_KEEP = ["PATH", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "USER", "LOGNAME", "SHELL", "TERM"] as const;

interface Sandbox {
  readonly dir: string;
  readonly bin: string;
  readonly home: string;
  readonly repo: string;
  readonly origin: string;
  readonly calls: string;
}

function stubBody(name: string, calls: string): string {
  // gh answers the merge watcher's state poll with an OPEN PR, so a started watcher keeps polling (and is TERMed).
  const gh =
    name === "gh"
      ? `case "$*" in *"--json state,headRefOid"*) printf '%s\\n' '{"state":"OPEN","headRefOid":"0000000000000000000000000000000000000000"}' ;; esac\n`
      : "";
  return `#!/bin/sh\nprintf '%s\\t%s\\n' '${name}' "$*" >> '${calls}'\n${gh}exit 0\n`;
}

function newSandbox(root: string, name: string): Sandbox {
  const dir = join(root, name);
  const s: Sandbox = { dir, bin: join(dir, "bin"), home: join(dir, "home"), repo: join(dir, "repo"), origin: join(dir, "origin.git"), calls: join(dir, "calls.log") };
  for (const d of [s.bin, s.home, s.repo, join(dir, "procs")]) mkdirSync(d, { recursive: true });
  writeFileSync(s.calls, "");
  for (const stub of STUB_NAMES) {
    const path = join(s.bin, stub);
    writeFileSync(path, stubBody(stub, s.calls));
    chmodSync(path, 0o755);
  }
  git(s, ["init", "-q", "--bare", s.origin], dir);
  git(s, ["init", "-q", "."], s.repo);
  git(s, ["symbolic-ref", "HEAD", "refs/heads/main"], s.repo);
  git(s, ["remote", "add", "origin", s.origin], s.repo);
  writeFileSync(join(s.repo, "README.md"), "studio past-the-rail probe scratch repo\n");
  git(s, ["add", "README.md"], s.repo);
  git(s, ["commit", "-q", "-m", "probe: scratch"], s.repo);
  assertStubsFirst(s);
  return s;
}

function probeEnv(s: Sandbox, extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_KEEP) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  return {
    ...env,
    HOME: s.home,
    PATH: `${s.bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "studio-probe",
    GIT_AUTHOR_EMAIL: "probe@example.invalid",
    GIT_COMMITTER_NAME: "studio-probe",
    GIT_COMMITTER_EMAIL: "probe@example.invalid",
    LOOMWRIGHT_GH_BIN: join(s.bin, "gh"),
    LOOMWRIGHT_DESKTOP_NOTIFICATIONS: "0",
    LOOMWRIGHT_SCRIPT_EVENTS: "0",
    LOOMWRIGHT_PROC_REGISTRY_DIR: join(s.dir, "procs"),
    ...extra,
  };
}

function git(s: Sandbox, args: readonly string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, env: probeEnv(s), encoding: "utf8", input: "" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}

/** Refuse to run anything unless every stub is what the scripts' PATH lookup finds first. */
function assertStubsFirst(s: Sandbox): void {
  for (const stub of ["gh", "claude", "curl"]) {
    const r = spawnSync("bash", ["-c", `command -v ${stub}`], { env: probeEnv(s), encoding: "utf8", input: "" });
    if (r.stdout.trim() !== join(s.bin, stub)) throw new Error(`the stub ${stub} is not first on PATH (found ${JSON.stringify(r.stdout.trim())}); nothing was run`);
  }
}

interface ScriptRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runScript(s: Sandbox, script: string, args: readonly string[], extra: Readonly<Record<string, string>> = {}): ScriptRun {
  const r = spawnSync("bash", [script, ...args], { cwd: s.repo, env: probeEnv(s, extra), encoding: "utf8", input: "", timeout: 120_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The stub / recorder calls so far: `[name, argv]` per line. */
function calls(s: Sandbox): [string, string][] {
  return readFileSync(s.calls, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const tab = l.indexOf("\t");
      return [l.slice(0, tab), l.slice(tab + 1)];
    });
}

async function pollFor<T>(what: string, seconds: number, read: () => T | undefined): Promise<T> {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const v = read();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error(`timed out after ${seconds}s waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The 1-based line of `scripts/<file>` holding `anchor` (exactly once), so an observed call names its source line. */
function anchorLine(installPath: string, file: string, anchor: string): number {
  const lines = readFileSync(join(installPath, "scripts", file), "utf8").split("\n");
  const at = lines.flatMap((l, i) => (l.includes(anchor) ? [i + 1] : []));
  if (at.length !== 1) throw new Error(`anchor ${JSON.stringify(anchor)} occurs ${at.length} times in scripts/${file} (want 1)`);
  return at[0] as number;
}

/** One observed outward call or started process. */
interface Observed {
  readonly run: string;
  readonly script: string;
  readonly line: number;
  readonly what: string;
  readonly trigger: string;
  readonly seen: string;
}

// ---------------------------------------------------------------------------------------------
// CI: the scanner against a synthetic install
// ---------------------------------------------------------------------------------------------

describe("the past-the-rail scanner (synthetic install, runs in CI)", () => {
  let root = "";
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "studio-ptr-scan-"));
    const w = (rel: string, body: string): void => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), body);
    };
    w("scripts/a.sh", ['#!/usr/bin/env bash', '# gh pr comment in a comment is never a hit', 'HERE="$(cd "$(dirname "$0")" && pwd)"', '. "$HERE/lib.sh"', 'bash "$HERE/b.sh" x 2>&1 && echo ok', ""].join("\n"));
    w("scripts/lib.sh", ['rh_comment() { "${LOOMWRIGHT_GH_BIN:-gh}" pr comment "$PR" --body "$1"; }', ""].join("\n"));
    w("scripts/b.sh", ['nohup bash "$HERE/c.sh" </dev/null >"$LOG" 2>&1 &', ""].join("\n"));
    w("scripts/c.sh", ["curl -fs --max-time 5 \"$URL\"", 'bash "$HERE/send-webhook.sh" --event-type gate', ""].join("\n"));
    w("scripts/send-webhook.sh", ["exit 0", ""].join("\n"));
    w("scripts/m.sh", ["_m_source() { . \"$HERE/m.d/$1.sh\"; }", "_m_source push", "_m_source spawn || { return 1 2>/dev/null || exit 1; }", ""].join("\n"));
    w("scripts/m.d/spawn.sh", ['out="$("$LANES_GH" pr create --base main)"', 'nohup env -u CLAUDECODE claude "${flags[@]}" >> "$LOG" 2>&1 &', ""].join("\n"));
    w("scripts/m.d/push.sh", ['g push -q origin "$c:refs/heads/$BRANCH"', ""].join("\n"));
    w("scripts/quiet.sh", ["#!/usr/bin/env bash", "# curl and claude in a comment", "x=1 2>&1 >/dev/null", "[ -n \"$x\" ] && echo '~/.claude/x' >&2", ""].join("\n"));
  });
  afterAll(() => {
    if (root !== "") rmSync(root, { recursive: true, force: true });
  });

  it("follows loaded files and sibling calls transitively, each reached file with its parent line", () => {
    const scan = scanScript(root, "a.sh");
    expect(scan.files).toEqual(["scripts/a.sh", "scripts/lib.sh", "scripts/b.sh", "scripts/c.sh", "scripts/send-webhook.sh"]);
    expect(scan.via).toEqual({
      "scripts/lib.sh": "scripts/a.sh:4 loads",
      "scripts/b.sh": "scripts/a.sh:5 calls",
      "scripts/c.sh": "scripts/b.sh:1 calls",
      "scripts/send-webhook.sh": "scripts/c.sh:2 calls",
    });
  });

  it("counts every outward token against the admitted script, and never a comment line, `&&` or `2>&1`", () => {
    const scan = scanScript(root, "a.sh");
    expect(scan.hits.map((h) => [h.file, h.line, h.tokens])).toEqual([
      ["scripts/lib.sh", 1, ["gh"]],
      ["scripts/b.sh", 1, ["nohup", "background &"]],
      ["scripts/c.sh", 1, ["curl"]],
      ["scripts/c.sh", 2, ["send-webhook.sh"]],
    ]);
    expect(scan.note).toBeNull();
  });

  it("follows a `_<x>_source <name>` module loader into `<script>.d/<name>.sh` and sees a push through a git wrapper", () => {
    const scan = scanScript(root, "m.sh");
    expect(scan.files).toEqual(["scripts/m.sh", "scripts/m.d/push.sh", "scripts/m.d/spawn.sh"]);
    expect(scan.hits.map((h) => [h.file, h.tokens])).toEqual([
      ["scripts/m.d/push.sh", ["push to origin"]],
      ["scripts/m.d/spawn.sh", ["gh"]],
      ["scripts/m.d/spawn.sh", ["claude", "nohup", "background &"]],
    ]);
  });

  it("records a script with no hit as no outward call in text", () => {
    const scan = scanScript(root, "quiet.sh");
    expect(scan.hits).toEqual([]);
    expect(scan.note).toBe("no outward call in text (static, loaded files followed)");
  });

  it("recognises each named token form", () => {
    expect(outwardTokens('GH="$GH" ; $GH api x')).toContain("gh");
    expect(outwardTokens('"${GH:-gh}" pr view')).toContain("gh");
    expect(outwardTokens('j="$("$GH_BIN" api "repos/$r/actions/runs/$id")"')).toEqual(["gh"]);
    expect(outwardTokens('[ -s "$GH_ERR_FILE" ] && echo "$LANES_GHOST"')).toEqual([]);
    expect(outwardTokens('( nohup "$CLAUDE_BIN" -p "/loomwright:pr-postmortem $PR_URL" & pm_register "$!" & )')).toEqual(["claude", "nohup", "background &"]);
    expect(outwardTokens("claude -p hi")).toEqual(["claude"]);
    expect(outwardTokens('echo "claude[bot] and claude-review and ~/.claude/x"')).toEqual([]);
    expect(outwardTokens('bash "$HERE/dispatch-pr-review.sh" "$PR"')).toEqual(["dispatch-*.sh"]);
    expect(outwardTokens("git push origin HEAD:main")).toEqual(["push to origin"]);
    expect(outwardTokens("git fetch origin main")).toEqual([]);
  });

  it("reads the admitted set from the four run policies, each name once", () => {
    const names = admittedScripts();
    expect(names).toEqual([...new Set(names)].sort());
    expect(names).toContain("review-heal-next-step.sh");
    expect(names).toContain("automate-next-step.sh");
    expect(names).toContain("meta-sync.sh");
  });

  it("names STUDIO_LIVE=1 in every skip reason", () => {
    expect(skipReason(false, "", false)).toContain("STUDIO_LIVE=1");
    expect(skipReason(true, "installed_plugins_missing", false)).toContain("STUDIO_LIVE=1");
    expect(skipReason(true, "", true)).toBe("");
  });
});

// ---------------------------------------------------------------------------------------------
// Live: the real install (STUDIO_LIVE=1 only)
// ---------------------------------------------------------------------------------------------

describe("past the rail: Loomwright's admitted scripts, live (needs STUDIO_LIVE=1 and a resolvable install)", () => {
  const install = INSTALL.installPath ?? "";
  const scripts = join(install, "scripts");
  let root = "";
  const observed: Observed[] = [];
  const scans: ScriptScan[] = [];
  const missing: string[] = [];
  const started: number[] = [];

  beforeAll(() => {
    if (!READY) return;
    root = mkdtempSync(join(tmpdir(), "studio-past-the-rail-"));
  });

  afterAll(() => {
    if (!READY) return;
    for (const pid of started) if (alive(pid)) process.kill(pid, "SIGTERM");
    const out = mkdtempSync(join(tmpdir(), "studio-past-the-rail-report-"));
    writeFileSync(join(out, "report.json"), `${JSON.stringify({ install: INSTALL.installPath, version: INSTALL.version, date: new Date().toISOString(), missing, observed, scans }, null, 2)}\n`);
    writeFileSync(join(out, "report.md"), reportMarkdown(scans, observed, missing));
    writeSync(1, `\npast-the-rail report: ${out}\n`);
    if (process.env.STUDIO_PROBE_KEEP !== "1") rmSync(root, { recursive: true, force: true });
  });

  it("static: scans every admitted script and what it loads or calls", (ctx) => {
    ctx.skip(!READY, SKIP_REASON);
    const names = admittedScripts();
    const admitted = loomwrightScriptPaths(install, names);
    expect(admitted.ok).toBe(true);
    const paths = admitted.ok ? admitted.paths : [];
    for (const name of names) {
      if (!paths.includes(join(install, "scripts", name))) missing.push(name);
      else scans.push(scanScript(install, name));
    }
    expect(missing).toEqual([]);
    expect(scans.length).toBe(names.length);
  });

  it("dynamic: review-heal-next-step.sh's ESCALATED tail posts a PR comment, calls the webhook and hands off the postmortem", (ctx) => {
    ctx.skip(!READY, SKIP_REASON);
    const s = newSandbox(root, "review-heal");
    const r = runScript(s, join(scripts, "review-heal-next-step.sh"), [PROBE_PR, "--start", "drain", "--fix-floor", "urgent", "--root", s.repo], {
      RH_NOTIFY_CMD: `${join(s.bin, "rec")} notify`,
      RH_POSTMORTEM_CMD: `${join(s.bin, "rec")} postmortem`,
      LOOMWRIGHT_WEBHOOK_URL: PROBE_WEBHOOK_URL,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ do: "done", decision: "ESCALATED", message: "fix_floor_invalid" });
    const c = calls(s);
    const comment = c.find(([n, a]) => n === "gh" && a.startsWith(`pr comment ${PROBE_PR} --body `));
    const curl = c.find(([n]) => n === "curl");
    const postmortem = c.find(([n, a]) => n === "rec" && a.startsWith(`postmortem ${PROBE_PR} `));
    expect(comment, JSON.stringify(c)).toBeDefined();
    expect(curl, JSON.stringify(c)).toBeDefined();
    expect(postmortem, JSON.stringify(c)).toBeDefined();
    const trigger = "a drain that ends ESCALATED (here: `--fix-floor urgent` ⇒ fix_floor_invalid); READY takes the same notify path";
    observed.push(
      { run: "review-heal", script: "review-heal-next-step.sh", line: anchorLine(install, "review-heal-next-step.sh", 'pr comment "$PR" --body'), what: "gh pr comment (rh_comment)", trigger, seen: `gh ${comment?.[1].split("\n")[0] ?? ""}` },
      { run: "review-heal", script: "review-heal-next-step.sh", line: anchorLine(install, "review-heal-next-step.sh", 'bash "$HERE/send-webhook.sh" --event-type gate'), what: "send-webhook.sh, which runs curl", trigger: `${trigger}; curl only when a webhook URL resolves (here LOOMWRIGHT_WEBHOOK_URL)`, seen: `curl ${curl?.[1] ?? ""}` },
      { run: "review-heal", script: "review-heal-next-step.sh", line: anchorLine(install, "review-heal-next-step.sh", "rh_once postmortem rh_postmortem_call"), what: "dispatch-pr-postmortem.sh (through RH_POSTMORTEM_CMD)", trigger: "every finished drain run, once (`rh_once postmortem`); the dispatcher applies the churn gate", seen: `RH_POSTMORTEM_CMD ${postmortem?.[1] ?? ""}` },
    );
  });

  it("dynamic: dispatch-pr-postmortem.sh past its churn gate starts a detached `claude -p`", async (ctx) => {
    ctx.skip(!READY, SKIP_REASON);
    const s = newSandbox(root, "postmortem");
    const r = runScript(s, join(scripts, "dispatch-pr-postmortem.sh"), [PROBE_PR, "--fix-cycles", "3", "--decision", "ESCALATED", "--postmortem-churn-threshold", "2"], {
      LOOMWRIGHT_CLAUDE_BIN: join(s.bin, "claude"),
    });
    expect(r.status, r.stderr).toBe(0);
    const claude = await pollFor("the stub claude to be started", 15, () => calls(s).find(([n]) => n === "claude"));
    expect(claude[1]).toBe(`-p /loomwright:pr-postmortem ${PROBE_PR}`);
    observed.push({
      run: "postmortem",
      script: "dispatch-pr-postmortem.sh",
      line: anchorLine(install, "dispatch-pr-postmortem.sh", '( nohup "$CLAUDE_BIN" -p'),
      what: "detached headless claude -p (nohup … &)",
      trigger: "fix_cycles > threshold (default 2), a repeat check failure or unresolved bot feedback, not already dispatched for the PR, not --no-auto-postmortem",
      seen: `claude ${claude[1]}`,
    });
  });

  /** A scratch repo holding a copy of Loomwright's own awaiting_merge golden run file, the PR rewritten to `PROBE_PR`. */
  function parkedRun(s: Sandbox): { readonly rf: string; readonly runId: string } {
    const golden = join(scripts, "fixtures", "automate-golden", "gate-eval-checks-not-green-park");
    const runId = readFileSync(join(golden, "source"), "utf8").match(/^run: *(\S+)/m)?.[1] ?? "";
    expect(runId).not.toBe("");
    const ad = join(s.repo, ".supervisor", "automate");
    mkdirSync(ad, { recursive: true });
    cpSync(join(golden, "tree", "dot-supervisor"), join(s.repo, ".supervisor"), { recursive: true });
    for (const f of readdirSync(ad)) {
      const p = join(ad, f);
      if (isFile(p)) writeFileSync(p, readFileSync(p, "utf8").replace(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/g, PROBE_PR));
    }
    const rf = join(ad, `${runId}.md`);
    writeFileSync(rf, readFileSync(join(golden, "input.md"), "utf8").replace(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/g, PROBE_PR));
    writeFileSync(join(ad, `${runId}.next-step.json`), "{}\n");
    return { rf, runId };
  }

  it("dynamic: automate-next-step.sh's awaiting_merge park launches the merge watcher (seam)", (ctx) => {
    ctx.skip(!READY, SKIP_REASON);
    const s = newSandbox(root, "park-seam");
    const { rf } = parkedRun(s);
    const r = runScript(s, join(scripts, "automate-next-step.sh"), ["--inline-phases", rf], {
      NEXT_STEP_FROM: "park",
      NEXT_STEP_WATCH_CMD: `${join(s.bin, "rec")} watch`,
      NEXT_STEP_NOTIFY_CMD: `${join(s.bin, "rec")} notify`,
      NEXT_STEP_LOCK_CMD: `${join(s.bin, "rec")} lock`,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ do: "park", pause_reason: "awaiting_merge" });
    const watch = calls(s).find(([n, a]) => n === "rec" && a.startsWith("watch "));
    expect(watch, JSON.stringify(calls(s))).toBeDefined();
    expect(watch?.[1].endsWith(` ${PROBE_PR}`)).toBe(true);
    observed.push({
      run: "park-seam",
      script: "automate-next-step.sh",
      line: anchorLine(install, "automate-next-step.sh", "$NEXT_STEP_WATCH_CMD \"$RF\" \"$ITEM\" \"$PR\""),
      what: "the merge-watcher launch (through NEXT_STEP_WATCH_CMD)",
      trigger: "the park step with park_kind awaiting_merge or escalated (never ready_for_release)",
      seen: `NEXT_STEP_WATCH_CMD ${watch?.[1].replace(s.repo, "<repo>") ?? ""}`,
    });
  });

  it("dynamic: with no seam the park starts the real automate-merge-watch.sh detached, which polls gh", async (ctx) => {
    ctx.skip(!READY, SKIP_REASON);
    const s = newSandbox(root, "park-default");
    const { rf, runId } = parkedRun(s);
    const r = runScript(s, join(scripts, "automate-next-step.sh"), ["--inline-phases", rf], {
      NEXT_STEP_FROM: "park",
      NEXT_STEP_NOTIFY_CMD: `${join(s.bin, "rec")} notify`,
      NEXT_STEP_LOCK_CMD: `${join(s.bin, "rec")} lock`,
      // A backstop: the watcher exits on its own within a minute even if the TERM below is missed.
      LOOMWRIGHT_MERGE_WATCH_MAX_SECONDS: "60",
      LOOMWRIGHT_MERGE_WATCH_INTERVAL: "1",
    });
    expect(r.status, r.stderr).toBe(0);
    const marker = join(s.repo, ".supervisor", "automate", `${runId}.merge-watch`);
    const pid = await pollFor("the merge watcher's marker pid", 20, () => {
      const m = existsSync(marker) ? /^pid\t(\d+)$/m.exec(readFileSync(marker, "utf8")) : null;
      return m === null ? undefined : Number(m[1]);
    });
    started.push(pid);
    const poll = await pollFor("the watcher's gh poll", 20, () => calls(s).find(([n, a]) => n === "gh" && a.includes("--json state,headRefOid")));
    expect(alive(pid)).toBe(true);
    process.kill(pid, "SIGTERM");
    await pollFor("the watcher to stop on TERM", 15, () => (alive(pid) ? undefined : true));
    observed.push(
      {
        run: "park-default",
        script: "automate-next-step.sh",
        line: anchorLine(install, "automate-next-step.sh", 'nohup bash "$HERE/automate-merge-watch.sh"'),
        what: "detached nohup bash automate-merge-watch.sh … & (a process that outlives the session)",
        trigger: "the park step with park_kind awaiting_merge or escalated, NEXT_STEP_WATCH_CMD unset (every real run)",
        seen: `watcher pid ${pid} alive after the driver exited`,
      },
      {
        run: "park-default",
        script: "automate-merge-watch.sh",
        line: anchorLine(install, "automate-merge-watch.sh", "--json state,headRefOid"),
        what: "gh pr view polls by the detached watcher",
        trigger: "every LOOMWRIGHT_MERGE_WATCH_INTERVAL (default 60 s) until MERGED / CLOSED / the 72 h cap",
        seen: `gh ${poll[1]}`,
      },
    );
  });

  it("dynamic: meta-sync.sh pushes run history to origin's metadata branch", (ctx) => {
    ctx.skip(!READY, SKIP_REASON);
    const s = newSandbox(root, "meta-sync");
    mkdirSync(join(s.repo, ".supervisor", "automate"), { recursive: true });
    writeFileSync(join(s.repo, ".supervisor", "automate", "probe-run.md"), "# probe run\n");
    const branch = ["--branch", "studio-probe-meta", "--allow-branch-mismatch", "--root", s.repo];
    const init = runScript(s, join(scripts, "meta-sync.sh"), ["init", ...branch]);
    expect(init.status, init.stderr).toBe(0);
    const push = runScript(s, join(scripts, "meta-sync.sh"), ["push", ...branch, "--message", "probe"]);
    expect(push.status, push.stderr).toBe(0);
    const refs = git(s, ["--git-dir", s.origin, "for-each-ref", "--format=%(refname)"], s.dir);
    expect(refs).toContain("refs/heads/studio-probe-meta");
    const tree = git(s, ["--git-dir", s.origin, "ls-tree", "-r", "--name-only", "studio-probe-meta"], s.dir);
    expect(tree).toContain(".supervisor/automate/probe-run.md");
    const trigger = "a session or driver calling meta-sync.sh init / push (an explicit --branch or the checkout's memory mode line)";
    observed.push(
      { run: "meta-sync", script: "meta-sync.d/commands.sh", line: anchorLine(install, "meta-sync.d/commands.sh", 'g push -q origin "$c:refs/heads/$BRANCH"'), what: "push to origin (init creates the metadata branch)", trigger, seen: `origin gained refs/heads/studio-probe-meta` },
      { run: "meta-sync", script: "meta-sync.d/commands.sh", line: anchorLine(install, "meta-sync.d/commands.sh", "g push -q --force-with-lease="), what: "push to origin with --force-with-lease (run history to the metadata branch)", trigger, seen: `origin's studio-probe-meta holds .supervisor/automate/probe-run.md` },
    );
  });
});

/**
 * The rows the evidence file is built from: the observed calls; per admitted
 * script its policies, closure size and hit count (or the zero-hit note); then
 * each hit line once, with the admitted scripts whose closure reaches it.
 */
function reportMarkdown(scans: readonly ScriptScan[], observed: readonly Observed[], missing: readonly string[]): string {
  const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/`/g, "'");
  const out: string[] = ["## Observed (probe)", "", "| Run | Script:line | Call | Trigger | Seen |", "|---|---|---|---|---|"];
  for (const o of observed) out.push(`| ${o.run} | \`${o.script}:${o.line}\` | ${cell(o.what)} | ${cell(o.trigger)} | ${cell(o.seen)} |`);
  out.push("", "## Admitted scripts", "", "| Script | Policies | Files in closure | Hit lines |", "|---|---|---|---|");
  for (const scan of scans) out.push(`| \`${scan.script}\` | ${policiesAdmitting(scan.script).join(", ")} | ${scan.files.length} | ${scan.note ?? scan.hits.length} |`);
  const rows = new Map<string, { hit: StaticHit; from: string[]; via: string }>();
  for (const scan of scans) {
    for (const hit of scan.hits) {
      const key = `${hit.file}:${hit.line}`;
      const row = rows.get(key) ?? { hit, from: [], via: scan.via[hit.file] ?? "itself" };
      row.from.push(scan.script);
      rows.set(key, row);
    }
  }
  out.push("", "## Static hits (read), each line once", "", "| File:line | Tokens | Text | Reached from | First reached via |", "|---|---|---|---|---|");
  const sorted = [...rows.values()].sort((a, b) => a.hit.file.localeCompare(b.hit.file) || a.hit.line - b.hit.line);
  for (const { hit, from, via } of sorted) {
    out.push(`| \`${hit.file.replace(/^scripts\//, "")}:${hit.line}\` | ${hit.tokens.join(", ")} | \`${cell(hit.text.slice(0, 120))}\` | ${from.length} (${from.join(", ")}) | ${via} |`);
  }
  if (missing.length > 0) out.push("", `Admitted but not in the install: ${missing.join(", ")}`);
  return `${out.join("\n")}\n`;
}
