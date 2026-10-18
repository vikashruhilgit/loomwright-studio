// The agents feature's foundation (phase 4 item 01): one `agents`
// contribution built from three empty sub-file parts (`roster`, `delegate`,
// `charter-tools`), registered seventh in `SHIPPED_CONTRIBUTIONS`, whose only
// part is the verb-less `studio agents` subcommand; the part merge's refusals;
// the one settings reader every agent shares (`readAgentSettings`, with
// `readWrightSettings` a thin call keeping its own shapes); the one memory
// reader (`ensureAgentMemoryFiles`); the read-only registry lookups; and the
// closed value sets migration 14's TEXT columns hold. A temp data dir with a
// hand-written `api.json`, a stub Keychain, a stub fetch that fails the test
// if called, and a temp home dir for the protected-folder check: never a
// daemon, the real home or the real Keychain.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENTS_HELP,
  AGENT_CREATED_BY,
  AGENT_ID_PATTERN,
  AGENT_PARTS,
  AGENT_STATUSES,
  AVATAR_HUES,
  AVATAR_SHAPES,
  MESSAGE_PHASE4_FIELDS,
  RESERVED_AGENT_IDS,
  agentMemoryDir,
  agentSettingsPath,
  agentsContribution,
  agentsContributionOf,
  charterToolsPart,
  delegatePart,
  ensureAgentMemoryFiles,
  getAgent,
  isRoutable,
  isValidAgentId,
  listAgents,
  mergeAgentParts,
  readAgentSettings,
  rosterPart,
} from "../src/agents/index.js";
import type { AgentPart, AgentVerb } from "../src/agents/index.js";
import { KERNEL_MEMORY_DIRS, MEMORY_FILES, ensureMemoryFiles } from "../src/brain/memory.js";
import { PROPOSED_ALLOWED_TOOLS, readWrightSettings, wrightSettingsPath } from "../src/brain/settings.js";
import { USAGE, runCli } from "../src/cli/index.js";
import type { CliDeps } from "../src/cli/index.js";
import { ContributionConflictError, InvalidContributionError, PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { mirrorPath, mirrorRelativePath } from "../src/playbooks/mirror.js";
import { NEVER_CATEGORIES } from "../src/sessions/policy.js";
import { Store } from "../src/store/index.js";
import { handoffPath } from "../src/tools/handoff.js";

let tmp: string;
let dataDir: string;
let homeDir: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-agents-"));
  dataDir = join(tmp, "data");
  homeDir = join(tmp, "home");
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

function writeApiInfo(dir: string = tmp): string {
  writeFileSync(join(dir, "api.json"), JSON.stringify({ port: 1, host: "127.0.0.1", pid: process.pid, started_at: "x" }));
  return dir;
}

/** `studio <argv>` with the shipped contributions, a live api.json pid, and no Keychain or API reachable. */
async function studio(argv: string[], overrides: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const reads: string[] = [];
  const fetches: string[] = [];
  const code = await runCli(argv, {
    dataDir: writeApiInfo(),
    isPidAlive: () => true,
    keychain: {
      read: (service) => {
        reads.push(service);
        return "unused";
      },
    },
    fetch: (async (input: unknown) => {
      fetches.push(String(input));
      throw new Error("the agents shell must not call the API");
    }) as typeof fetch,
    stdout: { write: (c: string) => out.push(c) },
    stderr: { write: (c: string) => err.push(c) },
    ...overrides,
  });
  return { code, stdout: out.join(""), stderr: err.join(""), reads, fetches };
}

const emptyPart = (name: string, extra: Partial<AgentPart> = {}): AgentPart => ({ name, tools: [], routes: [], verbs: [], handlers: {}, ...extra });

const verb = (name: string): AgentVerb => ({ name, help: `studio agents ${name} <id>`, run: async () => 7 });

/** The error `fn` throws (a test failure when it throws none). */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw");
}

/** A settings file for `id`, from the proposed shape plus `extra`. */
function writeSettings(id: string, extra: Record<string, unknown> = {}, model: unknown = "claude-haiku-4-5"): string {
  const file = agentSettingsPath(dataDir, id);
  mkdirSync(join(file, ".."), { recursive: true });
  const settings = { model, effort: null, permission_mode: "default", tool_policy: { status: "proposed", allowedTools: ["Read"], allowedBashPrefixes: [] }, ...extra };
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return file;
}

