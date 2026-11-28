// @vitest-environment jsdom
// Settings → "Wright's tools" (wa-c, AC4 and AC8): the `wright_tools` parse and words (`./tool-policy.ts`), the block
// on the real screen against a scripted bridge (each missing tool in plain words, the file named as plain text, no list
// when nothing is missing or the field is absent or null, kernel text rendered literally), and the audit log's
// sentences for the upgrade's two kinds. The kernel's route is covered by `kernel/test/gui-settings.test.ts`.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createCommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import { auditSentence } from "../budget/audit-sentences";
import type { SentenceRefs } from "../budget/audit-sentences";
import { SETTINGS_TEST_IDS as IDS } from "./model";
import { resetLastViews } from "./lastKnown";
import { SettingsScreen } from "./SettingsScreen";
import { STATUS, settingsBody } from "./test-support";
import { MISSING_TOOLS_HEADING, WRIGHT_SETTINGS_FILE, missingToolWords, toolPolicyStatusText, wrightToolsOf, wrightToolsSummary } from "./tool-policy";

afterEach(() => {
  cleanup();
  resetLastViews();
});

const STATUS_TOOL = { name: "kernel_studio_status", job: "Manage the crew", purpose: "Reads what is in Studio right now." };
const LESSON_TOOL = { name: "kernel_lesson_propose", job: "Manage playbooks", purpose: "Proposes a lesson for the owner to approve." };
const READ_TOOL = { name: "Read", job: null, purpose: null };

// ---- The parse and the words ------------------------------------------------------------------------------------

