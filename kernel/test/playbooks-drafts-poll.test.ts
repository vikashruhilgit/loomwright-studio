// Phase 6 item 09 (Wright drafts a PR-review duty): `kernel_playbook_create` and
// `kernel_playbook_update` take a structured `trigger.poll` (the `PollSpec` as an
// object), the mirror shows the mode and a readable poll schedule as proposed,
// item 04's refusals come back by their own reasons, `live` is refused, and a
// value the owner set is not Wright's to change. A temp data dir and a fixed
// clock; the tools run through the tool server's own `contributedToolHandler`
// (no SDK launch, no model); the `connectors` row is seeded raw, as the poll
// tests do.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContributedTool } from "../src/features/index.js";
import { getPlaybook, mirrorPath, playbooksContribution, setPlaybookPolicy } from "../src/playbooks/index.js";
import { contributedToolHandler } from "../src/tools/server.js";
import type { KernelToolContext, KernelToolResult } from "../src/tools/server.js";
import { count, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

const NOW = "2026-10-28T10:00:00.000Z";
const REPO = "vikashruhilgit/studio-sandbox";
const POLL = { source: "github.pulls", repos: [REPO], filters: { state: "open" }, interval_seconds: 300 };
const KEY = ["playbook.id", "item.id", "item.revision"];

let env: LoopEnv;
let keyN = 0;

beforeEach(() => {
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
  it("mode live is refused live_mode_not_in_phase_6 and nothing is written", async () => {
    expect(errorText(await create({ mode: "live" }))).toContain("live_mode_not_in_phase_6");
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
