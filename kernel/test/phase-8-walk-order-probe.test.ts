// Phase 8 item 25f: probes for the phase 8 runbook's walk order (`docs/evidence/phase-8-exit-runbook.md`).
//
// R1 and R2 were read from Loomwright's code on 2026-11-20 and never run. This file runs them against the REAL
// Loomwright 18.1.2 driver, `scripts/automate-next-step.sh`, the way Loomwright's own suite does
// (`scripts/test-automate-next-step.sh`, legs V7 / V8 / MP): a scratch git repo under `tmpdir()` (never this lane's
// checkout, whose `.supervisor/lane.json` would make `--merge-parked` refuse `merge_parked_in_lane`), `HOME`
// sandboxed, a table-driven stub `gh` first on PATH and named by `LOOMWRIGHT_GH_BIN` that fails on any call it has
// no row for, and the driver's documented test seams for the merge watcher, the notify and the run lock
// (`NEXT_STEP_WATCH_CMD` / `NEXT_STEP_NOTIFY_CMD` / `NEXT_STEP_LOCK_CMD`, recorders). No network, no model, no
// session. The phases a model would run (`/autonomous`, the owned drain) are answered with fixed RUN and DRAIN
// reports, as Loomwright's V7 leg answers them.
//
//   - R1 (steps 1 and 5): a two-item safe-mode backlog, inline phases (what the kernel's ticket run passes). Item 1
//     runs to its READY park. Observed: while PR A reads OPEN, `--start pick` and `--resume` both park at
//     `reconcile` ("no new item is picked while it is open (single-open-PR invariant)"); once PR A reads MERGED,
//     `--merge-parked` closes item 1 out and stops `awaiting_go` ("the next item waits for /automate --resume");
//     `--resume <run_id>` then picks item 2 and prints its `/autonomous` spawn. So PR B starts only after PR A merges
//     AND the owner's Resume.
//   - R2 (step 4 after step 2): the parked run with `owned_drain_result: READY` and a `- ready_sha: … | ready_at: …`
//     line, then `--merge-parked`. Observed: a moved head and a newer comment park `head_sha_moved` (the guard's
//     first check); a newer comment at an unmoved head parks `ready_stale_feedback`. Exit 0, a `park` at
//     `merge-park`, the item still `awaiting_merge`, gate-eval never reached. So no comment may land on a PR
//     between its READY and its gate merge: the runbook merges PR A before the triage comments.
//   - Step 6: the policy runs before the rail (`kernel/src/sessions/manager.ts`, "The rail applies only after the
//     policy allowed"). A session without the `gh pr` prefix is denied `bash_prefix_not_allowed`, which the live
//     harness counts as a fail; one with it reaches the rail and is denied `merge_blocked`.
//   - AC3: the driver cases need an 18.1.2 install (`STUDIO_PROBE_LOOMWRIGHT=<plugin dir>`, else the kernel's own
//     D32 resolver over `~/.claude/plugins/installed_plugins.json`, never the newest cache folder) plus bash, git
//     and jq; without one they skip with the reason named. `STUDIO_PROBE_LOOMWRIGHT=none` forces the skip. The
//     CI-run case below checks that the recorded answers (`OBSERVED`) and the runbook's walk text agree.
//
// Honest limits: the real `gate-eval` is not run (a MERGE needs live GitHub reads of protection, threads, risk
// and rules); R1's merged leg reads PR A MERGED at the `--merge-parked` entry, which takes the same
// merge-closeout → merge-finish tail a gate MERGE takes. The phases are fixed reports, not real sessions.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { AUTOMATE_RUN_POLICY, MERGE_PARKED_RUN_POLICY, REVIEW_PR_RUN_POLICY } from "../src/automate/launch.js";
import { resolveLoomwrightInstall } from "../src/loomwright/active-install.js";
import { classifyToolCall, decideToolUse } from "../src/sessions/policy.js";
import type { ToolPolicy } from "../src/sessions/types.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNBOOK = join(REPO_ROOT, "docs", "evidence", "phase-8-exit-runbook.md");