describe("wrightToolsOf: the contract's shape, field by field, every string inert", () => {
  it("reads status and missing, drops an extra field and an entry with no name", () => {
    expect(wrightToolsOf({ status: "owner", missing: [{ ...STATUS_TOOL, token: "sk-ant-x" }, { job: "x" }, { name: "" }, "Read", READ_TOOL], extra: 1 })).toEqual({
      status: "owner",
      missing: [STATUS_TOOL, READ_TOOL],
    });
    expect(wrightToolsOf({ status: null, missing: [] })).toEqual({ status: null, missing: [] });
    // A blank status reads as unset, never an empty "Tool policy: ".
    expect(wrightToolsOf({ status: " ", missing: [] })).toEqual({ status: null, missing: [] });
  });

  it("is null for absent, null and every malformed shape", () => {
    for (const raw of [undefined, null, "proposed", 3, [], {}, { status: "proposed" }, { status: 7, missing: [] }, { status: "proposed", missing: {} }]) {
      expect(wrightToolsOf(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("makes a control or bidi character inert, and a non-string job or purpose null", () => {
    expect(wrightToolsOf({ status: "own‮er", missing: [{ name: "a\nb", job: 7, purpose: "p\u0007" }] })).toEqual({
      status: "own\\u202eer",
      missing: [{ name: "a\\nb", job: null, purpose: "p\\x07" }],
    });
  });

  it("a catalogued tool reads as its purpose line and job, with its name to add; an uncatalogued one as its name", () => {
    expect(missingToolWords(STATUS_TOOL)).toEqual({ line: STATUS_TOOL.purpose, job: STATUS_TOOL.job, name: STATUS_TOOL.name });
    expect(missingToolWords(READ_TOOL)).toEqual({ line: "Read", job: undefined, name: undefined });
  });

  it("the status line and the summary", () => {
    expect(toolPolicyStatusText("proposed")).toBe("Tool policy: proposed by the kernel");
    expect(toolPolicyStatusText("owner")).toBe("Tool policy: owner");
    expect(toolPolicyStatusText(null)).toBe("Tool policy: not set");
    expect(wrightToolsSummary({ status: "proposed", missing: [] })).toBe("Wright's tool list has every tool the kernel proposes.");
    expect(wrightToolsSummary({ status: "owner", missing: [STATUS_TOOL] })).toMatch(/^Wright's tool list lacks 1 tool the kernel proposes\./);
    expect(wrightToolsSummary({ status: "owner", missing: [STATUS_TOOL, READ_TOOL] })).toMatch(/^Wright's tool list lacks 2 tools the kernel proposes\./);
  });
});

// ---- The block on the screen --------------------------------------------------------------------------------------

/** Render the real screen over a bridge whose `GET /settings` answers `body`, and wait for the first answer. */
async function mount(body: Record<string, unknown>): Promise<void> {
  const fake = fakeBridge();
  fake.route("GET /status", () => ok(STATUS));
  fake.route("GET /settings", () => ok(body));
  render(<SettingsScreen api={fake.bridge} registry={createCommandRegistry()} />);
  await screen.findByTestId(IDS.kernel);
}

const withTools = (wrightTools: unknown): Record<string, unknown> => (wrightTools === undefined ? settingsBody() : { ...settingsBody(), wright_tools: wrightTools });

describe("the Wright's tools block", () => {
  it("lists each missing tool in plain words: its purpose line and job label, or its name when the catalogue has none", async () => {
    await mount(withTools({ status: "owner", missing: [STATUS_TOOL, LESSON_TOOL, READ_TOOL] }));
    const block = screen.getByRole("region", { name: "Wright's tools" });
    expect(block.getAttribute("data-testid")).toBe(IDS.wrightTools);
    expect(within(block).getByTestId(IDS.wrightToolsStatus).textContent).toBe("Tool policy: owner");
    expect(within(block).getByTestId(IDS.wrightToolsSummary).textContent).toMatch(/^Wright's tool list lacks 3 tools the kernel proposes\./);
    expect(within(block).getByTestId(IDS.wrightToolsListHead).textContent).toBe(MISSING_TOOLS_HEADING);
    const items = within(block).getAllByTestId(IDS.wrightToolsItem);
    expect(items.map((li) => li.querySelector("b")?.textContent)).toEqual([STATUS_TOOL.purpose, LESSON_TOOL.purpose, "Read"]);
    expect(items.map((li) => li.textContent)).toEqual([
      `${STATUS_TOOL.purpose}${STATUS_TOOL.job} · ${STATUS_TOOL.name}`,
      `${LESSON_TOOL.purpose}${LESSON_TOOL.job} · ${LESSON_TOOL.name}`,
      "Read",
    ]);
    // The file to add them in, as plain text: never a link, never a Copy button.
    const file = within(block).getByTestId(IDS.wrightToolsFile);
    expect(file.textContent).toContain(WRIGHT_SETTINGS_FILE);
    expect(block.querySelectorAll("a, button")).toHaveLength(0);
  });

  it("sits between the Kernel section and This app", async () => {
    await mount(withTools({ status: "proposed", missing: [] }));
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-labelledby"));
    const at = regions.indexOf("settings-h-wright-tools");
    expect(regions[at - 1]).toBe("settings-h-kern");
    expect(regions[at + 1]).toBe("settings-h-app");
  });

  it("with nothing missing: the summary says so and no list (or its heading) renders", async () => {
    await mount(withTools({ status: "proposed", missing: [] }));
    const block = screen.getByTestId(IDS.wrightTools);
    expect(within(block).getByTestId(IDS.wrightToolsSummary).textContent).toBe("Wright's tool list has every tool the kernel proposes.");
    expect(within(block).getByTestId(IDS.wrightToolsStatus).textContent).toBe("Tool policy: proposed by the kernel");
    expect(within(block).queryByTestId(IDS.wrightToolsListHead)).toBeNull();
    expect(within(block).queryByTestId(IDS.wrightToolsList)).toBeNull();
    expect(within(block).queryByTestId(IDS.wrightToolsFile)).toBeNull();
    expect(screen.queryByText(MISSING_TOOLS_HEADING)).toBeNull();
  });

  it.each([
    ["absent (an older kernel)", undefined],
    ["null (no readable file)", null],
    ["malformed", { status: "owner", missing: "Read" }],
  ])("with wright_tools %s: no block and no list, and the rest of the screen still shows", async (_what, wrightTools) => {
    await mount(withTools(wrightTools));
    expect(screen.queryByTestId(IDS.wrightTools)).toBeNull();
    expect(screen.queryByTestId(IDS.wrightToolsList)).toBeNull();
    expect(screen.queryByText(MISSING_TOOLS_HEADING)).toBeNull();
    expect(screen.getByTestId(IDS.dataDir).textContent).toContain("/Users/owner/.loomwright-studio");
    await waitFor(() => expect(screen.getByRole("region", { name: "This app" })).toBeTruthy());
  });

  it("kernel text renders literally: markup stays text, control characters are written out", async () => {
    const markup = '<img src=x onerror="alert(1)">';
    await mount(withTools({ status: "owner", missing: [{ name: "kernel_x", job: "Job\u0007", purpose: markup }, { name: "a‮b", job: null, purpose: null }] }));
    const block = screen.getByTestId(IDS.wrightTools);
    expect(block.querySelector("img")).toBeNull();
    const lines = within(block)
      .getAllByTestId(IDS.wrightToolsItem)
      .map((li) => li.querySelector("b")?.textContent);
    expect(lines).toEqual([markup, "a\\u202eb"]);
    expect(block.textContent).toContain("Job\\x07");
  });
});

// ---- The audit log's sentences for the upgrade (AC8) ----------------------------------------------------------------

const refs: SentenceRefs = { taskId: null, sessionId: null, playbook: () => undefined, agent: (id) => id, time: (iso) => iso };
const FILE = "/Users/owner/.loomwright-studio/config/agents/wright.json";
const BACKUP = `${FILE}.bak-20261128T101500123Z-a1b2c3`;

describe("the upgrade's audit sentences", () => {
  it("wright_tool_policy_upgraded names how many tools were added, which, and that a backup was kept", () => {
    expect(auditSentence("wright_tool_policy_upgraded", { file: FILE, backup: BACKUP, added: ["kernel_studio_status", "kernel_lesson_propose"] }, refs)).toBe(
      "The kernel added 2 proposed tools to Wright's tool list: kernel_studio_status, kernel_lesson_propose. The list was one the kernel proposed and nobody changed; a backup of the old file was kept (wright.json.bak-20261128T101500123Z-a1b2c3).",
    );
    expect(auditSentence("wright_tool_policy_upgraded", { file: FILE, backup: BACKUP, added: ["kernel_studio_status"] }, refs)).toMatch(/^The kernel added 1 proposed tool to /);
    expect(auditSentence("wright_tool_policy_upgraded", {}, refs)).toBe(
      "The kernel added the proposed tools it lacked to Wright's tool list. The list was one the kernel proposed and nobody changed; a backup of the old file was kept.",
    );
  });

  it("wright_tool_policy_upgrade_failed names the step and code, and that the old file and list stay", () => {
    expect(auditSentence("wright_tool_policy_upgrade_failed", { file: FILE, step: "backup", code: "EACCES" }, refs)).toBe(
      "The kernel could not update Wright's tool list: writing the backup failed (EACCES). The file was left as it was, so Wright keeps its old list.",
    );
    expect(auditSentence("wright_tool_policy_upgrade_failed", { step: "size", code: "over_limit" }, refs)).toBe(
      "The kernel could not update Wright's tool list: the new file would pass the size limit (over_limit). The file was left as it was, so Wright keeps its old list.",
    );
    for (const [step, words] of [["write", "writing the new file failed"], ["rename", "replacing the file failed"], ["record", "recording the change failed"], ["fsync_dir", "the fsync dir step failed"], ["constructor", "the constructor step failed"]]) {
      expect(auditSentence("wright_tool_policy_upgrade_failed", { step }, refs)).toContain(`: ${words}.`);
    }
    expect(auditSentence("wright_tool_policy_upgrade_failed", {}, refs)).toBe("The kernel could not update Wright's tool list: a step failed. The file was left as it was, so Wright keeps its old list.");
  });
});
