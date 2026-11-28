// The Studio guide (wa-a): every non-resumed Wright and crew context carries
// the kernel's own guide (`kernel/src/brain/guide.ts`): the current rules, a
// plain-words glossary and a tool list generated from the tool catalogue and
// the session's `policy.allowedTools`. It sits right after `role.md`, is never
// cut, and is left out of a resumed thread. Context-level cases call
// `buildContext`; the end-to-end case runs the event loop with a catalogue and
// the brain's handler over a stub `EventSessions` (no SDK, no model).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_CONTEXT_CHARS, MAX_MANIFEST_CHARS, MAX_MEMORY_FILE_CHARS, MAX_MESSAGE_CHARS, NOTE_RESERVE, RESUMED_THREAD_LINE, buildContext, wrapUntrusted } from "../src/brain/context.js";
import type { ContextHistory, ContextInput, LoomwrightSummary } from "../src/brain/context.js";
import {
  GUIDE_HEADING,
  GUIDE_NO_KERNEL_TOOLS,
  GUIDE_TOOLS_UNAVAILABLE,
  MAX_CREW_GUIDE_CHARS,
  MAX_WRIGHT_GUIDE_CHARS,
  crewGuide,
  wrightGuide,
} from "../src/brain/guide.js";
import { brainMessageHandler, defaultWrightSettingsJson, ensureMemoryFiles, wrightSettingsPath } from "../src/brain/index.js";
import { MAX_STUDIO_VIEW_CHARS } from "../src/brain/studio-view.js";
import { MAX_THREAD_HISTORY_TOTAL_CHARS, MAX_THREAD_REFERENCES } from "../src/brain/threads.js";
import { DISPLAY_CATALOGUE_UNAVAILABLE, KERNEL_TOOL_PREFIX, buildToolCatalogue } from "../src/features/catalogue.js";
import type { ToolCatalogue } from "../src/features/catalogue.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { LOOMWRIGHT_COMMAND_NEEDS } from "../src/features/job-needs.js";
import { EventLoop } from "../src/loop/loop.js";
import { enqueueMessage } from "../src/loop/queue.js";
import type { EventSessions } from "../src/loop/types.js";
import type { SessionHandle, StartSessionParams } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";

const NOW = new Date("2026-11-28T10:00:00.000Z");
const UNAVAILABLE: LoomwrightSummary = { ok: false, reason: "not_installed (test)" };
/** The shipped composition's catalogue, and every tool in it allowed: each guide at its largest. */
const SHIPPED: ToolCatalogue = buildToolCatalogue(mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools, LOOMWRIGHT_COMMAND_NEEDS);
const ALL_ALLOWED: readonly string[] = SHIPPED.tools.map((t) => `${KERNEL_TOOL_PREFIX}${t.name}`);
/** A test composition: one tool the session is allowed, one it is not. */
const TEST_CATALOGUE: ToolCatalogue = buildToolCatalogue([
  { name: "kernel_test_probe", description: "Probe the test composition. More words after.", job: "read_pr" },
  { name: "kernel_test_hidden", description: "A tool this session is not allowed.", job: "read_pr" },
]);
const RULES = [
  "### How you act",
  "### Who decides",
  "### Where the owner acts",
  "### Your crew",
  "### Drafting a duty",
  "### Tickets to pull requests, and merge when ready",
  "### Triaging comments on pull requests",
  "### Untrusted text",
  "### Memory",
  "### What each part of Studio is",
];
/** Each glossary term, and the app place the owner sees it in. */
const GLOSSARY: readonly [string, string][] = [
  ["- A session is ", "in Sessions."],
  ["- A chat thread is ", "in Chat"],
  ["- A crew member is ", "in Team's inspector."],
  ["- A playbook is ", "in Playbooks"],
  ["- A trigger is ", "in Schedules & triggers."],
  ["- A schedule is ", "A wakeup is "],
  ["- An event is ", "under Budget & audit."],
  ["- An approval is ", "in Approvals."],
  ["- The settings are ", "are in Settings."],
  ["- The budget is ", "in Budget & audit."],
];

let tmp: string;
let dataDir: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-guide-"));
  dataDir = join(tmp, "data");
});

