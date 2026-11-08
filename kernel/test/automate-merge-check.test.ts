// Phase 8 item 09: the merge check (`kernel_automate_merge_check`) and the held
// merge approval (`kernel_merge_approval_request`).
//
//   - AC3: a live run (a running run file, or a held run lock) is `wait`.
//   - AC4: a parked `awaiting_merge` item at the PR's head on a Solo repo with CI
//     green and no live run is `go`, with p14's `/loomwright:automate --merge-parked
//     <run_id>` (plus `--trust-unprotected` only where the owner recorded it). A scan
//     pins that nothing in `kernel/src/automate/` calls a merge endpoint, the GitHub
//     CLI or starts a process.
//   - AC5: the merge approval is held through the real session gate (never covered
//     by an "always"), carries the head SHA and the app's payload keys, and once
//     approved makes `merge_check` answer `go` for that head and `wait` after a push;
//     a `ready_at` that differs from the run file's is `wait`.
//   - AC5b: a calling playbook's `studio_approval` requirement is passed to
//     `policyMet` on a Solo repo.
//   - AC5c: `merge-check` goes through `policyMet`'s own client; tests inject
//     `FakeGitHubClient`, and one test pins that `createRepoPolicyClient` is never
//     reached then (its Keychain read is mocked to throw).
//   - AC6: no repo policy is `park: no_policy`.
//   - AC9: an approval filed through the real tool path (the rail's `{tool, input,
//     cwd}` payload) and approved makes `policyMet` answer `met: true`, and `met: false`
//     after a new push.
//
// Everything runs on a temp store and checkouts with `FakeGitHubClient`: no
// network, no real Keychain, no real Loomwright, never the SDK or a model.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalError, decideApproval } from "../src/approvals/index.js";
import { MERGE_CHECK_ANSWERS, MERGE_CHECK_REASONS, mergeCheck } from "../src/automate/merge-check.js";
import type { MergeCheckAnswer } from "../src/automate/merge-check.js";
import { createAutomateRunnerTools } from "../src/automate/runner.js";
import type { ContributedTool } from "../src/features/index.js";
import { POLICY_NOT_MET_REASONS, policyMet } from "../src/integrations/github/repo-policy.js";
import type { GitHubPullMergeState } from "../src/integrations/types.js";
import { draftDenyReason } from "../src/sessions/draft-mode.js";
import { SessionManager } from "../src/sessions/index.js";
import type { SessionTokenMint } from "../src/sessions/github-session-auth.js";
import type { ToolPolicy } from "../src/sessions/index.js";
import { ALWAYS_HELD_TOOLS } from "../src/sessions/policy.js";
import { heldToolCheckOf } from "../src/tools/server.js";
import { FakeGitHubClient } from "./fixtures/github-fake.js";
import type { FakeGitHubData } from "./fixtures/github-fake.js";
import { HEAD, PARKED_RUN_ID, PR, READY_AT, installRunFiles, toolEnv, writeRunLock } from "./fixtures/loomwright-run-files/harness.js";
import type { ToolEnv } from "./fixtures/loomwright-run-files/harness.js";
import { events } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

// `createRepoPolicyClient` builds its client from the real Keychain reader. A test that injects a client must never get that far,
// so the reader throws, and the keychain-mock test counts the calls.
const keychainReads = vi.hoisted(() => ({ count: 0 }));
vi.mock("../src/auth/keychain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth/keychain.js")>()),
  securityCliKeychain: () => {
    keychainReads.count += 1;
    throw new Error("the real Keychain must not be read in a test");
  },
}));

const AUTOMATE_SRC = new URL("../src/automate/", import.meta.url);
const APP_SUBJECT = new URL("../../app/src/screens/approvals/subject.ts", import.meta.url);
const B = "b".repeat(40);
const NOW = new Date("2026-11-09T10:00:00.000Z");
const T0 = NOW.toISOString();
const PREFIX = "mcp__kernel__";
const APPROVAL = "kernel_merge_approval_request";

let env: ToolEnv;

beforeEach(() => {
  env = toolEnv("studio-merge-check-");
  keychainReads.count = 0;
});

afterEach(() => {
  env.close();
});