// ---- AC3: the contribution, its parts and `studio agents` -------------------------------

describe("the agents contribution (AC3)", () => {
  it("is the seventh shipped contribution, after playbooks: the parts' tools, one verb-less agents subcommand, no route, handler or due work", () => {
    expect(SHIPPED_CONTRIBUTIONS[6]).toBe(agentsContribution);
    expect(SHIPPED_CONTRIBUTIONS[5]?.name).toBe("playbooks");
    expect(agentsContribution.name).toBe("agents");
    expect(Object.isFrozen(agentsContribution)).toBe(true);
    expect(Object.keys(agentsContribution)).toEqual(["name", "tools", "subcommands"]);
    const merged = mergeContributions([agentsContribution], PHASE1_RESERVED);
    // Each part's tools, merged in part order (each part's own list is pinned in the next test).
    expect(merged.tools).toEqual(AGENT_PARTS.flatMap((p) => [...p.tools]));
    expect(merged.routes).toEqual([]);
    expect(merged.handlers).toEqual({});
    expect(merged.dueWork).toEqual([]);
    expect(merged.subcommands.map((s) => [s.name, s.help])).toEqual([["agents", "studio agents <verb>"]]);
    expect(AGENTS_HELP).toBe("studio agents <verb>");
    expect(mergeAgentParts(AGENT_PARTS).verbs).toEqual([]);
  });

  it("is built from three frozen parts, in order: roster (item 02), delegate (item 06), charter-tools (item 07)", () => {
    expect(AGENT_PARTS).toEqual([rosterPart, delegatePart, charterToolsPart]);
    expect(AGENT_PARTS.map((p) => p.name)).toEqual(["roster", "delegate", "charter-tools"]);
    expect(Object.isFrozen(AGENT_PARTS)).toBe(true);
    for (const part of AGENT_PARTS) expect(Object.isFrozen(part), part.name).toBe(true);
    // Item 02's roster part: still empty here.
    expect({ tools: rosterPart.tools, routes: rosterPart.routes, verbs: rosterPart.verbs, handlers: rosterPart.handlers, dueWork: rosterPart.dueWork ?? [] }).toEqual({
      tools: [],
      routes: [],
      verbs: [],
      handlers: {},
      dueWork: [],
    });
    // Item 06's delegate part: exactly the tool kernel_agent_message, nothing else.
    expect(Object.isFrozen(delegatePart.tools)).toBe(true);
    expect({ tools: delegatePart.tools.map((t) => t.name), routes: delegatePart.routes, verbs: delegatePart.verbs, handlers: delegatePart.handlers, dueWork: delegatePart.dueWork ?? [] }).toEqual({
      tools: ["kernel_agent_message"],
      routes: [],
      verbs: [],
      handlers: {},
      dueWork: [],
    });
    // Item 07's charter-tools part: still empty here.
    expect({
      tools: charterToolsPart.tools,
      routes: charterToolsPart.routes,
      verbs: charterToolsPart.verbs,
      handlers: charterToolsPart.handlers,
      dueWork: charterToolsPart.dueWork ?? [],
    }).toEqual({
      tools: [],
      routes: [],
      verbs: [],
      handlers: {},
      dueWork: [],
    });
  });
});

