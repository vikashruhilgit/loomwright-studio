// Phase 8 item 25a: every command, script call, Claude tool and slash command the installed Loomwright tells a
// kernel run session to use is either admitted by that kind's real run policy or recorded, with its reason, in
// `RUN_EXCLUSIONS` (`src/automate/run-exclusions.ts`). Anything else fails, naming the command, the kind, the deny
// reason and the source `file:line`.
//
// Three modes, one extraction path (`test/fixtures/loomwright-instructions/extract.ts`):
//   - default (CI, plain `npm test`): the committed fixture `test/fixtures/loomwright-<version>-instructions.json`,
//     extracted from the install; no test reads the real `installed_plugins.json` (the repo convention);
//   - `STUDIO_LIVE=1`: the install `resolveLoomwrightInstall()` returns, read live;
//   - `LOOMWRIGHT_FIXTURE_UPDATE=1` (`scripts/refresh-loomwright-fixture.sh`): the live install, and the fixture is
//     rewritten from it (named for its version; any other version's fixture is removed), then checked.
//
// Script admission is the real one: `loomwrightScriptPaths(<root>, policy.loomwrightScripts)`, where `<root>` is the
// install, or (fixture mode) a temp dir holding an empty `scripts/<name>` for every script the fixture lists.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUTOMATE_RUN_POLICY,
  MERGE_PARKED_RUN_POLICY,
  MERGE_PARKED_TRUSTED_RUN_POLICY,
  REVIEW_PR_RUN_POLICY,
} from "../src/automate/launch.js";
import {
  EXCLUSION_REASON_CLASSES,
  FACT_REASON_CLASSES,
  PAST_THE_RAIL,
  RUN_EXCLUSIONS,
  RUN_SESSION_KINDS,
  RUN_TOOL_DENIALS_OBSERVED,
} from "../src/automate/run-exclusions.js";
import type { RunExclusion, RunSessionKind } from "../src/automate/run-exclusions.js";
import { resolveLoomwrightInstall } from "../src/loomwright/active-install.js";
import { loomwrightScriptPaths } from "../src/sessions/loomwright-scripts.js";
import { decideToolUse } from "../src/sessions/policy.js";
import type { ToolPolicy } from "../src/sessions/types.js";
import {
  bashCommandFor,
  extractFile,
  extractMarkdown,
  fileDigest,
  fillPlaceholders,
  listScripts,
  SAMPLE_RUN_ID,
  scriptFacts,
  scriptOfWord,
  sortEntries,
  splitWords,
} from "./fixtures/loomwright-instructions/extract.js";
import type { RawEntry, ScriptFacts } from "./fixtures/loomwright-instructions/extract.js";

