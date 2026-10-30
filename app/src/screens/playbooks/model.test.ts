// The Playbooks screen's plain helpers: what each value reads (an unset one reads
// "not set", a snapshot field that is missing reads "unknown", never a default),
// who set it, a playbook's state, which approval holds its enable, a run's words,
// a version's changes, and the line "Edit in English" hands to Wright.
import { describe, expect, it } from "vitest";
import type { Approval, PlaybookListing, PlaybookRun, PlaybookVersion, Trigger } from "../../api/contract";
import {
  APPROVALS_HASH,
  NOT_COUNTED,
  NOT_SET,
  UNKNOWN,
  countText,
  dedupeText,
  draftsOf,
  handoffLine,
  isRelevantKind,
  limitText,
  newestRelevantEventId,
  pendingEnableApproval,
  readError,
  runItemText,
  runKindWord,
  runStatusWord,
  runTokensText,
  runTone,
  safe,
  setByWord,
  snapshotValue,
  stateOf,
  switchName,
  tokenFigure,
  tokensOfRuns,
  triggerText,
  valueOrNotSet,
  versionActors,
  versionChanges,
} from "./model";

const AT = "2026-10-29T10:00:00.000Z";

function listing(overrides: Partial<PlaybookListing> = {}): PlaybookListing {
  return {
    id: 3,
    slug: "pr-review",
    name: "PR review",
    owning_agent: "wright",
    intent: "Review PRs",
    status: "enabled",
    version: 3,
    dedupe_key_spec: null,
    dedupe_key_set_by: null,
    priority: "normal",
    priority_set_by: null,
    model: null,
    model_set_by: null,
    effort: null,
    effort_set_by: null,
    token_limit_per_day: null,
    token_limit_set_by: null,
    api_key_fallback_json: null,
    api_key_fallback_set_by: null,
    mode: "draft",
    mode_set_by: null,
    created_at: AT,
    updated_at: AT,
    trigger_id: null,
    next_fire_at: null,
    ...overrides,
  };
}

function version(n: number, snapshot: PlaybookVersion["snapshot"]): PlaybookVersion {
  return { playbook: 3, version: n, snapshot, created_at: AT };
}

function approvalFor(id: number, overrides: Partial<Approval> = {}): Approval {
  return {
    id,
    requesting_agent: "wright",
    requesting_session: null,
    action: "kernel_playbook_enable",
    payload: { tool: "mcp__kernel__kernel_playbook_enable", input: { id: 3, idempotency_key: "k" }, cwd: "/" },
    requested_at: AT,
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
    ...overrides,
  };
}

describe("an unset value reads 'not set', never a default", () => {
  it("null, undefined and an empty string are not set; a value is itself", () => {
    expect(valueOrNotSet(null)).toBe(NOT_SET);
    expect(valueOrNotSet(undefined)).toBe(NOT_SET);
    expect(valueOrNotSet("")).toBe(NOT_SET);
    expect(valueOrNotSet("haiku")).toBe("haiku");
    expect(valueOrNotSet(0)).toBe("0");
  });

  it("never fills in the kernel's own default for a null (normal priority, draft mode)", () => {
    expect(valueOrNotSet(null)).not.toBe("normal");
    expect(valueOrNotSet(null)).not.toBe("draft");
    expect(dedupeText(null)).toBe(NOT_SET);
    expect(limitText(null)).toBe(NOT_SET);
  });

  it("shows a dedupe key list in full, and anything that is not a list as it was sent", () => {
    expect(dedupeText('["item.id","item.revision"]')).toBe("item.id, item.revision");
    expect(dedupeText("[]")).toBe(NOT_SET);
    expect(dedupeText("pr:{number}:{head_sha}")).toBe("pr:{number}:{head_sha}");
    expect(dedupeText('{"a":1}')).toBe('{"a":1}');
  });

  it("shows tokens as counted figures, with separators", () => {
    expect(tokenFigure(31870)).toBe("31,870");
    expect(limitText(200000)).toBe("200,000");
  });
});

