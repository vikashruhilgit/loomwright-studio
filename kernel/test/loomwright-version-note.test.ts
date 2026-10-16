// The Loomwright version watcher (phase 2 item 07, D32 with D13's goal): the
// `loomwright` feature's due work records each active contract in
// `loomwright_contract_seen`, and on a version change writes a note built from
// the contract diff under `memory/shared/loomwright-updates/` plus one
// notification, breaking signals first. Every install and every
// `installed_plugins.json` is a fixture under a temp dir: no test reads the
// real `~/.claude/plugins/installed_plugins.json`. A fake clock drives the
// once-a-minute check; no notification is ever posted (no delivery due work
// runs here, and the one kernel test creates none).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel } from "../src/kernel.js";
import {
  KNOWN_CONTRACT_SCHEMA_VERSION,
  NO_CONTRACT_TITLE,
  VERSION_NOTE_SOURCE,
  checkLoomwrightVersion,
  containedNotePath,
  createVersionWatchDueWork,
  diffLoomwrightContracts,
  isDowngrade,
  loomwrightAdapterStatus,
  loomwrightContribution,
  safeVersionComponent,
  versionWatchDueWork,
  writeVersionNote,
} from "../src/loomwright/index.js";
import { EventLoop } from "../src/loop/loop.js";
import { listNotifications } from "../src/notifications/index.js";
import type { NotificationRow } from "../src/notifications/index.js";
import type { Store } from "../src/store/index.js";
import { fixtureContract, userEntry, writeInstalledPlugins, writeLoomwrightInstall } from "./fixtures/loomwright/helpers.js";
import { events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { fakeSessions, stubProvider } from "./session-fakes.js";

const MINUTE = 60_000;

let env: LoopEnv;
let root: string;
let pluginsFile: string;
let n = 0;

beforeEach(() => {
  env = loopEnv();
  root = dirname(env.dataDir);
  pluginsFile = join(root, "claude", "plugins", "installed_plugins.json");
});

afterEach(() => {
  vi.restoreAllMocks();
  env.cleanup();
});

type Contract = Record<string, unknown>;
type Entry = { name: string; description?: string; [field: string]: unknown };
type Hook = { event: string; matcher: string | null; script: string; host_mode: string; writes: string[]; [field: string]: unknown };

/** The valid 17.2.0 fixture with `plugin_version` = `version` and `edit` applied. */
function contract(version: string, edit?: (c: Contract) => void): Contract {
  const c = fixtureContract();
  c.plugin_version = version;
  edit?.(c);
  return c;
}

const list = <T>(c: Contract, field: string): T[] => c[field] as T[];

/** Write an install (a fresh dir unless `dir` is given) and make it the active one in `installed_plugins.json`. */
function activate(c: Contract | null, version: string, dir = join(root, "cache", `install-${n++}`)): string {
  writeLoomwrightInstall(dir, c);
  writeInstalledPlugins(pluginsFile, { "loomwright@atelier": [userEntry(dir, version)] });
  return dir;
}

function watchLoop(store: Store = env.store, run = createVersionWatchDueWork()): EventLoop {
  return new EventLoop(
    { store, handlers: {}, dueWork: [{ owner: "loomwright", run }], loomwright: { installedPluginsPath: pluginsFile } },
    { now: env.now },
  );
}

interface SeenRow {
  readonly id: number;
  readonly install_path: string;
  readonly plugin_version: string;
  readonly contract_schema_version: number;
  readonly contract_json: string;
  readonly first_seen_at: string;
}

function seenRows(store: Store = env.store): SeenRow[] {
  return store.prepare<[], SeenRow>("SELECT * FROM loomwright_contract_seen ORDER BY id").all();
}

function notifications(store: Store = env.store): NotificationRow[] {
  return listNotifications(store, 100).reverse();
}

const notesDir = (): string => join(env.dataDir, "memory", "shared", "loomwright-updates");

/** The note files (and anything else) in the notes dir, sorted; `[]` when it does not exist. */
function noteFiles(): string[] {
  return existsSync(notesDir()) ? readdirSync(notesDir()).sort() : [];
}

const note = (name: string): string => readFileSync(join(notesDir(), name), "utf8");

/** The `## ` headings of a note, in order. */
const headings = (text: string): string[] => text.split("\n").filter((l) => l.startsWith("## "));

/** The lines of one `## ` section. */
function sectionOf(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).filter((l) => l.startsWith("- "));
}

/** A baseline of 17.2.0 at a fresh install, then `next` active at a fresh install; the loop has ticked the baseline. */
async function transition(next: Contract | null, nextVersion: string): Promise<{ loop: EventLoop; from: string; to: string }> {
  const from = activate(contract("17.2.0"), "17.2.0");
  const loop = watchLoop();
  await loop.tick();
  expect(seenRows()).toHaveLength(1);
  const to = activate(next, nextVersion);
  env.advance(MINUTE);
  await loop.tick();
  return { loop, from, to };
}

/**
 * A line's CommonMark code spans and the text outside them: a run of n
 * backticks opens a span that only the next run of exactly n closes, and one
 * space is stripped from each side of content that has one on both. Asserts
 * each span's delimiter is longer than any backtick run inside it.
 */