// The sampler's own rule for a word it must not copy verbatim into a sample command: any shell
// metacharacter. Kept here, not imported from the rail, so the rail can change how it reads a
// command (25b) without changing which words this test samples.
const SAMPLE_METACHARACTERS = /[;&|<>()$`\n\r]/;

const UPDATE = process.env.LOOMWRIGHT_FIXTURE_UPDATE === "1";
const LIVE = process.env.STUDIO_LIVE === "1" || UPDATE;
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FIXTURE_NAME = /^loomwright-(.+)-instructions\.json$/;

/** One file of a kind's instruction set, with why it is in the set. */
interface SetFile {
  readonly file: string;
  readonly why: string;
}

const AL = "skills/automate-loop";

/** What `/automate` itself reads: the command, its loop skill and its driver. `merge_parked` reads a subset. */
const AUTOMATE_ENGINE: readonly SetFile[] = [
  { file: "commands/automate.md", why: "the command a ticket, resume or merge run starts with" },
  { file: `${AL}/SKILL.md`, why: "the authoritative loop contract the command defers to" },
  { file: `${AL}/helpers.md`, why: "the helper catalog the loop calls by name" },
  { file: `${AL}/invariants.md`, why: "the loop's invariants (merge only through gate-eval)" },
  { file: `${AL}/modes-and-merge-gate.md`, why: "safe mode and the merge gate a merge run takes" },
  { file: `${AL}/resume.md`, why: "--resume and --merge-parked (\"Merging one parked item\")" },
  { file: `${AL}/run-file.md`, why: "the run file the driver and session keep" },
  { file: "scripts/automate-next-step.sh", why: "the /automate driver: its printed invocation / launch / push / then text" },
];

/** The ticket run (`backlog`) and `resume`: `/automate --inline-phases`, so `/autonomous`, Launch Pad, the Supervisor and the owned `/review-pr` drain run in the session. */
const AUTOMATE_FILES: readonly SetFile[] = [
  ...AUTOMATE_ENGINE,
  { file: `${AL}/branch-mode.md`, why: "branch-mode steps the start reads when the repo uses it" },
  { file: `${AL}/intake.md`, why: "a new run's intake (the backlog doc becomes the Queue)" },
  { file: `${AL}/per-item-loop.md`, why: "the per-item PICK / RUN / DRAIN / GATE loop" },
  { file: "commands/autonomous.md", why: "--inline-phases runs /autonomous --single-iteration inline" },
  { file: "skills/autonomous-loop/SKILL.md", why: "/autonomous's loop (single-iteration only)" },
  { file: "commands/launch-pad.md", why: "Launch Pad runs inline under /autonomous" },
  { file: "agents/launch-pad.md", why: "the Launch Pad contract (LP-SCOPE, LP-SAVE gates)" },
  { file: "scripts/launch-pad-phase.sh", why: "Launch Pad's phase-marker driver" },
  { file: "commands/supervisor.md", why: "the Supervisor runs inline under /autonomous" },
  { file: "agents/supervisor.md", why: "the Supervisor contract" },
  { file: "scripts/supervisor-next-step.sh", why: "the Supervisor driver: its printed invocation / then text" },
  { file: "agents/execute-manager.md", why: "the Supervisor's Execute Manager (spawned with Task)" },
  { file: "agents/worker.md", why: "the implementation worker (spawned with Task)" },
  { file: "agents/context-keeper.md", why: "the Supervisor's Context-Keeper (spawned with Task)" },
  { file: "agents/code-reviewer.md", why: "the Phase 4.5 / drain code reviewer (spawned with Task)" },
  { file: "agents/plan-reviewer.md", why: "Launch Pad's plan reviewer (spawned with Task)" },
  { file: "agents/orchestrator.md", why: "the async orchestrator the Supervisor may spawn" },
  { file: "agents/rubric-grader.md", why: "the outcomes-rubric grader" },
  { file: "skills/async-orchestration/SKILL.md", why: "the Supervisor's parallel path" },
  { file: "skills/async-orchestration/finalize.md", why: "FINALIZE (merge subtask branches, publish)" },
  { file: "skills/supervisor-readiness/SKILL.md", why: "Launch Pad / Supervisor readiness checks" },
  { file: "skills/supervisor-readiness/design-decisions.md", why: "the brief's design-decision block" },
  { file: "skills/state-management/SKILL.md", why: ".supervisor/ state the Supervisor keeps" },
  { file: "skills/workflow-management/SKILL.md", why: "branch / PR workflow the Supervisor follows" },
  { file: "skills/supervisor-config/SKILL.md", why: "the Supervisor's config reads" },
  { file: "skills/preflight-sync/SKILL.md", why: "supervisor-next-step.sh's preflight invocation reads it" },
  { file: "skills/commit/SKILL.md", why: "how the worker and Supervisor commit" },
  { file: "skills/self-heal-advisory/SKILL.md", why: "Phase 4.5 (self-heal advisory)" },
  { file: "skills/self-heal-advisory/completion-tail.md", why: "Phase 4.5's completion tail" },
  { file: "skills/self-heal-advisory/escalation.md", why: "Phase 4.5's escalation" },
  { file: "skills/self-heal-advisory/multi-voter.md", why: "Phase 4.5's multi-voter review" },
  { file: "skills/self-heal-advisory/on-entry.md", why: "Phase 4.5's on-entry steps" },
  { file: "commands/review-pr.md", why: "the owned drain runs /review-pr inline" },
  { file: "skills/review-heal/SKILL.md", why: "the drain's review-heal loop" },
  { file: "skills/review-heal/dispatch.md", why: "the drain's review dispatch" },
  { file: "skills/review-heal/escalation.md", why: "the drain's escalation" },
  { file: "skills/review-heal/fallback-review.md", why: "the drain's earned fallback review" },
  { file: "scripts/review-heal-next-step.sh", why: "the review-heal driver: its printed push / then text" },
];

/** `review_pr`: `/loomwright:review-pr <url>`, the triage fix (heals, never merges). */
const REVIEW_PR_FILES: readonly SetFile[] = [
  { file: "commands/review-pr.md", why: "the command the run starts with" },
  { file: "skills/review-heal/SKILL.md", why: "the review-heal loop /review-pr runs" },
  { file: "skills/review-heal/dispatch.md", why: "the review dispatch" },
  { file: "skills/review-heal/escalation.md", why: "the escalation" },
  { file: "skills/review-heal/fallback-review.md", why: "the earned fallback review" },
  { file: "scripts/review-heal-next-step.sh", why: "the review-heal driver" },
  { file: "agents/code-reviewer.md", why: "the fallback review's agent (loomwright:code-reviewer)" },
];

/** `merge_parked`, plain and trusted: `/loomwright:automate --merge-parked <run_id>`, one parked item through the gate. */
const MERGE_PARKED_FILES: readonly SetFile[] = AUTOMATE_ENGINE;

/**
 * Each kind's closed instruction file set. Left out on purpose (a transitive reference closure pulls about 75
 * files, about 2 MB, including `commands/setup.md` and `commands/dreaming.md`): `skills/automate-loop/lanes.md` and
 * `command-lanes.md` (`--parallel` only; safe mode takes no lane), `skills/autonomous-loop/multi-iteration.md`
 * (never read under `--single-iteration`), and `agents/review-pr.md` (the standalone `claude --agent` runner).
 */
const FILE_SETS: Readonly<Record<RunSessionKind, readonly SetFile[]>> = {
  backlog: AUTOMATE_FILES,
  resume: AUTOMATE_FILES,
  review_pr: REVIEW_PR_FILES,
  merge_parked: MERGE_PARKED_FILES,
  merge_parked_trusted: MERGE_PARKED_FILES,
};

/**
 * Tool names as Loomwright writes them → the name the session's tool call carries. Loomwright 18.1.2 says `Task(`
 * for a subagent; the Agent SDK's tool is `Agent` (`@anthropic-ai/claude-agent-sdk` 0.3.284 `sdk.d.ts:36`,
 * "a custom subagent that can be invoked via the Agent tool"), which `RUN_TOOLS` grants. An unmapped name is
 * decided as written.
 */
const TOOL_ALIASES: Readonly<Record<string, string>> = { Task: "Agent" };

/** Each kind's run policy, as `launch.ts` builds it (a merge run is pinned to its run id). */
const POLICIES: Readonly<Record<RunSessionKind, ToolPolicy>> = {
  backlog: AUTOMATE_RUN_POLICY,
  resume: AUTOMATE_RUN_POLICY,
  review_pr: REVIEW_PR_RUN_POLICY,
  merge_parked: { ...MERGE_PARKED_RUN_POLICY, loomwrightRunId: SAMPLE_RUN_ID },
  merge_parked_trusted: { ...MERGE_PARKED_TRUSTED_RUN_POLICY, loomwrightRunId: SAMPLE_RUN_ID },
};

/** An extracted entry with the kinds whose file set holds its file. */
interface Entry extends RawEntry {
  readonly kinds: readonly RunSessionKind[];
}

/** Everything the checks read: from the fixture, or from the install. */
interface Source {
  readonly version: string;
  readonly file_sets: Readonly<Record<string, readonly string[]>>;
  readonly files: Readonly<Record<string, { lines: number; sha256: string }>>;
  readonly scripts: readonly string[];
  readonly script_facts: Readonly<Record<string, ScriptFacts>>;
  readonly lines: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly entries: readonly Entry[];
}

function unionFiles(): string[] {
  return [...new Set(Object.values(FILE_SETS).flatMap((s) => s.map((f) => f.file)))].sort();
}

function setNames(): Record<string, string[]> {
  return Object.fromEntries(RUN_SESSION_KINDS.map((k) => [k, FILE_SETS[k].map((f) => f.file)]));
}

function kindsOf(file: string): RunSessionKind[] {
  return RUN_SESSION_KINDS.filter((k) => FILE_SETS[k].some((f) => f.file === file));
}

/** Read everything from an install. A file of a set that is missing is left out of `files` (the set check fails on it). */
function sourceFromInstall(root: string, version: string): Source {
  const scripts = listScripts(root);
  const known = new Set(scripts);
  const files: Record<string, { lines: number; sha256: string }> = {};
  const raw: RawEntry[] = [];
  for (const f of unionFiles()) {
    if (!existsSync(join(root, f))) continue;
    files[f] = fileDigest(root, f);
    raw.push(...extractFile(root, f, known));
  }
  const script_facts: Record<string, ScriptFacts> = {};
  for (const s of scripts) script_facts[s] = scriptFacts(root, s, known);
  const lines: Record<string, Record<string, string>> = {};
  for (const row of PAST_THE_RAIL) {
    const all = existsSync(join(root, row.script)) ? readFileSync(join(root, row.script), "utf8").split("\n") : [];
    const kept = (lines[row.script] ??= {});
    for (let n = Math.max(1, row.line - 2); n <= Math.min(all.length, row.line + 2); n += 1) kept[String(n)] = all[n - 1] as string;
  }
  const entries = sortEntries(raw).map((e) => ({ ...e, kinds: kindsOf(e.file) }));
  return { version, file_sets: setNames(), files, scripts, script_facts, lines, entries };
}

/** The fixture as text: top-level keys pretty, one entry and one script's facts per line, so a diff reads per entry. */
function fixtureText(src: Source): string {
  const obj = (o: Readonly<Record<string, unknown>>, indent: string): string =>
    `{\n${Object.keys(o).sort().map((k) => `${indent}  ${JSON.stringify(k)}: ${JSON.stringify(o[k])}`).join(",\n")}\n${indent}}`;
  const lines = Object.keys(src.lines).sort().map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(src.lines[k])}`).join(",\n");
  return [
    "{",
    `  "version": ${JSON.stringify(src.version)},`,
    `  "generated_by": "bash scripts/refresh-loomwright-fixture.sh (LOOMWRIGHT_FIXTURE_UPDATE=1 vitest run test/loomwright-conformance.test.ts)",`,
    `  "file_sets": ${obj(src.file_sets, "  ")},`,
    `  "files": ${obj(src.files, "  ")},`,
    `  "scripts": ${JSON.stringify(src.scripts)},`,
    `  "script_facts": ${obj(src.script_facts, "  ")},`,
    `  "lines": {\n${lines}\n  },`,
    `  "entries": [\n${src.entries.map((e) => `    ${JSON.stringify({ file: e.file, line: e.line, type: e.type, source: e.source, text: e.text, kinds: e.kinds })}`).join(",\n")}\n  ]`,
    "}",
    "",
  ].join("\n");
}

