// Draft mode and the GitHub CLI deny (phase 6, item 07): the pure decisions
// the session gate (`SessionManager.#gate`) asks after the never boundary and
// the dry-run branch, before the outward hold. No I/O: the gate writes the
// `draft_outputs` row (`integrations/drafts.ts` `recordDraftOutput`).
//
// The playbook's `mode` is the user's policy (invariant 1); this only enforces
// it. The deny is a fixed safety-kernel rule (invariant 3): no grant, policy
// or model output turns it off. A merge stays `merge_blocked` (the rail denies
// it first, invariant 4). The recorded payload is untrusted model output: it
// is stored as data and never interpreted.
import { bashCommandOf, programCouldBe, shellWords } from "./policy.js";
import type { ToolCallClass } from "./policy.js";
import type { ToolPolicy } from "./types.js";

/** The outward class the rail answered (`classifyToolCall`), the only input a draft decision takes. */
export type OutwardCall = Extract<ToolCallClass, { kind: "outward" }>;

/** Every text in a draft payload is cut to this many characters (`truncated: true` when anything was cut). */
export const MAX_DRAFT_TEXT_CHARS = 65536;

/** The closed kinds of a draft payload. */
export const DRAFT_PAYLOAD_KINDS = Object.freeze(["gh_pr_review", "gh_pr_comment", "command", "input"] as const);

export type DraftPayloadKind = (typeof DRAFT_PAYLOAD_KINDS)[number];

/** The review verdict flag a `gh pr review` carried. */
export type DraftReviewEvent = "approve" | "request_changes" | "comment";

/**
 * What a draft row stores as `payload_json`:
 * - `gh_pr_review` / `gh_pr_comment`: the `gh` command read into its parts
 *   (`target` the PR the command names, `body` the last `-b`/`--body` value,
 *   `body_file` a `-F`/`--body-file` value (recorded, never read), `event` the
 *   review verdict, for a review only);
 * - `command`: any other Bash call;
 * - `input`: any other tool's input as JSON text.
 */
export type DraftPayload =
  | {
      readonly kind: "gh_pr_review" | "gh_pr_comment";
      readonly tool: "Bash";
      readonly command: string;
      readonly cwd: string;
      readonly target: string | null;
      readonly body: string | null;
      readonly body_file?: string;
      readonly event?: DraftReviewEvent;
      readonly truncated: boolean;
    }
  | { readonly kind: "command"; readonly tool: "Bash"; readonly command: string; readonly cwd: string; readonly truncated: boolean }
  | { readonly kind: "input"; readonly tool: string; readonly input_json: string; readonly cwd: string; readonly truncated: boolean };

/** The gate's step 5 answer: `draft` (record `call`, deny it) or `none`. */
export type DraftDecision = { readonly kind: "none" } | { readonly kind: "draft"; readonly action: string; readonly call: OutwardCall };

/**
 * Whether an outward call is recorded as a draft instead of held: the session
 * runs for a draft-mode playbook (`ToolPolicy.mode`, filled by the manager
 * alone). Every outward kind counts, the always-held tools and the path labels
 * included. A session with no playbook has no `mode`, and `live` keeps the
 * hold and the grants. Pure.
 */
export function draftDecision(policy: ToolPolicy, rail: OutwardCall): DraftDecision {
  return policy.mode === "draft" ? { kind: "draft", action: rail.action, call: rail } : { kind: "none" };
}

/**
 * The gate's step 6 answer: the call is a Bash `gh` call in a session whose
 * agent holds the `github` grant. It only denies, so it never widens a policy.
 * The program is read as the rail reads it (`programCouldBe`): `env gh …`,
 * `sh -c …` and a script are not recognised. Pure.
 */
export function githubCliDecision(policy: ToolPolicy, toolName: string, toolInput: unknown): { readonly kind: "deny" } | undefined {
  if (!(policy.connectors ?? []).includes("github") || toolName !== "Bash") return undefined;
  const command = bashCommandOf(toolInput);
  return command !== undefined && programCouldBe(command, "gh") ? { kind: "deny" } : undefined;
}

/** The hook's reason for a `draft_mode` deny: nothing was sent, the call is draft output `id`, do not retry or ask. */
export function draftDenyReason(id: number): string {
  return (
    `draft_mode: this playbook runs in draft mode, so the kernel did not send this call; it saved it as draft output ${id} for the owner to read. ` +
    "Nothing was posted. Do not retry it and do not ask for an approval."
  );
}

/** The hook's reason for a `use_kernel_github_tools` deny. */
export const GITHUB_CLI_DENY_REASON =
  "use_kernel_github_tools: this agent reads GitHub through the kernel, so gh does not run in its sessions. " +
  "Use kernel_github_pr_get, kernel_github_pr_diff, kernel_github_pr_files and kernel_github_pr_comments instead.";

/** Tracks whether any text was cut to `MAX_DRAFT_TEXT_CHARS`. */
interface Cuts {
  truncated: boolean;
}

