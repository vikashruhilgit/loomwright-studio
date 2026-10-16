// The playbooks feature's foundation (phase 3): one `playbooks` contribution
// built from four empty sub-file parts (`drafts`, `dry-run`, `enable`,
// `runs`), registered sixth in `SHIPPED_CONTRIBUTIONS`, registering nothing
// but the verb-less `studio playbooks` subcommand; the part merge refuses a
// verb or handler kind two parts claim; the closed value sets migration 13's
// TEXT columns hold. A temp data dir with a hand-written `api.json`, a stub
// Keychain and a stub fetch that fails the test if called: never a daemon.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { USAGE, runCli } from "../src/cli/index.js";
import type { CliDeps } from "../src/cli/index.js";
import { ContributionConflictError, InvalidContributionError, PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, defineTool, mergeContributions } from "../src/features/index.js";
import type { CliApiClient, ContributedRoute } from "../src/features/index.js";
import {
  DEDUPE_KEY_FIELDS,
  PLAYBOOKS_HELP,
  PLAYBOOK_PARTS,
  PLAYBOOK_PRIORITIES,
  PLAYBOOK_RUN_KINDS,
  PLAYBOOK_STATUSES,
  POLICY_SETTERS,
  draftsPart,
  dryRunPart,
  enablePart,
  mergePlaybookParts,
  playbooksContribution,
  playbooksContributionOf,
  runsPart,
} from "../src/playbooks/index.js";
import type { PlaybookPart, PlaybookVerb } from "../src/playbooks/index.js";

let tmp: string;
let dataDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-playbooks-"));
  dataDir = join(tmp, "data");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeApiInfo(dir: string = tmp): string {
  writeFileSync(join(dir, "api.json"), JSON.stringify({ port: 1, host: "127.0.0.1", pid: process.pid, started_at: "x" }));
  return dir;
}

/** `studio <argv>` with the shipped contributions (unless given), a live api.json pid, and no Keychain or API reachable. */
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
      throw new Error("the playbooks shell must not call the API");
    }) as typeof fetch,
    stdout: { write: (c: string) => out.push(c) },
    stderr: { write: (c: string) => err.push(c) },
    ...overrides,
  });
  return { code, stdout: out.join(""), stderr: err.join(""), reads, fetches };
}

const emptyPart = (name: string, extra: Partial<PlaybookPart> = {}): PlaybookPart => ({ name, tools: [], routes: [], verbs: [], handlers: {}, ...extra });

const verb = (name: string, seen: string[][] = []): PlaybookVerb => ({
  name,
  help: `studio playbooks ${name} <id>`,
  run: async (args) => {
    seen.push([name, ...args]);
    return 7;
  },
});

const noClient: CliApiClient = {
  request: async () => {
    throw new Error("no API in this test");
  },
};

describe("the playbooks contribution (AC4)", () => {
  it("is the sixth shipped contribution and registers no tool, route, handler or due work: only the playbooks subcommand", () => {
    expect(SHIPPED_CONTRIBUTIONS).toHaveLength(6);
    expect(SHIPPED_CONTRIBUTIONS[5]).toBe(playbooksContribution);
    expect(playbooksContribution.name).toBe("playbooks");
    expect(Object.isFrozen(playbooksContribution)).toBe(true);
    expect(Object.keys(playbooksContribution)).toEqual(["name", "subcommands"]);
    const merged = mergeContributions([playbooksContribution], PHASE1_RESERVED);
    expect(merged.tools).toEqual([]);
    expect(merged.routes).toEqual([]);
    expect(merged.subcommands.map((s) => [s.name, s.help])).toEqual([["playbooks", PLAYBOOKS_HELP]]);
    expect(merged.handlers).toEqual({});
    expect(merged.dueWork).toEqual([]);
  });

  it("the subcommand has zero verbs: its help line is exactly `studio playbooks <verb>` (one line, at most 200 characters)", () => {
    expect(PLAYBOOKS_HELP).toBe("studio playbooks <verb>");
    expect(mergePlaybookParts(PLAYBOOK_PARTS).verbs).toEqual([]);
  });

  it("is built from four empty frozen parts, in order: drafts, dry-run, enable, runs", () => {
    expect(PLAYBOOK_PARTS).toEqual([draftsPart, dryRunPart, enablePart, runsPart]);
    expect(PLAYBOOK_PARTS.map((p) => p.name)).toEqual(["drafts", "dry-run", "enable", "runs"]);
    expect(Object.isFrozen(PLAYBOOK_PARTS)).toBe(true);
    for (const part of PLAYBOOK_PARTS) {
      expect(Object.isFrozen(part), part.name).toBe(true);
      expect({ tools: part.tools, routes: part.routes, verbs: part.verbs, handlers: part.handlers }, part.name).toEqual({ tools: [], routes: [], verbs: [], handlers: {} });
    }
  });

  it("pins the closed value sets migration 13's TEXT columns hold", () => {
    expect(PLAYBOOK_STATUSES).toEqual(["draft", "enabled", "disabled"]);
    expect(PLAYBOOK_PRIORITIES).toEqual(["low", "normal", "high"]);
    expect(PLAYBOOK_RUN_KINDS).toEqual(["dry_run", "fire", "run_now"]);
    expect(DEDUPE_KEY_FIELDS).toEqual(["playbook.id", "playbook.version", "trigger.id", "trigger.scheduled_at", "date"]);
    expect(POLICY_SETTERS).toEqual(["wright", "owner"]);
    for (const list of [PLAYBOOK_STATUSES, PLAYBOOK_PRIORITIES, PLAYBOOK_RUN_KINDS, DEDUPE_KEY_FIELDS, POLICY_SETTERS]) expect(Object.isFrozen(list)).toBe(true);
  });
});