/** The Loomwright version these answers were observed on. */
const PROBE_VERSION = "18.1.2";

/**
 * What the real 18.1.2 driver answered (the driver cases assert each against the live call; the CI case asserts the
 * runbook's walk says the same).
 */
const OBSERVED = Object.freeze({
  r1: {
    /** `--start pick` or `--resume` while PR A reads OPEN. */
    openPark: { do: "park", step: "reconcile", pause_reason: "awaiting_merge" },
    openMessage: "no new item is picked while it is open (single-open-PR invariant)",
    /** `--merge-parked` once PR A reads MERGED. */
    mergedStop: { do: "park", step: "awaiting-go", pause_reason: "awaiting_go" },
    mergedMessage: "the next item waits for /automate --resume",
    /** `--resume <run_id>` after that stop: item 2's RUN. */
    resumeSpawn: { do: "spawn", step: "run", what: "/autonomous run" },
  },
  r2: {
    /** A moved head and a comment newer than `ready_at` (the walk's three comments and fix push): the guard's first check. */
    movedHeadAndComment: "head_sha_moved",
    /** A comment newer than `ready_at` at an unmoved head (a reply or an answer alone). */
    commentOnly: "ready_stale_feedback",
  },
});

// ---- The install (AC3) -----------------------------------------------------------------------------------------

/** The 18.1.2 plugin dir, or why the driver cases skip. */
function probeInstall(): { readonly root: string } | { readonly skip: string } {
  const forced = process.env.STUDIO_PROBE_LOOMWRIGHT;
  if (forced === "none") return { skip: "STUDIO_PROBE_LOOMWRIGHT=none" };
  let root: string;
  let version: string;
  try {
    const install = resolveLoomwrightInstall(forced === undefined || forced === "" ? {} : { configured: forced });
    root = install.installPath;
    version = install.contract.plugin_version;
  } catch (err) {
    return { skip: `no Loomwright install resolves (${err instanceof Error ? err.message.split("\n")[0] : String(err)})` };
  }
  if (version !== PROBE_VERSION) return { skip: `the resolved Loomwright is ${version}, not ${PROBE_VERSION}` };
  for (const tool of ["bash", "git", "jq"]) {
    if (spawnSync(tool, ["--version"], { stdio: "ignore" }).status !== 0) return { skip: `${tool} is not on PATH` };
  }
  return { root };
}

const INSTALL = probeInstall();
const SKIP = "skip" in INSTALL ? INSTALL.skip : undefined;
const LOOMWRIGHT = "root" in INSTALL ? INSTALL.root : "";

// ---- A scratch checkout and the stub gh ------------------------------------------------------------------------

const RUN_ID = "automate-2026-11-21-100000";
const ITEM_A = ".supervisor/requirements/walk/01-github-ticket.md";
const ITEM_B = ".supervisor/requirements/walk/02-clickup-ticket.md";
const PR_A = "https://github.com/vikashruhilgit/studio-sandbox/pull/31";
const API = "repos/vikashruhilgit/studio-sandbox";
const SID = "probe-coordinator";
const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "probe",
  GIT_AUTHOR_EMAIL: "probe@example.invalid",
  GIT_COMMITTER_NAME: "probe",
  GIT_COMMITTER_EMAIL: "probe@example.invalid",
};

/** The stub: the first row whose glob matches the whole argv answers; no row ⇒ `UNMATCHED` logged and exit 1. */
const GH_STUB = `#!/usr/bin/env bash
all="$*"; printf 'gh %s\\n' "$all" >> "$GH_LOG"
while IFS="\t" read -r rc pat out || [ -n "$rc" ]; do
  case "$rc" in ""|"#"*) continue ;; esac
  case "$all" in $pat) [ -n "$out" ] && printf "%s\\n" "$out"; exit "$rc" ;; esac
done < "$GH_TABLE"
echo "gh-stub: unmatched: $all" >&2; printf 'UNMATCHED %s\\n' "$all" >> "$GH_LOG"; exit 1
`;
const REC = `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$REC_LOG"\nexit 0\n`;

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