describe("studio agents (AC3)", () => {
  it("with no verb, or help: the help then `no verbs yet` on stdout, 0; no Keychain read, no API call", async () => {
    for (const argv of [["agents"], ["agents", "help"]]) {
      const r = await studio(argv);
      expect(r, argv.join(" ")).toMatchObject({ code: 0, stdout: `${AGENTS_HELP}\nno verbs yet\n`, stderr: "" });
      expect(r.reads).toEqual([]);
      expect(r.fetches).toEqual([]);
    }
  });

  it("an unknown verb: one line naming it, then the help, on stderr; 2", async () => {
    const r = await studio(["agents", "nope", "1"]);
    expect(r).toMatchObject({ code: 2, stdout: "", stderr: `studio agents: unknown verb "nope"\n${AGENTS_HELP}\n` });
    expect(r.reads).toEqual([]);
    expect(r.fetches).toEqual([]);
  });

  it("passes the api.json pid check first, like every contributed subcommand: a dead pid or no api.json never runs it", async () => {
    const dead = await studio(["agents"], { isPidAlive: () => false });
    expect(dead.code).toBe(1);
    expect(dead.stdout).toBe("");
    expect(dead.stderr).toMatch(/^studio: kernel daemon is not running \(pid \d+ in .*api\.json is gone\)\n$/);
    const missing = await studio(["agents", "nope"], { dataDir: join(tmp, "elsewhere") });
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).not.toContain("unknown verb");
    expect(missing.reads).toEqual([]);
  });

  it("the help line is one whole entry of studio's usage text", async () => {
    const r = await studio(["nope"]);
    expect(r.code).toBe(2);
    expect(r.stderr.startsWith(`${USAGE} | `)).toBe(true);
    expect(r.stderr.endsWith("\n")).toBe(true);
    expect(` | ${r.stderr.slice(0, -1)} | `).toContain(` | ${AGENTS_HELP} | `);
  });
});

describe("mergeAgentParts (AC3)", () => {
  it("a verb claimed by two parts is refused, naming both parts", () => {
    const err = thrown(() => mergeAgentParts([emptyPart("roster", { verbs: [verb("show")] }), emptyPart("delegate"), emptyPart("charter-tools", { verbs: [verb("show")] })]));
    expect(err).toBeInstanceOf(ContributionConflictError);
    expect((err as ContributionConflictError).part).toBe("subcommand");
    expect((err as ContributionConflictError).conflictName).toBe("agents show");
    expect((err as ContributionConflictError).owners).toEqual(["roster", "charter-tools"]);
  });

  it("a handler kind claimed by two parts is refused, naming both parts", () => {
    const err = thrown(() => mergeAgentParts([emptyPart("roster", { handlers: { message: () => {} } }), emptyPart("delegate", { handlers: { message: () => {} } })]));
    expect(err).toBeInstanceOf(ContributionConflictError);
    expect((err as ContributionConflictError).part).toBe("handler");
    expect((err as ContributionConflictError).conflictName).toBe("message");
    expect((err as ContributionConflictError).owners).toEqual(["roster", "delegate"]);
  });

  it("a verb named help is refused: it is the built-in help", () => {
    expect(() => mergeAgentParts([emptyPart("roster", { verbs: [verb("help")] })])).toThrow(InvalidContributionError);
  });

  it("a part's verb goes on the help line and dispatches; the contribution keeps only non-empty keys", async () => {
    const handler = () => {};
    const c = agentsContributionOf([emptyPart("roster", { verbs: [verb("list")] }), emptyPart("delegate", { handlers: { wakeup: handler } })]);
    expect(Object.keys(c)).toEqual(["name", "subcommands", "handlers"]);
    const sub = c.subcommands?.[0];
    expect(sub?.help).toBe("studio agents <verb> | list <id>");
    const out: string[] = [];
    const output = { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => out.push(s) } };
    const noClient = { request: async () => ({ status: 500, body: {} }) } as never;
    expect(await sub?.run(["list"], noClient, output)).toBe(7);
    expect(await sub?.run([], noClient, output)).toBe(0);
    expect(out.join("")).toBe("studio agents <verb> | list <id>\n");
  });
});

// ---- the closed value sets --------------------------------------------------------------