function codeSpans(line: string): { outside: string; spans: string[] } {
  let outside = "";
  const spans: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      outside += line[i];
      i++;
      continue;
    }
    let n = 0;
    while (line[i + n] === "`") n++;
    let close = -1;
    for (let j = i + n; j < line.length; ) {
      if (line[j] !== "`") {
        j++;
        continue;
      }
      let m = 0;
      while (line[j + m] === "`") m++;
      if (m === n) {
        close = j;
        break;
      }
      j += m;
    }
    if (close === -1) {
      outside += "`".repeat(n);
      i += n;
      continue;
    }
    let content = line.slice(i + n, close);
    expect(n).toBeGreaterThan(Math.max(0, ...(content.match(/`+/g) ?? []).map((r) => r.length)));
    if (content.startsWith(" ") && content.endsWith(" ") && content.trim() !== "") content = content.slice(1, -1);
    spans.push(content);
    i = close + n;
  }
  return { outside, spans };
}

function noFailures(): void {
  expect(events(env.store, "due_work_failed")).toEqual([]);
}

describe("the first observation (AC1)", () => {
  it("a started kernel records one row on its first tick, silently: the contract as read, no note, no notification", async () => {
    const dir = activate(contract("17.2.0"), "17.2.0");
    const items = new Map<string, string>();
    const keychain: KeychainReader = { read: (service) => items.get(service) };
    const writer: KeychainWriter = { add: (service, _account, secret) => void items.set(service, secret) };
    const dataDir = join(root, "kernel-data");
    let kernel: Kernel | undefined;
    try {
      kernel = await startKernel(
        { dataDir, env: { PATH: "/usr/bin" }, sessions: { installedPluginsPath: pluginsFile, stopGraceMs: 10 } },
        {
          keychain,
          keychainWriter: writer,
          sessionDeps: fakeSessions().deps,
          selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
          availableProviderIds: async () => ["api-key"],
        },
      );
      const store = kernel.store;
      await vi.waitFor(() => expect(seenRows(store)).toHaveLength(1));
      expect(seenRows(store)[0]).toMatchObject({
        install_path: dir,
        plugin_version: "17.2.0",
        contract_schema_version: 1,
        contract_json: readFileSync(join(dir, "capabilities.json"), "utf8"),
      });
      expect(notifications(store)).toEqual([]);
      expect(existsSync(join(dataDir, "memory"))).toBe(false);
      expect(events(store, "due_work_failed")).toEqual([]);
    } finally {
      await kernel?.stop();
    }
  });

  it("the shipped due work is loomwright's one due work, and checks each store on its first tick", async () => {
    expect(loomwrightContribution.dueWork).toEqual([versionWatchDueWork]);
    activate(contract("17.2.0"), "17.2.0");
    await watchLoop(env.store, versionWatchDueWork).tick();
    expect(seenRows()).toHaveLength(1);
    // A second kernel's store (the same clock instant) is checked on its own first tick.
    const other = loopEnv();
    try {
      await new EventLoop(
        { store: other.store, handlers: {}, dueWork: [{ owner: "loomwright", run: versionWatchDueWork }], loomwright: { installedPluginsPath: pluginsFile } },
        { now: env.now },
      ).tick();
      expect(seenRows(other.store)).toHaveLength(1);
    } finally {
      other.cleanup();
    }
  });

  it("a configured Loomwright path is the install watched, as for sessions and /status", async () => {
    const dir = writeLoomwrightInstall(join(root, "configured"), contract("17.2.0"));
    const loop = new EventLoop(
      { store: env.store, handlers: {}, dueWork: [{ owner: "loomwright", run: createVersionWatchDueWork() }], loomwright: { configured: dir } },
      { now: env.now },
    );
    await loop.tick();
    expect(seenRows().map((r) => r.install_path)).toEqual([dir]);
  });

  it("no install found (installed_plugins.json missing): nothing is recorded, written or notified", async () => {
    const outcome = checkLoomwrightVersion({ store: env.store, now: env.now }, { installedPluginsPath: pluginsFile });
    expect(outcome).toEqual({ kind: "unresolved", reason: "installed_plugins_missing" });
    expect(seenRows()).toEqual([]);
    expect(notifications()).toEqual([]);
    expect(noteFiles()).toEqual([]);
  });
});

describe("a version change (AC2)", () => {
  const next = (): Contract =>
    contract("17.3.0", (c) => {
      list<Entry>(c, "commands").push({ name: "doctor", description: "Check an install\n  and report" });
      c.skills = list<Entry>(c, "skills").filter((s) => s.name !== "error-handling");
    });

  it("checks at most once a minute: a tick 59 s after the last check sees nothing, one at 60 s sees the change", async () => {
    activate(contract("17.2.0"), "17.2.0");
    const loop = watchLoop();
    await loop.tick();
    activate(next(), "17.3.0");
    env.advance(MINUTE - 1_000);
    await loop.tick();
    expect(seenRows()).toHaveLength(1);
    env.advance(1_000);
    await loop.tick();
    expect(seenRows()).toHaveLength(2);
  });

  it("a clock that went back checks again; a negative or non-finite interval is refused", async () => {
    activate(contract("17.2.0"), "17.2.0");
    const loop = watchLoop();
    await loop.tick();
    activate(next(), "17.3.0");
    env.advance(-1_000);
    await loop.tick();
    expect(seenRows()).toHaveLength(2);
    for (const minIntervalMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createVersionWatchDueWork({ minIntervalMs })).toThrow(RangeError);
    }
  });

  it("names and versions are data: a backtick cannot end inline code early, and a long version is clipped to the title limit", async () => {
    const version = `17.3.0-${"x".repeat(300)}`;
    await transition(
      contract(version, (c) => list<Entry>(c, "commands").push({ name: "a`b", description: "tick" })),
      version,
    );
    noFailures();
    const [file] = noteFiles();
    expect(file).toBe(`17.2.0-to-${version.slice(0, 64)}.md`);
    expect(sectionOf(note(file ?? ""), "Added")).toEqual(["- Command `` a`b `` — `tick`"]);
    const title = notifications()[0]?.title ?? "";
    expect(title).toHaveLength(200);
    expect(title.endsWith("…")).toBe(true);
  });

  it("contract text is inert markdown: a double or triple backtick stays inside one code span, and a description's markdown is never live", async () => {
    const markdown = "**x** [l](u) `a`";
    const version = "17.3.0-*x*[l](u)";
    await transition(
      contract(version, (c) => {
        list<Entry>(c, "commands").push({ name: "a``b", description: markdown }, { name: "x```y", description: "``z``" });
        const automate = list<Entry>(c, "commands").find((e) => e.name === "automate");
        if (automate !== undefined) automate.description = markdown;
      }),
      version,
    );
    noFailures();
    const [file] = noteFiles();
    const text = note(file ?? "");
    // Every contract-supplied string is one intact code span: the kernel's own words are all that is outside.
    expect(sectionOf(text, "Added").map(codeSpans)).toEqual([
      { outside: "- Command  — ", spans: ["a``b", markdown] },
      { outside: "- Command  — ", spans: ["x```y", "``z``"] },
    ]);
    const [change] = sectionOf(text, "Description changes");
    const parsed = codeSpans(change ?? "");
    expect(parsed.outside).toBe("- Command :  → ");
    expect(parsed.spans).toHaveLength(3);
    expect(parsed.spans[0]).toBe("automate");
    expect(parsed.spans[2]).toBe(markdown);
    // The plugin version is a code span in the version lines, and backslash-escaped in the heading.
    expect(codeSpans(text.split("\n").find((l) => l.startsWith("- To: ")) ?? "").spans[0]).toBe(version);
    expect(text.split("\n")[1]).toBe("# Loomwright 17\\.2\\.0 → 17\\.3\\.0\\-\\*x\\*\\[l\\]\\(u\\)");
  });

  it("one note listing the added command and the removed skill with their one-liners, one notification, one row; later ticks add nothing", async () => {
    const { loop, to } = await transition(next(), "17.3.0");
    noFailures();
    expect(noteFiles()).toEqual(["17.2.0-to-17.3.0.md"]);
    const path = join(notesDir(), "17.2.0-to-17.3.0.md");
    const text = note("17.2.0-to-17.3.0.md");
    expect(text.split("\n")[1]).toBe("# Loomwright 17\\.2\\.0 → 17\\.3\\.0");
    expect(sectionOf(text, "Added")).toEqual(["- Command `doctor` — `Check an install and report`"]);
    expect(sectionOf(text, "Removed")).toEqual(["- Skill `error-handling` — (no description)"]);
    expect(headings(text)).toEqual(["## Added", "## Removed", "## Changed", "## Description changes"]);

    const [row] = notifications();
    expect(notifications()).toHaveLength(1);
    expect(row).toMatchObject({ source: VERSION_NOTE_SOURCE, title: "Loomwright 17.2.0 → 17.3.0", body: `1 added, 1 removed. Note: ${path}` });

    const rows = seenRows();
    expect(rows.map((r) => [r.install_path, r.plugin_version, r.contract_schema_version])).toEqual([
      [expect.any(String), "17.2.0", 1],
      [to, "17.3.0", 1],
    ]);
    expect(rows[1]?.contract_json).toBe(readFileSync(join(to, "capabilities.json"), "utf8"));

    for (let i = 0; i < 3; i++) {
      env.advance(MINUTE);
      await loop.tick();
    }
    expect(seenRows()).toEqual(rows);
    expect(noteFiles()).toEqual(["17.2.0-to-17.3.0.md"]);
    expect(note("17.2.0-to-17.3.0.md")).toBe(text);
    expect(notifications()).toHaveLength(1);
    noFailures();
  });

  it("only the install path changed (same version and schema): the row is recorded silently", async () => {
    await transition(contract("17.2.0"), "17.2.0");
    expect(seenRows()).toHaveLength(2);
    expect(noteFiles()).toEqual([]);
    expect(notifications()).toEqual([]);
  });

  it("a restart (a new store and a new due work) after the change creates nothing more", async () => {
    await transition(next(), "17.3.0");
    const rows = seenRows();
    const store = env.restart();
    await watchLoop(store).tick();
    expect(seenRows(store)).toEqual(rows);
    expect(notifications(store)).toHaveLength(1);
    expect(noteFiles()).toEqual(["17.2.0-to-17.3.0.md"]);
  });
});

