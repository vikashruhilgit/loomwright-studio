// Phase 8 item 25f, Part B (was 25e): does the kernel-started triage fix act on the owner's `fix:` comment?
//
// D45 starts the triage fix as `/loomwright:review-pr <pr url>` with no flag (`reviewPrRunPrompt`,
// `kernel/src/automate/launch.ts`). This file records what that fix session is given and what Loomwright 18.1.2 does
// with that exact prompt. The answer and the proposed D45 amendment are in
// `docs/evidence/phase-8-25e-triage-fix-probe.md`; nothing here changes D45 or `launch.ts`.
//
//   - AC7 (the kernel half, runs in CI): a PR parked by a paused `/automate` run, the owner's comment
//     `fix: rename ping to pong` on it (`FakeGitHubClient`), a live write-granted playbook session calling the real
//     `kernel_pr_route` (`automate_fix`), then the real `handleAutomateRun` through the real `EventLoop` with a
//     recording `EventSessions` (the scaffolding of `kernel/test/automate-launch-routes.test.ts`). Recorded and
//     asserted: the exact prompt (`/loomwright:review-pr <url>`, no flag), the policy (`REVIEW_PR_RUN_POLICY`), and
//     every place the comment's text could reach: the queued event, the prompt, the store's events, the run files
//     and sidecars in the checkout. It reaches none of them. The same holds on the runbook's new walk, where triage
//     runs on PR A after its merge: the route then answers `review_pr` (the App authored it, no run holds it) and the
//     kernel starts the same prompt.
//   - AC8 (the Loomwright half, install-gated as in `phase-8-walk-order-probe.test.ts`): the installed
//     `commands/review-pr.md` for that exact prompt (no `--until-mergeable`) runs the default diff-only loop, which
//     "reads no external state" (its line 40): `comment reached: no`. For contrast, the `--until-mergeable` drain
//     driver (`scripts/review-heal-next-step.sh`, which the default loop never calls) is driven once against a
//     scratch repo with a stub `gh` that returns the comment: it does request the issue-comment channel, and the
//     round still goes to the earned fallback review, never a `validate findings` spawn, so the owner's comment is
//     not turned into a finding there either.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOMATE_RUN_KEY, REVIEW_PR_RUN_POLICY, handleAutomateRun, reviewPrRunPrompt } from "../src/automate/launch.js";
import type { KernelRunPayload } from "../src/automate/launch.js";
import { createRoutingTools } from "../src/automate/routing.js";
import { resolveLoomwrightInstall } from "../src/loomwright/active-install.js";
import { EventLoop } from "../src/loop/index.js";
import type { EventSessions } from "../src/loop/types.js";
import type { SessionHandle, SessionRow, StartSessionParams } from "../src/sessions/index.js";
import { FakeGitHubClient } from "./fixtures/github-fake.js";
import { HEAD, PR, installRunFiles, toolEnv } from "./fixtures/loomwright-run-files/harness.js";
import type { ToolEnv } from "./fixtures/loomwright-run-files/harness.js";

// The default GitHub client reads the real Keychain; every case injects one, so it must never get that far.
vi.mock("../src/auth/keychain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth/keychain.js")>()),
  securityCliKeychain: () => {
    throw new Error("the real Keychain must not be read in a test");
  },
}));

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EVIDENCE = join(REPO_ROOT, "docs", "evidence", "phase-8-25e-triage-fix-probe.md");
const REPO = "o/r";
const URL7 = `https://github.com/${REPO}/pull/${PR}`;
/** The owner's comment from the runbook's triage step. */
const FIX_COMMENT = "fix: rename ping to pong";
/** Pieces of it that must appear nowhere the session is given. */
const COMMENT_PIECES = ["rename ping to pong", "ping to pong", "fix: rename"];

/** What this probe recorded (the evidence file states the same; the CI case checks it does). */
const RECORDED = Object.freeze({
  prompt: `/loomwright:review-pr ${URL7}`,
  commentReached: "no",
  /** The installed command file's line that says the default loop reads nothing outside the diff. */
  defaultLoopCite: { file: "commands/review-pr.md", line: 40, text: "reads no external state" },
  /** The `--until-mergeable` drain's first instruction with the comment on the PR and no bot review. */
  drainFirstSpawn: { do: "spawn", step: "fallback", what: "fallback review" },
});