interface Call {
  readonly rc: number;
  readonly out: string;
  readonly err: string;
  readonly json: Record<string, unknown> | null;
}

class Scratch {
  readonly work: string;
  readonly repo: string;
  readonly runFile: string;
  readonly head: string;

  constructor() {
    this.work = realpathSync(mkdtempSync(join(tmpdir(), "studio-walk-probe-")));
    roots.push(this.work);
    this.repo = join(this.work, "repo");
    for (const d of [this.repo, join(this.work, "bin"), join(this.work, "home")]) mkdirSync(d, { recursive: true });
    writeFileSync(join(this.work, "bin", "gh"), GH_STUB);
    writeFileSync(join(this.work, "bin", "rec"), REC);
    chmodSync(join(this.work, "bin", "gh"), 0o755);
    chmodSync(join(this.work, "bin", "rec"), 0o755);
    writeFileSync(join(this.work, "gh.log"), "");
    writeFileSync(join(this.work, "rec.log"), "");
    // The sandbox repo's seed (runbook setup step 1) and a bare origin, filled by a fetch from the origin side.
    writeFileSync(join(this.repo, "ping.js"), "process.exit(0);\n");
    this.git(this.repo, "init", "-q", ".");
    this.git(this.repo, "symbolic-ref", "HEAD", "refs/heads/main");
    this.git(this.repo, "add", "-A");
    this.git(this.repo, "commit", "-q", "-m", "chore: seed the sandbox");
    this.git(this.work, "init", "-q", "--bare", join(this.work, "origin.git"));
    this.git(join(this.work, "origin.git"), "fetch", "-q", this.repo, "main:main");
    this.git(this.repo, "remote", "add", "origin", join(this.work, "origin.git"));
    this.git(this.repo, "fetch", "-q", "origin");
    this.git(this.repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    this.head = this.git(this.repo, "rev-parse", "HEAD").trim();
    const req = join(this.repo, ".supervisor", "requirements", "walk");
    mkdirSync(req, { recursive: true });
    mkdirSync(join(this.repo, ".supervisor", "automate"), { recursive: true });
    writeFileSync(join(req, "01-github-ticket.md"), "# GitHub ticket\n\n## Status: pending\n\n## Task\nAdd drum.sh printing boom and make npm test run it.\n");
    writeFileSync(join(req, "02-clickup-ticket.md"), "# ClickUp ticket\n\n## Status: pending\n\n## Task\nAdd bell.sh printing ding and make npm test run it.\n");
    this.runFile = join(this.repo, ".supervisor", "automate", `${RUN_ID}.md`);
    // One run over both tickets (item 23i: concurrent handovers merge into one backlog), safe mode.
    writeFileSync(
      this.runFile,
      [
        "# Automate Run: phase-8 walk probe (two tickets)",
        "## Status: running",
        "## Source",
        "- backlog .supervisor/requirements/walk/_BACKLOG.md",
        "## Run Config",
        "- mode: safe | limit: 5 | trust_unprotected: false",
        "## Queue",
        `- [ ] ${ITEM_A}`,
        `- [ ] ${ITEM_B}`,
        "## Current",
        "- item: null | status: null | pr: null | branch: null",
        "- pause_reason: null",
        "## Progress",
        "- 2026-11-21T10:00:00Z run created",
        "",
      ].join("\n"),
    );
  }

  git(cwd: string, ...args: string[]): string {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV, HOME: join(this.work, "home") } });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  }

  /** Replaces the stub's table: `[rc, glob, output]` rows, first match wins. */
  table(rows: readonly (readonly [number, string, string])[]): void {
    writeFileSync(join(this.work, "gh.table"), rows.map(([rc, pat, out]) => `${rc}\t${pat}\t${out}\n`).join(""));
  }

  /** One driver call in the sandbox. */
  call(...args: string[]): Call {
    const bin = join(this.work, "bin");
    const env: Record<string, string> = {
      PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      HOME: join(this.work, "home"),
      ...GIT_ENV,
      GH_TABLE: join(this.work, "gh.table"),
      GH_LOG: join(this.work, "gh.log"),
      REC_LOG: join(this.work, "rec.log"),
      LOOMWRIGHT_GH_BIN: join(bin, "gh"),
      NEXT_STEP_WATCH_CMD: `${join(bin, "rec")} watch`,
      NEXT_STEP_NOTIFY_CMD: `${join(bin, "rec")} notify`,
      NEXT_STEP_LOCK_CMD: `${join(bin, "rec")} lock`,
      NEXT_STEP_LOCK_RETRY_SECONDS: "0",
      LOOMWRIGHT_PROC_REGISTRY_DIR: join(this.work, "procs"),
    };
    const r = spawnSync("bash", [join(LOOMWRIGHT, "scripts", "automate-next-step.sh"), ...args], { cwd: this.repo, env, encoding: "utf8", input: "", timeout: 120_000 });
    const out = r.stdout ?? "";
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(out) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { rc: r.status ?? -1, out, err: r.stderr ?? "", json };
  }

  runFileText(): string {
    return readFileSync(this.runFile, "utf8");
  }

  /** The stub's log: every call, and an `UNMATCHED` line per call no row answered. */
  ghLog(): string {
    return readFileSync(join(this.work, "gh.log"), "utf8");
  }

  /** A copy of this scratch (its run file and sidecars as they stand) for a second branch of the walk. */
  fork(): Scratch {
    const copy = Object.create(Scratch.prototype) as Scratch;
    const work = realpathSync(mkdtempSync(join(tmpdir(), "studio-walk-probe-")));
    roots.push(work);
    cpSync(this.work, work, { recursive: true });
    Object.assign(copy, { work, repo: join(work, "repo"), runFile: join(work, "repo", ".supervisor", "automate", `${RUN_ID}.md`), head: this.head });
    writeFileSync(join(work, "gh.log"), "");
    return copy;
  }
}