describe("the closed value sets", () => {
  it("pins the lists migration 14's TEXT columns hold, each frozen", () => {
    expect(AGENT_STATUSES).toEqual(["active", "off"]);
    expect(AGENT_CREATED_BY).toEqual(["owner", "wright"]);
    expect(RESERVED_AGENT_IDS).toEqual(["wright", "shared", "_unassigned", "playbooks"]);
    expect(AVATAR_SHAPES).toEqual(["shark", "seahorse", "octopus", "turtle", "jellyfish", "fish", "crab"]);
    expect(AVATAR_SHAPES).not.toContain("whale");
    expect(AVATAR_HUES).toEqual(["crew-teal", "crew-sky", "crew-berry", "crew-olive", "crew-slate"]);
    expect(MESSAGE_PHASE4_FIELDS).toEqual(["from_agent", "depth", "reply_to", "workspace"]);
    for (const list of [AGENT_STATUSES, AGENT_CREATED_BY, RESERVED_AGENT_IDS, AVATAR_SHAPES, AVATAR_HUES, MESSAGE_PHASE4_FIELDS]) expect(Object.isFrozen(list)).toBe(true);
  });

  it("the avatar hues are exactly the crew-* tokens of the design system", () => {
    const tokens = readFileSync(new URL("../../docs/design/tokens.json", import.meta.url), "utf8");
    const crew = [...new Set([...tokens.matchAll(/"name": "(crew-[a-z]+)"/g)].map((m) => m[1]))];
    expect(crew).toEqual([...AVATAR_HUES]);
  });

  it("isValidAgentId: the grammar, and never a reserved id", () => {
    for (const ok of ["mason", "a", "reviewer-2", `a${"b".repeat(31)}`]) expect(isValidAgentId(ok), ok).toBe(true);
    for (const bad of ["", "Mason", "2nd", "-a", "a_b", "a.b", "../x", "a/b", `a${"b".repeat(32)}`, "wright", "shared", "_unassigned", "playbooks", 7, null]) {
      expect(isValidAgentId(bad), String(bad)).toBe(false);
    }
    expect(AGENT_ID_PATTERN.test("wright")).toBe(true);
  });

  it("the reserved ids are the kernel-owned memory/ folders, read from the paths the kernel actually writes", () => {
    expect(RESERVED_AGENT_IDS).toBe(KERNEL_MEMORY_DIRS);
    const underMemory = (path: string): string => {
      const parts = relative(join(dataDir, "memory"), path).split(sep);
      return parts[0] ?? "";
    };
    const owned = [
      ...MEMORY_FILES.map((f) => f.relativePath.split("/")[0] ?? ""),
      mirrorRelativePath("x").split("/")[1] ?? "",
      underMemory(mirrorPath(dataDir, "x")),
      underMemory(handoffPath(dataDir, { agent: null, taskId: null, sessionId: 1 })),
    ];
    for (const folder of owned) expect(RESERVED_AGENT_IDS, folder).toContain(folder);
    // The one kernel-owned file under config/agents/ is Wright's.
    expect(wrightSettingsPath(dataDir)).toBe(join(dataDir, "config", "agents", "wright.json"));
    expect(RESERVED_AGENT_IDS).toContain("wright");
  });
});

// ---- AC4: readAgentSettings -------------------------------------------------------------