/** The one committed fixture (more than one, or none, is an error). */
function fixturePath(): string {
  const found = readdirSync(FIXTURES).filter((f) => FIXTURE_NAME.test(f));
  if (found.length !== 1) throw new Error(`expected exactly one ${FIXTURE_NAME} fixture in ${FIXTURES}, found ${found.length}: run scripts/refresh-loomwright-fixture.sh`);
  return join(FIXTURES, found[0] as string);
}

/** `policy` (by default `kind`'s run policy), with its scripts admitted under `root` exactly as the session manager admits them. */
function admittedPolicy(kind: RunSessionKind, root: string, policy: ToolPolicy = POLICIES[kind]): ToolPolicy {
  const admitted = loomwrightScriptPaths(root, policy.loomwrightScripts);
  if (!admitted.ok) throw new Error(`${kind}: ${admitted.message}`);
  return { ...policy, admittedScriptPaths: admitted.paths };
}

/** How `policy` decides `entry`; an `unparsed` entry is always denied `unparsed`. */
function decide(entry: RawEntry, policy: ToolPolicy, root: string, scripts: ReadonlySet<string>): { decision: "allow" | "deny"; reason: string } {
  switch (entry.type) {
    case "tool": {
      const name = TOOL_ALIASES[entry.text] ?? entry.text;
      // The `Bash` name alone is no call: its commands are decided as Bash entries; the name is checked against the grant.
      if (name === "Bash") return policy.allowedTools.includes("Bash") ? { decision: "allow", reason: "tool_allowed" } : { decision: "deny", reason: "tool_not_allowed" };
      return decideToolUse(policy, name, {});
    }
    case "slash":
      return decideToolUse(policy, "Skill", {});
    case "unparsed":
      return { decision: "deny", reason: "unparsed" };
    default:
      return decideToolUse(policy, "Bash", { command: bashCommandFor(entry.text, root, scripts) });
  }
}

/** The Loomwright script an entry calls (its first script word), if any. */
function calledScript(entry: RawEntry, scripts: ReadonlySet<string>): string | undefined {
  for (const w of entry.text.split(/\s+/)) {
    const s = scriptOfWord(w, scripts);
    if (s !== undefined) return s;
  }
  return undefined;
}