describe("a missing snapshot field reads unknown, never a default", () => {
  it("separates an absent field (unknown) from a null one (not set) and a value", () => {
    const snapshot = { priority: "high", model: null };
    expect(snapshotValue(snapshot, "priority")).toEqual({ known: true, text: "high" });
    expect(snapshotValue(snapshot, "model")).toEqual({ known: true, text: NOT_SET });
    expect(snapshotValue(snapshot, "mode")).toEqual({ known: false, text: UNKNOWN });
    expect(snapshotValue(snapshot, "mode").text).not.toBe("draft");
  });

  it("reads a field of the wrong type as unknown, and a dedupe list as the list", () => {
    expect(snapshotValue({ priority: { nested: true } } as never, "priority")).toEqual({ known: false, text: UNKNOWN });
    expect(snapshotValue({ dedupe_key_spec: '["date"]' }, "dedupe_key_spec")).toEqual({ known: true, text: "date" });
  });

  it("claims no change for a field a snapshot lacks, and lists it as unrecorded", () => {
    const older = version(1, { name: "PR review", priority: "low" });
    const newer = version(2, { name: "PR review", priority: "low", mode: "draft" });
    const result = versionChanges(newer, older);
    expect(result.changes).toEqual([]);
    expect(result.unrecorded).toContain("mode");
    expect(result.created).toBe(false);
  });

  it("lists what changed between two snapshots, and a first version as its own values", () => {
    const v1 = version(1, { name: "PR review", priority: "low", model: "haiku", token_limit_per_day: 100000, mode: "draft" });
    const v2 = version(2, { name: "PR review", priority: "normal", model: "haiku", token_limit_per_day: 200000, mode: "draft", priority_set_by: "owner", token_limit_set_by: "owner" });
    expect(versionChanges(v2, v1).changes).toEqual([
      { field: "priority", from: "low", to: "normal" },
      { field: "token_limit_per_day", from: "100,000", to: "200,000" },
    ]);
    const first = versionChanges(v1, undefined);
    expect(first.created).toBe(true);
    expect(first.changes.map((c) => c.field)).toEqual(["name", "priority", "model", "token_limit_per_day", "mode"]);
    expect(first.unrecorded).toEqual(expect.arrayContaining(["intent", "dedupe_key_spec", "effort"]));
  });

  it("names who made a version from the set_by of the policy fields it changed, and nobody when it cannot say", () => {
    const v = version(2, { priority: "normal", model: "sonnet", priority_set_by: "owner", model_set_by: "wright" });
    expect(versionActors(v, [{ field: "priority", from: "low", to: "normal" }])).toBe("you");
    expect(versionActors(v, [{ field: "priority", from: "low", to: "normal" }, { field: "model", from: "haiku", to: "sonnet" }])).toBe("you and Wright");
    expect(versionActors(v, [{ field: "intent", from: "a", to: "b" }])).toBe("");
    expect(versionActors(version(2, { priority: "normal" }), [{ field: "priority", from: "low", to: "normal" }])).toBe("");
  });
});

describe("who set a value", () => {
  it("reads 'set by you' for the owner and 'proposed by Wright' for Wright, and nothing for nobody", () => {
    expect(setByWord("owner")).toBe("set by you");
    expect(setByWord("wright")).toBe("proposed by Wright");
    expect(setByWord(null)).toBe("");
    expect(setByWord("kernel")).toBe("");
  });
});

describe("a playbook's state", () => {
  it("is on only when enabled; a draft waits on the owner; anything else, even an unknown status, reads off", () => {
    expect(stateOf({ status: "enabled" })).toBe("on");
    expect(stateOf({ status: "draft" })).toBe("draft");
    expect(stateOf({ status: "disabled" })).toBe("off");
    expect(stateOf({ status: "something-new" })).toBe("off");
  });

  it("names the switch '<name> is on|off' and counts on and drafts", () => {
    expect(switchName({ name: "PR review", status: "enabled" })).toBe("PR review is on");
    expect(switchName({ name: "PR review", status: "draft" })).toBe("PR review is off");
    const list = [listing({ id: 1 }), listing({ id: 2, status: "draft" }), listing({ id: 3, status: "disabled" })];
    expect(countText(list, false)).toBe("3 playbooks · 1 on");
    expect(countText(list, true)).toBe("3 playbooks · 1 on · last known");
    expect(countText([list[0] as PlaybookListing], false)).toBe("1 playbook · 1 on");
    expect(draftsOf(list).map((p) => p.id)).toEqual([2]);
  });

  it("renders kernel text inert: control characters are written out", () => {
    expect(safe("a\u001b[31mred\u001b[0m")).toBe("a\\x1b[31mred\\x1b[0m");
    expect(switchName({ name: "x‮y", status: "enabled" })).toBe("x\\u202ey is on");
  });
});

describe("the approval that holds a playbook's enable", () => {
  it("finds the pending enable whose payload names the playbook, and links to Approvals", () => {
    expect(pendingEnableApproval([approvalFor(6)], { id: 3 })?.id).toBe(6);
    expect(pendingEnableApproval([approvalFor(6)], { id: 4 })).toBeUndefined();
    expect(APPROVALS_HASH).toBe("#/approvals");
  });

  it("ignores a decided approval, and one for another tool", () => {
    expect(pendingEnableApproval([approvalFor(6, { status: "approved" })], { id: 3 })).toBeUndefined();
    expect(pendingEnableApproval([approvalFor(6, { payload: { tool: "mcp__github__comment", input: { id: 3 } } })], { id: 3 })).toBeUndefined();
    expect(pendingEnableApproval(undefined, { id: 3 })).toBeUndefined();
  });

  it("never reads the asking playbook as the subject while the payload names another", () => {
    const asked = approvalFor(7, { playbook: { id: 3, slug: "pr-review", version: 3 }, payload: { tool: "mcp__kernel__kernel_playbook_enable", input: { id: 4 } } });
    expect(pendingEnableApproval([asked], { id: 3 })).toBeUndefined();
    expect(pendingEnableApproval([asked], { id: 4 })?.id).toBe(7);
  });

  it("falls back to approval.playbook only when the payload names no subject", () => {
    const bare = approvalFor(8, { payload: {}, playbook: { id: 3, slug: "pr-review", version: 3 } });
    expect(pendingEnableApproval([bare], { id: 3 })?.id).toBe(8);
    expect(pendingEnableApproval([{ ...bare, action: "comment" }], { id: 3 })).toBeUndefined();
  });
});