let env: ToolEnv;

beforeEach(() => {
  env = toolEnv("studio-triage-fix-probe-");
  env.store.prepare("INSERT INTO agents (id, display_name, avatar_shape, avatar_hue, status, created_by, charter_json) VALUES ('mason', 'Mason', 'crab', 'crew-teal', 'active', 'owner', '{}')").run();
});

afterEach(() => {
  vi.restoreAllMocks();
  env.close();
});

/** The owner's PR with the owner's `fix:` comment on it. */
function github(author: string): FakeGitHubClient {
  return new FakeGitHubClient({
    pulls: {
      [REPO]: [
        { number: PR, title: "Add drum.sh", author, draft: false, head_sha: HEAD, url: URL7, updated_at: "2026-11-09T09:00:00Z", body: "", state: "open", merged: false, base_ref: "main", head_ref: "feature/x", labels: [] },
      ],
    },
    comments: { [`${REPO}#${PR}`]: [{ kind: "issue", author: "vikashruhilgit", body: FIX_COMMENT, created_at: "2026-11-09T09:30:00Z", path: null }] },
    repoInfo: { [REPO]: { default_branch: "main", private: false } },
  });
}

/** A recording `EventSessions` (the calling session's row mirrored into `sessions`, as the single-drain check reads it). */
function recorder(): { readonly sessions: EventSessions; readonly starts: StartSessionParams[]; set(id: number, row: Partial<SessionRow>): void } {
  const starts: StartSessionParams[] = [];
  const rows = new Map<number, Partial<SessionRow>>();
  return {
    starts,
    set(id, row) {
      env.store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET agent = excluded.agent, status = excluded.status").run(id, row.agent ?? null, row.status ?? "running", row.cwd ?? null);
      rows.set(id, row);
    },
    sessions: {
      async startSession(params: StartSessionParams): Promise<SessionHandle> {
        starts.push(params);
        return { id: 100 + starts.length } as unknown as SessionHandle;
      },
      resumeSession: () => Promise.reject(new Error("unexpected resume")),
      getSession: (id: number) => rows.get(id) as SessionRow | undefined,
    } satisfies EventSessions,
  };
}

/** Every file under `dir`, recursively, as `[path, text]`. */
function filesUnder(dir: string): [string, string][] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const p = join(dir, n);
    try {
      return [[p, readFileSync(p, "utf8")] as [string, string]];
    } catch {
      return [];
    }
  });
}

/** The comment's text, wherever it appears in the store's events, its queue or the checkout's Loomwright state. */
function commentSightings(): string[] {
  const hits: string[] = [];
  const tables = [
    ["event_queue", env.store.prepare<[], { payload_json: string }>("SELECT payload_json FROM event_queue").all().map((r) => r.payload_json)],
    ["events", env.store.prepare<[], { payload_json: string }>("SELECT payload_json FROM events").all().map((r) => r.payload_json)],
  ] as const;
  for (const [name, texts] of tables) for (const t of texts) if (COMMENT_PIECES.some((p) => t.includes(p))) hits.push(name);
  for (const [path, text] of filesUnder(join(env.checkout, ".supervisor"))) if (COMMENT_PIECES.some((p) => text.includes(p))) hits.push(path);
  return hits;
}