describe("breaking signals (AC3, AC4, AC5)", () => {
  it("a host_switch.env change: the note's first section is Breaking and names it; the notification body starts with the breaking count", async () => {
    await transition(
      contract("17.3.0", (c) => {
        (c.host_switch as Record<string, unknown>).env = "LOOMWRIGHT_HOST_MODE_V2";
      }),
      "17.3.0",
    );
    const text = note("17.2.0-to-17.3.0.md");
    expect(headings(text)[0]).toBe("## Breaking");
    expect(sectionOf(text, "Breaking")).toEqual([
      "- Host switch changed (env): `LOOMWRIGHT_HOST_MODE` / `LOOMWRIGHT_HOST_STATE_DIR` → `LOOMWRIGHT_HOST_MODE_V2` / `LOOMWRIGHT_HOST_STATE_DIR`. Sessions use the new contract's switch; a session without one is refused.",
    ]);
    expect(notifications()[0]?.body).toMatch(/^1 breaking, 0 added, 0 removed\. Note: /);
  });

  it("a removed host switch is breaking too (presence)", () => {
    const diff = diffLoomwrightContracts(JSON.stringify(contract("17.2.0")), JSON.stringify(contract("17.3.0", (c) => delete c.host_switch)));
    expect(diff.host_switch).toEqual({ fields: ["presence"], from: { env: "LOOMWRIGHT_HOST_MODE", state_dir_env: "LOOMWRIGHT_HOST_STATE_DIR" }, to: null });
    expect(diff.breaking.map((b) => b.kind)).toEqual(["host_switch_changed"]);
  });

  it("a removed command and a removed agent are each listed as breaking, and still counted as removals", async () => {
    await transition(
      contract("17.3.0", (c) => {
        c.commands = list<Entry>(c, "commands").filter((e) => e.name !== "review-pr");
        c.agents = list<Entry>(c, "agents").filter((e) => e.name !== "loomwright:worker");
      }),
      "17.3.0",
    );
    const text = note("17.2.0-to-17.3.0.md");
    expect(headings(text)[0]).toBe("## Breaking");
    expect(sectionOf(text, "Breaking")).toEqual([
      "- Command removed: `review-pr` — `Run a bounded review→fix→re-review heal loop against an existing PR URL; never auto-merges`",
      "- Agent removed: `loomwright:worker` — (no description)",
    ]);
    expect(sectionOf(text, "Removed")).toEqual([
      "- Agent `loomwright:worker` — (no description)",
      "- Command `review-pr` — `Run a bounded review→fix→re-review heal loop against an existing PR URL; never auto-merges`",
    ]);
    expect(notifications()[0]?.body).toMatch(/^2 breaking, 0 added, 2 removed\. Note: /);
  });

  it("a removed skill is not breaking", () => {
    const diff = diffLoomwrightContracts(
      JSON.stringify(contract("17.2.0")),
      JSON.stringify(contract("17.3.0", (c) => (c.skills = list<Entry>(c, "skills").slice(1)))),
    );
    expect(diff.removed).toHaveLength(1);
    expect(diff.breaking).toEqual([]);
  });

  it("a contract schema version above KNOWN_CONTRACT_SCHEMA_VERSION is breaking, and the note says the adapter still reads it and does not refuse sessions (D32)", async () => {
    expect(KNOWN_CONTRACT_SCHEMA_VERSION).toBe(1);
    await transition(contract("17.3.0", (c) => (c.contract_schema_version = 2)), "17.3.0");
    noFailures();
    const text = note("17.2.0-to-17.3.0.md");
    expect(headings(text)[0]).toBe("## Breaking");
    expect(sectionOf(text, "Breaking")).toEqual([
      "- Contract schema version 2 is newer than this kernel knows (1). The adapter still reads the contract and does not refuse sessions; fields it does not know are ignored.",
    ]);
    expect(sectionOf(text, "Changed")).toEqual(["- Contract schema version: 1 → 2"]);
    expect(seenRows().at(-1)).toMatchObject({ plugin_version: "17.3.0", contract_schema_version: 2 });
    // What the note says holds: the adapter reads it.
    expect(loomwrightAdapterStatus({ installedPluginsPath: pluginsFile })).toMatchObject({ status: "ok", plugin_version: "17.3.0", contract_schema_version: 2 });
  });

  /** 17.2.0 (schema 1), then 17.3.0 at schema 2 (the crossing), then 17.4.0 at `schema`: the second note's text. */
  async function afterSchema2(schema: number): Promise<string> {
    const { loop } = await transition(contract("17.3.0", (c) => (c.contract_schema_version = 2)), "17.3.0");
    expect(sectionOf(note("17.2.0-to-17.3.0.md"), "Breaking")).toHaveLength(1);
    activate(contract("17.4.0", (c) => (c.contract_schema_version = schema)), "17.4.0");
    env.advance(MINUTE);
    await loop.tick();
    noFailures();
    expect(seenRows()).toHaveLength(3);
    expect(seenRows().at(-1)).toMatchObject({ plugin_version: "17.4.0", contract_schema_version: schema });
    return note("17.3.0-to-17.4.0.md");
  }

  it("schema_above_known is flagged only on the change that crosses it: a later version still at schema 2 has no Breaking line, and its note still states the schema", async () => {
    const text = await afterSchema2(2);
    const [, second, third] = seenRows();
    expect(diffLoomwrightContracts(second?.contract_json ?? "", third?.contract_json ?? "").breaking).toEqual([]);
    expect(headings(text)).not.toContain("## Breaking");
    expect(text).not.toContain("is newer than this kernel knows");
    expect(text.split("\n").filter((l) => l.startsWith("- From: ") || l.startsWith("- To: ")).map((l) => l.includes("(contract 2)"))).toEqual([true, true]);
    expect(sectionOf(text, "Changed")).toEqual(["- (none)"]);
    expect(notifications().at(-1)?.body).toMatch(/^0 added, 0 removed\. Note: /);
  });

  it("schema 2 → 3 (both above KNOWN_CONTRACT_SCHEMA_VERSION) is not flagged again; the Changed section reports it", async () => {
    const text = await afterSchema2(3);
    expect(headings(text)).not.toContain("## Breaking");
    expect(sectionOf(text, "Changed")).toEqual(["- Contract schema version: 2 → 3"]);
    expect(notifications().at(-1)?.body).toMatch(/^0 added, 0 removed, 1 changed\. Note: /);
  });

  it("schema 2 → 1 (back down to KNOWN_CONTRACT_SCHEMA_VERSION) is not flagged; the Changed section reports it", async () => {
    const text = await afterSchema2(1);
    expect(headings(text)).not.toContain("## Breaking");
    expect(sectionOf(text, "Changed")).toEqual(["- Contract schema version: 2 → 1"]);
  });

  /**
   * Drive the watcher through `steps` ([plugin version, schema version]), each
   * at a fresh install, a minute apart; the first is the baseline. Returns, per
   * later step, whether its note has a Breaking heading and its notification body.
   */
  async function walk(steps: Array<[string, number]>): Promise<Array<{ breaking: boolean; body: string }>> {
    const loop = watchLoop();
    const out: Array<{ breaking: boolean; body: string }> = [];
    for (const [i, [version, schema]] of steps.entries()) {
      activate(contract(version, (c) => (c.contract_schema_version = schema)), version);
      if (i > 0) env.advance(MINUTE);
      await loop.tick();
      noFailures();
      expect(seenRows()).toHaveLength(i + 1);
      if (i === 0) {
        expect(noteFiles()).toEqual([]);
        expect(notifications()).toEqual([]);
        continue;
      }
      const text = note(`${steps[i - 1]?.[0]}-to-${version}.md`);
      const breaking = headings(text).includes("## Breaking");
      if (breaking) expect(sectionOf(text, "Breaking")).toEqual([expect.stringContaining("is newer than this kernel knows")]);
      out.push({ breaking, body: (notifications().at(-1)?.body ?? "").replace(/\. Note: .*$/s, "") });
    }
    return out;
  }

  it("a baseline already above known is silent; it is flagged only after a change down to known and back up (2 → 1 → 2)", async () => {
    expect(await walk([["17.2.0", 2], ["17.3.0", 1], ["17.4.0", 2]])).toEqual([
      { breaking: false, body: "0 added, 0 removed, 1 changed" },
      { breaking: true, body: "1 breaking, 0 added, 0 removed, 1 changed" },
    ]);
  });

  it("each crossing is flagged, so a change down to known and back up flags again (1 → 2 → 1 → 2)", async () => {
    expect(await walk([["17.2.0", 1], ["17.3.0", 2], ["17.4.0", 1], ["17.5.0", 2]])).toEqual([
      { breaking: true, body: "1 breaking, 0 added, 0 removed, 1 changed" },
      { breaking: false, body: "0 added, 0 removed, 1 changed" },
      { breaking: true, body: "1 breaking, 0 added, 0 removed, 1 changed" },
    ]);
  });

  it("an old side with no schema version (not a contract) and a new one above known is a crossing", () => {
    const above = JSON.stringify(contract("17.3.0", (c) => (c.contract_schema_version = 2)));
    expect(diffLoomwrightContracts("not json", above).breaking.map((b) => b.kind)).toContain("schema_above_known");
  });
});