describe("readAgentSettings (AC4)", () => {
  it("returns a crew member's never, limits and workspaces with the session settings", () => {
    const workspace = join(tmp, "work", "repo");
    const file = writeSettings("mason", { never: ["git_push", "gh_pr_create"], limits: { tokens_per_day: 200000, sessions_at_once: 2, delegation_depth: 1 }, workspaces: [workspace] });
    expect(readAgentSettings(dataDir, "mason", { homeDir })).toEqual({
      ok: true,
      file,
      settings: {
        model: "claude-haiku-4-5",
        effort: null,
        permissionMode: "default",
        policy: { allowedTools: ["Read"], allowedBashPrefixes: [] },
        policyStatus: "proposed",
        never: ["git_push", "gh_pr_create"],
        limits: { tokens_per_day: 200000, sessions_at_once: 2, delegation_depth: 1 },
        workspaces: [workspace],
      },
    });
    // Each limit is optional; the reader picks none.
    writeSettings("mason", { limits: { sessions_at_once: 1 } });
    const r = readAgentSettings(dataDir, "mason", { homeDir });
    expect(r.ok && r.settings.limits).toEqual({ sessions_at_once: 1 });
    expect(r.ok && Object.keys(r.settings)).toEqual(["model", "effort", "permissionMode", "policy", "policyStatus", "limits"]);
    // Every never category the rail knows is accepted.
    writeSettings("mason", { never: [...NEVER_CATEGORIES] });
    expect(readAgentSettings(dataDir, "mason", { homeDir }).ok).toBe(true);
  });

  it("an unknown never category is settings_invalid naming the file and the field", () => {
    const file = writeSettings("mason", { never: ["git_push", "push_everything"] });
    const r = readAgentSettings(dataDir, "mason", { homeDir });
    expect(r).toMatchObject({ ok: false, error: "settings_invalid", file, field: "never.1" });
    expect(r.ok === false && "message" in r && r.message.startsWith(`${file}: never.1: `)).toBe(true);
  });

  it("a limit that is not a positive safe integer (or an unknown limit) is settings_invalid naming the field", () => {
    for (const [limits, field] of [
      [{ tokens_per_day: 0 }, "limits.tokens_per_day"],
      [{ sessions_at_once: -1 }, "limits.sessions_at_once"],
      [{ delegation_depth: 1.5 }, "limits.delegation_depth"],
      [{ tokens_per_day: "100" }, "limits.tokens_per_day"],
      [{ tokens_per_day: Number.MAX_SAFE_INTEGER + 2 }, "limits.tokens_per_day"],
      [{ token_per_day: 5 }, "limits"],
    ] as const) {
      const file = writeSettings("mason", { limits });
      expect(readAgentSettings(dataDir, "mason", { homeDir }), JSON.stringify(limits)).toMatchObject({ ok: false, error: "settings_invalid", file, field });
    }
  });

  it("a relative workspace, one inside a protected folder, or the data dir (or inside it, by any spelling) is settings_invalid naming the field", () => {
    mkdirSync(dataDir, { recursive: true });
    symlinkSync(dataDir, join(tmp, "link"));
    const cases: [string, RegExp][] = [
      ["work/repo", /is not an absolute path/],
      [join(homeDir, "Documents", "repo"), /macOS-protected folder/],
      [join(homeDir, "Desktop"), /macOS-protected folder/],
      [dataDir, /the data dir or inside it/],
      [join(dataDir, "memory", "mason"), /the data dir or inside it/],
      [join(realpathSync(dataDir), "x"), /the data dir or inside it/],
      [join(dataDir.toUpperCase(), "x"), /the data dir or inside it/],
      // Through a symlink to the data dir, to a folder not created yet.
      [join(tmp, "link", "later"), /the data dir or inside it/],
    ];
    for (const [workspace, why] of cases) {
      const file = writeSettings("mason", { workspaces: [join(tmp, "fine"), workspace] });
      const r = readAgentSettings(dataDir, "mason", { homeDir });
      expect(r, workspace).toMatchObject({ ok: false, error: "settings_invalid", file, field: "workspaces.1" });
      expect(r.ok === false && "message" in r ? r.message : "", workspace).toMatch(why);
    }
    // A sibling of the data dir is not inside it.
    writeSettings("mason", { workspaces: [`${dataDir}2`] });
    expect(readAgentSettings(dataDir, "mason", { homeDir }).ok).toBe(true);
  });

  it("a workspace inside the data dir through the /System/Volumes/Data firmlink (any case) is settings_invalid naming the field", () => {
    mkdirSync(dataDir, { recursive: true });
    for (const data of ["/System/Volumes/Data", "/system/volumes/data"]) {
      const workspace = `${data}${join(realpathSync(dataDir), "x")}`;
      const file = writeSettings("mason", { workspaces: [workspace] });
      const r = readAgentSettings(dataDir, "mason", { homeDir });
      expect(r, workspace).toMatchObject({ ok: false, error: "settings_invalid", file, field: "workspaces.0" });
      expect(r.ok === false && "message" in r ? r.message : "", workspace).toMatch(/the data dir or inside it/);
    }
  });

  it("a workspace that contains the data dir ('/', its parent, or an ancestor of the /System/Volumes/Data firmlink) is settings_invalid naming the field", () => {
    mkdirSync(dataDir, { recursive: true });
    // `/System/Volumes` and `/System` hold the data dir through the firmlink
    // (lexically, so on any platform); a symlink to `/System/Volumes` only
    // resolves where that folder exists (macOS).
    const viaFirmlink = ["/System/Volumes", "/System", "/system/volumes"];
    if (existsSync("/System/Volumes")) {
      symlinkSync("/System/Volumes", join(tmp, "sysvol"));
      viaFirmlink.push(join(tmp, "sysvol"));
    }
    for (const workspace of ["/", tmp, realpathSync(tmp), ...viaFirmlink]) {
      const file = writeSettings("mason", { workspaces: [workspace] });
      const r = readAgentSettings(dataDir, "mason", { homeDir });
      expect(r, workspace).toMatchObject({ ok: false, error: "settings_invalid", file, field: "workspaces.0" });
      expect(r.ok === false && "message" in r ? r.message : "", workspace).toMatch(/contains the data dir/);
    }
  });

  it("a crew file with an unknown key (a misspelt never, limits, workspaces or tool_policy field) is settings_invalid naming the key, never ok without it", () => {
    for (const [extra, field, key] of [
      [{ nevr: ["git_push"] }, "the file", "nevr"],
      [{ Never: ["git_push"] }, "the file", "Never"],
      [{ workspace: ["/"] }, "the file", "workspace"],
      [{ limit: { sessions_at_once: 1 } }, "the file", "limit"],
      [{ tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [], never: ["git_push"] } }, "tool_policy", "never"],
    ] as const) {
      const file = writeSettings("mason", extra);
      const r = readAgentSettings(dataDir, "mason", { homeDir });
      expect(r, key).toMatchObject({ ok: false, error: "settings_invalid", file, field });
      expect(r.ok === false && "message" in r ? r.message : "", key).toBe(`${file}: ${field}: unknown key ${JSON.stringify(key)} (a misspelt setting is refused, never silently not applied)`);
    }
    // Two unknown keys are both named.
    const file = writeSettings("mason", { nevr: [], workspace: [] });
    const r = readAgentSettings(dataDir, "mason", { homeDir });
    expect(r.ok === false && "message" in r ? r.message : "").toBe(`${file}: the file: unknown keys "nevr", "workspace" (a misspelt setting is refused, never silently not applied)`);
  });

  it("no file for a crew member is settings_missing naming the file, and nothing is created", () => {
    const r = readAgentSettings(dataDir, "mason", { homeDir });
    expect(r).toEqual({ ok: false, error: "settings_missing", file: agentSettingsPath(dataDir, "mason"), message: expect.stringContaining("mason") });
    expect(existsSync(dataDir)).toBe(false);
    // With the folder present (Wright's file in it), still nothing is created for the crew member.
    readWrightSettings(dataDir);
    expect(readAgentSettings(dataDir, "mason", { homeDir })).toMatchObject({ error: "settings_missing" });
    expect(readdirSync(join(dataDir, "config", "agents"))).toEqual(["wright.json"]);
  });

  it("an id that breaks the grammar, or is reserved, is agent_id_invalid and reads nothing (even a valid file at that path)", () => {
    for (const bad of ["Mason", "shared", "_unassigned", "playbooks", "../config/agents/wright", ""]) {
      if (bad !== "" && !bad.includes("/")) writeSettings(bad);
      const r = readAgentSettings(dataDir, bad, { homeDir });
      expect(r, bad).toEqual({ ok: false, error: "agent_id_invalid", message: expect.any(String) });
    }
    expect(existsSync(wrightSettingsPath(dataDir))).toBe(false);
  });

  it("a crew member with no model is model_unset naming it; a crew file over the size limit or not JSON is settings_invalid on the file", () => {
    const file = writeSettings("mason", {}, null);
    expect(readAgentSettings(dataDir, "mason", { homeDir })).toEqual({ ok: false, error: "model_unset", file, field: "model", message: `Agent mason has no model: set "model" in ${file} (the kernel never picks one)` });
    writeFileSync(file, "{");
    expect(readAgentSettings(dataDir, "mason", { homeDir })).toEqual({ ok: false, error: "settings_invalid", file, field: "the file", message: `${file}: not JSON` });
    writeFileSync(file, " ".repeat(64 * 1024 + 1));
    expect(readAgentSettings(dataDir, "mason", { homeDir })).toMatchObject({ error: "settings_invalid", field: "the file" });
  });
});

