// Phase 6 item 09 (Wright drafts a PR-review duty): `kernel_playbook_create` and
// `kernel_playbook_update` take a structured `trigger.poll` (the `PollSpec` as an
// object), the mirror shows the mode and a readable poll schedule as proposed,
// item 04's refusals come back by their own reasons, an agent's `live` is refused, and a
// value the owner set is not Wright's to change. A temp data dir and a fixed
// clock; the tools run through the tool server's own `contributedToolHandler`
// (no SDK launch, no model); the `connectors` row is seeded raw, as the poll
// tests do.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContributedTool } from "../src/features/index.js";
import { formatPlaybook } from "../src/playbooks/drafts.js";
import { getPlaybook, mirrorPath, playbooksContribution, setPlaybookPolicy } from "../src/playbooks/index.js";
import { contributedToolHandler } from "../src/tools/server.js";
import type { KernelToolContext, KernelToolResult } from "../src/tools/server.js";
import { count, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

// Phase 8 item 21c: the kernel's ClickUp reader is replaced by a counting one, so a test sees every
// `clickup_get_list` call a drafting tool makes. Only `createMcpTicketReader` is replaced; the rest of
// `trackers.js` is real, and the GitHub-poll cases below never call the reader.
const reader = vi.hoisted(() => ({
  calls: [] as { tool: string; args: Record<string, unknown> }[],
  /** The answer to call number `n` (1-based); every test sets its own. */
  answer: (_n: number): { ok: true; text: string } | { ok: false; error: string } => ({ ok: false, error: "mcp_unreachable" }),
}));

vi.mock("../src/integrations/mcp/trackers.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/integrations/mcp/trackers.js")>()),
  createMcpTicketReader: () => ({
    call: async (_store: unknown, _kind: string, tool: string, args: Record<string, unknown>) => {
      reader.calls.push({ tool, args });
      return reader.answer(reader.calls.length);
    },
  }),
}));

const NOW = "2026-10-28T10:00:00.000Z";
const REPO = "vikashruhilgit/studio-sandbox";
const POLL = { source: "github.pulls", repos: [REPO], filters: { state: "open" }, interval_seconds: 300 };
const KEY = ["playbook.id", "item.id", "item.revision"];

let env: LoopEnv;
let keyN = 0;

beforeEach(() => {
  reader.calls.length = 0;
  reader.answer = () => ({ ok: false, error: "mcp_unreachable" });
  env = loopEnv(NOW);
  env.store.prepare("INSERT INTO connectors (kind, status, reachable_repos_json) VALUES ('github', 'connected', ?)").run(JSON.stringify([REPO]));
});

afterEach(() => env.cleanup());

function tool(name: string): ContributedTool {
  const t = (playbooksContribution.tools ?? []).find((x) => x.name === name);
  if (t === undefined) throw new Error(`no tool ${name}`);
  return t;
}

/** Call a playbooks tool as Wright's session through the tool server's handler. */
function call(name: string, args: unknown): Promise<KernelToolResult> {
  const sessions = {
    stopSession: async () => "stopped",
    getSession: (id: number) => (id === 1 ? { id, agent: "wright" } : undefined),
  } as unknown as KernelToolContext["sessions"];
  return contributedToolHandler(tool(name), { store: env.store, sessions, sessionId: 1, now: env.now })(args);
}

const create = (args: Record<string, unknown> = {}) =>
  call("kernel_playbook_create", {
    idempotency_key: `c${++keyN}`,
    name: "Review open PRs",
    intent: "Review every open pull request when it changes; draft only.",
    trigger: { kind: "poll", poll: POLL },
    dedupe_key: KEY,
    mode: "draft",
    ...args,
  });
const update = (id: number, changes: Record<string, unknown>) => call("kernel_playbook_update", { id, changes, idempotency_key: `u${++keyN}` });

function value<T = Record<string, unknown>>(r: KernelToolResult): T {
  expect(r.isError, r.content[0]?.text).toBeUndefined();
  return JSON.parse(r.content[0]?.text ?? "null") as T;
}

function errorText(r: KernelToolResult): string {
  expect(r.isError, r.content[0]?.text).toBe(true);
  return r.content[0]?.text ?? "";
}