function rowMatches(row: RunExclusion, entry: RawEntry, kind: RunSessionKind, reason: string, scripts: ReadonlySet<string>): boolean {
  const m = row.match;
  if (!row.kinds.includes(kind) || m.type !== entry.type) return false;
  if (m.scripts !== undefined && !m.scripts.includes(calledScript(entry, scripts) ?? "")) return false;
  if (m.tools !== undefined && !m.tools.includes(entry.text)) return false;
  if (m.deny !== undefined && !(m.deny as readonly string[]).includes(reason)) return false;
  if (m.files !== undefined && !m.files.includes(entry.file)) return false;
  if (m.text !== undefined && !new RegExp(m.text).test(entry.text)) return false;
  return true;
}

/** The index of the `)` closing a `$(` whose body starts at `from` (quotes and nesting respected), or -1. */
function closeParen(text: string, from: number): number {
  let depth = 1;
  let quote: string | undefined;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quote !== undefined) {
      if (c === "\\" && quote === '"') i += 1;
      else if (c === quote) quote = undefined;
    } else if (c === "\\") i += 1;
    else if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth += 1;
    else if (c === ")" && (depth -= 1) === 0) return i;
  }
  return -1;
}

/**
 * The simple commands a composed shell text runs: its top-level parts split on `&&`, `||`, `;`, `&`, a newline and a
 * pipe (a `|` with whitespace on a side; `a|b` with none is a synopsis's alternation and stays in its word), plus each
 * `$(…)` body, recursively. A heredoc body is skipped. Honest limit: backtick substitution and `( … )` subshells are
 * not entered; their words hold a metacharacter, so `literalCommand` replaces them with a sample value.
 */
function shellParts(text: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote: string | undefined;
  let heredoc: string | undefined;
  const flush = (): void => {
    if (cur.trim() !== "") parts.push(cur.trim());
    cur = "";
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quote === "'") {
      cur += c;
      if (c === "'") quote = undefined;
      continue;
    }
    if (c === "\\") {
      cur += text.slice(i, i + 2);
      i += 1;
      continue;
    }
    if (c === "$" && text[i + 1] === "(") {
      const end = closeParen(text, i + 2);
      if (end === -1) {
        cur += text.slice(i);
        break;
      }
      parts.push(...shellParts(text.slice(i + 2, end)));
      cur += text.slice(i, end + 1);
      i = end;
      continue;
    }
    if (quote === '"') {
      cur += c;
      if (c === '"') quote = undefined;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "<" && text[i + 1] === "<" && text[i + 2] !== "<") {
      const m = /^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(text.slice(i));
      if (m !== null) heredoc = m[2];
      cur += c;
      continue;
    }
    if (c === "\n") {
      flush();
      if (heredoc !== undefined) {
        const lines = text.slice(i + 1).split("\n");
        const end = lines.findIndex((l) => l.trim() === heredoc);
        if (end === -1) break;
        i += lines.slice(0, end + 1).reduce((n, l) => n + l.length + 1, 0);
        heredoc = undefined;
      }
      continue;
    }
    const prev = text[i - 1] ?? " ";
    const next = text[i + 1] ?? " ";
    if ((c === "&" && next === "&") || (c === "|" && next === "|")) {
      flush();
      i += 1;
      continue;
    }
    if (c === ";" || (c === "&" && prev !== ">" && prev !== "<" && next !== ">")) {
      flush();
      continue;
    }
    if (c === "|" && (/\s/.test(prev) || /\s/.test(next))) {
      flush();
      continue;
    }
    cur += c;
  }
  flush();
  return parts;
}

/** Shell keywords that open a part (`if ! x`, `then x`), stripped before the program word. */
const SHELL_KEYWORDS: ReadonlySet<string> = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "time", "{"]);

/**
 * A part as the session issues it after a denial for a metacharacter: leading shell keywords and `VAR=value`
 * assignments dropped, each redirection dropped (the session writes a file with Write), and every other word that
 * holds a metacharacter replaced by `sample` (the literal value the session fills in). A word naming a Loomwright
 * script is kept (`bashCommandFor` resolves it). Undefined for a part with no program word (`fi`, `done`, an
 * assignment alone, a lone `)`).
 */
function literalCommand(part: string, scripts: ReadonlySet<string>): string | undefined {
  let flat = "";
  for (let i = 0; i < part.length; i += 1) {
    const end = part[i] === "$" && part[i + 1] === "(" ? closeParen(part, i + 2) : -1;
    if (end === -1) {
      flat += part[i] as string;
      continue;
    }
    // A substitution is one word: the script it names (`$(ns_sq "$HERE/x.sh")`), else its sample value.
    const named = (splitWords(part.slice(i + 2, end)) ?? []).map((w) => scriptOfWord(w.word, scripts)).find((s) => s !== undefined);
    flat += named ?? "sample";
    i = end;
  }
  const words = splitWords(flat)?.map((w) => w.word);
  if (words === undefined) return undefined;
  let k = 0;
  while (k < words.length && (SHELL_KEYWORDS.has(words[k] as string) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k] as string))) k += 1;
  // No program word: a closing keyword, a synopsis's `| --alt` alternative, or an elided `…` tail.
  if (k >= words.length || /^(fi|done|esac|\}|\)|;;|…|\.\.\.)$|^-/.test(words[k] as string)) return undefined;
  const out: string[] = [];
  for (let i = k; i < words.length; i += 1) {
    const w = words[i] as string;
    if (/^\d?(>>?|<|&>)$/.test(w)) {
      i += 1;
      continue;
    }
    if (/^\d?(>>?|<|&>)\S/.test(w)) continue;
    if (scriptOfWord(w, scripts) !== undefined || !SAMPLE_METACHARACTERS.test(w)) out.push(w);
    // A synopsis's `a|b|c` alternation: its first alternative, the form the session issues.
    else if (/^[A-Za-z0-9_.:=-]+(\|[A-Za-z0-9_.:=-]+)+$/.test(w)) out.push(w.split("|")[0] as string);
    else out.push("sample");
  }
  return out.length === 0 ? undefined : out.join(" ");
}