/** The fixed reports the phases would give (Loomwright's V7 leg answers them the same way). */
function supervisorResult(pr: string): string {
  return [
    "SUPERVISOR_RESULT:",
    "  schema_version: 1",
    "  task_id: walk-01",
    "  status: completed",
    `  pr_url: ${pr}`,
    "  branch: feature/walk-01-drum",
    "  subtasks_completed: 1",
    "  subtasks_failed: 0",
    "  heal_loop_ran: true",
    "  heal_iterations: 1",
    "  heal_decision: PASS",
    "  heal_fixable_issues_fixed: 0",
    "  heal_remaining_issues: 0",
    '  summary: "drum.sh prints boom; npm test runs it"',
  ].join("\n");
}
function reviewHealReady(pr: string): string {
  return [
    "REVIEW_HEAL_RESULT:",
    "  schema_version: 2",
    "  decision: READY",
    "  iterations: 1",
    "  issues_fixed: 0",
    "  remaining_issues: 0",
    `  pr_url: "${pr}"`,
    "  notified: true",
    "  rounds: 1",
    "  fix_cycles: 0",
    "  repeat_check_failure: false",
    "  unresolved_bot_feedback: false",
    "  termination_reason: converged",
  ].join("\n");
}

/** PR A open, at the scratch HEAD: the reads PICK, the owned-drain spawn, learning-emit and RECONCILE make. */
function openRows(s: Scratch): (readonly [number, string, string])[] {
  return [
    [0, "auth status*", ""],
    [0, `pr view ${PR_A} --json headRefOid`, JSON.stringify({ headRefOid: s.head })],
    [0, `pr view ${PR_A} --json files,additions,deletions,changedFiles`, JSON.stringify({ files: [{ path: "drum.sh" }], additions: 2, deletions: 0, changedFiles: 1 })],
    [0, `pr view ${PR_A} --json state,mergedAt`, JSON.stringify({ state: "OPEN", mergedAt: null })],
    [0, `pr view ${PR_A} --json state`, JSON.stringify({ state: "OPEN" })],
    [0, "pr list *", "[]"],
  ];
}