interface Created {
  id: number;
  slug: string;
  trigger_id: number;
}

function mirrorLines(slug: string): string[] {
  return readFileSync(mirrorPath(env.dataDir, slug), "utf8").split("\n");
}

function triggerRows(): unknown[] {
  return env.store.prepare("SELECT id, kind, spec_json, playbook FROM triggers ORDER BY id").all();
}

function nothingWritten(): void {
  expect(count(env.store, "SELECT count(*) FROM playbooks")).toBe(0);
  expect(count(env.store, "SELECT count(*) FROM playbook_versions")).toBe(0);
  expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(0);
}

describe("kernel_playbook_create with a structured poll (AC1)", () => {
  it("stores a draft and its linked poll trigger, every value proposed by Wright, and the mirror shows the dedupe key, the mode and the poll schedule as proposed", async () => {
    const created = value<Created>(await create());
    expect(getPlaybook(env.store, created.id)).toMatchObject({
      status: "draft",
      version: 1,
      owning_agent: "wright",
      dedupe_key_spec: JSON.stringify(KEY),
      dedupe_key_set_by: "wright",
      mode: "draft",
      mode_set_by: "wright",
    });
    const rows = triggerRows() as { kind: string; spec_json: string; playbook: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "poll", playbook: created.slug });
    expect(JSON.parse(rows[0]?.spec_json ?? "null")).toEqual(POLL);

    const lines = mirrorLines(created.slug);
    expect(lines).toContain("- Dedupe key: `playbook.id, item.id, item.revision` (proposed)");
    expect(lines).toContain("- Mode: `draft` (proposed)");
    expect(lines).toContain(`- Schedule: poll \`github.pulls\` on \`${REPO}\`, filters \`state\` \`open\`, every \`300\` seconds (proposed) (trigger ${created.trigger_id})`);
  });

  it("shows every repo and every filter of a wider poll, and 'no filters' when it gives none", async () => {
    env.store.prepare("UPDATE connectors SET reachable_repos_json = ?").run(JSON.stringify([REPO, "vikashruhilgit/other"]));
    const wide = value<Created>(
      await create({
        name: "Wide",
        trigger: { kind: "poll", poll: { ...POLL, repos: [REPO, "vikashruhilgit/other"], filters: { state: "open", draft: false, author: "alice" } } },
      }),
    );
    expect(mirrorLines(wide.slug)).toContain(
      `- Schedule: poll \`github.pulls\` on \`${REPO}\`, \`vikashruhilgit/other\`, filters \`state\` \`open\`, \`draft\` \`false\`, \`author\` \`alice\`, every \`300\` seconds (proposed) (trigger ${wide.trigger_id})`,
    );
    const bare = value<Created>(await create({ name: "Bare", trigger: { kind: "poll", poll: { source: "github.pulls", repos: [REPO], interval_seconds: 120 } } }));
    expect(mirrorLines(bare.slug)).toContain(`- Schedule: poll \`github.pulls\` on \`${REPO}\`, no filters, every \`120\` seconds (proposed) (trigger ${bare.trigger_id})`);
  });

  it("a poll given as JSON text in spec still works and stores the same trigger", async () => {
    const created = value<Created>(await create({ trigger: { kind: "poll", spec: JSON.stringify(POLL) } }));
    const rows = triggerRows() as { spec_json: string }[];
    expect(JSON.parse(rows[0]?.spec_json ?? "null")).toEqual(POLL);
    expect(mirrorLines(created.slug)).toContain(`- Schedule: poll \`github.pulls\` on \`${REPO}\`, filters \`state\` \`open\`, every \`300\` seconds (proposed) (trigger ${created.trigger_id})`);
  });

  it("refuses a poll beside spec, a poll on another kind, and a poll trigger with neither, naming trigger and writing nothing", async () => {
    expect(errorText(await create({ trigger: { kind: "poll", poll: POLL, spec: JSON.stringify(POLL) } }))).toContain("trigger: give the poll as an object in poll or as JSON text in spec, not both");
    expect(errorText(await create({ trigger: { kind: "cron", spec: "0 9 * * *", tz: "UTC", poll: POLL } }))).toContain("trigger: poll is for kind poll only");
    expect(errorText(await create({ trigger: { kind: "poll" } }))).toContain("trigger: a poll trigger needs poll");
    nothingWritten();
  });

  it("refuses a once or cron trigger with no spec, naming trigger and writing nothing", async () => {
    expect(errorText(await create({ trigger: { kind: "cron", tz: "UTC" } }))).toContain("trigger: spec is required");
    expect(errorText(await create({ trigger: { kind: "once" } }))).toContain("trigger: spec is required");
    nothingWritten();
  });
});