const state = (over: Partial<GitHubPullMergeState> = {}): GitHubPullMergeState => ({ head_sha: HEAD, approvals: 0, changes_requested: false, ci: "green", ...over });

/** A fake whose `o/r#7` has `over` as its merge state. */
function fakeFor(over: Partial<GitHubPullMergeState> = {}, data: FakeGitHubData = {}): FakeGitHubClient {
  return new FakeGitHubClient({ repoInfo: { "o/r": { default_branch: "main", private: false } }, mergeStates: { "o/r#7": state(over) }, ...data });
}

function setPolicy(kind: "solo" | "studio_approval" | "reviews" | "unset", extra: { required?: number; trust?: number; repo?: string } = {}): void {
  env.store
    .prepare("INSERT INTO repo_policies (repo, policy_kind, required_reviews, trust_unprotected, set_by, set_at) VALUES (?, ?, ?, ?, 'owner', ?)")
    .run(extra.repo ?? "o/r", kind, extra.required ?? null, extra.trust ?? 0, T0);
}

/** `mergeCheck` over the fixture checkout, with an injected client. */
function check(fake: FakeGitHubClient, over: { pr?: number; repo?: string; playbookRequirement?: string | null } = {}): Promise<MergeCheckAnswer> {
  return mergeCheck(
    { repo: over.repo ?? "o/r", pr: over.pr ?? PR, checkout: env.checkout, playbookRequirement: over.playbookRequirement ?? null },
    { store: env.store, client: () => fake, now: () => NOW },
  );
}

function wait(reason: string): MergeCheckAnswer {
  return expect.objectContaining({ answer: "wait", reason }) as unknown as MergeCheckAnswer;
}

function park(reason: string): MergeCheckAnswer {
  return expect.objectContaining({ answer: "park", reason }) as unknown as MergeCheckAnswer;
}

const GO: MergeCheckAnswer = { answer: "go", run_id: PARKED_RUN_ID, ready_sha: HEAD, invocation: `/loomwright:automate --merge-parked ${PARKED_RUN_ID}` };

/** The fixture parked run file's path and a rewrite of it. */
const parkedFile = (): string => join(env.checkout, ".supervisor", "automate", `${PARKED_RUN_ID}.md`);
function editParked(edit: (text: string) => string): void {
  writeFileSync(parkedFile(), edit(readFileSync(parkedFile(), "utf8")));
}

// ---- The closed sets ---------------------------------------------------------------------

describe("the closed sets", () => {
  it("are exactly their values, and cover every policyMet reason", () => {
    expect(MERGE_CHECK_ANSWERS).toEqual(["go", "wait", "park"]);
    expect(MERGE_CHECK_REASONS).toEqual([
      "no_policy",
      "head_moved",
      "ci_not_green",
      "awaiting_owner_approval",
      "reviews_short",
      "changes_requested",
      "unreadable",
      "run_live",
      "run_state_unreadable",
      "not_parked",
      "not_awaiting_merge",
      "ambiguous_runs",
      "ready_sha_missing",
      "ready_at_mismatch",
    ]);
    for (const r of POLICY_NOT_MET_REASONS) expect(MERGE_CHECK_REASONS).toContain(r);
    expect(Object.isFrozen(MERGE_CHECK_ANSWERS) && Object.isFrozen(MERGE_CHECK_REASONS)).toBe(true);
  });
});

// ---- AC3, AC4 ----------------------------------------------------------------------------

describe("AC3: a live run is wait", () => {
  it("a running run file on a Solo repo answers wait: run_live, and GitHub is not read", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "live");
    const fake = fakeFor();
    expect(await check(fake)).toEqual(wait("run_live"));
    expect(fake.calls).toEqual([]);
  });

  it("a live run wins over a parked item in the same checkout", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "live", "parked");
    expect(await check(fakeFor())).toEqual(wait("run_live"));
  });

  it("a held run lock (its holder alive) answers wait: run_live with no run file at all; a dead holder does not", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    writeRunLock(env.checkout, process.pid);
    expect(await check(fakeFor())).toEqual(wait("run_live"));
    writeRunLock(env.checkout, 2_000_000_000);
    expect(await check(fakeFor())).toEqual(GO);
  });

  it("an unreadable run state answers wait: run_state_unreadable, never go", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    writeFileSync(join(env.checkout, ".supervisor", "automate", "huge.md"), `# Automate Run: huge\n## Status: paused\n${"x".repeat(1024 * 1024 + 1)}`);
    expect(await check(fakeFor())).toEqual(wait("run_state_unreadable"));
  });
});