/**
 * One conformance failure per denied (entry, kind) with no row, or with more than one; `used` collects the rows that
 * matched. An entry denied for a shell metacharacter is decided a second time, part by part (`shellParts`, each as
 * `literalCommand` writes it): the retry the session makes with the literal value. Each denied part must match exactly
 * one row too (as an entry of its own, at the same file:line), so a composition row can never hide a program or script
 * the kind's policy does not admit.
 */
/**
 * Options for `conformanceFailures`: `policies` replaces a kind's run policy (a test de-admitting one script, prefix
 * or tool); `allowed.n` counts the admitted decisions, entries and parts alike.
 */
interface ConformanceOptions {
  readonly policies?: Partial<Record<RunSessionKind, ToolPolicy>>;
  readonly allowed?: { n: number };
}

function conformanceFailures(
  entries: readonly Entry[],
  root: string,
  scripts: ReadonlySet<string>,
  rows: readonly RunExclusion[],
  used?: Set<string>,
  opts: ConformanceOptions = {},
): string[] {
  const failures: string[] = [];
  const policies = new Map<RunSessionKind, ToolPolicy>();
  const check = (e: RawEntry, kind: RunSessionKind, reason: string, label: string): void => {
    const hits = rows.filter((r) => rowMatches(r, e, kind, reason, scripts));
    for (const h of hits) used?.add(h.id);
    if (hits.length === 1) return;
    const what = `${kind}: ${label}\`${e.text.replace(/\n/g, "\\n")}\` (${e.type}) denied ${reason} at ${e.file}:${e.line}`;
    failures.push(hits.length === 0 ? `${what}: no exclusion row` : `${what}: matches ${hits.length} rows (${hits.map((h) => h.id).join(", ")})`);
  };
  for (const e of entries) {
    for (const kind of e.kinds) {
      const policy = policies.get(kind) ?? admittedPolicy(kind, root, opts.policies?.[kind]);
      policies.set(kind, policy);
      const d = decide(e, policy, root, scripts);
      if (d.decision === "allow") {
        if (opts.allowed !== undefined) opts.allowed.n += 1;
        continue;
      }
      check(e, kind, d.reason, "");
      if (d.reason !== "bash_shell_metacharacter" || (e.type !== "command" && e.type !== "script")) continue;
      const seen = new Set<string>();
      for (const part of shellParts(fillPlaceholders(e.text))) {
        const text = literalCommand(part, scripts);
        if (text === undefined || seen.has(text)) continue;
        seen.add(text);
        const p: RawEntry = { ...e, type: calledScript({ ...e, text }, scripts) === undefined ? "command" : "script", text };
        const pd = decide(p, policy, root, scripts);
        if (pd.decision === "allow" && opts.allowed !== undefined) opts.allowed.n += 1;
        if (pd.decision === "deny") check(p, kind, pd.reason, `part of \`${e.text.replace(/\n/g, "\\n")}\`: `);
      }
    }
  }
  return failures;
}

/** Whether a fact-class row's fact holds for its script (directly, or through `fact_via`, which the script must name). */
function factHolds(row: RunExclusion, facts: Readonly<Record<string, ScriptFacts>>): boolean {
  const script = row.match.scripts?.[0] as string;
  const key = row.reason_class === "starts a claude process" ? "claude" : "eval_or_bash_c";
  const own = facts[script];
  if (own === undefined) return false;
  if (row.fact_via === undefined) return own[key] !== null;
  const via = facts[row.fact_via];
  return own.calls.includes(row.fact_via) && via !== undefined && via[key] !== null;
}

let src: Source;
let root: string;
let scratch: string | undefined;

beforeAll(() => {
  if (LIVE) {
    const install = resolveLoomwrightInstall();
    root = install.installPath;
    src = sourceFromInstall(root, install.contract.plugin_version);
    if (UPDATE) {
      for (const f of readdirSync(FIXTURES).filter((x) => FIXTURE_NAME.test(x))) rmSync(join(FIXTURES, f));
      writeFileSync(join(FIXTURES, `loomwright-${src.version}-instructions.json`), fixtureText(src));
    }
    return;
  }
  src = JSON.parse(readFileSync(fixturePath(), "utf8")) as Source;
  scratch = mkdtempSync(join(tmpdir(), "loomwright-conformance-"));
  mkdirSync(join(scratch, "scripts"));
  for (const s of src.scripts) writeFileSync(join(scratch, "scripts", s), "");
  root = scratch;
});

afterAll(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
});