// ---- AC5: Wright's settings are unchanged -----------------------------------------------

describe("Wright's settings through the one reader (AC5)", () => {
  it("a fresh data dir: wright.json is created with the proposed policy (the four agent names in it) and no never, limits or workspaces", () => {
    expect(readAgentSettings(dataDir, "wright")).toMatchObject({ ok: false, error: "model_unset", file: wrightSettingsPath(dataDir), field: "model" });
    const written = JSON.parse(readFileSync(wrightSettingsPath(dataDir), "utf8")) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual(["model", "effort", "permission_mode", "tool_policy"]);
    for (const name of ["create", "update", "list", "message"]) expect(PROPOSED_ALLOWED_TOOLS).toContain(`mcp__kernel__kernel_agent_${name}`);
  });

  it("readWrightSettings keeps today's shapes: settings_invalid has no field key, model_unset has Wright's text, ok carries the file and five settings", () => {
    const file = wrightSettingsPath(dataDir);
    expect(readWrightSettings(dataDir)).toStrictEqual({ ok: false, error: "model_unset", file, field: "model", message: `Wright has no model: set "model" in ${file} (the kernel never picks one)` });
    writeFileSync(file, "nope");
    expect(readWrightSettings(dataDir)).toStrictEqual({ ok: false, error: "settings_invalid", file, message: `${file}: not JSON` });
    writeFileSync(file, JSON.stringify({ model: "m", permission_mode: "default", tool_policy: { allowedTools: [], allowedBashPrefixes: 3 } }));
    expect(readWrightSettings(dataDir)).toStrictEqual({ ok: false, error: "settings_invalid", file, message: expect.stringMatching(new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: tool_policy\\.allowedBashPrefixes: `)) });
    // The one reader names the field; the Wright reader drops it.
    expect(readAgentSettings(dataDir, "wright")).toMatchObject({ error: "settings_invalid", field: "tool_policy.allowedBashPrefixes" });
    writeFileSync(file, JSON.stringify({ model: " m ", effort: "high", permission_mode: "plan", tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] } }));
    expect(readWrightSettings(dataDir)).toStrictEqual({
      ok: true,
      file,
      settings: { model: "m", effort: "high", permissionMode: "plan", policy: { allowedTools: ["Read"], allowedBashPrefixes: [] }, policyStatus: null },
    });
    // Unknown keys in wright.json are still dropped, as before the crew existed (only crew files are strict).
    writeFileSync(file, JSON.stringify({ model: "m", permission_mode: "default", note: "x", tool_policy: { allowedTools: [], allowedBashPrefixes: [], note: "y" } }));
    expect(readWrightSettings(dataDir)).toMatchObject({ ok: true, settings: { model: "m", policy: { allowedTools: [], allowedBashPrefixes: [] } } });
  });

  it("a wright.json that sets a valid never, limits or workspaces is settings_invalid (refused, never silently dropped)", () => {
    const file = wrightSettingsPath(dataDir);
    readWrightSettings(dataDir);
    const base = { model: "m", permission_mode: "default", tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] } };
    for (const [field, value] of [
      ["never", ["git_push"]],
      ["limits", { tokens_per_day: 5 }],
      ["workspaces", [join(tmp, "work")]],
    ] as const) {
      writeFileSync(file, JSON.stringify({ ...base, [field]: value }));
      expect(readWrightSettings(dataDir), field).toStrictEqual({ ok: false, error: "settings_invalid", file, message: `${file}: ${field}: not supported for Wright yet (the kernel does not apply it to Wright's sessions); remove it` });
      expect(readAgentSettings(dataDir, "wright", { homeDir }), field).toMatchObject({ ok: false, error: "settings_invalid", file, field });
    }
  });
});

// ---- AC6: ensureAgentMemoryFiles --------------------------------------------------------

describe("ensureAgentMemoryFiles (AC6)", () => {
  it("a crew id with no role.md: creates preferences, people and lessons, never role.md, and reports charter_missing", () => {
    const dir = agentMemoryDir(dataDir, "mason");
    expect(dir).toBe(join(dataDir, "memory", "mason"));
    expect(ensureAgentMemoryFiles(dataDir, "mason")).toEqual({ ok: false, error: "charter_missing", file: join(dir, "role.md") });
    expect(readdirSync(dir).sort()).toEqual(["lessons.md", "people.md", "preferences.md"]);
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), "utf8"), f).toContain("mason");
    // Only the crew member's own folder: not Wright's, not shared/.
    expect(readdirSync(join(dataDir, "memory"))).toEqual(["mason"]);
  });

  it("an existing file keeps its bytes (exclusive create); with role.md present the result is ok", () => {
    const dir = agentMemoryDir(dataDir, "mason");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "people.md"), "Asha reviews payments.\n");
    writeFileSync(join(dir, "role.md"), "# Mason\n\nThe owner's charter.\n");
    expect(ensureAgentMemoryFiles(dataDir, "mason")).toEqual({ ok: true });
    expect(readFileSync(join(dir, "people.md"), "utf8")).toBe("Asha reviews payments.\n");
    expect(readFileSync(join(dir, "role.md"), "utf8")).toBe("# Mason\n\nThe owner's charter.\n");
    expect(existsSync(join(dir, "lessons.md"))).toBe(true);
  });

  it("for wright it does exactly what ensureMemoryFiles does", () => {
    expect(agentMemoryDir(dataDir, "wright")).toBe(join(dataDir, "memory", "wright"));
    expect(ensureAgentMemoryFiles(dataDir, "wright")).toEqual({ ok: true });
    for (const f of MEMORY_FILES) expect(existsSync(join(dataDir, "memory", f.relativePath)), f.relativePath).toBe(true);
    expect(ensureMemoryFiles(dataDir)).toEqual([]);
  });

  it("an invalid or reserved id is agent_id_invalid and creates nothing", () => {
    for (const bad of ["shared", "playbooks", "_unassigned", "Mason", "../wright", ""]) {
      expect(ensureAgentMemoryFiles(dataDir, bad), bad).toMatchObject({ ok: false, error: "agent_id_invalid" });
    }
    expect(existsSync(dataDir)).toBe(false);
  });

  it("playbooks is refused even when a playbook mirror named role.md exists: a mirror is never a charter, and no crew file lands among the mirrors", () => {
    const mirror = mirrorPath(dataDir, "role");
    mkdirSync(join(mirror, ".."), { recursive: true });
    writeFileSync(mirror, "# a playbook mirror\n");
    expect(ensureAgentMemoryFiles(dataDir, "playbooks")).toMatchObject({ ok: false, error: "agent_id_invalid" });
    expect(readAgentSettings(dataDir, "playbooks", { homeDir })).toMatchObject({ ok: false, error: "agent_id_invalid" });
    expect(readdirSync(join(dataDir, "memory", "playbooks"))).toEqual(["role.md"]);
    expect(existsSync(join(dataDir, "config"))).toBe(false);
  });
});