describe("an active install without a usable contract (AC6)", () => {
  it("no note, no row; /status reports contract_missing; one notification naming the install, never repeated for it", async () => {
    const { loop, to } = await transition(null, "17.3.0");
    noFailures();
    expect(noteFiles()).toEqual([]);
    expect(seenRows()).toHaveLength(1);
    expect(loomwrightAdapterStatus({ installedPluginsPath: pluginsFile })).toMatchObject({ status: "error", reason: "contract_missing", path: to });
    const rows = notifications();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: VERSION_NOTE_SOURCE, title: NO_CONTRACT_TITLE });
    expect(rows[0]?.body).toContain(`Install: ${to}`);
    expect(rows[0]?.body).toContain(`Loomwright at ${to}: capabilities.json missing`);

    for (let i = 0; i < 3; i++) {
      env.advance(MINUTE);
      await loop.tick();
    }
    // A restart does not repeat it either: the dedupe reads the table.
    const store = env.restart();
    await watchLoop(store).tick();
    expect(notifications(store)).toHaveLength(1);
    expect(seenRows(store)).toHaveLength(1);
  });

  it("another install path without a contract gets its own notification", async () => {
    const { loop } = await transition(null, "17.3.0");
    activate(null, "17.4.0");
    env.advance(MINUTE);
    await loop.tick();
    expect(notifications().map((r) => r.title)).toEqual([NO_CONTRACT_TITLE, NO_CONTRACT_TITLE]);
  });

  it("the same install with a different problem (missing, then not JSON) gets its own notification: the dedupe is on the body, which carries the message", async () => {
    const { loop, to } = await transition(null, "17.3.0");
    activate({ raw: "{ not json" } as unknown as Contract, "17.3.0", to);
    env.advance(MINUTE);
    await loop.tick();
    const bodies = notifications().map((r) => r.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain(`Loomwright at ${to}: capabilities.json missing`);
    expect(bodies[1]).toContain(`Loomwright at ${to}: capabilities.json is not JSON`);
  });

  it("a contract that is not JSON is no usable contract either; the body names the adapter's message", async () => {
    const { to } = await transition({ raw: "{ not json" } as unknown as Contract, "17.3.0");
    expect(noteFiles()).toEqual([]);
    expect(notifications()[0]?.body).toContain(`Loomwright at ${to}: capabilities.json is not JSON`);
  });
});