describe(`Loomwright instruction conformance (${UPDATE ? "fixture update" : LIVE ? "live install, STUDIO_LIVE=1" : "committed fixture"})`, () => {
  it("each kind's instruction file set is closed, and every listed file exists in the source", () => {
    const missing: string[] = [];
    for (const kind of RUN_SESSION_KINDS) {
      const files = FILE_SETS[kind].map((f) => f.file);
      expect(new Set(files).size, `${kind}: a file is listed twice`).toBe(files.length);
      for (const f of FILE_SETS[kind]) {
        expect(f.why.trim(), `${kind}: ${f.file} has no reason`).not.toBe("");
        if (src.files[f.file] === undefined) missing.push(`${kind}: ${f.file} (renamed or removed in Loomwright ${src.version})`);
      }
    }
    expect(missing).toEqual([]);
    expect(src.file_sets, "the fixture was made from other file sets: run scripts/refresh-loomwright-fixture.sh").toEqual(setNames());
    expect(src.entries.every((e) => JSON.stringify(e.kinds) === JSON.stringify(kindsOf(e.file))), "an entry's kinds disagree with the file sets").toBe(true);
    expect(src.entries.length).toBeGreaterThan(0);
  });

  it("every extracted entry is admitted by its kind's run policy, or matches exactly one exclusion row", () => {
    const failures = conformanceFailures(src.entries, root, new Set(src.scripts), RUN_EXCLUSIONS);
    expect(failures, `${failures.length} denied instruction(s) without exactly one exclusion row:\n${failures.join("\n")}`).toEqual([]);
  });

  it("every exclusion row is well formed and matches at least one denied entry", () => {
    const used = new Set<string>();
    conformanceFailures(src.entries, root, new Set(src.scripts), RUN_EXCLUSIONS, used);
    const bad: string[] = [];
    const ids = new Set<string>();
    for (const r of RUN_EXCLUSIONS) {
      if (ids.has(r.id)) bad.push(`${r.id}: duplicate id`);
      ids.add(r.id);
      if (r.kinds.length === 0) bad.push(`${r.id}: no kinds`);
      if (!(EXCLUSION_REASON_CLASSES as readonly string[]).includes(r.reason_class)) bad.push(`${r.id}: unknown reason class`);
      if (r.reason.trim() === "") bad.push(`${r.id}: no reason`);
      if (!r.consequence.startsWith("consequence if denied: ") || r.consequence.length <= "consequence if denied: ".length) bad.push(`${r.id}: no consequence line`);
      if (r.reason_fact_false !== undefined && !FACT_REASON_CLASSES.includes(r.reason_class)) bad.push(`${r.id}: reason_fact_false on a class that states no fact`);
      if (FACT_REASON_CLASSES.includes(r.reason_class) && r.match.type === "script" && r.match.scripts?.length !== 1) bad.push(`${r.id}: a fact row names exactly one script`);
      if (!used.has(r.id)) bad.push(`${r.id}: matches no denied entry in Loomwright ${src.version} (stale: remove it)`);
    }
    expect(bad).toEqual([]);
  });

  it("each exclusion's stated script fact holds in the script text, and each reason_fact_false row's fact is still false", () => {
    const wrong: string[] = [];
    for (const r of RUN_EXCLUSIONS) {
      if (!FACT_REASON_CLASSES.includes(r.reason_class) || r.match.type !== "script") continue;
      const script = r.match.scripts?.[0] as string;
      const holds = factHolds(r, src.script_facts);
      if (r.reason_fact_false !== undefined) {
        if (holds) wrong.push(`${r.id}: "${r.reason_class}" is now TRUE for ${script}: drop reason_fact_false (${r.reason_fact_false})`);
      } else if (!holds) {
        wrong.push(`${r.id}: "${r.reason_class}" is false for ${script}${r.fact_via === undefined ? "" : ` (via ${r.fact_via})`} in Loomwright ${src.version}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("each 'runs past the rail' row's cited line holds its anchor", () => {
    const moved: string[] = [];
    for (const row of PAST_THE_RAIL) {
      const text = src.lines[row.script]?.[String(row.line)];
      if (text === undefined || !text.includes(row.anchor)) {
        moved.push(`${row.id}: anchor not found at the cited line ${row.script}:${row.line} (${JSON.stringify(row.anchor)}; the line reads ${JSON.stringify(text ?? null)})`);
      }
    }
    expect(moved).toEqual([]);
  });

  it("the source is deterministic and install-relative: entries sorted by file, line, text; no absolute home path", () => {
    expect(src.entries.map((e) => [e.file, e.line, e.text])).toEqual(sortEntries(src.entries).map((e) => [e.file, e.line, e.text]));
    const text = fixtureText(src);
    expect(text.includes(homedir())).toBe(false);
    expect(/"\/(Users|home)\//.test(text)).toBe(false);
    if (!LIVE) expect(readFileSync(fixturePath(), "utf8")).toBe(text);
  });
});

describe("the extractor keeps a shape it cannot parse (AC 6, 10a)", () => {
  const scripts = new Set(["automate-helpers.sh"]);
  const line = 'Then run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/automate-helpers.sh current-set --run x` before PICK.';

  it("returns the synthetic line as `unparsed` with its file:line", () => {
    const got = extractMarkdown("skills/synthetic/SKILL.md", `# Synthetic\n\n${line}\n`, scripts);
    expect(got).toEqual([
      { file: "skills/synthetic/SKILL.md", line: 3, type: "unparsed", source: "backtick", text: line.slice(line.indexOf("`") + 1, line.lastIndexOf("`")) },
    ]);
  });

  it("reports an unparsed entry with no exclusion row as a conformance failure", () => {
    const entries = extractMarkdown("skills/synthetic/SKILL.md", `${line}\n`, scripts).map((e) => ({ ...e, kinds: ["backlog"] as RunSessionKind[] }));
    expect(entries.length).toBe(1);
    const failures = conformanceFailures(entries, root, scripts, RUN_EXCLUSIONS);
    expect(failures).toEqual([expect.stringMatching(/^backlog: .* \(unparsed\) denied unparsed at skills\/synthetic\/SKILL\.md:1: no exclusion row$/)]);
  });

  it("keeps a shell-fence line whose program it does not list as `unparsed`, never dropped (review iteration 4)", () => {
    const md = "```bash\nuv run pytest -q\nkubectl apply -f x.yaml\nBASE=$(uvx tool)\n```\n";
    expect(extractMarkdown("skills/synthetic/SKILL.md", md, scripts)).toEqual([
      { file: "skills/synthetic/SKILL.md", line: 2, type: "unparsed", source: "fence", text: "uv run pytest -q" },
      { file: "skills/synthetic/SKILL.md", line: 3, type: "unparsed", source: "fence", text: "kubectl apply -f x.yaml" },
      { file: "skills/synthetic/SKILL.md", line: 4, type: "unparsed", source: "fence", text: "BASE=$(uvx tool)" },
    ]);
    // The same words in a backtick span stay a prose mention.
    expect(extractMarkdown("skills/synthetic/SKILL.md", "Run `uv run pytest` there.\n", scripts)).toEqual([]);
  });

  it("reads a lone listed program in a shell fence as a command, and in a backtick span as a mention (review iteration 4)", () => {
    expect(extractMarkdown("skills/synthetic/SKILL.md", "```bash\nmake\n```\n", scripts)).toEqual([
      { file: "skills/synthetic/SKILL.md", line: 2, type: "command", source: "fence", text: "make" },
    ]);
    expect(extractMarkdown("skills/synthetic/SKILL.md", "Then `make` it.\n", scripts)).toEqual([]);
  });
});

describe("a shell-composition row never hides the program it composes (review iteration 1)", () => {
  const scripts = new Set<string>();
  const at = (text: string): Entry => ({ file: "skills/synthetic/SKILL.md", line: 7, type: "command", source: "fence", text, kinds: ["backlog"] });

  it("decides a `$`-bearing command's literal retry: an unadmitted program with no row of its own fails", () => {
    const failures = conformanceFailures([at('zzprog --base "origin/$BASE_BRANCH"')], root, scripts, RUN_EXCLUSIONS);
    expect(failures).toEqual([
      'backlog: part of `zzprog --base "origin/$BASE_BRANCH"`: `zzprog --base sample` (command) denied bash_prefix_not_allowed at skills/synthetic/SKILL.md:7: no exclusion row',
    ]);
  });

  it("decides each part of a pipe, chain and substitution: only the unadmitted ones fail", () => {
    const failures = conformanceFailures([at('git log --oneline -1 "$X" | zzpipe -q && git status || zzchain "$(zzsub --x)" 2>/dev/null')], root, scripts, RUN_EXCLUSIONS);
    expect(failures.map((f) => /: `([^`]*)` \(command\) denied/.exec(f.slice(f.indexOf("`: `")))?.[1])).toEqual(["zzpipe -q", "zzsub --x", "zzchain \"sample\""]);
  });

  it("an admitted literal retry adds nothing beyond the composition row", () => {
    expect(conformanceFailures([at('git log --oneline -1 "origin/$BASE_BRANCH"')], root, scripts, RUN_EXCLUSIONS)).toEqual([]);
  });
});

describe("a row matches only the shapes its reason describes (review iteration 2)", () => {
  const scripts = new Set<string>();
  const at = (file: string, text: string): Entry => ({ file, line: 9, type: "command", source: "fence", text, kinds: ["backlog"] });
  const SYN = "skills/synthetic/SKILL.md";
  // Each shape once in a file no row lists, and once in a file the row that used to absorb it lists (so the text bites, not only `files`).
  const shapes: readonly (readonly [string, string])[] = [
    // 25c: `git -C <dir> push …` is judged as `git push` (held by the rail); a second global option stays refused.
    ["git -C ../wt -c core.hooksPath=x push --force origin main", "skills/async-orchestration/finalize.md"],
    ["git -C . reset --hard origin/main", "skills/async-orchestration/finalize.md"],
    ["git reset --hard origin/main", "skills/automate-loop/per-item-loop.md"],
    ["git merge --abort", "skills/workflow-management/SKILL.md"],
    ["rm -rf ~/.claude", "agents/code-reviewer.md"],
    ["rm -rf ~/.claude", "skills/automate-loop/helpers.md"],
    ["cp ~/.ssh/id_rsa /tmp/x", "skills/state-management/SKILL.md"],
    ["cp .supervisor/state.md ~/.ssh/authorized_keys", "skills/state-management/SKILL.md"],
    ["claude -p --dangerously-skip-permissions \"fix it\"", "skills/review-heal/SKILL.md"],
    ["npm run deploy", "skills/workflow-management/SKILL.md"],
  ];

  const cases = [...new Map(shapes.flatMap(([text, listed]) => [[text, SYN], [text, listed]]).map((c) => [c.join("\t"), c] as const)).values()];

  it.each(cases)("`%s` in %s has no exclusion row", (text, file) => {
    const failures = conformanceFailures([at(file, text)], root, scripts, RUN_EXCLUSIONS);
    expect(failures).toEqual([expect.stringMatching(new RegExp(` denied [a-z_]+ at ${file.replace(/[.]/g, "\\.")}:9: no exclusion row$`))]);
  });

  it("a recorded shape in a file its row does not list has no exclusion row (`claude -p`, `npm test`)", () => {
    for (const text of ["claude -p", "npm test"]) {
      expect(conformanceFailures([at(SYN, text)], root, scripts, RUN_EXCLUSIONS)).toEqual([expect.stringMatching(/: no exclusion row$/)]);
    }
  });

  it("the shapes the rows record still match in their own files", () => {
    const real = [
      // 25c admits the parallel path's `git -C ../<worktree> add -A` and `git merge feature/<x> --no-ff`; these stay denied.
      at("skills/autonomous-loop/SKILL.md", "mv .supervisor/jobs/pending/<this-session-id>-*.md .supervisor/jobs/failed/"),
      at("skills/state-management/SKILL.md", "cp .supervisor/state.md {scratchpad}/supervisor-state.md"),
      at("agents/code-reviewer.md", "rm -rf"),
      at("skills/review-heal/SKILL.md", "claude -p"),
      at("skills/workflow-management/SKILL.md", "npm run lint"),
    ];
    expect(conformanceFailures(real, root, scripts, RUN_EXCLUSIONS)).toEqual([]);
  });
});

/** `kind`'s run policy without one admitted script, Bash prefix or tool. */
function withoutElement(kind: RunSessionKind, field: "loomwrightScripts" | "allowedBashPrefixes" | "allowedTools", name: string): ToolPolicy {
  const policy = POLICIES[kind];
  return { ...policy, [field]: (policy[field] ?? []).filter((n) => n !== name) };
}

describe("a driver row matches only the option its reason names (review iteration 3)", () => {
  const driver = new Set(["automate-next-step.sh"]);
  const at = (file: string, text: string, kind: RunSessionKind): Entry => ({ file, line: 40, type: "script", source: "backtick", text, kinds: [kind] });
  const SKILL = "skills/automate-loop/SKILL.md";
  const HELPERS = "skills/automate-loop/helpers.md";

  it.each([
    ["backlog", SKILL, "automate-next-step.sh <runfile> --start pick --session-id <sid>"],
    ["backlog", SKILL, "automate-next-step.sh --resume .supervisor/automate --session-id <sid>"],
    ["resume", HELPERS, "automate-next-step.sh <runfile> --result '{}' --mode safe --session-id <sid>"],
    ["merge_parked", SKILL, "automate-next-step.sh --merge-parked .supervisor/automate --run <run_id> --session-id <sid>"],
    ["merge_parked_trusted", HELPERS, "automate-next-step.sh <runfile> --result '{}' --session-id <sid>"],
  ] as const)("%s: in %s, `%s` with automate-next-step.sh de-admitted has no exclusion row", (kind, file, text) => {
    const failures = conformanceFailures([at(file, text, kind)], root, driver, RUN_EXCLUSIONS, undefined, {
      policies: { [kind]: withoutElement(kind, "loomwrightScripts", "automate-next-step.sh") },
    });
    expect(failures).toEqual([expect.stringMatching(/ denied bash_prefix_not_allowed at .*:40: no exclusion row$/)]);
  });

  it("the refused options and the synopsis still match their rows under the real policies", () => {
    const real = [
      at(SKILL, "automate-next-step.sh --merge-parked .supervisor/automate --run <run_id> --session-id <sid>", "backlog"),
      at(SKILL, "automate-next-step.sh <runfile> --start pick --session-id <sid>", "merge_parked"),
      at(SKILL, "automate-next-step.sh --resume .supervisor/automate --session-id <sid>", "merge_parked_trusted"),
      at(HELPERS, "automate-next-step.sh --resume sample [--run sample", "resume"),
      at(HELPERS, "automate-next-step.sh --resume sample [--run sample", "merge_parked"),
    ];
    expect(conformanceFailures(real, root, driver, RUN_EXCLUSIONS)).toEqual([]);
  });

  it("the synopsis row is limited to the helper catalog", () => {
    expect(conformanceFailures([at(SKILL, "automate-next-step.sh --resume sample [--run sample", "backlog")], root, driver, RUN_EXCLUSIONS)).toEqual([
      expect.stringMatching(/: no exclusion row$/),
    ]);
  });
});

describe("no row hides a de-admitted script, prefix or tool (review iteration 3)", () => {
  // `resume` shares `backlog`'s policy and file set; the two merge kinds differ in their driver profile, so both are checked.
  const KINDS: readonly RunSessionKind[] = ["backlog", "review_pr", "merge_parked", "merge_parked_trusted"];
  const FIELDS = ["loomwrightScripts", "allowedBashPrefixes", "allowedTools"] as const;

  it("de-admitting any element a kind's entries rely on fails the conformance check", () => {
    const scripts = new Set(src.scripts);
    const hidden: string[] = [];
    for (const kind of KINDS) {
      const entries = src.entries.filter((e) => e.kinds.includes(kind)).map((e) => ({ ...e, kinds: [kind] }));
      const base = { n: 0 };
      expect(conformanceFailures(entries, root, scripts, RUN_EXCLUSIONS, undefined, { allowed: base })).toEqual([]);
      for (const field of FIELDS) {
        for (const name of POLICIES[kind][field] ?? []) {
          const allowed = { n: 0 };
          const failures = conformanceFailures(entries, root, scripts, RUN_EXCLUSIONS, undefined, { policies: { [kind]: withoutElement(kind, field, name) }, allowed });
          if (allowed.n < base.n && failures.length === 0) hidden.push(`${kind}: without ${field} \`${name}\`, ${base.n - allowed.n} admitted decision(s) become denials every one of which a row absorbs`);
        }
      }
    }
    expect(hidden).toEqual([]);
  });
});

describe("a tool a run asked for live and is denied on purpose is recorded with its events (25c)", () => {
  it("SendMessage is denied by every run policy and listed in the observed-denials record (events 33474, 38037)", () => {
    const send = RUN_TOOL_DENIALS_OBSERVED.find((d) => d.tool === "SendMessage");
    expect(send).toMatchObject({ reason_class: "tool not granted", events: [33474, 38037] });
    expect(send?.kinds).toEqual(RUN_SESSION_KINDS);
    expect(send?.consequence).toMatch(/^consequence if denied: ./);
    for (const kind of RUN_SESSION_KINDS) {
      expect(decideToolUse(POLICIES[kind], "SendMessage", { to: "worker", message: "x" }), kind).toEqual({ decision: "deny", reason: "tool_not_allowed" });
    }
    // Every recorded tool is denied by every kind it names, in a known reason class, and has no extracted entry to sit on as a row.
    for (const d of RUN_TOOL_DENIALS_OBSERVED) {
      expect(EXCLUSION_REASON_CLASSES, d.tool).toContain(d.reason_class);
      for (const kind of d.kinds) expect(decideToolUse(POLICIES[kind], d.tool, {}).decision, `${kind}: ${d.tool}`).toBe("deny");
      expect(src.entries.some((e) => e.type === "tool" && e.text === d.tool), d.tool).toBe(false);
    }
  });

  it("TaskOutput and Monitor are granted to every run kind; no exclusion row names them any more", () => {
    for (const kind of RUN_SESSION_KINDS) {
      expect(POLICIES[kind].allowedTools, kind).toEqual(expect.arrayContaining(["TaskOutput", "Monitor"]));
      expect(POLICIES[kind].allowedTools, kind).not.toContain("SendMessage");
    }
    expect(RUN_EXCLUSIONS.filter((r) => r.match.tools?.some((t) => t === "TaskOutput" || t === "Monitor"))).toEqual([]);
  });
});