/** Route as a live playbook session, then let the kernel start what the route queued. */
async function routeThenLaunch(author: string): Promise<{ answer: Record<string, unknown>; payload: Record<string, unknown>; start: StartSessionParams }> {
  const pb = env.playbook("live");
  const answered = await env.call(createRoutingTools({ client: () => github(author) }), "kernel_pr_route", { repo: REPO, pr: PR }, { playbook: pb });
  if (answered.isError) throw new Error(answered.text);
  const answer = answered.value as Record<string, unknown>;
  const queued = env.store.prepare<[], { payload_json: string }>("SELECT payload_json FROM event_queue WHERE kind = 'message' ORDER BY id").all();
  expect(queued).toHaveLength(1);
  const payload = JSON.parse(queued[0]?.payload_json ?? "{}") as Record<string, unknown>;
  const source = (payload[AUTOMATE_RUN_KEY] as KernelRunPayload).source_session;
  const r = recorder();
  r.set(source, { id: source, agent: "mason", playbook: pb, playbook_version: 1, task_id: null, model: "claude-opus-4-1", status: "running" });
  await new EventLoop({ store: env.store, handlers: { message: handleAutomateRun }, sessions: r.sessions }).tick();
  expect(r.starts).toHaveLength(1);
  return { answer, payload, start: r.starts[0] as StartSessionParams };
}

// ---- AC7: the kernel's route and launch -----------------------------------------------------------------------

describe("AC7: the kernel-started triage fix is given the PR, never the comment", () => {
  it("a parked PR: automate_fix, the prompt exactly /loomwright:review-pr <url> with no flag, REVIEW_PR_RUN_POLICY, and the comment reaches nowhere", async () => {
    installRunFiles(env.checkout, "parked");
    const { answer, payload, start } = await routeThenLaunch("vikashruhilgit");
    expect(answer).toMatchObject({ route: "automate_fix", owner_kind: "automate_parked", command: RECORDED.prompt, run: "started_by_kernel" });
    // The queued event: the kind, repo, PR number, checkout and attribution only.
    expect(Object.keys(payload[AUTOMATE_RUN_KEY] as object).sort()).toEqual(["checkout", "kind", "playbook", "playbook_version", "pr", "repo", "source_session", "task"]);
    // The prompt and the policy the kernel starts the session with.
    expect(start.prompt).toBe(RECORDED.prompt);
    expect(start.prompt).toBe(reviewPrRunPrompt(REPO, PR));
    expect(start.prompt).not.toMatch(/--[a-z]/);
    const { never: _never, ...policy } = start.policy as typeof start.policy & { never?: unknown };
    expect(policy).toEqual({ ...REVIEW_PR_RUN_POLICY });
    expect(start.cwd).toBe(env.checkout);
    // Every place the comment's text could reach the session: none.
    for (const piece of COMMENT_PIECES) {
      expect(start.prompt, piece).not.toContain(piece);
      expect(JSON.stringify(payload), piece).not.toContain(piece);
      expect(JSON.stringify(answer), piece).not.toContain(piece);
    }
    expect(commentSightings()).toEqual([]);
  });

  it("the new walk's triage on PR A after its merge: review_pr (the App authored it, its item is done), the same prompt, and the comment reaches nowhere", async () => {
    env.store.prepare("INSERT INTO connectors (kind, status, account_login, app_slug) VALUES ('github', 'connected', ?, ?)").run("vikashruhilgit", "studio-app");
    // The run file as --merge-parked leaves it after PR A merged (observed in phase-8-walk-order-probe.test.ts R1).
    const dir = join(env.checkout, ".supervisor", "automate");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "2026-11-21-100000-walk.md"),
      [
        "# Automate Run: phase-8 walk",
        "## Status: paused",
        "## Source",
        "- backlog .supervisor/requirements/walk/_BACKLOG.md",
        "## Run Config",
        "- mode: safe | limit: 5 | trust_unprotected: false",
        "## Queue",
        "- [x] .supervisor/requirements/walk/01-github-ticket.md",
        "- [ ] .supervisor/requirements/walk/02-clickup-ticket.md",
        "## Current",
        `- item: .supervisor/requirements/walk/01-github-ticket.md | status: done | pr: ${URL7} | branch: feature/x`,
        "- pause_reason: awaiting_go",
        "## Progress",
        "- 2026-11-21T11:00:00Z checked off .supervisor/requirements/walk/01-github-ticket.md",
        "",
      ].join("\n"),
    );
    const { answer, start } = await routeThenLaunch("studio-app[bot]");
    expect(answer).toMatchObject({ route: "review_pr", owner_kind: "owner", command: RECORDED.prompt, run: "started_by_kernel" });
    expect(start.prompt).toBe(RECORDED.prompt);
    expect(commentSightings()).toEqual([]);
  });
});