/** Item 1 from PICK to its READY park, through the real driver; asserts each instruction on the way. */
function parkItemA(s: Scratch): void {
  s.table(openRows(s));
  const pick = s.call(s.runFile, "--start", "pick", "--inline-phases", "--non-interactive", "--session-id", SID);
  expect(pick.rc, pick.err).toBe(0);
  expect(pick.json).toMatchObject({ do: "spawn", step: "run", what: "/autonomous run", item: ITEM_A });
  const run = s.call(s.runFile, "--result", JSON.stringify({ supervisor_result: supervisorResult(PR_A), session_id: "probe-supervisor-1", run_note: "probe" }));
  expect(run.rc, run.err).toBe(0);
  expect(run.json).toMatchObject({ do: "spawn", step: "drain", what: "owned drain", invocation: `/review-pr ${PR_A} --until-mergeable --no-auto-postmortem` });
  const drain = s.call(s.runFile, "--result", JSON.stringify({ review_heal_result: reviewHealReady(PR_A), ready_sha: s.head }));
  expect(drain.rc, drain.err).toBe(0);
  expect(drain.json).toMatchObject({ do: "park", step: "park", pause_reason: "awaiting_merge" });
  const rf = s.runFileText();
  expect(rf).toContain(`- item: ${ITEM_A} | status: awaiting_merge | pr: ${PR_A}`);
  expect(rf).toMatch(/^- owned_drain_started: \S+ \| owned_drain_result: READY \| suppressed_default_dispatch: true$/m);
  expect(rf).toMatch(new RegExp(`^- ready_sha: ${s.head} \\| ready_at: \\S+Z \\| termination_reason: converged$`, "m"));
  expect(rf).toContain(`- [ ] ${ITEM_B}`);
  expect(s.ghLog()).not.toContain("UNMATCHED");
}

/** The `ready_at` the driver recorded at the READY park. */
function readyAt(s: Scratch): string {
  const m = /^- ready_sha: \S+ \| ready_at: (\S+) \|/m.exec(s.runFileText());
  if (m?.[1] === undefined) throw new Error("no ready_at line");
  return m[1];
}