describe("studio playbooks (AC4)", () => {
  it("with no verb, or help: the help on stdout, then `no verbs yet`, 0; no Keychain read, no API call", async () => {
    for (const argv of [["playbooks"], ["playbooks", "help"]]) {
      const r = await studio(argv);
      expect(r, argv.join(" ")).toMatchObject({ code: 0, stdout: "studio playbooks <verb>\nno verbs yet\n", stderr: "" });
      expect(r.reads).toEqual([]);
      expect(r.fetches).toEqual([]);
    }
  });

  it("an unknown verb: one line naming it, then the help, on stderr; 2", async () => {
    const r = await studio(["playbooks", "nope", "1"]);
    expect(r).toMatchObject({ code: 2, stdout: "", stderr: 'studio playbooks: unknown verb "nope"\nstudio playbooks <verb>\n' });
    expect(r.reads).toEqual([]);
    expect(r.fetches).toEqual([]);
  });

  it("passes the api.json pid check first, like every contributed subcommand: a dead pid or no api.json never runs it", async () => {
    const dead = await studio(["playbooks"], { isPidAlive: () => false });
    expect(dead.code).toBe(1);
    expect(dead.stdout).toBe("");
    expect(dead.stderr).toMatch(/^studio: kernel daemon is not running \(pid \d+ in .*api\.json is gone\)\n$/);
    const missing = await studio(["playbooks", "nope"], { dataDir: join(tmp, "elsewhere") });
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).not.toContain("unknown verb");
    expect(missing.reads).toEqual([]);
  });

  it("the help line is the last line of studio's usage text", async () => {
    const r = await studio(["nope"]);
    expect(r.code).toBe(2);
    expect(r.stderr.startsWith(`${USAGE} | `)).toBe(true);
    expect(r.stderr.endsWith(` | ${PLAYBOOKS_HELP}\n`)).toBe(true);
  });
});

describe("mergePlaybookParts", () => {
  it("joins tools and routes in part order and the parts' verbs and handlers", () => {
    const tool = (name: string) => defineTool({ name, description: "test tool", shape: { id: z.number() }, handler: () => ({}) });
    const route: ContributedRoute = { method: "GET", path: "/playbooks", handler: async () => ({ status: 200, body: {} }) };
    const handler = () => {};
    const merged = mergePlaybookParts([
      emptyPart("a", { tools: [tool("kernel_playbook_a")], verbs: [verb("one")] }),
      emptyPart("b", { tools: [tool("kernel_playbook_b")], routes: [route], verbs: [verb("two")], handlers: { message: handler } }),
    ]);
    expect(merged.tools.map((t) => t.name)).toEqual(["kernel_playbook_a", "kernel_playbook_b"]);
    expect(merged.routes).toEqual([route]);
    expect(merged.verbs.map((v) => v.name)).toEqual(["one", "two"]);
    expect(merged.handlers).toEqual({ message: handler });
  });

  it("a verb claimed by two parts is refused, naming both parts", () => {
    let err: unknown;
    try {
      mergePlaybookParts([emptyPart("drafts", { verbs: [verb("show")] }), emptyPart("dry-run"), emptyPart("runs", { verbs: [verb("show")] })]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ContributionConflictError);
    expect((err as ContributionConflictError).part).toBe("subcommand");
    expect((err as ContributionConflictError).conflictName).toBe("playbooks show");
    expect((err as ContributionConflictError).owners).toEqual(["drafts", "runs"]);
    expect((err as Error).message).toContain("drafts");
  });

  it("a handler kind claimed by two parts is refused, naming both parts", () => {
    let err: unknown;
    try {
      mergePlaybookParts([emptyPart("enable", { handlers: { message: () => {} } }), emptyPart("runs", { handlers: { message: () => {} } })]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ContributionConflictError);
    expect((err as ContributionConflictError).part).toBe("handler");
    expect((err as ContributionConflictError).conflictName).toBe("message");
    expect((err as ContributionConflictError).owners).toEqual(["enable", "runs"]);
  });

  it("a verb named help is refused: it is the built-in help", () => {
    expect(() => mergePlaybookParts([emptyPart("drafts", { verbs: [verb("help")] })])).toThrow(InvalidContributionError);
  });
});

describe("a playbooks contribution with verbs (what a later item's part adds)", () => {
  it("appends each verb's help to the help line, dispatches a known verb with the remaining args, and keeps only non-empty keys", async () => {
    const seen: string[][] = [];
    const handler = () => {};
    const c = playbooksContributionOf([emptyPart("drafts", { verbs: [verb("show", seen)] }), emptyPart("runs", { handlers: { wakeup: handler } })]);
    expect(Object.keys(c)).toEqual(["name", "subcommands", "handlers"]);
    const sub = c.subcommands?.[0];
    expect(sub?.help).toBe("studio playbooks <verb> | studio playbooks show <id>");
    const out: string[] = [];
    const output = { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => out.push(s) } };
    expect(await sub?.run(["show", "3", "--json"], noClient, output)).toBe(7);
    expect(seen).toEqual([["show", "3", "--json"]]);
    expect(await sub?.run([], noClient, output)).toBe(0);
    expect(out.join("")).toBe("studio playbooks <verb> | studio playbooks show <id>\n");
    // Still merges as a feature: the handler is a contributed handler.
    expect(mergeContributions([c], PHASE1_RESERVED).handlers.wakeup).toBe(handler);
  });
});
