// Settings → "Wright's tools" (wa-c): the parse and the plain words for `GET /settings`' `wright_tools`. Plain
// TypeScript: no React, no DOM, and no import that reaches a `.tsx` file, so `./model.ts` (which the e2e project imports
// for `SETTINGS_TEST_IDS`) can spread `WRIGHT_TOOLS_TEST_IDS` into its ids.
//
// The kernel reads Wright's `config/agents/wright.json` raw and names the tools of its current proposal that the file's
// list lacks, each with its catalogue job label and purpose line (`kernel/src/gui/settings.ts`). The kernel rewrites
// that list itself only while it is still, as a set, one the kernel once proposed (`tool_policy.status` `proposed`);
// a list the owner changed is never written, so the block names what it lacks and the file to add it in. Studio
// changes nothing here (mechanism only, invariant 1).
//
// Every string the kernel sent is untrusted data (invariant 3): it passes through `printable`, nothing here builds
// markup, and the screen renders each value as a React text child. A `wright_tools` that is not the contract's shape
// reads as `null` (no block), never as a failed reply: the rest of the screen still shows.
import { printable } from "../approvals/printable";
import { countText } from "../../components/format";

/** The block's test ids, spread into `SETTINGS_TEST_IDS`. */
export const WRIGHT_TOOLS_TEST_IDS = {
  wrightTools: "settings-wright-tools",
  wrightToolsStatus: "settings-wright-tools-status",
  wrightToolsSummary: "settings-wright-tools-summary",
  wrightToolsListHead: "settings-wright-tools-list-head",
  wrightToolsList: "settings-wright-tools-list",
  wrightToolsItem: "settings-wright-tools-item",
  wrightToolsFile: "settings-wright-tools-file",
} as const;

/** Wright's settings file, relative to the kernel's data folder (`wrightSettingsPath` in the kernel). */
export const WRIGHT_SETTINGS_FILE = "config/agents/wright.json";

/** One proposed tool Wright's list lacks, every string inert. `job` and `purpose` are `null` when the catalogue does not list it. */
export interface MissingToolView {
  readonly name: string;
  readonly job: string | null;
  readonly purpose: string | null;
}

/** What the screen holds of `wright_tools`: the file's `tool_policy.status` (`null` when unset) and the tools its list lacks. */
export interface WrightToolsView {
  readonly status: string | null;
  readonly missing: readonly MissingToolView[];
}

/** Whether `value` is a plain JSON object (not null, not an array). Re-exported by `./model.ts`, its home before wa-c. */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A string field as inert text, `null` for anything else. */
const textOrNull = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? printable(value) : null);

/**
 * The view of `wright_tools`, built field by field. `null` when it is absent (an older kernel), `null` (no readable
 * file), or not the contract's shape (not an object, a `status` that is neither a string nor null, a `missing` that
 * is not a list). An entry with no string `name` is left out. Pure; never throws.
 */
export function wrightToolsOf(raw: unknown): WrightToolsView | null {
  if (!isRecord(raw) || !Array.isArray(raw.missing)) return null;
  if (raw.status !== null && typeof raw.status !== "string") return null;
  const missing: MissingToolView[] = [];
  for (const entry of raw.missing as unknown[]) {
    if (!isRecord(entry) || typeof entry.name !== "string" || entry.name.trim() === "") continue;
    missing.push({ name: printable(entry.name), job: textOrNull(entry.job), purpose: textOrNull(entry.purpose) });
  }
  // A blank status says no more than an unset one, so it reads "not set" rather than an empty "Tool policy: ".
  return { status: textOrNull(raw.status), missing };
}

/** One missing tool's line: what it does in plain words, its job, and its name when the line is not already the name. */
export interface MissingToolWords {
  /** The purpose line, or the tool name when the catalogue has no entry for it. */
  readonly line: string;
  /** The job label, or `undefined` when none. */
  readonly job: string | undefined;
  /** The name to add to the list, when `line` is the purpose; `undefined` when `line` is the name itself. */
  readonly name: string | undefined;
}

export function missingToolWords(tool: MissingToolView): MissingToolWords {
  if (tool.purpose === null) return { line: tool.name, job: tool.job ?? undefined, name: undefined };
  return { line: tool.purpose, job: tool.job ?? undefined, name: tool.name };
}

/** The status line: how the file's tool policy is set. */
export function toolPolicyStatusText(status: string | null): string {
  if (status === null) return "Tool policy: not set";
  if (status === "proposed") return "Tool policy: proposed by the kernel";
  return `Tool policy: ${status}`;
}

/** The sentence above the list (or in its place when the list is empty). */
export function wrightToolsSummary(view: WrightToolsView): string {
  const n = view.missing.length;
  if (n === 0) return "Wright's tool list has every tool the kernel proposes.";
  return `Wright's tool list lacks ${countText(n)} ${n === 1 ? "tool" : "tools"} the kernel proposes. The kernel updates the list itself only while it is still one the kernel proposed and nobody changed.`;
}

/** The list's heading, drawn only when the list has an entry. */
export const MISSING_TOOLS_HEADING = "Proposed tools Wright's list lacks";
