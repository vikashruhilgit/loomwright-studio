// The audit log's sentence table (phase 7 item 17): a sentence for every event kind the kernel writes, read
// defensively from an untrusted payload, never JSON, never markup. The coverage test reads `kernel/src` the way
// `screens/menubar/kernel-mirror.test.ts` does, so a kind the kernel starts writing without an entry here fails.
import { describe, expect, it } from "vitest";
import { AUDIT_SENTENCES, auditSentence } from "./audit-sentences";
import type { SentenceRefs } from "./audit-sentences";

// ---- The kernel's own kinds, scanned from its source ----------------------------------------------------------

interface NodeEntry {
  readonly name: string;
  isDirectory(): boolean;
}
interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(path: string, options: { readonly withFileTypes: true }): NodeEntry[];
}
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): NodeFs } }).process.getBuiltinModule("node:fs");
const here = (import.meta as unknown as { dirname: string }).dirname;
const KERNEL = `${here}/../../../../kernel/src`;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out.sort();
}

/**
 * Kinds whose writer builds the name at run time, which no scan of the source can see: each is listed with the file
 * that writes it (the test below checks the file still names it). None today: every writer passes a literal, a named
 * constant, or an `*_AUDIT_KINDS` list, all of which the scan reads.
 */
const RUN_TIME_KINDS: readonly { readonly kind: string; readonly file: string }[] = [];

