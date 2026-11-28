// wa-c: an unedited proposed tool list gets the current proposed tools. The
// shared reader (`readAgentSettings`, so `readWrightSettings`) rewrites a
// `wright.json` whose `tool_policy.status` is `"proposed"` and whose
// `allowedTools` is, as a set, one of the kernel's recorded past lists
// (`kernel/src/agents/past-tool-lists.ts`) to `PROPOSED_ALLOWED_TOOLS`, with a
// backup and one `wright_tool_policy_upgraded` event, and only while an audit
// sink is registered for the data dir. Any other list, any other status and
// every crew file is never written. A temp data dir and a real store; file
// system failures are injected through a `node:fs` mock that passes every
// other call through. Never a session, the Keychain or a model.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAST_PROPOSED_TOOL_LISTS,
  PROPOSED_TOOLS_AUDIT_KINDS,
  isPastProposedList,
  proposedToolsMissing,
  readWrightToolPolicy,
  registerProposedToolsAudit,
} from "../src/agents/past-tool-lists.js";
import type { ProposedToolsAuditSink } from "../src/agents/past-tool-lists.js";
import { agentSettingsPath, readAgentSettings } from "../src/agents/settings.js";
import { PROPOSED_ALLOWED_TOOLS, defaultWrightSettingsJson, readWrightSettings, wrightSettingsPath } from "../src/brain/settings.js";
import { startKernel } from "../src/kernel.js";
import { NO_REF, appendEvent } from "../src/loop/internal.js";
import { events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, stubProvider } from "./session-fakes.js";

/** The injected file system failure: the next matching call throws an error with `code`. */
const fault = vi.hoisted(() => ({ current: undefined as { op: "writeFileSync" | "renameSync"; match: (path: string) => boolean; code: string } | undefined }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const failing = (op: "writeFileSync" | "renameSync", path: unknown): void => {
    const f = fault.current;
    if (f !== undefined && f.op === op && f.match(String(path))) {
      fault.current = undefined;
      throw Object.assign(new Error(`injected ${f.code}`), { code: f.code });
    }
  };
  const writeFileSync = ((path: unknown, ...rest: unknown[]) => {
    failing("writeFileSync", path);
    return (actual.writeFileSync as (...a: unknown[]) => void)(path, ...rest);
  }) as typeof actual.writeFileSync;
  const renameSync = ((from: unknown, to: unknown) => {
    failing("renameSync", to);
    return actual.renameSync(from as string, to as string);
  }) as typeof actual.renameSync;
  return { ...actual, writeFileSync, renameSync, default: { ...actual, writeFileSync, renameSync } };
});

const T0 = "2026-11-28T10:00:00.000Z";
const MODEL = "claude-test-model";
const [LIST_15, LIST_21, LIST_25] = PAST_PROPOSED_TOOL_LISTS as [readonly string[], readonly string[], readonly string[]];

let env: LoopEnv;
let unregister: (() => void) | undefined;

beforeEach(() => {
  env = loopEnv(T0);
  fault.current = undefined;
});

afterEach(() => {
  unregister?.();
  unregister = undefined;
  fault.current = undefined;
  vi.useRealTimers();
  env.cleanup();
});

/** The sink `startKernel` registers, over the test's store. */
function storeSink(): ProposedToolsAuditSink {
  return {
    transaction: (fn) => env.store.transaction(fn),
    record: (kind, payload) => appendEvent(env.store, kind, NO_REF, payload, env.now().toISOString()),
  };
}

function register(sink: ProposedToolsAuditSink = storeSink()): void {
  unregister = registerProposedToolsAudit(env.dataDir, sink);
}

function file(): string {
  return wrightSettingsPath(env.dataDir);
}

/** Writes `wright.json` and returns its bytes. */
function writeWright(settings: Record<string, unknown>): Buffer {
  mkdirSync(join(env.dataDir, "config", "agents"), { recursive: true });
  writeFileSync(file(), `${JSON.stringify(settings, null, 2)}\n`);
  return readFileSync(file());
}