// ---- AC8: what Loomwright 18.1.2 does with that prompt (install-gated) ---------------------------------------------

/** The 18.1.2 plugin dir, or why the Loomwright half skips (the same gate as the walk-order probe). */
function probeInstall(): { readonly root: string } | { readonly skip: string } {
  const forced = process.env.STUDIO_PROBE_LOOMWRIGHT;
  if (forced === "none") return { skip: "STUDIO_PROBE_LOOMWRIGHT=none" };
  try {
    const install = resolveLoomwrightInstall(forced === undefined || forced === "" ? {} : { configured: forced });
    if (install.contract.plugin_version !== "18.1.2") return { skip: `the resolved Loomwright is ${install.contract.plugin_version}, not 18.1.2` };
    for (const tool of ["bash", "git", "jq"]) if (spawnSync(tool, ["--version"], { stdio: "ignore" }).status !== 0) return { skip: `${tool} is not on PATH` };
    return { root: install.installPath };
  } catch (err) {
    return { skip: `no Loomwright install resolves (${err instanceof Error ? err.message.split("\n")[0] : String(err)})` };
  }
}
const INSTALL = probeInstall();
const SKIP = "skip" in INSTALL ? INSTALL.skip : undefined;
const LOOMWRIGHT = "root" in INSTALL ? INSTALL.root : "";

const scratchRoots: string[] = [];
afterAll(() => {
  for (const r of scratchRoots) rmSync(r, { recursive: true, force: true });
});