afterEach(() => {
  for (const s of stores.splice(0)) if (s.isOpen) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** The guide as `buildContext` renders it (`## Studio guide`, the body, a newline). */
function rendered(body: string): string {
  return `## ${GUIDE_HEADING}\n\n${body}\n`;
}

function context(extra: Partial<ContextInput> = {}): string {
  return buildContext({ dataDir, source: "ask", text: "hi", loomwright: UNAVAILABLE, now: NOW, timeZone: "UTC", ...extra });
}

/** The text of `guide`'s `### <heading>` subsection, up to the next one (or the end). */
function subsection(guide: string, heading: string): string {
  const start = guide.indexOf(`### ${heading}\n`);
  expect(start, heading).toBeGreaterThan(-1);
  const next = guide.indexOf("\n### ", start + 1);
  return guide.slice(start, next < 0 ? undefined : next);
}

/** A crew member's four files, `role.md` its charter heading. */
function crewFiles(id: string): void {
  const dir = join(dataDir, "memory", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "role.md"), `# ${id[0]?.toUpperCase()}${id.slice(1)}\n\nThe charter's prose.\n`);
  for (const f of ["preferences", "people", "lessons"]) writeFileSync(join(dir, `${f}.md`), `# ${f}\n`);
}

describe("the Wright context carries the kernel's Studio guide (AC1)", () => {
  it("right after role.md: every rule section and every glossary term, with where the owner sees it, and none of it read from a memory file", () => {
    ensureMemoryFiles(dataDir);
    const prompt = context({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED });
    const at = prompt.indexOf(`\n## ${GUIDE_HEADING}\n`);
    expect(at).toBeGreaterThan(prompt.indexOf("## memory/wright/role.md"));
    expect(at).toBeLessThan(prompt.indexOf("## memory/wright/preferences.md"));
    expect(prompt).toContain(rendered(wrightGuide({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED })));
    const guide = prompt.slice(at, prompt.indexOf("## memory/wright/preferences.md"));
    for (const heading of RULES) expect(guide, heading).toContain(`\n${heading}\n`);
    const glossary = subsection(guide, "What each part of Studio is");
    for (const [term, where] of GLOSSARY) {
      const from = glossary.indexOf(term);
      expect(from, term).toBeGreaterThan(-1);
      const to = glossary.indexOf("\n- ", from + 1);
      // The term's own entry (up to the next one) says where the owner sees it.
      expect(glossary.slice(from, to < 0 ? undefined : to).replace(/\s+/g, " "), term).toContain(where);
    }
    // Not a memory file: with every memory file gone, the guide is still whole.
    rmSync(join(dataDir, "memory"), { recursive: true, force: true });
    const bare = context({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED });
    expect(bare).toContain("(memory/wright/role.md is missing)");
    expect(bare).toContain(rendered(wrightGuide({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED })));
  });

  it("is kernel text: never wrapped, and no wrapper tag that could open or close one; the crew guide never names Wright's heading", () => {
    for (const guide of [wrightGuide(), wrightGuide({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED }), crewGuide(), crewGuide({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED })]) {
      expect(guide).not.toContain("<untrusted-data ");
      expect(guide).not.toContain("</untrusted-data>");
    }
    expect(crewGuide({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED })).not.toContain("# Wright");
    expect(context()).not.toContain("<untrusted-data source=");
  });
});

describe("the guide's tool list is the catalogue's tools the session allows (AC2)", () => {
  it("a tool from a test composition the session is allowed appears; one it is not allowed does not", () => {
    const allowed = [`${KERNEL_TOOL_PREFIX}kernel_test_probe`, "Read"];
    for (const guide of [wrightGuide({ catalogue: TEST_CATALOGUE, allowedTools: allowed }), crewGuide({ catalogue: TEST_CATALOGUE, allowedTools: allowed })]) {
      expect(guide).toContain("\nRead a PR:\n- kernel_test_probe: Probe the test composition.\n");
      expect(guide).not.toContain("kernel_test_hidden");
      // The catalogue's phase 1 tools are in it too, but this session is not allowed them.
      expect(guide).not.toContain("- kernel_task_create: ");
    }
    const prompt = context({ catalogue: TEST_CATALOGUE, allowedTools: allowed });
    expect(prompt).toContain("- kernel_test_probe: Probe the test composition.");
    expect(prompt).not.toContain("kernel_test_hidden");
  });

  it("end to end: the loop's catalogue reaches the handler's prompt (EventContext.catalogue)", async () => {
    const file = wrightSettingsPath(dataDir);
    mkdirSync(join(file, ".."), { recursive: true });
    const settings = JSON.parse(defaultWrightSettingsJson()) as { tool_policy: { allowedTools: string[] } } & Record<string, unknown>;
    settings.tool_policy.allowedTools = [...settings.tool_policy.allowedTools, `${KERNEL_TOOL_PREFIX}kernel_test_probe`];
    writeFileSync(file, `${JSON.stringify({ ...settings, model: "claude-haiku-4-5" }, null, 2)}\n`);
    const store = new Store({ dataDir });
    stores.push(store);
    const starts: StartSessionParams[] = [];
    const sessions: EventSessions = {
      startSession: async (params) => {
        starts.push(params);
        const id = Number(store.prepare("INSERT INTO sessions (agent, task_id, status, model) VALUES (?, ?, 'running', ?)").run(params.agent, params.task ?? null, params.model).lastInsertRowid);
        return { id, sdkSessionId: `sdk-${id}`, pgid: undefined, done: Promise.resolve("completed"), result: Promise.resolve("ok") } as SessionHandle;
      },
      resumeSession: async () => {
        throw new Error("not resumed in this test");
      },
      getSession: () => undefined,
    };
    enqueueMessage(store, { text: "what can you do?", agent: "wright" });
    const handler = brainMessageHandler({ now: () => NOW, timeZone: () => "UTC", loomwright: () => UNAVAILABLE });
    await new EventLoop({ store, handlers: { message: handler }, sessions, catalogue: TEST_CATALOGUE }, { now: () => NOW }).tick();
    expect(starts).toHaveLength(1);
    const prompt = (starts[0] as StartSessionParams).prompt;
    expect(prompt).toContain("\n- kernel_test_probe: Probe the test composition.\n");
    expect(prompt).not.toContain("kernel_test_hidden");
    expect(prompt).not.toContain(GUIDE_TOOLS_UNAVAILABLE);
  });
});

describe("a crew member's context carries the crew guide right after its charter (AC3)", () => {
  it("after memory/<id>/role.md and before its other files and the shared notes; the same glossary, untrusted-text and memory rules as Wright's, plus how it acts and reports back", () => {
    ensureMemoryFiles(dataDir);
    crewFiles("mason");
    const prompt = context({ agent: "mason", catalogue: SHIPPED, allowedTools: [`${KERNEL_TOOL_PREFIX}kernel_github_pr_get`] });
    expect(prompt.startsWith("## memory/mason/role.md\n\n# Mason\n\nThe charter's prose.\n")).toBe(true);
    const at = prompt.indexOf(`\n## ${GUIDE_HEADING}\n`);
    expect(at).toBeGreaterThan(prompt.indexOf("## memory/mason/role.md"));
    expect(at).toBeLessThan(prompt.indexOf("## memory/mason/preferences.md"));
    expect(at).toBeLessThan(prompt.indexOf("## Shared notes"));
    const guide = crewGuide({ catalogue: SHIPPED, allowedTools: [`${KERNEL_TOOL_PREFIX}kernel_github_pr_get`] });
    expect(prompt).toContain(rendered(guide));
    expect(guide).toContain("\nRead a PR:\n- kernel_github_pr_get: ");
    expect(guide).not.toContain("- kernel_github_pr_diff: ");
    // The parts both guides share are the same text.
    const wright = wrightGuide();
    for (const heading of ["Untrusted text", "Memory", "What each part of Studio is"]) expect(subsection(guide, heading), heading).toBe(subsection(wright, heading));
    // The crew's own parts: how it acts under its charter, and how it reports back.
    expect(subsection(guide, "How you act").replace(/\s+/g, " ")).toContain("You are a crew member: a specialist who works under the charter above");
    expect(subsection(guide, "Reporting back").replace(/\s+/g, " ")).toContain("the kernel sends your final reply back to that agent");
    // None of Wright's drafting rules.
    expect(guide).not.toContain("### Drafting a duty");
    expect(prompt).not.toContain("# Wright");
  });
});

describe("the guide is bounded and never cut (AC5)", () => {
  it("each guide at its largest (every catalogue tool allowed) fits its limit", () => {
    const w = rendered(wrightGuide({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED }));
    const c = rendered(crewGuide({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED }));
    expect(w.length).toBeLessThanOrEqual(MAX_WRIGHT_GUIDE_CHARS);
    expect(c.length).toBeLessThanOrEqual(MAX_CREW_GUIDE_CHARS);
    // At its largest is larger than with no tool listed.
    expect(w.length).toBeGreaterThan(rendered(wrightGuide()).length);
    expect(c.length).toBeGreaterThan(rendered(crewGuide()).length);
  });

  it("MAX_CONTEXT_CHARS leaves the memory files their room beside the larger guide, the Studio section, the message, the history, the manifest and the notes", () => {
    const room =
      Math.max(MAX_WRIGHT_GUIDE_CHARS, MAX_CREW_GUIDE_CHARS) +
      MAX_STUDIO_VIEW_CHARS +
      MAX_MESSAGE_CHARS +
      MAX_THREAD_HISTORY_TOTAL_CHARS * 1.25 +
      4 * MAX_MEMORY_FILE_CHARS +
      MAX_MANIFEST_CHARS +
      NOTE_RESERVE +
      1_000;
    expect(room).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });

  it("with maximal thread references, full memory files and the largest guide, the guide is whole and the memory cut notes still appear (Wright and crew)", () => {
    ensureMemoryFiles(dataDir);
    crewFiles("mason");
    for (const id of ["wright", "mason"]) for (const f of ["role", "preferences", "people", "lessons"]) writeFileSync(join(dataDir, "memory", id, `${f}.md`), "m".repeat(200_000));
    const per = Math.floor(MAX_THREAD_HISTORY_TOTAL_CHARS / MAX_THREAD_REFERENCES);
    const references: ContextHistory[] = Array.from({ length: MAX_THREAD_REFERENCES }, (_, i) => ({ heading: `Thread ${i + 1} (reference: exchanges)`, body: wrapUntrusted(`thread:${i + 1}`, "h".repeat(per)) }));
    const base = { source: "trigger:3", text: "t".repeat(MAX_MESSAGE_CHARS + 1_000), loomwright: { ok: true, summary: "s".repeat(MAX_MANIFEST_CHARS) } as LoomwrightSummary, catalogue: SHIPPED, allowedTools: ALL_ALLOWED };
    for (const agent of ["wright", "mason"]) {
      const guide = rendered(agent === "wright" ? wrightGuide({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED }) : crewGuide({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED }));
      const prompt = context({ ...base, agent, history: references });
      expect(prompt.length, agent).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
      expect(prompt, agent).toContain(guide);
      for (const f of ["role", "preferences", "people", "lessons"]) {
        expect(prompt, `${agent} ${f}`).toMatch(new RegExp(`… truncated: memory/${agent}/${f}\\.md, at least \\d+ chars cut \\(file limit ${MAX_MEMORY_FILE_CHARS}\\)`));
      }

      // A history past every bound the thread module keeps (the context is still built), leaving the memory less room
      // than role.md alone takes: role.md is cut by the context limit and the rest dropped, while the guide (its room
      // taken out first) is still whole right after it. A guide cut like a memory section would be cut here instead.
      const roomForMemory = 5_000;
      expect(roomForMemory).toBeLessThan(MAX_MEMORY_FILE_CHARS);
      const oversized = [{ heading: "History", body: "h".repeat(MAX_CONTEXT_CHARS - guide.length - MAX_MESSAGE_CHARS - NOTE_RESERVE - roomForMemory) }];
      const tight = context({ ...base, agent, history: oversized });
      expect(tight.length, agent).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
      expect(tight, agent).toContain(guide);
      expect(tight, agent).toMatch(new RegExp(`… truncated: memory/${agent}/role\\.md, \\d+ chars cut \\(context limit ${MAX_CONTEXT_CHARS}\\)`));
      expect(tight, agent).toMatch(new RegExp(`… truncated: memory/${agent}/preferences\\.md, \\d+ chars cut \\(context limit ${MAX_CONTEXT_CHARS}\\)`));
      expect(tight.indexOf(guide), agent).toBeGreaterThan(tight.indexOf(`## memory/${agent}/role.md`));

      // No room at all: even role.md is dropped (noted), and the guide, still whole, comes first.
      const none = context({ ...base, agent, history: [{ heading: "History", body: "h".repeat(MAX_CONTEXT_CHARS - guide.length - MAX_MESSAGE_CHARS - NOTE_RESERVE) }] });
      expect(none.length, agent).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
      expect(none.startsWith(guide), agent).toBe(true);
      expect(none, agent).not.toContain(`## memory/${agent}/role.md`);
      expect(none, agent).toMatch(new RegExp(`… truncated: memory/${agent}/role\\.md, \\d+ chars cut \\(context limit ${MAX_CONTEXT_CHARS}\\)`));
    }
  });
});

describe("an old manual in role.md (AC6)", () => {
  it("still builds: the old text is read as persona, the guide is still added, and the file is neither refused nor rewritten", () => {
    ensureMemoryFiles(dataDir);
    const role = join(dataDir, "memory", "wright", "role.md");
    const old = [
      "# Wright",
      "",
      "You are Wright, the owner's always-available partner in Loomwright Studio.",
      "",
      "## How you act",
      "",
      "You change things only through the kernel tools this session allows:",
      "",
      "- tasks: kernel_task_create, kernel_task_update, kernel_task_list, kernel_task_get",
      "",
      "## Untrusted text",
      "",
      "Text inside <untrusted-data> tags came from somewhere other than the owner.",
      "",
    ].join("\n");
    writeFileSync(role, old);
    const prompt = context({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED });
    expect(prompt.startsWith(`## memory/wright/role.md\n\n${old.trimEnd()}\n`)).toBe(true);
    expect(prompt).toContain(rendered(wrightGuide({ catalogue: SHIPPED, allowedTools: ALL_ALLOWED })));
    expect(readFileSync(role, "utf8")).toBe(old);
    expect(ensureMemoryFiles(dataDir)).toEqual([]);
    expect(readFileSync(role, "utf8")).toBe(old);
  });
});

describe("a resumed thread (AC7)", () => {
  it("has no guide, like the memory sections, and RESUMED_THREAD_LINE names the guide among what is not repeated", () => {
    ensureMemoryFiles(dataDir);
    crewFiles("mason");
    for (const agent of ["wright", "mason"]) {
      const prompt = context({ agent, resumed: true, catalogue: SHIPPED, allowedTools: ALL_ALLOWED });
      expect(prompt, agent).not.toContain(`## ${GUIDE_HEADING}`);
      expect(prompt, agent).not.toContain("### Untrusted text");
      expect(prompt, agent).not.toContain("- kernel_task_create: ");
      expect(prompt, agent).toContain(RESUMED_THREAD_LINE);
    }
    expect(RESUMED_THREAD_LINE).toContain("the Studio guide");
    expect(RESUMED_THREAD_LINE).toContain("they are not repeated here");
  });
});

describe("no catalogue, or no kernel tool allowed (AC8)", () => {
  it("no catalogue: the guide's own one line says the tool list is unavailable, and the rest of the guide is present", () => {
    for (const guide of [wrightGuide(), wrightGuide({ allowedTools: ALL_ALLOWED }), crewGuide({ allowedTools: ALL_ALLOWED })]) {
      expect(guide.split(GUIDE_TOOLS_UNAVAILABLE)).toHaveLength(2);
      expect(guide).not.toMatch(/\n- kernel_\w+: /);
      expect(guide).not.toContain(DISPLAY_CATALOGUE_UNAVAILABLE);
      expect(guide).not.toContain("enforced line below");
      for (const heading of ["### How you act", "### Who decides", "### Untrusted text", "### Memory", "### What each part of Studio is"]) expect(guide, heading).toContain(heading);
    }
    // A context built with no catalogue is exactly a handler context with none: the allowed tools change nothing then.
    ensureMemoryFiles(dataDir);
    expect(context({ allowedTools: ALL_ALLOWED })).toBe(context());
    expect(context()).toContain(GUIDE_TOOLS_UNAVAILABLE);
  });

  it("a catalogue but no kernel tool allowed: one line saying so, never an empty list", () => {
    for (const allowedTools of [[], ["Read", "Glob", "Grep"], [KERNEL_TOOL_PREFIX]]) {
      const guide = wrightGuide({ catalogue: SHIPPED, allowedTools });
      expect(guide.split(GUIDE_NO_KERNEL_TOOLS)).toHaveLength(2);
      expect(guide).not.toMatch(/\n- kernel_\w+: /);
      expect(guide).not.toContain(GUIDE_TOOLS_UNAVAILABLE);
    }
  });
});

describe("docs/architecture/brain.md shows the Wright guide's rules verbatim", () => {
  it("the studio-guide block equals the guide from \"### Who decides\" to its end", () => {
    const doc = readFileSync(new URL("../../docs/architecture/brain.md", import.meta.url), "utf8");
    const start = doc.indexOf("<!-- studio-guide:start -->");
    const end = doc.indexOf("<!-- studio-guide:end -->");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = doc.slice(start, end).split("\n");
    const open = block.indexOf("```markdown");
    const close = block.lastIndexOf("```");
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const guide = wrightGuide();
    expect(block.slice(open + 1, close).join("\n")).toBe(guide.slice(guide.indexOf("### Who decides")));
  });
});