describe("item 04's refusals come back by their own reasons (AC2)", () => {
  it("an interval of 30 seconds is refused poll_interval_below_floor, not as a shape error", async () => {
    const text = errorText(await create({ trigger: { kind: "poll", poll: { ...POLL, interval_seconds: 30 } } }));
    expect(text).toContain("poll_interval_below_floor");
    nothingWritten();
  });

  it("a repo the connector does not reach is refused poll_repo_not_reachable", async () => {
    const text = errorText(await create({ trigger: { kind: "poll", poll: { ...POLL, repos: ["vikashruhilgit/not-reached"] } } }));
    expect(text).toContain("poll_repo_not_reachable");
    expect(text).toContain("vikashruhilgit/not-reached");
    nothingWritten();
  });

  it("an unknown filter key is refused poll_filter_unknown, not stripped and not a shape error", async () => {
    const text = errorText(await create({ trigger: { kind: "poll", poll: { ...POLL, filters: { state: "open", label: "bug" } } } }));
    expect(text).toContain("poll_filter_unknown");
    expect(text).toContain("label");
    nothingWritten();
  });

  it("the same refusals come back from an update, which leaves the playbook as it was", async () => {
    const created = value<Created>(await create());
    const before = triggerRows();
    expect(errorText(await update(created.id, { trigger: { kind: "poll", poll: { ...POLL, interval_seconds: 30 } } }))).toContain("poll_interval_below_floor");
    expect(errorText(await update(created.id, { trigger: { kind: "poll", poll: { ...POLL, filters: { label: "x" } } } }))).toContain("poll_filter_unknown");
    expect(getPlaybook(env.store, created.id)?.version).toBe(1);
    expect(triggerRows()).toEqual(before);
  });

  it("an update with a new poll re-schedules the same linked trigger as a new version", async () => {
    const created = value<Created>(await create());
    const result = value<{ version: number; trigger_id: number; changed: boolean }>(await update(created.id, { trigger: { kind: "poll", poll: { ...POLL, interval_seconds: 600 } } }));
    expect(result).toMatchObject({ version: 2, trigger_id: created.trigger_id, changed: true });
    const rows = triggerRows() as { spec_json: string }[];
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.spec_json ?? "null")).toEqual({ ...POLL, interval_seconds: 600 });
    expect(mirrorLines(created.slug)).toContain(`- Schedule: poll \`github.pulls\` on \`${REPO}\`, filters \`state\` \`open\`, every \`600\` seconds (proposed) (trigger ${created.trigger_id})`);
  });
});

describe("mode and the owner's values (AC3, AC5)", () => {
  it("mode live is refused live_mode_owner_only and nothing is written", async () => {
    expect(errorText(await create({ mode: "live" }))).toContain("live_mode_owner_only");
    nothingWritten();
  });

  it("after the owner sets dedupe_key or mode, Wright's update of that field is refused naming it, and the stored value is unchanged", async () => {
    const created = value<Created>(await create());
    setPlaybookPolicy(env.store, { id: created.id, field: "dedupe_key", value: ["playbook.id", "item.id"] }, env.now());
    setPlaybookPolicy(env.store, { id: created.id, field: "mode", value: "draft" }, env.now());
    const owned = getPlaybook(env.store, created.id);
    expect(owned).toMatchObject({ dedupe_key_spec: JSON.stringify(["playbook.id", "item.id"]), dedupe_key_set_by: "owner", mode: "draft", mode_set_by: "owner" });

    expect(errorText(await update(created.id, { dedupe_key: KEY }))).toBe("kernel_playbook_update: dedupe_key: the owner set this value; only the owner can change it");
    expect(errorText(await update(created.id, { mode: "draft" }))).toBe("kernel_playbook_update: mode: the owner set this value; only the owner can change it");
    expect(getPlaybook(env.store, created.id)).toEqual(owned);
  });
});