describe("AC4: a parked awaiting_merge item at the PR's head on a Solo repo, CI green, no live run, is go", () => {
  it("answers go with p14's invocation, and reads GitHub once", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    const fake = fakeFor();
    expect(await check(fake)).toEqual(GO);
    expect(fake.calls).toEqual([{ method: "getPullMergeState", args: ["o/r", PR] }]);
  });

  it("adds --trust-unprotected only where the owner recorded that choice", async () => {
    setPolicy("solo", { trust: 1 });
    installRunFiles(env.checkout, "parked");
    expect(await check(fakeFor())).toEqual({ ...GO, invocation: `${GO.answer === "go" ? GO.invocation : ""} --trust-unprotected` });
  });

  it("ignores a sidecar next to the run file: only the title makes a run (p15's trap)", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    expect(readdirSync(join(env.checkout, ".supervisor", "automate")).sort()[1]).toBe(`${PARKED_RUN_ID}.supervisor-result.md`);
    expect(await check(fakeFor())).toEqual(GO);
  });

  it("answers wait while CI is not green (pending, failing, none), park-free, with no go", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    for (const ci of ["pending", "failing", "none"] as const) expect(await check(fakeFor({ ci })), ci).toEqual(wait("ci_not_green"));
  });

  it("answers wait: head_moved when the PR's head is not the head Loomwright marked READY", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    expect(await check(fakeFor({ head_sha: B }))).toEqual(wait("head_moved"));
  });

  it("is not go for an item that is not parked awaiting_merge for this repo and PR", async () => {
    setPolicy("solo");
    setPolicy("solo", { repo: "o/other" });
    installRunFiles(env.checkout, "escalated");
    expect(await check(fakeFor())).toEqual(park("not_awaiting_merge"));
    rmSync(join(env.checkout, ".supervisor", "automate"), { recursive: true });
    installRunFiles(env.checkout, "parked");
    // Another PR number, and another repo, are not what the run file parks.
    expect(await check(fakeFor(), { pr: 8 })).toEqual(park("not_parked"));
    expect(await check(fakeFor(), { repo: "o/other" })).toEqual(park("not_parked"));
    // A finished run parks nothing.
    rmSync(join(env.checkout, ".supervisor", "automate"), { recursive: true });
    installRunFiles(env.checkout, "done");
    expect(await check(fakeFor())).toEqual(park("not_parked"));
    // No run files at all.
    rmSync(join(env.checkout, ".supervisor"), { recursive: true });
    expect(await check(fakeFor())).toEqual(park("not_parked"));
  });

  it("parks ready_sha_missing when the item records no READY head, or one that is not a full SHA; the live head is never substituted", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    editParked((t) => t.replace(/^- ready_sha:.*\n/m, ""));
    const fake = fakeFor();
    expect(await check(fake)).toEqual(park("ready_sha_missing"));
    editParked((t) => `${t}\n`.replace("## Progress", "- ready_sha: abc123 | ready_at: 2026-11-08T07:36:18Z | termination_reason: converged\n## Progress"));
    expect(await check(fake)).toEqual(park("ready_sha_missing"));
    expect(fake.calls).toEqual([]);
  });

  it("parks ambiguous_runs when two paused runs both park this PR awaiting_merge", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    writeFileSync(join(env.checkout, ".supervisor", "automate", "2026-11-09-000000-again.md"), readFileSync(parkedFile(), "utf8").replace(PARKED_RUN_ID, "2026-11-09-000000-again"));
    expect(await check(fakeFor())).toEqual(park("ambiguous_runs"));
  });

  it("answers wait: unreadable when GitHub cannot be read or the PR is unknown to it, never go", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    const down = fakeFor({}, { failures: { getPullMergeState: { ok: false, error: "unreachable", rateLimit: null } } });
    expect(await check(down)).toEqual(wait("unreadable"));
    const limited = fakeFor({}, { failures: { getPullMergeState: { ok: false, error: "rate_limited", resets_at: T0, rateLimit: { limit: 1, remaining: 0, reset_at: T0 } } } });
    expect(await check(limited)).toEqual(wait("unreadable"));
    expect(await check(new FakeGitHubClient({}))).toEqual(wait("unreadable"));
  });

  it("reads a reviews policy: wait while approvals are short, park on a requested change, go when met", async () => {
    setPolicy("reviews", { required: 2 });
    installRunFiles(env.checkout, "parked");
    expect(await check(fakeFor({ approvals: 1 }))).toEqual(wait("reviews_short"));
    expect(await check(fakeFor({ approvals: 2, changes_requested: true }))).toEqual(park("changes_requested"));
    expect(await check(fakeFor({ approvals: 2 }))).toEqual(GO);
  });

  it("scans: nothing under kernel/src/automate/ names a merge endpoint, the GitHub CLI's merge, a merge mutation or a way to start a process", () => {
    const files = readdirSync(AUTOMATE_SRC).filter((f) => f.endsWith(".ts"));
    expect(files.sort()).toEqual(["index.ts", "merge-check.ts", "run-state.ts", "runner.ts", "tickets-to-items.ts"]);
    const forbidden: readonly [string, RegExp][] = [
      ["a /merge endpoint", /\/merge(?![\w-])/],
      ["gh pr merge", /gh\s+pr\s+merge|\bgh\b.*\bmerge\b/],
      ["a merge mutation", /mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest/i],
      ["a merge call", /\.merge\s*\(|\bmergePull|\bmerge_pull|"PUT"|method:\s*"(PUT|POST|PATCH|DELETE)"/],
      ["a process", /\bchild_process\b|\bexecFile|\bexecSync\b|\bspawn(Sync)?\b|\bfork\s*\(/],
      ["a network call", /\bfetch\s*\(|\bhttps?\.request\b|node:https?\b/],
    ];
    for (const f of files) {
      const text = readFileSync(new URL(f, AUTOMATE_SRC), "utf8");
      for (const [what, pattern] of forbidden) expect(pattern.test(text), `${f} has ${what}`).toBe(false);
    }
  });
});

// ---- AC6 ---------------------------------------------------------------------------------

describe("AC6: no repo policy is park: no_policy", () => {
  it("answers park: no_policy for no row, and for an unset row, without reading GitHub", async () => {
    installRunFiles(env.checkout, "parked");
    const fake = fakeFor();
    expect(await check(fake)).toEqual(park("no_policy"));
    setPolicy("unset");
    expect(await check(fake)).toEqual(park("no_policy"));
    expect(fake.calls).toEqual([]);
  });

  it("answers no_policy even before it reads the run state, so an unconfigured repo always reads the same", async () => {
    installRunFiles(env.checkout, "live");
    expect(await check(fakeFor())).toEqual(park("no_policy"));
  });
});

// ---- AC5c --------------------------------------------------------------------------------

describe("AC5c: policyMet's own client", () => {
  it("an injected client is the only one used: createRepoPolicyClient (the Keychain) is never reached", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    expect(await check(fakeFor())).toEqual(GO);
    expect(keychainReads.count).toBe(0);
  });

  it("production wiring passes no client: policyMet builds its own, and a failure to is unreadable, never go", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    // No `client`: the default path builds `createRepoPolicyClient()`, which reads the (mocked, throwing) Keychain.
    const answer = await mergeCheck({ repo: "o/r", pr: PR, checkout: env.checkout, playbookRequirement: null }, { store: env.store, now: () => NOW });
    expect(answer).toEqual(wait("unreadable"));
    expect(keychainReads.count).toBe(1);
  });

  it("the tool passes no client by default, and an injected one only through createAutomateRunnerTools", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    const pb = env.playbook("live");
    const plain = createAutomateRunnerTools();
    expect(await env.call(plain, "kernel_automate_merge_check", { repo: "o/r", pr: PR }, { playbook: pb })).toMatchObject({ isError: false, value: { answer: "wait", reason: "unreadable" } });
    expect(keychainReads.count).toBe(1);
    const fake = fakeFor();
    const injected = createAutomateRunnerTools({ client: () => fake });
    expect(await env.call(injected, "kernel_automate_merge_check", { repo: "o/r", pr: PR }, { playbook: pb })).toEqual({
      isError: false,
      value: { repo: "o/r", pr: PR, ...GO },
    });
    expect(keychainReads.count).toBe(1);
  });
});