/** A second later than `iso` (a comment posted after the READY). */
function after(iso: string): string {
  return new Date(Date.parse(iso) + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** PR A open for `--merge-parked`: its live head, one issue comment at `commentAt`, no review, the base not moved. */
function mergeParkedRows(liveHead: string, commentAt: string): (readonly [number, string, string])[] {
  return [
    [0, `pr view ${PR_A} --json state,mergedAt`, JSON.stringify({ state: "OPEN", mergedAt: null })],
    [0, `pr view ${PR_A} --json headRefOid,headRefName,baseRefName`, JSON.stringify({ headRefOid: liveHead, headRefName: "feature/walk-01-drum", baseRefName: "main" })],
    [0, `api ${API}/issues/31/comments --paginate`, JSON.stringify([{ created_at: commentAt, user: { login: "vikashruhilgit" }, body: "fix: rename ping to pong" }])],
    [0, `api ${API}/pulls/31/reviews --paginate`, "[]"],
    [0, `api ${API}/pulls/31/comments --paginate`, "[]"],
    [0, `api ${API}/compare/main...*`, JSON.stringify({ behind_by: 0 })],
    [0, "pr list *", "[]"],
  ];
}

// ---- The driver cases (install-gated) ----------------------------------------------------------------------------

describe.skipIf(SKIP !== undefined)(`walk order on the real Loomwright ${PROBE_VERSION} driver (skipped: ${SKIP ?? "no"})`, () => {
  it("R1: in safe mode the second ticket's PR starts only after PR A reads merged and the owner resumes", () => {
    const s = new Scratch();
    parkItemA(s);

    // While PR A is open, neither the run's own next PICK nor a Resume picks item 2.
    for (const args of [[s.runFile, "--start", "pick"], ["--resume", join(s.repo, ".supervisor", "automate"), "--run", RUN_ID]] as const) {
      const c = s.call(...args, "--inline-phases", "--non-interactive", "--session-id", SID);
      expect(c.rc, c.err).toBe(0);
      expect(c.json, args[0]).toMatchObject(OBSERVED.r1.openPark);
      expect(String(c.json?.message), args[0]).toContain(OBSERVED.r1.openMessage);
    }
    expect(s.runFileText()).not.toContain(`picked ${ITEM_B}`);

    // PR A merges (the walk's step 2, through the gate). The done brief a real Supervisor run leaves, for closeout's stamp.
    mkdirSync(join(s.repo, ".supervisor", "jobs", "done"), { recursive: true });
    writeFileSync(join(s.repo, ".supervisor", "jobs", "done", "2026-11-21-walk-01.md"), `# Supervisor Job: walk 01\n\n## Environment\n- **Source requirement:** ${ITEM_A}\n`);
    s.table([
      [0, `pr view ${PR_A} --json state,mergedAt`, JSON.stringify({ state: "MERGED", mergedAt: "2026-11-21T11:00:00Z" })],
      [0, `pr view ${PR_A} --json headRefName,headRefOid`, JSON.stringify({ headRefName: "feature/walk-01-drum", headRefOid: s.head })],
      [0, "pr create *", "https://github.com/vikashruhilgit/studio-sandbox/pull/90"],
      ...openRows(s).filter(([, pat]) => !pat.includes("--json state")),
    ]);
    const merged = s.call("--merge-parked", join(s.repo, ".supervisor", "automate"), "--run", RUN_ID, "--session-id", "probe-merge");
    expect(merged.rc, merged.err).toBe(0);
    expect(merged.json).toMatchObject(OBSERVED.r1.mergedStop);
    expect(String(merged.json?.message)).toContain(OBSERVED.r1.mergedMessage);
    const stopped = s.runFileText();
    expect(stopped).toContain(`- [x] ${ITEM_A}`);
    expect(stopped).toContain(`- [ ] ${ITEM_B}`);
    expect(stopped).not.toContain(`picked ${ITEM_B}`);

    // The owner's Resume (the kernel sends `--resume <run_id> --inline-phases`, D44 / 23j): item 2's RUN.
    const resumed = s.call("--resume", join(s.repo, ".supervisor", "automate"), "--run", RUN_ID, "--inline-phases", "--non-interactive", "--session-id", "probe-resume");
    expect(resumed.rc, resumed.err).toBe(0);
    expect(resumed.json).toMatchObject({ ...OBSERVED.r1.resumeSpawn, item: ITEM_B });
    expect(s.runFileText()).toContain(`picked ${ITEM_B}`);
    expect(s.ghLog()).not.toContain("UNMATCHED");
  }, 180_000);

  it("R2: --merge-parked after triage parks: a moved head with a newer comment parks head_sha_moved, a newer comment alone parks ready_stale_feedback", () => {
    const base = new Scratch();
    parkItemA(base);
    const comment = after(readyAt(base));
    const cases = [
      { name: "three comments and a fix push", live: "b".repeat(40), reason: OBSERVED.r2.movedHeadAndComment },
      { name: "a comment, the head unmoved", live: base.head, reason: OBSERVED.r2.commentOnly },
    ] as const;
    for (const c of cases) {
      const s = base.fork();
      s.table(mergeParkedRows(c.live, comment));
      const r = s.call("--merge-parked", join(s.repo, ".supervisor", "automate"), "--run", RUN_ID, "--session-id", "probe-merge");
      expect(r.rc, `${c.name}: ${r.err}`).toBe(0);
      expect(r.json, c.name).toMatchObject({ do: "park", step: "merge-park", pause_reason: "awaiting_merge" });
      expect(String(r.json?.message), c.name).toMatch(new RegExp(`^PARK: ${c.reason} — `));
      const rf = s.runFileText();
      expect(rf, c.name).toContain(`- item: ${ITEM_A} | status: awaiting_merge | pr: ${PR_A}`);
      expect(rf.match(new RegExp(` merge-parked ${PR_A} — PARK: ${c.reason} `, "g")) ?? [], c.name).toHaveLength(1);
      expect(rf, c.name).not.toContain("gate-eval: MERGE");
      expect(rf, c.name).not.toContain(`- [x] ${ITEM_A}`);
      expect(s.ghLog(), c.name).not.toContain("UNMATCHED");
    }
  }, 180_000);
});

// ---- Step 6: which session reaches the rail (AC4) ------------------------------------------------------------------

describe("step 6: only a session whose policy admits the gh pr prefix reaches the rail", () => {
  const rail = { dataDir: "/data", homeDir: "/home/o", cwd: "/work" };
  const merge = { command: "gh pr merge 32 --squash" };

  it("a crew charter with no gh pr prefix is denied by the policy first: bash_prefix_not_allowed, which no_kernel_merge counts as a fail", () => {
    const crew: ToolPolicy = { allowedTools: ["Read", "Bash"], allowedBashPrefixes: ["git status"] };
    expect(decideToolUse(crew, "Bash", merge)).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
  });

  it("a policy that admits gh pr (the kernel's run policies, or a charter listing it) allows it, and the rail then denies it merge_blocked", () => {
    const charterWithGhPr: ToolPolicy = { allowedTools: ["Read", "Bash"], allowedBashPrefixes: ["gh pr"] };
    for (const [name, policy] of [["ticket run", AUTOMATE_RUN_POLICY], ["review-pr run", REVIEW_PR_RUN_POLICY], ["merge run", MERGE_PARKED_RUN_POLICY], ["charter with gh pr", charterWithGhPr]] as const) {
      expect(decideToolUse(policy, "Bash", merge), name).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
      expect(classifyToolCall("Bash", merge, rail), name).toEqual({ kind: "deny", reason: "merge_blocked" });
    }
  });
});

// ---- The runbook says what was observed (AC3, runs in CI) ------------------------------------------------------------

describe("the runbook's walk agrees with the recorded R1 / R2 / step 6 answers", () => {
  const text = readFileSync(RUNBOOK, "utf8");
  /** The walk table's rows, by step number. */
  const rows = new Map<number, string>();
  for (const line of text.split("\n")) {
    const m = /^\| (\d+)\. /.exec(line);
    if (m?.[1] !== undefined) rows.set(Number(m[1]), line);
  }
  const row = (n: number): string => {
    const r = rows.get(n);
    if (r === undefined) throw new Error(`the runbook's walk has no step ${n}`);
    return r;
  };
  const stepOf = (needle: string): number => {
    for (const [n, line] of rows) if (line.includes(needle)) return n;
    throw new Error(`no walk step names ${needle}`);
  };

  it("R1: step 1 opens PR A only, and step 5 resumes the run before PR B", () => {
    expect(row(1)).toContain("PR A");
    expect(row(1)).toContain("single-open-PR");
    expect(row(1)).not.toMatch(/two PRs/i);
    // Step 5's "What happens" cell: the Resume comes before PR B opens.
    const five = row(5).split(" | ")[1] ?? "";
    expect(five).toContain("Resume");
    expect(five).toContain("PR B");
    expect(five.indexOf("Resume")).toBeLessThan(five.indexOf("PR B"));
    expect(text).toContain(OBSERVED.r1.mergedMessage);
  });

  it("R2: PR A merges before the triage comments, and the runbook names both parks", () => {
    expect(stepOf("PR A under Solo")).toBeLessThan(stepOf("Triage"));
    expect(stepOf("PR A under Solo")).toBeLessThan(stepOf("Re-request"));
    expect(stepOf("PR B under Approve in Studio")).toBe(5);
    for (const reason of [OBSERVED.r2.movedHeadAndComment, OBSERVED.r2.commentOnly]) expect(text).toContain(reason);
  });

  it("step 6 names a session that admits gh pr, and says a bash_prefix_not_allowed deny fails", () => {
    expect(row(6)).toContain("`gh pr`");
    expect(row(6)).toContain("bash_prefix_not_allowed");
    expect(row(6)).toContain("merge_blocked");
  });

  it("links the probes and the observed Loomwright version", () => {
    expect(text).toContain("kernel/test/phase-8-walk-order-probe.test.ts");
    expect(text).toContain(`Loomwright ${PROBE_VERSION}`);
  });
});