describe("target_repo through the drafting tools (phase 8 item 20h, AC1)", () => {
  const TARGET = "vikashruhilgit/studio-sandbox";
  const targetLine = (slug: string): string | undefined => mirrorLines(slug).find((l) => l.startsWith("- Target repo:"));

  it("a create with target_repo stores it in playbooks.target_repo and version 1's snapshot, formatPlaybook shows a `target repo:` line, and the mirror shows `- Target repo:`", async () => {
    const created = value<Created>(await create({ target_repo: TARGET }));
    expect(getPlaybook(env.store, created.id)?.target_repo).toBe(TARGET);
    const snapshot = env.store.prepare("SELECT snapshot_json FROM playbook_versions WHERE playbook = ? AND version = 1").pluck().get(created.id) as string;
    expect(JSON.parse(snapshot)).toMatchObject({ target_repo: TARGET });
    expect(targetLine(created.slug)).toBe(`- Target repo: \`${TARGET}\``);
    const shown = formatPlaybook({ playbook: getPlaybook(env.store, created.id) as never, versions: [], trigger: null }, "UTC");
    expect(shown.split("\n")).toContain(`  target repo: ${TARGET}`);
  });

  it("a playbook with no target repo keeps its mirror byte for byte (no line) and its show output unchanged", async () => {
    const created = value<Created>(await create());
    expect(targetLine(created.slug)).toBeUndefined();
    expect(mirrorLines(created.slug).some((l) => l.includes("Target repo"))).toBe(false);
    expect(formatPlaybook({ playbook: getPlaybook(env.store, created.id) as never, versions: [], trigger: null }, "UTC")).not.toContain("target repo");
  });

  it("an update sets it as a new version (the mirror follows), re-saving the same value changes nothing, and none clears it", async () => {
    const created = value<Created>(await create());
    expect(value<{ version: number; changed: boolean }>(await update(created.id, { target_repo: TARGET }))).toMatchObject({ version: 2, changed: true });
    expect(getPlaybook(env.store, created.id)?.target_repo).toBe(TARGET);
    expect(targetLine(created.slug)).toBe(`- Target repo: \`${TARGET}\``);
    expect(value<{ version: number; changed: boolean }>(await update(created.id, { target_repo: TARGET }))).toMatchObject({ version: 2, changed: false });
    expect(value<{ version: number; changed: boolean }>(await update(created.id, { target_repo: "none" }))).toMatchObject({ version: 3, changed: true });
    expect(getPlaybook(env.store, created.id)?.target_repo).toBeNull();
    expect(targetLine(created.slug)).toBeUndefined();
  });

  it("a malformed value is refused invalid_input naming target_repo on a create and on an update, writing nothing", async () => {
    for (const bad of ["studio-sandbox", "owner/name/extra", "../name", "owner/..", "owner/."]) {
      expect(errorText(await create({ target_repo: bad })), bad).toContain("target_repo must be owner/name");
    }
    nothingWritten();
    const created = value<Created>(await create());
    expect(errorText(await update(created.id, { target_repo: "owner/.." }))).toBe("kernel_playbook_update: target_repo must be owner/name, with neither part . or .. (got \"owner/..\")");
    expect(getPlaybook(env.store, created.id)).toMatchObject({ version: 1, target_repo: null });
  });

  it("both tools' descriptions name target_repo, and a ticket playbook is told it needs one before it can be enabled", () => {
    for (const name of ["kernel_playbook_create", "kernel_playbook_update"]) {
      const description = tool(name).description;
      expect(description, name).toContain("target_repo (optional)");
      expect(description, name).toContain("no_target_repo");
      expect(description, name).toContain("never from ticket, PR or comment text");
    }
    expect(tool("kernel_playbook_update").description).toContain("jobs, target_repo, trigger");
  });
});