// ---- AC5b --------------------------------------------------------------------------------

/** Files and approves one merge approval through the real session gate (see `gateEnv`). */
async function approve(gate: Gate, input: Record<string, unknown>): Promise<number> {
  const held = await gate.call(APPROVAL, input);
  const id = Number(/held as approval (\d+)/.exec(held.permissionDecisionReason)?.[1]);
  decideApproval(env.store, { id, decision: "once", by: "owner" }, NOW);
  return id;
}

const REQUEST = { repo: "o/r", pr: PR, head_sha: HEAD, ci: "green", ready_at: READY_AT };

describe("AC5b: the calling playbook's merge_requirement is passed to policyMet", () => {
  it("on a Solo repo a studio_approval playbook waits (awaiting_owner_approval) until an approval exists at the head, then goes", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    const fake = fakeFor();
    const tools = createAutomateRunnerTools({ client: () => fake });
    const strict = env.playbook("live", "studio_approval");
    const lax = env.playbook("live", "none");
    const ask = (playbook: number): ReturnType<typeof env.call> => env.call(tools, "kernel_automate_merge_check", { repo: "o/r", pr: PR }, { playbook });
    // Control: the same Solo repo with a playbook that asks for nothing more is go.
    expect(await ask(lax)).toMatchObject({ isError: false, value: GO });
    expect(await ask(strict)).toMatchObject({ isError: false, value: { answer: "wait", reason: "awaiting_owner_approval" } });
    const gate = await gateEnv(env, tools, strict);
    await approve(gate, REQUEST);
    expect(await ask(strict)).toMatchObject({ isError: false, value: GO });
    // A new push makes the approval stale: wait again, at the old head and at the new one.
    fake.setMergeState("o/r", PR, state({ head_sha: B }));
    expect(await ask(strict)).toMatchObject({ isError: false, value: { answer: "wait", reason: "head_moved" } });
    editParked((t) => t.replace(HEAD, B));
    expect(await ask(strict)).toMatchObject({ isError: false, value: { answer: "wait", reason: "awaiting_owner_approval" } });
  });

  it("a playbook's reviews:N requirement raises the approvals a Solo repo needs", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    const tools = createAutomateRunnerTools({ client: () => fakeFor({ approvals: 1 }) });
    expect(await env.call(tools, "kernel_automate_merge_check", { repo: "o/r", pr: PR }, { playbook: env.playbook("live", "reviews:2") })).toMatchObject({ value: { answer: "wait", reason: "reviews_short" } });
    expect(await env.call(tools, "kernel_automate_merge_check", { repo: "o/r", pr: PR }, { playbook: env.playbook("live", "reviews:1") })).toMatchObject({ value: { answer: "go" } });
  });
});