function proposed(allowedTools: readonly string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { model: MODEL, effort: null, permission_mode: "default", tool_policy: { status: "proposed", allowedTools: [...allowedTools], allowedBashPrefixes: [] }, ...extra };
}

function agentsDir(): string[] {
  return readdirSync(join(env.dataDir, "config", "agents")).sort();
}

function backups(): string[] {
  return agentsDir().filter((name) => name.startsWith("wright.json.bak-"));
}

function upgradeEvents(): ReturnType<typeof events> {
  return events(env.store).filter((e) => (PROPOSED_TOOLS_AUDIT_KINDS as readonly string[]).includes(e.kind));
}

/** A shuffled copy with one duplicate: the match ignores order and duplicates. */
function shuffledWithDuplicate(list: readonly string[]): string[] {
  const out = [...list].reverse();
  out.splice(3, 0, out[0] as string);
  return out;
}

describe("the recorded past lists", () => {
  it("are the 15-, 21- and 25-tool lists, each a subset of the next and of PROPOSED_ALLOWED_TOOLS (no upgrade can remove a tool)", () => {
    expect(PAST_PROPOSED_TOOL_LISTS.map((l) => l.length)).toEqual([15, 21, 25]);
    for (const [i, list] of PAST_PROPOSED_TOOL_LISTS.entries()) {
      expect(list.filter((t) => !PROPOSED_ALLOWED_TOOLS.includes(t)), `list ${i}`).toEqual([]);
      const next = PAST_PROPOSED_TOOL_LISTS[i + 1];
      if (next !== undefined) expect(list.filter((t) => !next.includes(t)), `list ${i}`).toEqual([]);
      expect(new Set(list).size, `list ${i} has no duplicate`).toBe(list.length);
    }
  });

  it("matches a past list as a set, never the current list, never a list one tool short or one tool over", () => {
    expect(isPastProposedList(shuffledWithDuplicate(LIST_15))).toBe(true);
    expect(isPastProposedList(LIST_21)).toBe(true);
    expect(isPastProposedList(PROPOSED_ALLOWED_TOOLS)).toBe(false);
    expect(isPastProposedList(LIST_21.slice(1))).toBe(false);
    expect(isPastProposedList([...LIST_15, "Bash"])).toBe(false);
    expect(isPastProposedList([])).toBe(false);
  });

  it("names the current proposed tools a list lacks, in proposal order", () => {
    expect(proposedToolsMissing(PROPOSED_ALLOWED_TOOLS)).toEqual([]);
    expect(proposedToolsMissing(LIST_21)).toEqual(PROPOSED_ALLOWED_TOOLS.filter((t) => !LIST_21.includes(t)));
    expect(proposedToolsMissing(["Read"])).toEqual(PROPOSED_ALLOWED_TOOLS.filter((t) => t !== "Read"));
  });
});