describe("the note file (AC7)", () => {
  it("an existing note of that name (the owner's) is never overwritten: the note goes to the first free suffixed name", async () => {
    mkdirSync(notesDir(), { recursive: true });
    writeFileSync(join(notesDir(), "17.2.0-to-17.3.0.md"), "the owner's own notes\n");
    await transition(contract("17.3.0"), "17.3.0");
    expect(note("17.2.0-to-17.3.0.md")).toBe("the owner's own notes\n");
    expect(noteFiles()).toEqual(["17.2.0-to-17.3.0-2.md", "17.2.0-to-17.3.0.md"]);
    expect(notifications()[0]?.body).toContain(join(notesDir(), "17.2.0-to-17.3.0-2.md"));
  });

  it("writeVersionNote: -2, then -3, …; a file with the same marker line is reused", () => {
    const dir = join(root, "notes");
    expect(writeVersionNote(dir, "a-to-b", "<!-- m1 -->\none\n", "<!-- m1 -->")).toBe(join(dir, "a-to-b.md"));
    expect(writeVersionNote(dir, "a-to-b", "<!-- m2 -->\ntwo\n", "<!-- m2 -->")).toBe(join(dir, "a-to-b-2.md"));
    expect(writeVersionNote(dir, "a-to-b", "<!-- m3 -->\nthree\n", "<!-- m3 -->")).toBe(join(dir, "a-to-b-3.md"));
    expect(writeVersionNote(dir, "a-to-b", "<!-- m2 -->\nagain\n", "<!-- m2 -->")).toBe(join(dir, "a-to-b-2.md"));
    expect(readFileSync(join(dir, "a-to-b-2.md"), "utf8")).toBe("<!-- m2 -->\ntwo\n");
    // No temp file is left behind.
    expect(readdirSync(dir).sort()).toEqual(["a-to-b-2.md", "a-to-b-3.md", "a-to-b.md"]);
  });

  it("writeVersionNote: a name taken by something unreadable as a note (a directory) is skipped, never written into", () => {
    const dir = join(root, "notes");
    mkdirSync(join(dir, "a-to-b.md"), { recursive: true });
    expect(writeVersionNote(dir, "a-to-b", "<!-- m -->\n", "<!-- m -->")).toBe(join(dir, "a-to-b-2.md"));
    expect(readdirSync(join(dir, "a-to-b.md"))).toEqual([]);
  });

  it("a crash after the note was written and before the row committed: the retry reuses its own note, and writes no duplicate", async () => {
    activate(contract("17.2.0"), "17.2.0");
    const loop = watchLoop();
    await loop.tick();
    activate(contract("17.3.0", (c) => list<Entry>(c, "commands").push({ name: "doctor" })), "17.3.0");

    // The notification insert fails once: the row and the notification roll back, the note stays.
    const prepare = env.store.prepare.bind(env.store);
    let failed = false;
    vi.spyOn(env.store, "prepare").mockImplementation(((sql: string) => {
      if (!failed && /^INSERT INTO notifications\b/.test(sql)) {
        failed = true;
        throw new Error("simulated crash before the commit");
      }
      return prepare(sql);
    }) as Store["prepare"]);
    env.advance(MINUTE);
    await loop.tick();
    expect(failed).toBe(true);
    expect(events(env.store, "due_work_failed")).toHaveLength(1);
    expect(noteFiles()).toEqual(["17.2.0-to-17.3.0.md"]);
    expect(seenRows()).toHaveLength(1);
    expect(notifications()).toEqual([]);
    const written = note("17.2.0-to-17.3.0.md");

    env.advance(MINUTE);
    await loop.tick();
    expect(noteFiles()).toEqual(["17.2.0-to-17.3.0.md"]);
    expect(note("17.2.0-to-17.3.0.md")).toBe(written);
    expect(seenRows()).toHaveLength(2);
    expect(notifications()).toHaveLength(1);
    expect(notifications()[0]?.body).toContain(join(notesDir(), "17.2.0-to-17.3.0.md"));
  });

  it("a crash-retry with a marker over 16 KiB (a long plugin version) still reuses its own note: one file, one notification", async () => {
    const longVersion = "é".repeat(3000); // percent-encoded: 18,000 bytes in the marker
    activate(contract("17.2.0"), "17.2.0");
    const loop = watchLoop();
    await loop.tick();
    activate(contract(longVersion), longVersion);

    // The row-and-notification transaction fails once: the note stays, nothing else commits.
    const transaction = env.store.transaction.bind(env.store);
    let failed = false;
    vi.spyOn(env.store, "transaction").mockImplementation(((fn: () => unknown) => {
      if (!failed && seenRows().length === 1 && noteFiles().length === 1) {
        failed = true;
        throw new Error("simulated crash before the commit");
      }
      return transaction(fn);
    }) as Store["transaction"]);
    env.advance(MINUTE);
    await loop.tick();
    expect(failed).toBe(true);
    const [name] = noteFiles();
    expect(noteFiles()).toHaveLength(1);
    expect(Buffer.byteLength(note(name ?? "").split("\n")[0] ?? "", "utf8")).toBeGreaterThan(16 * 1024);
    expect(notifications()).toEqual([]);

    env.advance(MINUTE);
    await loop.tick();
    expect(noteFiles()).toEqual([name]);
    expect(seenRows()).toHaveLength(2);
    expect(notifications()).toHaveLength(1);
    expect(notifications()[0]?.body).toContain(join(notesDir(), name ?? ""));
  });

  it("writeVersionNote: a file whose first line only starts with the marker is not reused", () => {
    const dir = join(root, "notes");
    const marker = `<!-- ${"m".repeat(20_000)} -->`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a-to-b.md"), `${marker}x\n`);
    expect(writeVersionNote(dir, "a-to-b", `${marker}\n`, marker)).toBe(join(dir, "a-to-b-2.md"));
    expect(writeVersionNote(dir, "a-to-b", `${marker}\nagain\n`, marker)).toBe(join(dir, "a-to-b-2.md"));
  });

  it("writeVersionNote: the probe of an existing file allocates at most the marker plus one byte, and at most the file's size", () => {
    const dir = join(root, "notes");
    const marker = `<!-- ${"m".repeat(20_000)} -->`;
    const bound = Buffer.byteLength(marker, "utf8") + 1;
    mkdirSync(dir, { recursive: true });
    /** `writeVersionNote` over an existing `a-to-b.md` holding `existing`: the path it returns and every `Buffer.alloc` size. */
    const probe = (existing: string): { path: string; sizes: number[] } => {
      writeFileSync(join(dir, "a-to-b.md"), existing);
      rmSync(join(dir, "a-to-b-2.md"), { force: true });
      const alloc = vi.spyOn(Buffer, "alloc");
      try {
        const path = writeVersionNote(dir, "a-to-b", `${marker}\n`, marker);
        return { path, sizes: alloc.mock.calls.map(([size]) => size) };
      } finally {
        alloc.mockRestore();
      }
    };
    // Larger than the marker: this marker's own note, found by reading at most `bound` bytes.
    const large = probe(`${marker}\n${"x".repeat(100_000)}\n`);
    expect(large.path).toBe(join(dir, "a-to-b.md"));
    expect(large.sizes.length).toBeGreaterThan(0);
    expect(Math.max(...large.sizes)).toBeLessThanOrEqual(bound);
    // Smaller than the marker: read whole, with no more than its size allocated, and not reused.
    const owners = "<!-- the owner's -->\n";
    const small = probe(owners);
    expect(small.path).toBe(join(dir, "a-to-b-2.md"));
    expect(small.sizes.length).toBeGreaterThan(0);
    expect(Math.max(...small.sizes)).toBeLessThanOrEqual(Buffer.byteLength(owners, "utf8"));
  });

  it("the note's first line is its provenance marker: the row it diffs from and the new triple", async () => {
    const { to } = await transition(contract("17.3.0"), "17.3.0");
    const [first] = seenRows();
    expect(note("17.2.0-to-17.3.0.md").split("\n")[0]).toBe(
      `<!-- loomwright-version-note from:${first?.id} to:${encodeURIComponent(to)}|17.3.0|1 -->`,
    );
  });
});