describe.skipIf(SKIP !== undefined)(`AC8: Loomwright 18.1.2's /review-pr for that prompt (skipped: ${SKIP ?? "no"})`, () => {
  it("the default loop (no --until-mergeable) reads no external state: comment reached: no", () => {
    const lines = readFileSync(join(LOOMWRIGHT, RECORDED.defaultLoopCite.file), "utf8").split("\n");
    const cite = lines[RECORDED.defaultLoopCite.line - 1] ?? "";
    expect(cite).toContain("Without `--until-mergeable`");
    expect(cite).toContain(RECORDED.defaultLoopCite.text);
    // The default loop's steps ("What This Does", up to the cited line): a branch checkout, a diff review, a fix
    // worker, a push; the one gh call that touches comments writes one (`gh pr comment`), none reads them.
    const start = lines.findIndex((l) => l.startsWith("## What This Does"));
    expect(start).toBeGreaterThan(0);
    const steps = lines.slice(start, RECORDED.defaultLoopCite.line).join("\n");
    expect(steps).toContain("Task(loomwright:code-reviewer)` reviews the PR-branch diff");
    expect(steps).toContain("gh pr view <pr-url> --json headRefName");
    expect(steps).not.toMatch(/issues\/\S*comments|--json comments|reviewThreads|gh api/);
    expect(steps.match(/comment/gi) ?? []).toEqual(["comment"]);
    expect(steps).toContain("`gh pr comment`");
  });

  it("contrast: the --until-mergeable drain driver requests the issue comments, and still turns the owner's comment into no finding", () => {
    const work = realpathSync(mkdtempSync(join(tmpdir(), "studio-triage-probe-")));
    scratchRoots.push(work);
    const repo = join(work, "repo");
    const bin = join(work, "bin");
    for (const d of [repo, bin, join(work, "home")]) mkdirSync(d, { recursive: true });
    const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "probe", GIT_AUTHOR_EMAIL: "probe@example.invalid", GIT_COMMITTER_NAME: "probe", GIT_COMMITTER_EMAIL: "probe@example.invalid", HOME: join(work, "home") };
    writeFileSync(join(repo, "ping.js"), "process.exit(0);\n");
    for (const args of [["init", "-q", "."], ["symbolic-ref", "HEAD", "refs/heads/main"], ["add", "-A"], ["commit", "-q", "-m", "seed"]]) {
      expect(spawnSync("git", args, { cwd: repo, env: gitEnv }).status, args.join(" ")).toBe(0);
    }
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, env: gitEnv, encoding: "utf8" }).stdout.trim();
    const pr = "https://github.com/vikashruhilgit/studio-sandbox/pull/31";
    const api = "repos/vikashruhilgit/studio-sandbox";
    writeFileSync(
      join(bin, "gh"),
      `#!/usr/bin/env bash\nall="$*"; printf 'gh %s\\n' "$all" >> "$GH_LOG"\nwhile IFS="\t" read -r rc pat out || [ -n "$rc" ]; do\n  case "$rc" in ""|"#"*) continue ;; esac\n  case "$all" in $pat) [ -n "$out" ] && printf "%s\\n" "$out"; exit "$rc" ;; esac\ndone < "$GH_TABLE"\necho "gh-stub: unmatched: $all" >&2; printf 'UNMATCHED %s\\n' "$all" >> "$GH_LOG"; exit 1\n`,
    );
    chmodSync(join(bin, "gh"), 0o755);
    const view = { baseRefName: "main", headRefName: "feature/walk-01-drum", headRefOid: head, isCrossRepository: false, statusCheckRollup: [{ __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }], reviews: [], latestReviews: [], reviewDecision: "", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" };
    const rows: [number, string, string][] = [
      [0, `pr view ${pr} --json *`, JSON.stringify(view)],
      [0, "api graphql *reviewThreads*", JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } })],
      [1, "api *branches/main/protection*", "gh: Not Found (HTTP 404)"],
      [0, `api --method GET ${api}/rules/branches/main*`, "[]"],
      [0, `api --method GET ${api}/issues/31/comments*`, JSON.stringify([{ id: 1, created_at: "2026-11-21T06:00:00Z", user: { login: "vikashruhilgit", type: "User" }, body: FIX_COMMENT }])],
    ];
    writeFileSync(join(work, "gh.table"), rows.map(([rc, p, o]) => `${rc}\t${p}\t${o}\n`).join(""));
    writeFileSync(join(work, "gh.log"), "");
    const r = spawnSync("bash", [join(LOOMWRIGHT, "scripts", "review-heal-next-step.sh"), pr, "--start", "drain", "--required-checks", "name:ci", "--no-auto-postmortem", "--root", repo], {
      cwd: repo,
      encoding: "utf8",
      input: "",
      timeout: 120_000,
      env: { ...gitEnv, PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`, GH_TABLE: join(work, "gh.table"), GH_LOG: join(work, "gh.log"), LOOMWRIGHT_GH_BIN: join(bin, "gh") },
    });
    expect(r.status, r.stderr).toBe(0);
    const instruction = JSON.parse(r.stdout) as Record<string, unknown>;
    const log = readFileSync(join(work, "gh.log"), "utf8");
    // The drain reads the channel the comment is on…
    expect(log).toContain(`gh api --method GET ${api}/issues/31/comments`);
    expect(log).not.toContain("UNMATCHED");
    // …and its next instruction is the earned fallback review, not a validate-findings spawn: no finding came from it.
    expect(instruction).toMatchObject(RECORDED.drainFirstSpawn);
    expect(JSON.stringify(instruction)).not.toContain("ping to pong");
  }, 180_000);
});

// ---- The evidence file states what was recorded (runs in CI) ---------------------------------------------------------

describe("the Part B evidence file", () => {
  it("records the comment reached line, the prompt, the policy and the cited line, and proposes the D45 amendment for the owner", () => {
    const text = readFileSync(EVIDENCE, "utf8");
    expect(text).toContain(`comment reached: ${RECORDED.commentReached}`);
    expect(text).toContain(`${RECORDED.defaultLoopCite.file}:${RECORDED.defaultLoopCite.line}`);
    expect(text).toContain("REVIEW_PR_RUN_POLICY");
    expect(text).toContain("/loomwright:review-pr <url>");
    expect(text).toContain("D45 amendment");
    expect(text).toContain("kernel/test/phase-8-triage-fix-probe.test.ts");
  });
});