/** Every kind `kernel/src` writes, with the files that write it: see the header of this file for the forms read. */
function kernelKinds(): Map<string, Set<string>> {
  const files = sourceFiles(KERNEL).map((path) => ({ path: path.slice(KERNEL.length + 1), text: nodeFs.readFileSync(path, "utf8") }));
  // Named constants that hold a kind (`export const PAUSE_ENGAGED = "pause_engaged"`).
  const constants = new Map<string, string>();
  for (const { text } of files) for (const m of text.matchAll(/\bconst ([A-Z][A-Z0-9_]+) = "([a-z][a-z0-9_]*)"/g)) constants.set(m[1] as string, m[2] as string);

  const kinds = new Map<string, Set<string>>();
  const add = (kind: string | undefined, file: string): void => {
    if (kind === undefined) return;
    let at = kinds.get(kind);
    if (at === undefined) kinds.set(kind, (at = new Set()));
    at.add(file);
  };
  // The writers' helpers take the store and refs before the kind: `appendEvent(store, "kind", …)`, `#appendEvent("kind", …)`,
  // `#recordSafely("kind", …)`, `#settleGroup(sessionId, g, "kind", …)`; the kill switch's `append(store, KIND, …)`.
  const CALLS = "(?:appendEvent|recordSafely|settleGroup)";
  const BEFORE = "((?:\\s*[\\w.#]+\\s*,)*?)";
  const literal = new RegExp(`${CALLS}\\(${BEFORE}\\s*"([a-z][a-z0-9_]*)"`, "g");
  const named = new RegExp(`(?:${CALLS}|\\bappend)\\(${BEFORE}\\s*([A-Z][A-Z0-9_]+)\\b`, "g");
  for (const { path, text } of files) {
    for (const m of text.matchAll(literal)) add(m[2], path);
    for (const m of text.matchAll(named)) add(constants.get(m[2] as string), path);
    // The loop's `#finish(row, ref, "event_done", …)` names its audit kind.
    for (const m of text.matchAll(/#finish\(\s*row,\s*ref,\s*"([a-z][a-z0-9_]*)"/g)) add(m[1], path);
    // A statement that inserts the kind itself: `INSERT INTO events (…) VALUES (?, 'stop_all_completed', …)`.
    for (const m of text.matchAll(/INSERT INTO events[^"`]*VALUES \(\?, '([a-z][a-z0-9_]*)'/g)) add(m[1], path);
    // The exported lists of audit kinds (`AGENT_AUDIT_KINDS`, `TRIGGER_AUDIT_KINDS`, …).
    for (const m of text.matchAll(/export const [A-Z_]*AUDIT_KINDS = \[([^\]]*)\]/g)) for (const k of (m[1] as string).matchAll(/"([a-z_]+)"/g)) add(k[1], path);
  }
  for (const { kind, file } of RUN_TIME_KINDS) add(kind, file);
  return kinds;
}

describe("the sentence table covers every kind the kernel writes", () => {
  const kinds = kernelKinds();

  it("the scan sees the kernel's kinds (a rotted scan would pass the next test for the wrong reason)", () => {
    // One kind per form the scan reads.
    for (const kind of ["session_status", "task_created", "kill_switch_engaged", "pause_engaged", "memory_updated", "draft_output_recorded", "session_stop_requested", "stop_all_completed", "agent_created", "trigger_fired", "event_done", "session_group_killed"]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
    expect(kinds.size).toBeGreaterThan(60);
  });

  it("every kind has an entry", () => {
    const missing = [...kinds.keys()].filter((kind) => !Object.hasOwn(AUDIT_SENTENCES, kind)).map((kind) => `${kind} (${[...(kinds.get(kind) ?? [])].join(", ")})`);
    expect(missing).toEqual([]);
  });

  it("no entry is for a kind the kernel does not write", () => {
    expect(Object.keys(AUDIT_SENTENCES).filter((kind) => !kinds.has(kind))).toEqual([]);
  });

  it("a run-time kind names a file that still writes it", () => {
    for (const { kind, file } of RUN_TIME_KINDS) expect(nodeFs.readFileSync(`${KERNEL}/${file}`, "utf8"), `${file} writes ${kind}`).toContain(kind);
  });
});

// ---- Reading a payload ------------------------------------------------------------------------------------------------

const refs = (o: Partial<SentenceRefs> = {}): SentenceRefs => ({
  taskId: null,
  sessionId: null,
  playbook: (value) => (value === "review-prs" || value === 4 ? "Review PRs on studio-sandbox" : undefined),
  agent: (id) => (id === "mason" ? "Mason" : id),
  time: (iso) => `at ${iso.slice(11, 16)}`,
  ...o,
});

describe("the sentences", () => {
  it("the example: a recorded draft says it was recorded, not sent", () => {
    expect(auditSentence("draft_output_recorded", { draft_output_id: 3, tool: "gh pr review", summary: "gh pr review studio-sandbox #3" }, refs({ sessionId: 41 }))).toBe(
      "Draft review recorded for studio-sandbox #3. Recorded, not sent.",
    );
    expect(auditSentence("draft_output_recorded", {}, refs())).toBe("Draft output recorded. Recorded, not sent.");
  });

  it("each reads its payload's fields into one plain sentence", () => {
    const cases: readonly (readonly [string, unknown, string, Partial<SentenceRefs>?])[] = [
      ["task_created", { title: "Pick the repos to review first", state: "waiting on owner" }, "Task 12 was created: Pick the repos to review first · state waiting on owner.", { taskId: 12 }],
      ["task_updated", { fields: ["state"], state: "done" }, "Task 9 was updated: state · state done.", { taskId: 9 }],
      ["session_output_appended", { from_seq: 9, to_seq: 9 }, "Session 41 wrote output (entry 9).", { sessionId: 41 }],
      ["session_output_appended", { from_seq: 9, to_seq: 14 }, "Session 41 wrote output (entries 9–14).", { sessionId: 41 }],
      ["session_status", { from: "running", to: "completed", reason: "result_success" }, "Session 41 went from running to completed (result success).", { sessionId: 41 }],
      ["session_status", { from: null, to: "starting" }, "Session 41 started as starting.", { sessionId: 41 }],
      ["admission_refused", { kind: "start", agent: "mason", reason: "agent_sessions_at_once", retry_at: "2026-10-30T15:30:00.000Z" }, "A session start for Mason was refused: agent sessions at once. Retry at 15:30.", {}],
      ["cap_warning", { rate_limit_type: "seven_day", utilization: 0.83, resets_at: "2026-11-02T09:00:00.000Z" }, "The seven_day window is near its cap at 83% · resets at 09:00.", {}],
      ["kill_switch_released", { anything: 1 }, "The kill switch was released.", {}],
      ["trigger_missed", { trigger_id: 5, reason: "kill_switch" }, "Trigger 5 did not fire: kill switch.", {}],
      ["trigger_fired", { trigger_id: 5, playbook: "review-prs", items: 1 }, "Trigger 5 fired for Review PRs on studio-sandbox · 1 item found.", {}],
      ["playbook_updated", { playbook_id: 4, version: 3, fields: ["priority", "model"], by: "you" }, "Playbook Review PRs on studio-sandbox was updated to v3: priority, model by you.", {}],
      ["wakeup_scheduled", { wakeup_id: 5, due_at: "2026-10-30T15:30:00.000Z", reason: "PR #3 review may be ready" }, "Wake-up #5 is due at 15:30: PR #3 review may be ready.", {}],
      ["agent_renamed", { id: "mason", old: "Mason", new: "Mason the Builder" }, "Mason was renamed from Mason to Mason the Builder.", {}],
      ["agent_settings_set", { id: "mason", field: "model", old: "sonnet", new: "haiku", by: "owner" }, "Mason's model was changed from sonnet to haiku by owner.", {}],
      ["approval_requested", { id: 7, action: "kernel_agent_create", agent: "wright" }, "wright asked for approval to kernel_agent_create (approval 7).", {}],
      ["tool_decision", { tool: "Bash", decision: "deny", reason: "draft_mode" }, "Bash was denied (draft mode).", {}],
      ["memory_updated", { path: "memory/mason/lessons.md", by: "owner", size: 12 }, "memory/mason/lessons.md was updated by owner.", {}],
      ["budget_limit_reached", { agent: "mason", limit: 150000, counted_tokens: 150100 }, "Mason reached its daily limit of 150,000 tokens.", {}],
      ["auth_provider_switch_withdrawn", { kept: "api-key", withdrawn: "subscription-token" }, "You kept api-key: the pending switch to subscription-token was withdrawn.", {}],
      ["auth_provider_switch_withdrawn", {}, "You kept the auth provider in use: the pending switch was withdrawn.", {}],
    ];
    for (const [kind, payload, expected, o] of cases) expect(auditSentence(kind, payload, refs(o)), `${kind} ${JSON.stringify(payload)}`).toBe(expected);
  });

  it("run_declared_checks: no base, admitted with and without skipped lines, the count fallback and plurals", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const at = { repo: "o/r", base_ref: "refs/remotes/origin/main", base_sha: sha };
    const said = (payload: unknown) => auditSentence("run_declared_checks", payload, refs({ sessionId: 41 }));
    expect(said({ repo: "o/r", base_ref: null, base_sha: null, reason: "base_unresolved", admitted: [], skipped: [] })).toBe(
      "The kernel found no base branch for o/r, so session 41 may run none of its checks: base unresolved.",
    );
    expect(said({ base_sha: null })).toBe("The kernel found no base branch for the repo, so session 41 may run none of its checks.");
    // A command declared twice (a workflow and a script) is named once; skipped_count is the whole total.
    expect(said({ ...at, admitted: [{ command: "npm test" }, { command: "npm run lint" }, { command: "npm test" }], skipped: [{ text: "x" }], skipped_count: 3 })).toBe(
      "The kernel read refs/remotes/origin/main at 0123456789ab: session 41 may run o/r's declared checks (npm test, npm run lint); 3 declared lines were skipped.",
    );
    // No skipped_count: the listed skipped lines are counted; one reads singular.
    expect(said({ ...at, admitted: [{ command: "npm test" }], skipped: [{ text: "x" }] })).toBe(
      "The kernel read refs/remotes/origin/main at 0123456789ab: session 41 may run o/r's declared checks (npm test); 1 declared line was skipped.",
    );
    // Nothing skipped, and nothing admitted.
    expect(said({ ...at, admitted: [{ command: "npm test" }], skipped: [], skipped_count: 0 })).toBe(
      "The kernel read refs/remotes/origin/main at 0123456789ab: session 41 may run o/r's declared checks (npm test).",
    );
    expect(said({ ...at, admitted: [], skipped: [], skipped_count: 0 })).toBe("The kernel read refs/remotes/origin/main at 0123456789ab: session 41 may run none of o/r's checks.");
    // A count that is not a whole number falls back to the list.
    expect(said({ ...at, admitted: [], skipped: [{}, {}], skipped_count: -1 })).toBe(
      "The kernel read refs/remotes/origin/main at 0123456789ab: session 41 may run none of o/r's checks; 2 declared lines were skipped.",
    );
    // 27a: an empty unrunnable list reads byte-identically to no key at all.
    expect(said({ ...at, admitted: [{ command: "npm test" }], skipped: [], skipped_count: 0, unrunnable: [], unrunnable_count: 0 })).toBe(
      "The kernel read refs/remotes/origin/main at 0123456789ab: session 41 may run o/r's declared checks (npm test).",
    );
  });

  it("run_declared_checks (27a): each unrunnable check's line is appended, at most 5 by name, unrunnable_count the total", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const at = { repo: "o/r", base_ref: "refs/remotes/origin/main", base_sha: sha };
    const said = (payload: unknown) => auditSentence("run_declared_checks", payload, refs({ sessionId: 41 }));
    const npmTest = { command: "npm test", executable: "npm", line: "npm test is declared but npm is not on the run's PATH" };
    expect(said({ ...at, admitted: [{ command: "npm test" }], skipped: [], skipped_count: 0, unrunnable: [npmTest], unrunnable_count: 1 })).toBe(
      "The kernel read refs/remotes/origin/main at 0123456789ab: session 41 may run o/r's declared checks (npm test); npm test is declared but npm is not on the run's PATH.",
    );
    // After the skipped count; a node-only gap reads its own line.
    const lint = { command: "npm run lint", executable: "node", line: "npm run lint is declared but node is not on the run's PATH" };
    expect(said({ ...at, admitted: [{ command: "npm test" }, { command: "npm run lint" }], skipped: [{}], skipped_count: 1, unrunnable: [npmTest, lint], unrunnable_count: 2 })).toBe(
      "The kernel read refs/remotes/origin/main at 0123456789ab: session 41 may run o/r's declared checks (npm test, npm run lint); 1 declared line was skipped; npm test is declared but npm is not on the run's PATH; npm run lint is declared but node is not on the run's PATH.",
    );
    // More than 5, or a count above the listed (the event's own bound): the rest are counted.
    const many = Array.from({ length: 7 }, (_, i) => ({ line: `c${i} is declared but c${i} is not on the run's PATH` }));
    expect(said({ ...at, admitted: [{ command: "c0" }], unrunnable: many, unrunnable_count: 120 })).toBe(
      `The kernel read refs/remotes/origin/main at 0123456789ab: session 41 may run o/r's declared checks (c0); ${many.slice(0, 5).map((m) => m.line).join("; ")}; and 115 more.`,
    );
    // No count, or a malformed one: the listed lines are counted; a malformed entry is dropped, never printed.
    expect(said({ ...at, admitted: [{ command: "c0" }], unrunnable: [...many, null, { line: 3 }, "x"], unrunnable_count: -2 })).toBe(
      `The kernel read refs/remotes/origin/main at 0123456789ab: session 41 may run o/r's declared checks (c0); ${many.slice(0, 5).map((m) => m.line).join("; ")}; and 2 more.`,
    );
  });

  it("no sentence carries a dollar figure (D24)", () => {
    const payloads = [{ spend_usd: 12.5, ceiling_usd: 20, playbook: "review-prs", slug: "review-prs", agent: "mason", kind: "start" }];
    for (const kind of ["api_key_ceiling_reached", "api_key_fallback_admitted"]) for (const p of payloads) expect(auditSentence(kind, p, refs())).not.toMatch(/\$|usd|12\.5/i);
  });

  it("every kind reads any payload as one plain sentence: no JSON, no 'undefined', and it never throws", () => {
    const hostile: unknown[] = [
      undefined,
      null,
      "text",
      7,
      [1, 2, 3],
      {},
      { nested: { a: { b: 1 } }, list: [{ x: 1 }], n: null },
      { id: { a: 1 }, agent: ["mason"], reason: { code: "x" }, fields: [{ a: 1 }, "ok"], from: {}, to: [], queue_id: Number.NaN, sessions: "nope", title: { a: 1 } },
      { __proto__: { agent: "x" }, constructor: "y", toString: 1 },
    ];
    for (const kind of Object.keys(AUDIT_SENTENCES)) {
      for (const payload of hostile) {
        const text = auditSentence(kind, payload, refs({ taskId: 3, sessionId: 4 }));
        const label = `${kind} ${JSON.stringify(payload)} -> ${text}`;
        expect(text.length, label).toBeGreaterThan(0);
        expect(text, label).not.toMatch(/[{}[\]]|undefined|null|NaN|\[object/);
        expect(text, label).not.toMatch(/\s{2,}/);
      }
    }
  });

  it("payload strings are made inert text: control characters are written out, long text is cut", () => {
    const text = auditSentence("task_created", { title: `a\u001b[31mb${"x".repeat(500)}` }, refs({ taskId: 1 }));
    expect(text).toContain("a\\x1b[31mb");
    expect(text).not.toContain("\u001b");
    expect(text.length).toBeLessThan(200);
    expect(text).toContain("…");
  });

  it("markup in a payload stays literal text", () => {
    expect(auditSentence("task_created", { title: "<img src=x onerror=alert(1)>" }, refs({ taskId: 1 }))).toBe("Task 1 was created: <img src=x onerror=alert(1)>.");
  });

  it("an unknown kind reads '{kind} · no description yet', never its payload", () => {
    expect(auditSentence("made_up_kind", { secret: "value", nested: { a: 1 } }, refs())).toBe("made_up_kind · no description yet");
    expect(auditSentence("made_up_kind", undefined, refs())).toBe("made_up_kind · no description yet");
  });

  it("wa-b: the role upgrade's kinds come from ROLE_UPGRADE_AUDIT_KINDS, and each reads as one sentence naming the file", () => {
    const kinds = kernelKinds();
    for (const kind of ["wright_role_upgraded", "wright_role_upgrade_failed"]) expect([...(kinds.get(kind) ?? [])], kind).toContain("brain/past-templates.ts");

    const backup = "wright/role.bak-20261128T101500123Z-a1b2c3d4.md";
    expect(auditSentence("wright_role_upgraded", { file: "wright/role.md", old_hash: "8819eec9acb3aed46042567dc20a595b3e303f162b07bf692a22197c357d4345", backup }, refs())).toBe(
      "The kernel replaced wright/role.md with the current role template. The old file was a copy of a past template that nobody changed; a backup of it was kept (role.bak-20261128T101500123Z-a1b2c3d4.md).",
    );
    expect(auditSentence("wright_role_upgraded", {}, refs())).toBe(
      "The kernel replaced Wright's role file with the current role template. The old file was a copy of a past template that nobody changed; a backup of it was kept.",
    );

    expect(auditSentence("wright_role_upgrade_failed", { file: "wright/role.md", step: "backup", code: "EACCES" }, refs())).toBe(
      "The kernel could not update wright/role.md: writing the backup failed (EACCES). The file was left as it was.",
    );
    for (const [step, said] of [["write", "writing the new file failed"], ["rename", "replacing the file failed"], ["record", "recording the change failed"], ["fsync_dir", "the fsync dir step failed"], ["constructor", "the constructor step failed"]]) {
      expect(auditSentence("wright_role_upgrade_failed", { file: "wright/role.md", step }, refs())).toBe(`The kernel could not update wright/role.md: ${said as string}. The file was left as it was.`);
    }
    expect(auditSentence("wright_role_upgrade_failed", {}, refs())).toBe("The kernel could not update Wright's role file: a step failed. The file was left as it was.");
    // A payload's text is data: markup stays literal, a control character is written out.
    expect(auditSentence("wright_role_upgrade_failed", { file: "<b>x</b>", step: "write", code: "E\u001bX" }, refs())).toBe(
      "The kernel could not update <b>x</b>: writing the new file failed (E\\x1bX). The file was left as it was.",
    );
  });

  it("a kind that is an Object.prototype name is unknown, not a function call", () => {
    for (const kind of ["constructor", "toString", "__proto__", "hasOwnProperty"]) expect(auditSentence(kind, {}, refs())).toBe(`${kind} · no description yet`);
  });
});