describe("a downgrade (AC8)", () => {
  it("17.3.0 → 17.2.0 (a return to a triple seen before): the same note, titled a downgrade; the re-seen triple's row becomes the latest", async () => {
    const a = activate(contract("17.2.0"), "17.2.0");
    const loop = watchLoop();
    await loop.tick();
    const b = activate(contract("17.3.0", (c) => list<Entry>(c, "commands").push({ name: "doctor", description: "Check" })), "17.3.0");
    env.advance(MINUTE);
    await loop.tick();
    activate(contract("17.2.0"), "17.2.0", a);
    env.advance(MINUTE);
    await loop.tick();
    noFailures();

    expect(noteFiles()).toEqual(["17.2.0-to-17.3.0.md", "17.3.0-to-17.2.0.md"]);
    const text = note("17.3.0-to-17.2.0.md");
    expect(text.split("\n")[1]).toBe("# Loomwright downgrade 17\\.3\\.0 → 17\\.2\\.0");
    expect(sectionOf(text, "Removed")).toEqual(["- Command `doctor` — `Check`"]);
    expect(notifications().map((r) => r.title)).toEqual(["Loomwright 17.2.0 → 17.3.0", "Loomwright downgrade 17.3.0 → 17.2.0"]);
    const rows = seenRows();
    expect(rows.map((r) => [r.install_path, r.plugin_version])).toEqual([
      [b, "17.3.0"],
      [a, "17.2.0"],
    ]);
  });

  it("isDowngrade compares MAJOR.MINOR.PATCH numerically; a version that is not three numbers is never a downgrade", () => {
    expect(isDowngrade("17.3.0", "17.2.0")).toBe(true);
    expect(isDowngrade("17.10.0", "17.9.0")).toBe(true);
    expect(isDowngrade("17.9.0", "17.10.0")).toBe(false);
    expect(isDowngrade("18.0.0", "17.99.99")).toBe(true);
    expect(isDowngrade("17.2.0", "17.2.0")).toBe(false);
    expect(isDowngrade("17.3.0", "17.2.0-renamed-test")).toBe(false);
    expect(isDowngrade("v17.3.0", "17.2.0")).toBe(false);
  });
});