// ---- the registry lookups ---------------------------------------------------------------

describe("the registry lookups", () => {
  function storeWith(rows: { id: string; status: string; created_at: string }[]): Store {
    const store = new Store({ dataDir: join(tmp, "store") });
    stores.push(store);
    const insert = store.prepare<[string, string, string]>(
      "INSERT INTO agents (id, display_name, avatar_shape, avatar_hue, status, created_by, charter_json, created_at) VALUES (?, 'Name', 'crab', 'crew-teal', ?, 'owner', '{}', ?)",
    );
    for (const r of rows) insert.run(r.id, r.status, r.created_at);
    return store;
  }

  it("getAgent reads a row as stored; listAgents orders by created_at then id; neither writes", () => {
    const store = storeWith([
      { id: "zed", status: "active", created_at: "2026-10-18T10:00:00.000Z" },
      { id: "mason", status: "off", created_at: "2026-10-18T11:00:00.000Z" },
      { id: "ada", status: "active", created_at: "2026-10-18T10:00:00.000Z" },
    ]);
    expect(getAgent(store, "mason")).toMatchObject({ id: "mason", display_name: "Name", avatar_shape: "crab", avatar_hue: "crew-teal", status: "off", created_by: "owner", approval_id: null, charter_json: "{}" });
    expect(getAgent(store, "nobody")).toBeUndefined();
    expect(getAgent(store, "wright")).toBeUndefined();
    expect(listAgents(store).map((a) => a.id)).toEqual(["ada", "zed", "mason"]);
  });

  it("isRoutable: wright always; a registered active member; never an off, unknown, invalid or reserved id", () => {
    const store = storeWith([
      { id: "mason", status: "active", created_at: "2026-10-18T10:00:00.000Z" },
      { id: "reviewer", status: "off", created_at: "2026-10-18T10:00:00.000Z" },
    ]);
    expect(isRoutable(store, "wright")).toBe(true);
    expect(isRoutable(store, "mason")).toBe(true);
    expect(isRoutable(store, "reviewer")).toBe(false);
    expect(isRoutable(store, "nobody")).toBe(false);
    expect(isRoutable(store, "Mason")).toBe(false);
    expect(isRoutable(store, "shared")).toBe(false);
  });
});