// ---- The gate: AC5, AC9 ------------------------------------------------------------------

interface Gate {
  /** Calls `name` through the session's PreToolUse hook, as the SDK would. */
  call(name: string, input: unknown): Promise<{ hookEventName: string; permissionDecision: string; permissionDecisionReason: string }>;
  readonly fakes: ReturnType<typeof fakeSessions>;
}

/**
 * A real `SessionManager` over the fake spawner whose agent `mason` holds `github: write`, a session of live playbook `playbook`, and the
 * pre-hold check built from `tools` (`heldToolCheckOf`), so a call is held exactly as in the kernel. Returns the session's gate.
 */
async function gateEnv(e: ToolEnv, tools: readonly ContributedTool[], playbook: number | null, policy?: ToolPolicy): Promise<Gate> {
  const root = mkdtempSync(join(tmpdir(), "studio-merge-gate-"));
  mkdirSync(join(root, "home"));
  if (playbook !== null) {
    const slug = e.store.prepare<[number], string>("SELECT slug FROM playbooks WHERE id = ?").pluck().get(playbook) as string;
    const spec = JSON.stringify({ source: "github.pulls", repos: ["o/r"], filters: {}, interval_seconds: 300 });
    e.store
      .prepare("INSERT INTO triggers (owning_agent, playbook, kind, spec_json, action, action_payload, created_by) VALUES ('mason', ?, 'poll', ?, 'wake_agent', '{}', 'owner')")
      .run(slug, spec);
  }
  const fakes = fakeSessions();
  const mint: SessionTokenMint = () => ({ ok: true, token: "ghs_sessiontokenabcdef", expires_at: new Date(NOW.getTime() + 3_600_000).toISOString() });
  const manager: SessionManager = new SessionManager(
    {
      store: e.store,
      authProvider: stubProvider(),
      loomwrightPath: makePluginDir(root),
      stopGraceMs: 10,
      baseEnv: { PATH: "/usr/bin" },
      connectorsFor: () => ["github"],
      githubWriteFor: () => true,
      sessionTokenMint: mint,
      heldToolCheck: heldToolCheckOf(tools, (id) => ({ store: e.store, sessions: manager, sessionId: id, now: () => NOW })),
    },
    { ...fakes.deps, homeDir: join(root, "home"), now: () => NOW },
  );
  const allowing: ToolPolicy = policy ?? { allowedTools: tools.map((t) => `${PREFIX}${t.name}`), allowedBashPrefixes: [] };
  await manager.startSession(startParams(root, { agent: "mason", policy: allowing, ...(playbook === null ? {} : { playbook, playbookVersion: 1 }) }));
  const hook = fakes.calls[fakes.calls.length - 1]?.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
  return {
    fakes,
    async call(name, input) {
      const hookInput = { hook_event_name: "PreToolUse", tool_name: `${PREFIX}${name}`, tool_input: input, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: root } as unknown as HookInput;
      return ((await hook(hookInput, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Awaited<ReturnType<Gate["call"]>> }).hookSpecificOutput;
    },
  };
}

describe("AC5: kernel_merge_approval_request is held through the real gate", () => {
  it("holds the call as a pending approval whose payload is the rail's {tool, input, cwd}, with the head SHA, ci and ready_at in input and in the display", async () => {
    const tools = createAutomateRunnerTools({ client: () => fakeFor() });
    const gate = await gateEnv(env, tools, env.playbook("live"));
    const held = await gate.call(APPROVAL, REQUEST);
    expect(held.permissionDecision).toBe("deny");
    expect(held.permissionDecisionReason).toMatch(/^approval_required: held as approval 1; it did not run\. .*run exactly the same call again, once\.$/);
    const rows = env.store.prepare("SELECT id, action, status, payload_json FROM approvals").all() as { id: number; action: string; status: string; payload_json: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, action: APPROVAL, status: "pending" });
    const payload = JSON.parse(rows[0]?.payload_json ?? "") as { tool: string; input: Record<string, unknown>; cwd: string };
    expect(payload.tool).toBe(`${PREFIX}${APPROVAL}`);
    expect(payload.input).toEqual(REQUEST);
    expect(payload.input["head_sha"]).toBe(HEAD);
    // The display is the owner's text (stored on the approval_requested event): the repo, PR, head, the claimed CI and the READY time.
    const requested = events(env.store, "approval_requested");
    expect(requested).toHaveLength(1);
    expect(requested[0]?.payload["display"]).toBe(
      [
        `Merge approval for o/r#7 at head ${HEAD}`,
        "CI (the agent's claim; re-read before any merge): green",
        `Loomwright READY at: ${READY_AT}`,
        "A record only: Loomwright's own gate decides and merges. A new push makes this approval stale.",
      ].join("\n"),
    );
    expect(requested[0]?.payload["source"]).toBe("rail");
  });

  it("files `ci` and `ready_at` under the names the app's merge card reads (MERGE_PAYLOAD_KEYS), and the three keys the kernel authorises on", async () => {
    const keys = /export const MERGE_PAYLOAD_KEYS = \{([^}]*)\}/.exec(readFileSync(APP_SUBJECT, "utf8"))?.[1] ?? "";
    for (const [prop, name] of [["repo", "repo"], ["pr", "pr"], ["headSha", "head_sha"], ["ci", "ci"], ["readyAt", "ready_at"], ["policy", "policy"]]) {
      expect(keys, prop).toContain(`${prop}: "${name}"`);
    }
    const tool = createAutomateRunnerTools().find((t) => t.name === APPROVAL) as ContributedTool;
    expect(Object.keys(tool.shape).sort()).toEqual(["ci", "head_sha", "policy", "pr", "ready_at", "repo"]);
  });

  it("is in ALWAYS_HELD_TOOLS and no 'always' grant can cover it: deciding it always is refused, once is the only way", async () => {
    expect(ALWAYS_HELD_TOOLS).toContain(`${PREFIX}${APPROVAL}`);
    const tools = createAutomateRunnerTools();
    const gate = await gateEnv(env, tools, env.playbook("live"));
    await gate.call(APPROVAL, REQUEST);
    const refused = (): unknown => decideApproval(env.store, { id: 1, decision: "always", by: "owner" }, NOW);
    expect(refused).toThrow(ApprovalError);
    expect(refused).toThrow(/always never covers mcp__kernel__kernel_merge_approval_request/);
    expect(env.store.prepare("SELECT status FROM approvals WHERE id = 1").pluck().get()).toBe("pending");
  });

  it("is refused before any hold in a chat session (held_refused, nothing written), and recorded as a draft in a draft playbook, never held", async () => {
    const tools = createAutomateRunnerTools();
    const chat = await gateEnv(env, tools, null);
    const refused = await chat.call(APPROVAL, REQUEST);
    expect(refused.permissionDecision).toBe("deny");
    expect(refused.permissionDecisionReason).toMatch(/^not_a_playbook_session: /);
    expect(events(env.store, "tool_decision").map((e) => e.payload["reason"])).toEqual(["held_refused"]);
    expect(env.store.prepare("SELECT count(*) FROM approvals").pluck().get()).toBe(0);

    const draft = await gateEnv(env, tools, env.playbook("draft"));
    const out = await draft.call(APPROVAL, REQUEST);
    expect(out).toEqual({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: draftDenyReason(1) });
    expect(env.store.prepare("SELECT count(*) FROM approvals").pluck().get()).toBe(0);
    expect(env.store.prepare("SELECT tool FROM draft_outputs").pluck().all()).toEqual([APPROVAL]);
  });

  it("refuses a malformed request before it is held: a short SHA, an unknown CI word and a bad time write no approval", async () => {
    const tools = createAutomateRunnerTools();
    const gate = await gateEnv(env, tools, env.playbook("live"));
    for (const bad of [{ ...REQUEST, head_sha: HEAD.slice(0, 7) }, { ...REQUEST, ci: "success" }, { ...REQUEST, ready_at: "soon" }, { ...REQUEST, head_sha: HEAD.toUpperCase() }]) {
      const out = await gate.call(APPROVAL, bad);
      expect(out.permissionDecision, JSON.stringify(bad)).toBe("deny");
      expect(out.permissionDecisionReason, JSON.stringify(bad)).toMatch(/^kernel_merge_approval_request: invalid input/);
    }
    expect(env.store.prepare("SELECT count(*) FROM approvals").pluck().get()).toBe(0);
  });

  it("once approved, the agent's repeat is allowed once and the handler only answers recorded; a second repeat is held anew", async () => {
    const tools = createAutomateRunnerTools();
    const pb = env.playbook("live");
    const gate = await gateEnv(env, tools, pb);
    await approve(gate, REQUEST);
    expect(await gate.call(APPROVAL, REQUEST)).toEqual({ hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "approval_granted" });
    expect(await env.call(tools, APPROVAL, REQUEST, { playbook: pb })).toMatchObject({ isError: false, value: { recorded: true } });
    expect((await gate.call(APPROVAL, REQUEST)).permissionDecisionReason).toMatch(/^approval_required: held as approval 2;/);
  });

  it("once approved, merge_check answers go for that head and wait (head moved) after a new push; a stale ready_at is wait", async () => {
    setPolicy("studio_approval");
    installRunFiles(env.checkout, "parked");
    const fake = fakeFor();
    const tools = createAutomateRunnerTools({ client: () => fake });
    const gate = await gateEnv(env, tools, env.playbook("live"));
    // Before any approval: wait, awaiting the owner.
    expect(await check(fake)).toEqual(wait("awaiting_owner_approval"));
    // Held but undecided, or denied: still wait.
    await gate.call(APPROVAL, REQUEST);
    expect(await check(fake)).toEqual(wait("awaiting_owner_approval"));
    decideApproval(env.store, { id: 1, decision: "deny", by: "owner" }, NOW);
    expect(await check(fake)).toEqual(wait("awaiting_owner_approval"));
    // Approved at this head and this READY time: go.
    await approve(gate, REQUEST);
    expect(await check(fake)).toEqual(GO);
    // An approval for another READY time of the same head is not this one: wait.
    editParked((t) => t.replace(READY_AT, "2026-11-08T09:00:00Z"));
    expect(await check(fake)).toEqual(wait("ready_at_mismatch"));
    editParked((t) => t.replace("2026-11-08T09:00:00Z", READY_AT));
    expect(await check(fake)).toEqual(GO);
    // A new push: the approval is stale (wait, head moved); a re-drain at the new head needs a new approval.
    fake.setMergeState("o/r", PR, state({ head_sha: B }));
    expect(await check(fake)).toEqual(wait("head_moved"));
    editParked((t) => t.replace(HEAD, B));
    expect(await check(fake)).toEqual(wait("awaiting_owner_approval"));
  });

  it("an approval for another PR, another repo or another head never satisfies this one", async () => {
    setPolicy("studio_approval");
    installRunFiles(env.checkout, "parked");
    const fake = fakeFor();
    const tools = createAutomateRunnerTools({ client: () => fake });
    const gate = await gateEnv(env, tools, env.playbook("live"));
    for (const other of [{ ...REQUEST, pr: 8 }, { ...REQUEST, repo: "o/else" }, { ...REQUEST, head_sha: B }]) await approve(gate, other);
    expect(await check(fake)).toEqual(wait("awaiting_owner_approval"));
  });

  it("on a Solo repo an approval at the head is not needed, but one whose ready_at differs still holds the merge back", async () => {
    setPolicy("solo");
    installRunFiles(env.checkout, "parked");
    const fake = fakeFor();
    const tools = createAutomateRunnerTools({ client: () => fake });
    const gate = await gateEnv(env, tools, env.playbook("live"));
    expect(await check(fake)).toEqual(GO);
    await approve(gate, { ...REQUEST, ready_at: "2026-11-08T06:00:00Z" });
    expect(await check(fake)).toEqual(wait("ready_at_mismatch"));
    await approve(gate, REQUEST);
    expect(await check(fake)).toEqual(GO);
  });
});