describe("hooks and unknown fields (AC9)", () => {
  const withHooks = (version: string, edit: (hooks: Hook[]) => Hook[]): Contract =>
    contract(version, (c) => {
      c.hooks = edit(list<Hook>(c, "hooks").map((h) => ({ ...h, writes: [...h.writes] })));
    });

  const next = (): Contract =>
    withHooks("17.3.0", (hooks) => {
      const out = hooks.filter((h) => h.script !== "scripts/send-webhook.sh"); // PreToolUse removed
      const stop = out.find((h) => h.event === "Stop");
      if (stop !== undefined) stop.host_mode = "skips";
      const notify = out.find((h) => h.event === "Notification");
      // Two paths added, one removed; a reordered list is the same set.
      if (notify !== undefined) notify.writes = [".supervisor/logs/new-a", ".supervisor/logs/new-b", ...notify.writes.slice(1).reverse()];
      out.push({ event: "SubagentStop", matcher: null, script: "scripts/new-hook.sh", host_mode: "redirects", writes: [".supervisor/logs/x", ".supervisor/logs/y"] });
      return out;
    });

  it("the note's hooks group reports each change by event and kind, with counts, never a script, matcher or write path", async () => {
    await transition(next(), "17.3.0");
    const text = note("17.2.0-to-17.3.0.md");
    expect(sectionOf(text, "Changed")).toEqual([
      "- Hook `Notification` writes changed: 2 paths added, 1 removed",
      "- Hook `PreToolUse` removed: host mode `unaffected`, 0 write paths",
      "- Hook `Stop` host mode changed: `unaffected` → `skips`",
      "- Hook `SubagentStop` added: host mode `redirects`, 2 write paths",
    ]);
    expect(headings(text)[0]).toBe("## Added"); // hook changes are not breaking
    for (const leak of ["scripts/", ".supervisor/", "AskUserQuestion", "permission_prompt", "settings.local.json"]) expect(text).not.toContain(leak);
  });

  it("hooks are a multiset by event, matcher and script: one of two identical hooks removed is one removal", () => {
    const old = withHooks("17.2.0", (hooks) => [...hooks, { ...(hooks[0] as Hook) }]);
    const diff = diffLoomwrightContracts(JSON.stringify(old), JSON.stringify(contract("17.3.0")));
    expect(diff.hooks).toEqual([{ kind: "removed", event: "Notification", host_mode_from: "redirects", host_mode_to: null, writes_added: 0, writes_removed: 7 }]);
  });

  it("unknown fields at every level are ignored: a contract carrying extra fields diffs the same as one without them", () => {
    const extras = (c: Contract): Contract => {
      const x = structuredClone(c);
      x.release_notes = "ignore me";
      x.future_list = [{ name: "x" }];
      for (const field of ["agents", "commands", "skills", "result_schemas", "hooks"]) {
        for (const e of list<Record<string, unknown>>(x, field)) e.added_in_v3 = { nested: true };
      }
      (x.host_switch as Record<string, unknown>).future = "field";
      return x;
    };
    const old = contract("17.2.0");
    const nxt = next();
    const plain = diffLoomwrightContracts(JSON.stringify(old), JSON.stringify(nxt));
    expect(plain.hooks).toHaveLength(4);
    expect(diffLoomwrightContracts(JSON.stringify(extras(old)), JSON.stringify(extras(nxt)))).toEqual(plain);
    expect(diffLoomwrightContracts(JSON.stringify(old), JSON.stringify(extras(old)))).toEqual(diffLoomwrightContracts(JSON.stringify(old), JSON.stringify(old)));
  });

  it("a hook-only change: the notification body counts the Changed lines, and added/removed stay 0", async () => {
    await transition(next(), "17.3.0");
    expect(notifications()[0]?.body).toMatch(/^0 added, 0 removed, 4 changed\. Note: /);
  });

  it("result-schema version changes are listed under Changed", () => {
    const nxt = contract("17.3.0", (c) => {
      const s = list<Record<string, unknown>>(c, "result_schemas").find((r) => r.name === "WORKER_RESULT");
      if (s !== undefined) s.schema_version = 3;
    });
    const diff = diffLoomwrightContracts(JSON.stringify(contract("17.2.0")), JSON.stringify(nxt));
    expect(diff.result_schema_versions).toEqual([{ name: "WORKER_RESULT", from: 2, to: 3 }]);
    expect(diff.breaking).toEqual([]);
  });

  it("text that is not a contract diffs as an empty contract, never a throw", () => {
    const diff = diffLoomwrightContracts("not json", JSON.stringify(contract("17.3.0")));
    expect(diff.from).toEqual({ plugin_version: null, contract_schema_version: null });
    expect(diff.added.length).toBeGreaterThan(0);
  });
});