describe("runs", () => {
  const run = (overrides: Partial<PlaybookRun> = {}): PlaybookRun => ({
    id: 1,
    playbook: 3,
    version: 3,
    kind: "fire",
    status: "done",
    item_ref: "github:acme/widgets#42",
    item_revision: "9f3c2a1e7b04d58c",
    tokens: 31870,
    session: 12,
    started: AT,
    ended: AT,
    ...overrides,
  });

  it("puts every status in words, and an unknown one as the kernel sent it", () => {
    expect(runStatusWord("running")).toBe("running");
    expect(runStatusWord("skipped_duplicate")).toBe("skipped: already done");
    expect(runStatusWord("exotic")).toBe("exotic");
    expect(runKindWord("dry_run")).toBe("dry run");
    expect(runKindWord("exotic")).toBe("exotic");
    expect(runTone("running")).toBe("working");
    expect(runTone("done")).toBe("ok");
    expect(runTone("failed")).toBe("danger");
    expect(runTone("exotic")).toBe("idle");
  });

  it("shows a run's tokens as counted, and 'not counted yet' while it has none", () => {
    expect(runTokensText(run())).toBe("31,870 tokens");
    expect(runTokensText(run({ tokens: null }))).toBe(NOT_COUNTED);
  });

  it("sums only counted tokens and says how many runs have none, never inventing a figure for them", () => {
    expect(tokensOfRuns([run({ tokens: 100 }), run({ tokens: null }), run({ tokens: 50 })])).toEqual({ counted: 150, runs: 3, pending: 1 });
    expect(tokensOfRuns([])).toEqual({ counted: 0, runs: 0, pending: 0 });
  });

  it("shows a run's item with a short revision, and nothing for a run with no item", () => {
    expect(runItemText(run())).toBe("github:acme/widgets#42 @ 9f3c2a1");
    expect(runItemText(run({ item_revision: null }))).toBe("github:acme/widgets#42");
    expect(runItemText(run({ item_ref: null, item_revision: null }))).toBe("");
  });
});

describe("a trigger in words, in full", () => {
  const poll = (spec: unknown): Trigger => ({
    id: 5,
    owning_agent: "wright",
    playbook: "pr-review",
    kind: "poll",
    spec,
    action: "playbook",
    text: "t",
    enabled: true,
    enabled_changed_by: null,
    enabled_changed_at: null,
    next_fire_at: null,
    last_fired_at: null,
    last_result: null,
    created_by: "wright",
    created_at: AT,
  });

  it("shows a poll's interval, every repo and every filter without truncating", () => {
    const text = triggerText(poll({ source: "github.pulls", repos: ["acme/widgets", "acme/gadgets"], filters: { state: "open", draft: false, author: "vikash" }, interval_seconds: 600 }), { trigger_id: 5 });
    expect(text).toBe("poll every 600s · acme/widgets, acme/gadgets · state=open, draft=false, author=vikash");
  });

  it("reads a spec it does not know as the trigger's kind, and no trigger as none (or its id)", () => {
    expect(triggerText(poll({ weird: true }), { trigger_id: 5 })).toBe("poll");
    expect(triggerText(undefined, { trigger_id: null })).toBe("none");
    expect(triggerText(undefined, { trigger_id: 5 })).toBe("trigger 5");
  });
});

describe("Edit in English", () => {
  it("names the playbook by id and slug and leaves the line open for the owner to finish", () => {
    expect(handoffLine({ id: 7, slug: "pb-7" })).toBe("About playbook 7 (pb-7): ");
  });
});

describe("the feed", () => {
  it("knows the kinds that change what the screen shows", () => {
    expect(isRelevantKind("playbook_updated")).toBe(true);
    expect(isRelevantKind("session_status")).toBe(true);
    expect(isRelevantKind("event_done")).toBe(true);
    expect(isRelevantKind("approval_requested")).toBe(false);
    expect(isRelevantKind("trigger_fired")).toBe(false);
  });

  it("finds the newest relevant event id, 0 for none", () => {
    expect(newestRelevantEventId([])).toBe(0);
    expect(newestRelevantEventId([{ id: 1, kind: "approval_requested" }])).toBe(0);
    expect(
      newestRelevantEventId([
        { id: 1, kind: "playbook_created" },
        { id: 2, kind: "session_status" },
        { id: 3, kind: "approval_requested" },
      ]),
    ).toBe(2);
  });
});

describe("a failed read", () => {
  it("says why the list did not load, by who failed", () => {
    expect(readError({ kind: "refused", status: 500, body: { error: "store_locked", message: "the store is locked" } }).detail).toBe("GET /playbooks · 500 · store_locked · the store is locked");
    expect(readError({ kind: "not_connected", connection: { state: "unreachable", reason: "connection_failed" } }).text).toContain("not reachable");
    expect(readError({ kind: "bridge_failed" }).text).toContain("could not ask the kernel");
  });
});