describe("AC9: policyMet reads the approval the real tool path filed", () => {
  it("is met for that repo, PR and head on a studio_approval repo once approved, and not met after a new push", async () => {
    setPolicy("studio_approval");
    const fake = fakeFor();
    const tools = createAutomateRunnerTools({ client: () => fake });
    const gate = await gateEnv(env, tools, env.playbook("live"));
    const deps = { store: env.store, client: () => fake, now: () => NOW };
    // Held, not yet decided: not met.
    await gate.call(APPROVAL, REQUEST);
    expect(await policyMet("o/r", PR, HEAD, deps)).toEqual({ met: false, reason: "awaiting_owner_approval" });
    // The row is the one the rail filed, not a hand-built one.
    const filed = JSON.parse(env.store.prepare("SELECT payload_json FROM approvals WHERE id = 1").pluck().get() as string) as Record<string, unknown>;
    expect(Object.keys(filed).sort()).toEqual(["cwd", "input", "tool"]);
    expect(filed["repo"]).toBeUndefined();
    decideApproval(env.store, { id: 1, decision: "once", by: "owner" }, NOW);
    expect(await policyMet("o/r", PR, HEAD, deps)).toEqual({ met: true });
    // A new push: the head is no longer the approved one.
    fake.setMergeState("o/r", PR, state({ head_sha: B }));
    expect(await policyMet("o/r", PR, HEAD, deps)).toEqual({ met: false, reason: "head_moved" });
    expect(await policyMet("o/r", PR, B, deps)).toEqual({ met: false, reason: "awaiting_owner_approval" });
    // Another PR on the same repo has no approval.
    fake.setMergeState("o/r", 8, state());
    expect(await policyMet("o/r", 8, HEAD, deps)).toEqual({ met: false, reason: "awaiting_owner_approval" });
  });
});