describe("an unsafe plugin version (AC10)", () => {
  it.each([
    ["17.3.0/../../evil", "17.2.0-to-17.3.0_.._.._evil.md"],
    ["../../../escape", "17.2.0-to-_.._.._escape.md"],
  ])("%s: the file name is sanitised to [A-Za-z0-9._-] and written inside the notes dir", async (version, name) => {
    await transition(contract(version), version);
    noFailures();
    expect(noteFiles()).toEqual([name]);
    expect(readdirSync(join(env.dataDir, "memory", "shared"))).toEqual(["loomwright-updates"]);
    expect(readdirSync(env.dataDir).filter((f) => f.endsWith(".md"))).toEqual([]);
    expect(existsSync(join(root, "escape.md"))).toBe(false);
  });

  it("safeVersionComponent: other characters become _, leading dots go, empty is unknown, at most 64 characters", () => {
    expect(safeVersionComponent("17.2.0")).toBe("17.2.0");
    expect(safeVersionComponent("a b/c\\d\n")).toBe("a_b_c_d_");
    expect(safeVersionComponent("..")).toBe("unknown");
    expect(safeVersionComponent("...x")).toBe("x");
    expect(safeVersionComponent("")).toBe("unknown");
    expect(safeVersionComponent("9".repeat(100))).toHaveLength(64);
  });

  it.each([
    ["a NUL", "17.3.0\u0000evil", "Loomwright 17.2.0 → 17.3.0 evil"],
    ["C0 controls and DEL", "17.3.0\u0007\u001b[31m\u007fevil", "Loomwright 17.2.0 → 17.3.0 [31m evil"],
  ])("a version holding %s still notes the change: the title shows it without control characters", async (_, version, title) => {
    await transition(contract(version), version);
    noFailures();
    expect(seenRows()).toHaveLength(2);
    expect(notifications().map((row) => row.title)).toEqual([title]);
    expect(noteFiles()).toHaveLength(1);
  });

  it("a stored version holding a NUL is shown without it when the next version is noted", async () => {
    const loop = watchLoop();
    activate(contract("17.2.0\u0000x"), "17.2.0");
    await loop.tick();
    activate(contract("17.3.0"), "17.3.0");
    env.advance(MINUTE);
    await loop.tick();
    noFailures();
    expect(seenRows()).toHaveLength(2);
    expect(notifications().map((row) => row.title)).toEqual(["Loomwright 17.2.0 x → 17.3.0"]);
  });

  it("containedNotePath refuses a name that would leave the directory", () => {
    const dir = join(root, "notes");
    expect(containedNotePath(dir, "a.md")).toBe(join(dir, "a.md"));
    for (const bad of ["../a.md", "x/../../a.md", "sub/a.md", "/etc/a.md"]) expect(() => containedNotePath(dir, bad)).toThrow(/leaves/);
  });
});

describe("description-only changes (AC11)", () => {
  it("are grouped last, and the notification counts only additions and removals", async () => {
    await transition(
      contract("17.2.1", (c) => {
        const automate = list<Entry>(c, "commands").find((e) => e.name === "automate");
        if (automate !== undefined) automate.description = "Automate, reworded";
        const skill = list<Entry>(c, "skills").find((e) => e.name === "unit-testing");
        if (skill !== undefined) skill.description = "Now described";
      }),
      "17.2.1",
    );
    const text = note("17.2.0-to-17.2.1.md");
    expect(headings(text).at(-1)).toBe("## Description changes");
    const changes = sectionOf(text, "Description changes");
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatch(/^- Command `automate`: `Generic automation engine .*` → `Automate, reworded`$/);
    expect(changes[1]).toBe("- Skill `unit-testing`: (no description) → `Now described`");
    expect(sectionOf(text, "Added")).toEqual(["- (none)"]);
    expect(notifications()[0]?.body).toMatch(/^0 added, 0 removed\. Note: /);
  });
});

// A guard, not a behaviour test. The watcher runs on every kernel's first
// tick, and with neither `loomwrightPath` nor `installedPluginsPath` set it
// reads the host's real `~/.claude/plugins/installed_plugins.json` (as
// `/status` does). So every test file that starts a kernel must inject one of
// them. Honest limit: this is a static scan per file, not per call, so a file
// that injects one in some calls and forgets it in another still passes.
describe("test sandboxing guard", () => {
  const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
  const FIXTURES_DIR = join(TEST_DIR, "fixtures");

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  }

  it("every test file that calls startKernel( injects loomwrightPath or installedPluginsPath", () => {
    const files = walk(TEST_DIR).filter((f) => f.endsWith(".ts") || (f.endsWith(".mjs") && f.startsWith(FIXTURES_DIR + sep)));
    const starters = files.filter((f) => readFileSync(f, "utf8").includes("startKernel("));
    expect(starters.length).toBeGreaterThan(0);
    const unsandboxed = starters.filter((f) => !/\b(loomwrightPath|installedPluginsPath)\b/.test(readFileSync(f, "utf8")));
    expect(unsandboxed.map((f) => relative(TEST_DIR, f))).toEqual([]);
  });
});