describe("a repeated create or update never repeats the ClickUp lookup (phase 8 item 21c)", () => {
  const RECORDED = JSON.parse(readFileSync(new URL("./fixtures/mcp-trackers/clickup-lookup-responses.json", import.meta.url), "utf8")) as {
    get_list_one: { id: string; name: string };
  };
  const NAME = RECORDED.get_list_one.name;
  const LIST_ID = RECORDED.get_list_one.id;
  // The store refuses a clickup.tasks poll without a connected ClickUp connector (the reader itself is mocked).
  beforeEach(() => {
    env.store
      .prepare("INSERT INTO mcp_connections (kind, server_url, status, granted_tools) VALUES ('clickup', 'https://mcp.example.test/mcp', 'connected', ?)")
      .run(JSON.stringify([{ name: "clickup_get_list", proxy: "kernel_mcp_r_clickup_clickup_get_list", read_only: true, description: "", schema: "{}" }]));
  });
  const OTHER_NAME = "Another list";
  const clickup = (filters: Record<string, unknown>) => ({ kind: "poll", poll: { source: "clickup.tasks", filters, interval_seconds: 300 } });
  const answerFirstOnly = (): void => {
    reader.answer = (n) => (n === 1 ? { ok: true, text: JSON.stringify(RECORDED.get_list_one) } : { ok: false, error: "mcp_timeout" });
  };
  const stepRow = (tool: string, key: string): { status: string; failure_reason: string | null } | undefined =>
    env.store.prepare("SELECT status, failure_reason FROM work_steps WHERE key = ?").get(`${tool}:session-1:${key}`) as { status: string; failure_reason: string | null } | undefined;
  const stepCount = (): number => count(env.store, "SELECT count(*) FROM work_steps");
  const version = (id: number): number | undefined => getPlaybook(env.store, id)?.version;
  const storedFilters = (): unknown => (JSON.parse((triggerRows() as { spec_json: string }[])[0]?.spec_json ?? "null") as { filters: unknown }).filters;

  it("AC1: a create with a list name, repeated under the same key, returns the first result with one lookup and one playbook", async () => {
    answerFirstOnly();
    const args = { idempotency_key: "k1", trigger: clickup({ list: NAME }) };
    const first = await create(args);
    const created = value<Created>(first);
    expect(storedFilters()).toEqual({ list: LIST_ID });
    expect(reader.calls).toEqual([{ tool: "clickup_get_list", args: { list_name: NAME } }]);

    const repeat = await create(args);
    expect(repeat).toEqual(first);
    expect(reader.calls).toHaveLength(1);
    expect(count(env.store, "SELECT count(*) FROM playbooks")).toBe(1);
    expect(created.id).toBe(1);
  });

  it("AC2: an update to a list-name poll, repeated under the same key, returns the first result with one lookup and no new version", async () => {
    answerFirstOnly();
    const created = value<Created>(await create());
    const args = { id: created.id, changes: { trigger: clickup({ list: NAME }) }, idempotency_key: "k2" };
    const first = await call("kernel_playbook_update", args);
    expect(value<{ version: number }>(first).version).toBe(2);
    expect(reader.calls).toHaveLength(1);

    const repeat = await call("kernel_playbook_update", args);
    expect(repeat).toEqual(first);
    expect(reader.calls).toHaveLength(1);
    expect(version(created.id)).toBe(2);
    expect(storedFilters()).toEqual({ list: LIST_ID });
  });

  it("AC3: a list given as an ID never calls the reader, on a create or an update, and a repeat returns the first result", async () => {
    const args = { idempotency_key: "k3", trigger: clickup({ list: LIST_ID }) };
    const first = await create(args);
    const created = value<Created>(first);
    expect(await create(args)).toEqual(first);
    const upArgs = { id: created.id, changes: { trigger: clickup({ space: "9010000000002" }) }, idempotency_key: "k3u" };
    const upFirst = await call("kernel_playbook_update", upArgs);
    expect(value<{ version: number }>(upFirst).version).toBe(2);
    expect(await call("kernel_playbook_update", upArgs)).toEqual(upFirst);
    expect(version(created.id)).toBe(2);
    expect(reader.calls).toHaveLength(0);
  });

  it("AC3: a refused write with no lookup records nothing, and a later call under the same key runs again", async () => {
    const args = { idempotency_key: "k3r", trigger: clickup({ list: LIST_ID }), mode: "live" };
    expect(errorText(await create(args))).toContain("live_mode_owner_only");
    nothingWritten();
    expect(stepCount()).toBe(0);
    const later = value<Created>(await create({ ...args, mode: "draft" }));
    expect(later.id).toBe(1);

    setPlaybookPolicy(env.store, { id: later.id, field: "mode", value: "draft" }, env.now());
    const owned = version(later.id) as number;
    const upArgs = { id: later.id, changes: { trigger: clickup({ list: LIST_ID }), mode: "draft" }, idempotency_key: "k3ur" };
    expect(errorText(await call("kernel_playbook_update", upArgs))).toContain("mode: the owner set this value");
    expect(stepRow("kernel_playbook_update", "k3ur")).toBeUndefined();
    expect(value<{ version: number }>(await call("kernel_playbook_update", { ...upArgs, changes: { name: "Renamed" } })).version).toBe(owned + 1);
    expect(reader.calls).toHaveLength(0);
  });

  it("AC4: the same key with other arguments returns the first result, makes no lookup for them and writes nothing new", async () => {
    answerFirstOnly();
    const first = await create({ idempotency_key: "k4", trigger: clickup({ list: NAME }) });
    const created = value<Created>(first);
    const before = { triggers: triggerRows(), versions: count(env.store, "SELECT count(*) FROM playbook_versions") };
    expect(await create({ idempotency_key: "k4", name: "Other name", trigger: clickup({ list: OTHER_NAME }) })).toEqual(first);
    expect(reader.calls).toHaveLength(1);
    expect(count(env.store, "SELECT count(*) FROM playbooks")).toBe(1);
    expect({ triggers: triggerRows(), versions: count(env.store, "SELECT count(*) FROM playbook_versions") }).toEqual(before);

    reader.answer = (n) => (n === 2 ? { ok: true, text: JSON.stringify(RECORDED.get_list_one) } : { ok: false, error: "mcp_timeout" });
    const upFirst = await call("kernel_playbook_update", { id: created.id, changes: { trigger: clickup({ list: NAME }), name: "Renamed" }, idempotency_key: "k4u" });
    expect(value<{ version: number }>(upFirst).version).toBe(2);
    const callsAfterFirstUpdate = reader.calls.length;
    const afterUpdate = { triggers: triggerRows(), playbook: getPlaybook(env.store, created.id) };
    expect(await call("kernel_playbook_update", { id: created.id, changes: { trigger: clickup({ list: OTHER_NAME }), name: "Third name" }, idempotency_key: "k4u" })).toEqual(upFirst);
    expect(reader.calls).toHaveLength(callsAfterFirstUpdate);
    expect({ triggers: triggerRows(), playbook: getPlaybook(env.store, created.id) }).toEqual(afterUpdate);
  });

  const FAILURES: [string, () => void, Record<string, unknown>, string][] = [
    ["a list nothing has (mcp_tool_error)", () => (reader.answer = () => ({ ok: false, error: "mcp_tool_error" })), { list: NAME }, "could not be looked up: mcp_tool_error"],
    ["an unreachable reader (mcp_timeout)", () => (reader.answer = () => ({ ok: false, error: "mcp_timeout" })), { list: NAME }, "could not be looked up: mcp_timeout"],
    ["an answer naming another list", () => (reader.answer = () => ({ ok: true, text: JSON.stringify({ ...RECORDED.get_list_one, name: OTHER_NAME }) })), { list: NAME }, "matches no ClickUp list (0 matches)"],
    ["a space name", () => undefined, { space: "Some space" }, "filters.space \"Some space\" could not be looked up: tool_unavailable"],
  ];

  describe.each(FAILURES)("AC5: a failed lookup (%s) releases the key", (_label, fail, filters, text) => {
    const succeed = (): void => {
      reader.answer = () => ({ ok: true, text: JSON.stringify(RECORDED.get_list_one) });
    };

    it("a create is refused, leaves no row and no work step, and the same key runs again", async () => {
      fail();
      const args = { idempotency_key: "k5", trigger: clickup(filters) };
      const refusal = errorText(await create(args));
      expect(refusal).toContain("kernel_playbook_create: ");
      expect(refusal).toContain(text);
      nothingWritten();
      expect(stepCount()).toBe(0);
      // A call the lookup made is made again by the same key (a space name makes none).
      const calls = reader.calls.length;
      expect(errorText(await create(args))).toBe(refusal);
      expect(reader.calls).toHaveLength(calls * 2);
      expect(stepCount()).toBe(0);

      succeed();
      const ok = await create({ idempotency_key: "k5", trigger: clickup({ list: NAME }) });
      expect(value<Created>(ok).id).toBe(1);
    });

    it("an update is refused with the playbook unchanged, and the same key runs again", async () => {
      const created = value<Created>(await create());
      const before = { triggers: triggerRows(), playbook: getPlaybook(env.store, created.id), steps: stepCount() };
      fail();
      const args = { id: created.id, changes: { trigger: clickup(filters) }, idempotency_key: "k5u" };
      const refusal = errorText(await call("kernel_playbook_update", args));
      expect(refusal).toContain("kernel_playbook_update: ");
      expect(refusal).toContain(text);
      expect({ triggers: triggerRows(), playbook: getPlaybook(env.store, created.id), steps: stepCount() }).toEqual(before);
      expect(stepRow("kernel_playbook_update", "k5u")).toBeUndefined();

      succeed();
      expect(value<{ version: number }>(await call("kernel_playbook_update", { ...args, changes: { trigger: clickup({ list: NAME }) } })).version).toBe(2);
    });
  });

  it("AC5: a failed lookup is called again by the same key (the reader sees both calls) and then succeeds when it answers", async () => {
    const args = { idempotency_key: "k5b", trigger: clickup({ list: NAME }) };
    reader.answer = () => ({ ok: false, error: "mcp_timeout" });
    expect(errorText(await create(args))).toContain("mcp_timeout");
    expect(reader.calls).toHaveLength(1);
    reader.answer = () => ({ ok: true, text: JSON.stringify(RECORDED.get_list_one) });
    expect(value<Created>(await create(args)).id).toBe(1);
    expect(reader.calls).toHaveLength(2);
  });

  it("AC6: a write refused after a lookup is recorded failed:error, nothing is written, and a repeat is refused without a lookup", async () => {
    reader.answer = () => ({ ok: true, text: JSON.stringify(RECORDED.get_list_one) });
    const args = { idempotency_key: "k6", trigger: clickup({ list: NAME }), mode: "live" };
    expect(errorText(await create(args))).toContain("live_mode_owner_only");
    nothingWritten();
    expect(stepRow("kernel_playbook_create", "k6")).toEqual({ status: "failed", failure_reason: "error" });
    expect(reader.calls).toHaveLength(1);
    expect(errorText(await create(args))).toContain("already failed (failed:error); use a new key to try again");
    expect(reader.calls).toHaveLength(1);
    nothingWritten();

    const created = value<Created>(await create({ trigger: clickup({ list: LIST_ID }) }));
    setPlaybookPolicy(env.store, { id: created.id, field: "mode", value: "draft" }, env.now());
    const upArgs = { id: created.id, changes: { trigger: clickup({ list: NAME }), mode: "draft" }, idempotency_key: "k6u" };
    const callsBefore = reader.calls.length;
    const owned = version(created.id);
    const triggers = triggerRows();
    expect(errorText(await call("kernel_playbook_update", upArgs))).toContain("mode: the owner set this value");
    expect(reader.calls).toHaveLength(callsBefore + 1);
    expect(stepRow("kernel_playbook_update", "k6u")).toEqual({ status: "failed", failure_reason: "error" });
    expect(errorText(await call("kernel_playbook_update", upArgs))).toContain("already failed (failed:error); use a new key to try again");
    expect(reader.calls).toHaveLength(callsBefore + 1);
    expect(version(created.id)).toBe(owned);
    expect(triggerRows()).toEqual(triggers);
  });

  it("AC7: a step left started by a crash is interrupted, not re-run: no lookup and no playbook", async () => {
    reader.answer = () => ({ ok: true, text: JSON.stringify(RECORDED.get_list_one) });
    env.store.prepare("INSERT INTO work_steps (key, status) VALUES (?, 'started')").run("kernel_playbook_create:session-1:k7");
    expect(errorText(await create({ idempotency_key: "k7", trigger: clickup({ list: NAME }) }))).toContain("was interrupted by a crash and is not re-runnable");
    expect(reader.calls).toHaveLength(0);
    nothingWritten();
  });
});