describe("AC1: an unedited proposed list upgrades, with a backup and one event", () => {
  it.each([
    ["15", LIST_15],
    ["21", LIST_21],
    ["25", LIST_25],
  ])("past %s-tool list (shuffled and with a duplicate) upgrades to the current list, with a backup and one event (none when it already is the current list)", (_n, list) => {
    register();
    const old = writeWright(proposed(shuffledWithDuplicate(list)));
    const read = readAgentSettings(env.dataDir, "wright");
    const added = PROPOSED_ALLOWED_TOOLS.filter((t) => !list.includes(t));
    if (added.length === 0) {
      // The 25-tool list is the current proposal at wa-c: nothing to add, nothing written.
      expect(readFileSync(file()).equals(old)).toBe(true);
      expect(backups()).toEqual([]);
      expect(upgradeEvents()).toEqual([]);
      return;
    }
    expect(read.ok && read.settings.policy.allowedTools).toEqual([...PROPOSED_ALLOWED_TOOLS]);
    const written = JSON.parse(readFileSync(file(), "utf8"));
    expect(written.tool_policy).toEqual({ status: "proposed", allowedTools: [...PROPOSED_ALLOWED_TOOLS], allowedBashPrefixes: [] });
    const [backup, ...more] = backups();
    expect(more).toEqual([]);
    expect(backup).toMatch(/^wright\.json\.bak-\d{8}T\d{9}Z-[0-9a-f]{8}$/);
    const backupPath = join(env.dataDir, "config", "agents", backup as string);
    expect(readFileSync(backupPath).equals(old)).toBe(true);
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);
    expect(upgradeEvents()).toEqual([expect.objectContaining({ kind: "wright_tool_policy_upgraded", actor: "kernel", payload: { file: file(), backup: backupPath, added } })]);
    // No temporary sibling is left.
    expect(agentsDir().filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("an unknown top-level key and limits survive the rewrite (it is built from the raw JSON, never the parsed settings)", () => {
    register();
    writeWright(proposed(LIST_15, { limits: { tokens_per_day: 5000 }, x_owner_note: { kept: true }, effort: "high" }));
    const read = readAgentSettings(env.dataDir, "wright");
    expect(read.ok && read.settings.limits).toEqual({ tokens_per_day: 5000 });
    const written = JSON.parse(readFileSync(file(), "utf8"));
    expect(written).toEqual(proposed(PROPOSED_ALLOWED_TOOLS, { limits: { tokens_per_day: 5000 }, x_owner_note: { kept: true }, effort: "high" }));
    expect(Object.keys(written)).toEqual(["model", "effort", "permission_mode", "tool_policy", "limits", "x_owner_note"]);
  });

  it("a file with no model is upgraded too (the upgrade runs before the model check)", () => {
    register();
    writeWright(proposed(LIST_15, { model: null }));
    expect(readAgentSettings(env.dataDir, "wright")).toMatchObject({ ok: false, error: "model_unset" });
    expect(JSON.parse(readFileSync(file(), "utf8")).tool_policy.allowedTools).toEqual([...PROPOSED_ALLOWED_TOOLS]);
    expect(upgradeEvents().map((e) => e.kind)).toEqual(["wright_tool_policy_upgraded"]);
  });

  it("two upgrades in the same millisecond make two backups (a random suffix, exclusive create)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(T0));
    register();
    writeWright(proposed(LIST_15));
    readAgentSettings(env.dataDir, "wright");
    writeWright(proposed(LIST_21));
    readAgentSettings(env.dataDir, "wright");
    expect(backups()).toHaveLength(2);
    expect(upgradeEvents().map((e) => e.kind)).toEqual(["wright_tool_policy_upgraded", "wright_tool_policy_upgraded"]);
  });
});

describe("AC2: the second read writes nothing", () => {
  it("the second read writes nothing and records no event", () => {
    register();
    writeWright(proposed(LIST_15));
    readAgentSettings(env.dataDir, "wright");
    const after = readFileSync(file());
    const read = readAgentSettings(env.dataDir, "wright");
    expect(read.ok && read.settings.policy.allowedTools).toEqual([...PROPOSED_ALLOWED_TOOLS]);
    expect(readFileSync(file()).equals(after)).toBe(true);
    expect(backups()).toHaveLength(1);
    expect(upgradeEvents()).toHaveLength(1);
  });

  it("a fresh data dir's file holds the current list and is never upgraded", () => {
    register();
    expect(readAgentSettings(env.dataDir, "wright")).toMatchObject({ ok: false, error: "model_unset" });
    readAgentSettings(env.dataDir, "wright");
    expect(readFileSync(file(), "utf8")).toBe(defaultWrightSettingsJson());
    expect(agentsDir()).toEqual(["wright.json"]);
    expect(upgradeEvents()).toEqual([]);
  });
});

describe("AC3: an owner's list or status is never written", () => {
  it.each([
    ["one tool removed", proposed(LIST_21.slice(1))],
    ["one tool added", proposed([...LIST_15, "Bash"])],
    ["status owner", { ...proposed(LIST_15), tool_policy: { status: "owner", allowedTools: [...LIST_15], allowedBashPrefixes: [] } }],
    ["status absent", { ...proposed(LIST_15), tool_policy: { allowedTools: [...LIST_15], allowedBashPrefixes: [] } }],
    ["status Proposed", { ...proposed(LIST_15), tool_policy: { status: "Proposed", allowedTools: [...LIST_15], allowedBashPrefixes: [] } }],
  ])("an edited list or a non-proposed status (%s) is left byte for byte, with no event", (_what, settings) => {
    register();
    const old = writeWright(settings);
    const read = readAgentSettings(env.dataDir, "wright");
    expect(read.ok).toBe(true);
    expect(read.ok && read.settings.policy.allowedTools).toEqual((settings.tool_policy as { allowedTools: string[] }).allowedTools);
    expect(readFileSync(file()).equals(old)).toBe(true);
    expect(agentsDir()).toEqual(["wright.json"]);
    expect(upgradeEvents()).toEqual([]);
  });

  it("with no sink registered, nothing is upgraded", () => {
    const old = writeWright(proposed(LIST_15));
    const read = readWrightSettings(env.dataDir);
    expect(read.ok && read.settings.policy.allowedTools).toEqual([...LIST_15]);
    expect(readFileSync(file()).equals(old)).toBe(true);
    expect(agentsDir()).toEqual(["wright.json"]);
    expect(upgradeEvents()).toEqual([]);
  });

  it("a sink registered for another data dir does not upgrade this one, and an unregistered sink upgrades nothing", () => {
    unregister = registerProposedToolsAudit(join(env.dataDir, "elsewhere"), storeSink());
    const old = writeWright(proposed(LIST_15));
    readAgentSettings(env.dataDir, "wright");
    expect(readFileSync(file()).equals(old)).toBe(true);
    unregister();
    register();
    unregister();
    readAgentSettings(env.dataDir, "wright");
    expect(readFileSync(file()).equals(old)).toBe(true);
    expect(upgradeEvents()).toEqual([]);
  });

  it("the raw reader never creates the file, and reads an unreadable file as null", () => {
    expect(readWrightToolPolicy(env.dataDir)).toBeNull();
    expect(() => statSync(file())).toThrow();
    writeWright(proposed(LIST_15));
    expect(readWrightToolPolicy(env.dataDir)).toEqual({ status: "proposed", allowedTools: [...LIST_15] });
    writeFileSync(file(), "{not json");
    expect(readWrightToolPolicy(env.dataDir)).toBeNull();
    writeFileSync(file(), JSON.stringify({ tool_policy: { status: 3, allowedTools: [] } }));
    expect(readWrightToolPolicy(env.dataDir)).toBeNull();
  });
});

describe("AC5: a malformed file is refused unchanged", () => {
  it.each([
    ["schema-invalid (permission_mode 7)", () => `${JSON.stringify(proposed(LIST_15, { permission_mode: 7 }), null, 2)}\n`],
    ["never-setting (Wright refuses never)", () => `${JSON.stringify(proposed(LIST_15, { never: [] }), null, 2)}\n`],
    ["non-JSON", () => `{"tool_policy": {"status": "proposed", "allowedTools": ${JSON.stringify(LIST_15)}`],
    ["oversized (over 64 KiB)", () => `${JSON.stringify(proposed(LIST_15, { x_pad: "x".repeat(70 * 1024) }), null, 2)}\n`],
  ])("a %s file returns settings_invalid with its bytes unchanged, no backup and no event", (_what, text) => {
    register();
    mkdirSync(join(env.dataDir, "config", "agents"), { recursive: true });
    writeFileSync(file(), text());
    const old = readFileSync(file());
    expect(readAgentSettings(env.dataDir, "wright")).toMatchObject({ ok: false, error: "settings_invalid" });
    expect(readFileSync(file()).equals(old)).toBe(true);
    expect(agentsDir()).toEqual(["wright.json"]);
    expect(upgradeEvents()).toEqual([]);
  });

  it("a rewrite that would pass 64 KiB is never written: the old file stays and the failure is recorded", () => {
    register();
    // Under the limit as written, over it once the current list replaces the 15 (the 10 added names push it past).
    const pad = 64 * 1024 - Buffer.byteLength(`${JSON.stringify(proposed(LIST_15, { x_pad: "" }), null, 2)}\n`) - 10;
    const old = writeWright(proposed(LIST_15, { x_pad: "x".repeat(pad) }));
    expect(old.length).toBeLessThanOrEqual(64 * 1024);
    const read = readAgentSettings(env.dataDir, "wright");
    expect(read.ok && read.settings.policy.allowedTools).toEqual([...LIST_15]);
    expect(readFileSync(file()).equals(old)).toBe(true);
    expect(agentsDir()).toEqual(["wright.json"]);
    expect(upgradeEvents().map((e) => [e.kind, e.payload])).toEqual([["wright_tool_policy_upgrade_failed", { file: file(), step: "size", code: "over_limit" }]]);
  });
});

describe("AC6: a crew member's file is never upgraded", () => {
  it("a crew file holding a past list is not written", () => {
    register();
    const crew = agentSettingsPath(env.dataDir, "scout");
    mkdirSync(join(env.dataDir, "config", "agents"), { recursive: true });
    writeFileSync(crew, `${JSON.stringify(proposed(LIST_15), null, 2)}\n`);
    const old = readFileSync(crew);
    const read = readAgentSettings(env.dataDir, "scout");
    expect(read.ok && read.settings.policy.allowedTools).toEqual([...LIST_15]);
    expect(readFileSync(crew).equals(old)).toBe(true);
    expect(agentsDir()).toEqual(["scout.json"]);
    expect(upgradeEvents()).toEqual([]);
  });
});

describe("AC7: a failed step keeps the old file", () => {
  it.each([
    ["backup", "writeFileSync" as const, (p: string) => p.includes(".bak-"), "ENOSPC"],
    ["write", "writeFileSync" as const, (p: string) => p.endsWith(".tmp"), "EACCES"],
    ["rename", "renameSync" as const, (p: string) => p.endsWith("wright.json"), "EXDEV"],
  ])("a failed write (an injected %s failure) keeps the old bytes, returns the old list and records wright_tool_policy_upgrade_failed", (step, op, match, code) => {
    register();
    const old = writeWright(proposed(LIST_15));
    fault.current = { op, match, code };
    const read = readWrightSettings(env.dataDir);
    expect(fault.current).toBeUndefined();
    expect(read.ok && read.settings.policy.allowedTools).toEqual([...LIST_15]);
    expect(readFileSync(file()).equals(old)).toBe(true);
    expect(agentsDir().filter((n) => n.endsWith(".tmp"))).toEqual([]);
    // The backup of the old bytes stays when the backup itself was made.
    expect(backups()).toHaveLength(step === "backup" ? 0 : 1);
    expect(upgradeEvents().map((e) => [e.kind, e.payload])).toEqual([["wright_tool_policy_upgrade_failed", { file: file(), step, code }]]);
  });

  it("a sink that throws is swallowed and the read returns", () => {
    register({
      transaction: (fn) => env.store.transaction(fn),
      record: () => {
        throw new Error("the store is closed");
      },
    });
    const old = writeWright(proposed(LIST_15));
    const read = readWrightSettings(env.dataDir);
    expect(read.ok && read.settings.policy.allowedTools).toEqual([...LIST_15]);
    expect(readFileSync(file()).equals(old)).toBe(true);
    expect(agentsDir().filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(upgradeEvents()).toEqual([]);
  });

  it("a COMMIT that fails after the rename still records the upgrade (the file holds the new list) and returns the new list", () => {
    const sink = storeSink();
    register({
      // The rename ran inside `fn`; the transaction then fails as a failed COMMIT would (its event rolled back).
      transaction: (fn) => {
        env.store.transaction(() => {
          fn();
          throw new Error("SQLITE_BUSY at COMMIT");
        });
        return undefined as never;
      },
      record: sink.record,
    });
    writeWright(proposed(LIST_15));
    const read = readAgentSettings(env.dataDir, "wright");
    expect(read.ok && read.settings.policy.allowedTools).toEqual([...PROPOSED_ALLOWED_TOOLS]);
    expect(JSON.parse(readFileSync(file(), "utf8")).tool_policy.allowedTools).toEqual([...PROPOSED_ALLOWED_TOOLS]);
    expect(upgradeEvents().map((e) => e.kind)).toEqual(["wright_tool_policy_upgraded"]);
    expect(backups()).toHaveLength(1);
  });

  it("a sink whose transaction throws is swallowed the same way", () => {
    register({
      transaction: () => {
        throw new Error("database is locked");
      },
      record: () => {
        throw new Error("database is locked");
      },
    });
    const old = writeWright(proposed(LIST_15));
    const read = readAgentSettings(env.dataDir, "wright");
    expect(read.ok && read.settings.policy.allowedTools).toEqual([...LIST_15]);
    expect(readFileSync(file()).equals(old)).toBe(true);
  });
});

describe("AC7b: an owner's edit during the upgrade wins", () => {
  it("an owner's edit between the read and the rename wins", () => {
    const edited = `${JSON.stringify({ ...proposed(LIST_15), tool_policy: { status: "owner", allowedTools: ["Read"], allowedBashPrefixes: [] } }, null, 2)}\n`;
    const sink = storeSink();
    register({
      transaction: (fn) => {
        // The owner saves the file after the upgrade's read, before its re-read.
        writeFileSync(file(), edited);
        return sink.transaction(fn);
      },
      record: sink.record,
    });
    writeWright(proposed(LIST_15));
    const read = readAgentSettings(env.dataDir, "wright");
    expect(read.ok && read.settings.policy.allowedTools).toEqual([...LIST_15]);
    expect(readFileSync(file(), "utf8")).toBe(edited);
    expect(agentsDir().filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(backups()).toHaveLength(1);
    expect(upgradeEvents()).toEqual([]);
    // The next read sees the owner's edit and leaves it alone.
    expect(readAgentSettings(env.dataDir, "wright")).toMatchObject({ ok: true, settings: { policy: { allowedTools: ["Read"] }, policyStatus: "owner" } });
    expect(readFileSync(file(), "utf8")).toBe(edited);
  });
});

describe("startKernel registers the audit sink over its store, and unregisters it before the store closes", () => {
  it("a running kernel upgrades an unedited proposed list with its own event; after stop, nothing upgrades", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "studio-upgrade-kernel-"));
    const dataDir = join(tmp, "data");
    const path = wrightSettingsPath(dataDir);
    mkdirSync(join(dataDir, "config", "agents"), { recursive: true });
    writeFileSync(path, `${JSON.stringify(proposed(LIST_15), null, 2)}\n`);
    const items = new Map<string, string>();
    const kernel = await startKernel(
      { dataDir, env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: makePluginDir(tmp), stopGraceMs: 10 }, contributions: [] },
      {
        keychain: { read: (service) => items.get(service) },
        keychainWriter: { add: (service, _account, secret) => void items.set(service, secret) },
        sessionDeps: fakeSessions().deps,
        selectAuthProvider: async () => stubProvider(),
        availableProviderIds: async () => ["api-key"],
      },
    );
    try {
      const read = readWrightSettings(dataDir);
      expect(read.ok && read.settings.policy.allowedTools).toEqual([...PROPOSED_ALLOWED_TOOLS]);
      expect(events(kernel.store, "wright_tool_policy_upgraded")).toHaveLength(1);
    } finally {
      await kernel.stop();
    }
    try {
      const old = Buffer.from(`${JSON.stringify(proposed(LIST_21), null, 2)}\n`);
      writeFileSync(path, old);
      const read = readWrightSettings(dataDir);
      expect(read.ok && read.settings.policy.allowedTools).toEqual([...LIST_21]);
      expect(readFileSync(path).equals(old)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