function bounded(text: string, cuts: Cuts): string {
  if (text.length <= MAX_DRAFT_TEXT_CHARS) return text;
  cuts.truncated = true;
  return text.slice(0, MAX_DRAFT_TEXT_CHARS);
}

/** The value flags of `gh pr review|comment` (short and long spellings) and what each is. */
const VALUE_FLAGS: ReadonlyMap<string, "body" | "body_file" | "repo"> = new Map([
  ["-b", "body"],
  ["--body", "body"],
  ["-F", "body_file"],
  ["--body-file", "body_file"],
  ["-R", "repo"],
  ["--repo", "repo"],
]);

/** The review verdict flags of `gh pr review`. */
const EVENT_FLAGS: ReadonlyMap<string, DraftReviewEvent> = new Map([
  ["-a", "approve"],
  ["--approve", "approve"],
  ["-r", "request_changes"],
  ["--request-changes", "request_changes"],
  ["-c", "comment"],
  ["--comment", "comment"],
]);

interface GhPrParts {
  target: string | null;
  body: string | null;
  bodyFile: string | undefined;
  event: DraftReviewEvent | undefined;
}

/**
 * `gh [flags] pr <sub> [args]` read into its parts (best effort: a command the
 * words do not spell that way reads as no parts). `-R`/`--repo` takes a value
 * before the subcommand too; any other flag before it is taken as a boolean.
 */
function ghPrParts(command: string, sub: "review" | "comment"): GhPrParts {
  const parts: GhPrParts = { target: null, body: null, bodyFile: undefined, event: undefined };
  const words = shellWords(command);
  const start = words.findIndex((w) => w !== "");
  let stage = 0;
  let j = start + 1;
  for (; start !== -1 && j < words.length && stage < 2; j++) {
    const w = words[j] as string;
    if (w === "") continue;
    if (w.startsWith("-")) {
      if (w === "-R" || w === "--repo") j++;
      continue;
    }
    if (w.toLowerCase() !== (stage === 0 ? "pr" : sub)) return parts;
    stage++;
  }
  if (stage < 2) return parts;
  for (; j < words.length; j++) {
    const w = words[j] as string;
    let flag: string | undefined;
    let glued: string | undefined;
    if (w.startsWith("--")) {
      const eq = w.indexOf("=");
      flag = eq === -1 ? w : w.slice(0, eq);
      glued = eq === -1 ? undefined : w.slice(eq + 1);
    } else if (w.length > 1 && w.startsWith("-")) {
      flag = w.slice(0, 2);
      const rest = w.slice(2);
      glued = rest === "" ? undefined : rest.replace(/^=/, "");
    } else {
      parts.target ??= w;
      continue;
    }
    const name = VALUE_FLAGS.get(flag);
    if (name !== undefined) {
      const value = glued ?? words[++j] ?? null;
      if (name === "body") parts.body = value;
      else if (name === "body_file" && value !== null) parts.bodyFile = value;
    } else if (sub === "review" && glued === undefined && EVENT_FLAGS.has(flag)) {
      parts.event = EVENT_FLAGS.get(flag);
    }
  }
  return parts;
}

/**
 * The bounded payload a draft row stores (see `DraftPayload`). Pure; `toolInput`
 * is untrusted data: it is only read, never executed, and the result is never
 * interpreted. Every text is cut to `MAX_DRAFT_TEXT_CHARS`.
 */
export function draftPayloadOf(toolName: string, toolInput: unknown, rail: OutwardCall): DraftPayload {
  const cuts: Cuts = { truncated: false };
  const cwd = bounded(rail.payload.cwd, cuts);
  const command = toolName === "Bash" ? bashCommandOf(toolInput) : undefined;
  if (command === undefined) {
    return { kind: "input", tool: toolName, input_json: bounded(JSON.stringify(toolInput) ?? "null", cuts), cwd, truncated: cuts.truncated };
  }
  const sub = rail.action === "gh pr review" ? "review" : rail.action === "gh pr comment" ? "comment" : undefined;
  if (sub === undefined) return { kind: "command", tool: "Bash", command: bounded(command, cuts), cwd, truncated: cuts.truncated };
  const parts = ghPrParts(command, sub);
  const text = (value: string | null): string | null => (value === null ? null : bounded(value, cuts));
  const body = text(parts.body);
  const target = text(parts.target);
  const bodyFile = parts.bodyFile === undefined ? undefined : bounded(parts.bodyFile, cuts);
  const boundedCommand = bounded(command, cuts);
  return {
    kind: sub === "review" ? "gh_pr_review" : "gh_pr_comment",
    tool: "Bash",
    command: boundedCommand,
    cwd,
    target,
    body,
    ...(bodyFile === undefined ? {} : { body_file: bodyFile }),
    ...(parts.event === undefined ? {} : { event: parts.event }),
    truncated: cuts.truncated,
  };
}
