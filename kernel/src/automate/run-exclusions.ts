// The recorded reasons a kernel run session is denied something Loomwright tells it to use, and what Loomwright's
// own admitted scripts run past the rail (phase 8 item 25a). Data only: no policy reads this module, and `launch.ts`
// does not import it. `test/loomwright-conformance.test.ts` extracts every command, script call, tool name and
// slash command the Loomwright instruction files tell each run session kind to use, decides each one with the
// kind's real run policy (`decideToolUse`), and fails on any denial that does not match exactly one row of
// `RUN_EXCLUSIONS`. It also checks each row's stated script fact against the script text, and each
// `PAST_THE_RAIL` row's cited line against its anchor.
//
// A row `filed: 25b|25c|25d` is a known gap the named story closes (25b: the rail reads quoted text as text; 25c:
// run sessions manage files, read git and run the helper scripts they need inside their checkout; 25d: a run runs
// the repo's declared checks), which then removes the row. A row with no `filed` is a denial kept on purpose (a
// refused subcommand, a `claude` process, an outward post, a persistent memory write) or a text that is not an
// instruction (`advisory, never instructed`). Where a row is filed to a story whose criteria do not name the
// command yet, its reason says "not in 25x's list": 25a found it, and that story's owner decides.
//
// A row for a denied shell metacharacter (`shell composition`, `usage-synopsis`) never stands alone: the test also
// decides each part of the composed command as the session would retry it (the literal value filled in), and each
// denied part must match exactly one row of its own, so a composition row cannot hide an unadmitted program.
//
// `test/automate-merge-check.test.ts` scans every file here for a merge call, a merge endpoint or a process start.
// This file is the scan's one reviewed exemption from its merge-TEXT patterns only: it names the GitHub CLI's merge
// command as text to match (Loomwright's counter-examples and gate-eval's line), so the scan instead asserts that it
// imports types only and exports frozen data with no function; the process, network and merge-call patterns still apply.
//
// Read from Loomwright 18.1.2 on 2026-11-21 (the committed fixture `test/fixtures/loomwright-18.1.2-instructions.json`).
import type { ToolDecisionReason } from "../sessions/policy.js";

/** The kernel run session kinds the conformance test checks: `launch.ts`'s four kinds, with `merge_parked` both plain and trusted. */
export const RUN_SESSION_KINDS = Object.freeze(["backlog", "resume", "review_pr", "merge_parked", "merge_parked_trusted"] as const);

/** One of `RUN_SESSION_KINDS`. */
export type RunSessionKind = (typeof RUN_SESSION_KINDS)[number];

/** The closed set of reason classes. The first two state a fact about a script that the test checks against its text. */
export const EXCLUSION_REASON_CLASSES = Object.freeze([
  "starts a claude process",
  "runs eval / bash -c",
  "posts outward past the approval gate",
  "persistent memory or contract write",
  "harness hook, never the session",
  "refused subcommand or driver option",
  "script not admitted for this kind",
  "program or subcommand not admitted",
  "runs project code",
  "quoted text the rail reads as shell",
  "shell composition",
  "tool not granted",
  "advisory, never instructed",
  "unparsed",
] as const);

/** One of `EXCLUSION_REASON_CLASSES`. */
export type ExclusionReasonClass = (typeof EXCLUSION_REASON_CLASSES)[number];

/** The reason classes whose stated fact the test checks against the script text. */
export const FACT_REASON_CLASSES: readonly ExclusionReasonClass[] = Object.freeze(["starts a claude process", "runs eval / bash -c"]);

/**
 * What a row matches. Every given field must hold:
 * - `type`: the entry's type (`command`, `script`, `tool`, `slash`, `unparsed`);
 * - `scripts`: the Loomwright script the entry calls (its basename);
 * - `tools`: the tool name as written;
 * - `text`: a regular expression (source) tested on the entry's text as written;
 * - `deny`: the deny reason (`unparsed` for an unparsed entry);
 * - `files`: the entry's source file, install-relative.
 */
export interface ExclusionMatch {
  readonly type: "command" | "script" | "tool" | "slash" | "unparsed";
  readonly scripts?: readonly string[];
  readonly tools?: readonly string[];
  readonly text?: string;
  readonly deny?: readonly (ToolDecisionReason | "unparsed")[];
  readonly files?: readonly string[];
}

/** One recorded exclusion. */
export interface RunExclusion {
  readonly id: string;
  readonly match: ExclusionMatch;
  readonly kinds: readonly RunSessionKind[];
  readonly reason_class: ExclusionReasonClass;
  readonly reason: string;
  /** Starts `consequence if denied: `. */
  readonly consequence: string;
  readonly filed?: "25b" | "25c" | "25d";
  /** For a fact class: the fact holds through this sibling script, which the row's script names on a non-comment line. */
  readonly fact_via?: string;
  /** The stated fact is known to be false: the test asserts it IS false, and goes red once it becomes true or the row is corrected. */
  readonly reason_fact_false?: "filed: 25c";
}

const AUTOMATE: readonly RunSessionKind[] = Object.freeze(["backlog", "resume"]);
const MERGE: readonly RunSessionKind[] = Object.freeze(["merge_parked", "merge_parked_trusted"]);
const REVIEW: readonly RunSessionKind[] = Object.freeze(["review_pr"]);
const ALL: readonly RunSessionKind[] = RUN_SESSION_KINDS;

const SHELL_META = ["bash_shell_metacharacter"] as const;
// A compound command: the rail refuses an operator outside quotes as a metacharacter, and 25b's
// parser refuses a heredoc it cannot read as `bash_unparsed`.
const SHELL_COMPOUND = ["bash_shell_metacharacter", "bash_unparsed"] as const;
const NOT_LISTED = ["bash_prefix_not_allowed"] as const;

/** The recorded exclusions (see the module comment). Each denied (entry, kind) matches exactly one row. */
export const RUN_EXCLUSIONS: readonly RunExclusion[] = Object.freeze([
  // ---- Scripts that start a claude process or run eval / bash -c (facts the test checks) ----
  {
    id: "dispatch-pr-review",
    match: { type: "script", deny: NOT_LISTED, scripts: ["dispatch-pr-review.sh"] },
    kinds: ALL,
    reason_class: "starts a claude process",
    reason: "launch.ts:232: it starts a detached headless `claude` review process the kernel does not own (invariant 2).",
    consequence: "consequence if denied: the run's review dispatch falls back to the drain's own review; a kernel-owned path is 23m.",
  },
  {
    id: "dispatch-pr-postmortem",
    match: { type: "script", deny: NOT_LISTED, scripts: ["dispatch-pr-postmortem.sh"] },
    kinds: ALL,
    reason_class: "starts a claude process",
    reason: "launch.ts:286: it starts a detached headless `claude` postmortem process (invariant 2).",
    consequence: "consequence if denied: no postmortem from the session; the driver still dispatches one past the rail (PAST_THE_RAIL).",
  },
  {
    id: "hook-dispatch-on-pr-create",
    match: { type: "script", deny: NOT_LISTED, scripts: ["hook-dispatch-on-pr-create.sh"] },
    kinds: ALL,
    reason_class: "starts a claude process",
    fact_via: "dispatch-pr-review.sh",
    reason: "launch.ts:232: a PostToolUse hook backstop that runs dispatch-pr-review.sh, which starts `claude` (invariant 2); the harness fires it, never the session.",
    consequence: "consequence if denied: none for the session (the hook is the harness's).",
  },
  {
    id: "gate-auto",
    match: { type: "script", deny: NOT_LISTED, scripts: ["gate-auto.sh"] },
    kinds: ALL,
    reason_class: "starts a claude process",
    reason_fact_false: "filed: 25c",
    reason: "launch.ts:232 says it starts a `claude` process; 18.1.2's gate-auto.sh holds no `claude` at all (it records and reads LP-SAVE gate decisions). 25c admits `decide|record|list` and corrects this reason.",
    consequence: "consequence if denied: Launch Pad's LP-SAVE gate is answered by the model instead of the recorded decision (24b, event 37984).",
    filed: "25c",
  },
  {
    id: "automate-lanes",
    match: { type: "script", deny: NOT_LISTED, scripts: ["automate-lanes.sh"], text: "^(?!.*\\bscope-outside\\b)" },
    kinds: ALL,
    reason_class: "starts a claude process",
    reason: "launch.ts:201: `lane-launch` / `phase-launch` start headless `claude -p` lanes and phases (automate-lanes.d/launch.sh); safe mode takes no lane.",
    consequence: "consequence if denied: no lanes and no fresh phases, which `--inline-phases` safe mode never uses.",
  },
  {
    id: "run-ground-truth",
    match: { type: "script", deny: NOT_LISTED, scripts: ["run-ground-truth.sh"] },
    kinds: ALL,
    reason_class: "runs eval / bash -c",
    reason: "launch.ts:235: it runs `bash -c '<shell>'` lines read from the brief, which the session can write; the per-command rail never sees them (invariant 3).",
    consequence: "consequence if denied: Phase 4.5's executable-acceptance ground truth is not run in a kernel run.",
  },
  {
    id: "rules-check",
    match: { type: "script", deny: NOT_LISTED, scripts: ["rules-check.sh"] },
    kinds: ALL,
    reason_class: "runs eval / bash -c",
    reason: "launch.ts:236: each selected house rule's `check` runs via `bash -c` from the committed rules store, past the rail.",
    consequence: "consequence if denied: house-rule checks are not run by the session; the reviewer reads the rules instead.",
  },
  {
    id: "worker-rule-selfcheck",
    match: { type: "script", deny: NOT_LISTED, scripts: ["worker-rule-selfcheck.sh"] },
    kinds: ALL,
    reason_class: "runs eval / bash -c",
    fact_via: "rules-check.sh",
    reason: "launch.ts:236: it runs rules-check.sh, which runs each rule's check via `bash -c`.",
    consequence: "consequence if denied: the worker's house-rule self-check is skipped (report-only in Loomwright).",
  },
  {
    id: "run-pin-mutations",
    match: { type: "script", deny: NOT_LISTED, scripts: ["run-pin-mutations.sh"] },
    kinds: ALL,
    reason_class: "runs eval / bash -c",
    reason_fact_false: "filed: 25c",
    reason: "launch.ts:236 says it runs command lines read from files; 18.1.2 holds no `eval` or `bash -c`: it runs pinned test files with `bash \"$1\"` (run-pin-mutations.sh:262), project code (25d's class). 25c corrects the reason.",
    consequence: "consequence if denied: pin mutations are not run; Phase 4.5 reports the pins unverified.",
    filed: "25c",
  },
  {
    id: "run-benchmark",
    match: { type: "script", deny: NOT_LISTED, scripts: ["run-benchmark.sh"] },
    kinds: ALL,
    reason_class: "runs eval / bash -c",
    reason_fact_false: "filed: 25c",
    reason: "launch.ts:236 says it runs command lines read from files; 18.1.2's run-benchmark.sh holds no `eval` or `bash -c` (it validates a fixed corpus with jq). 25c corrects the reason.",
    consequence: "consequence if denied: no benchmark_result in the Supervisor's result (advisory).",
    filed: "25c",
  },

  // ---- Deliberate: outward posts, memory writes, harness hooks, refused subcommands ----
  {
    id: "outward-scripts",
    match: { type: "script", deny: NOT_LISTED, scripts: ["send-webhook.sh", "automate-merge-watch.sh", "automate-trail.sh", "automate-wave.sh", "lane-sampler.sh"] },
    kinds: ALL,
    reason_class: "posts outward past the approval gate",
    reason: "launch.ts:202-206, :233: each posts a webhook, pushes, or opens a PR itself, past the approval gate (invariant 3); the driver runs what safe mode needs.",
    consequence: "consequence if denied: no webhook or trail PR from the session; the rail and the gate see the session's own git push and gh pr create.",
  },
  {
    id: "memory-writes",
    match: { type: "script", deny: NOT_LISTED, scripts: ["write-project-memory.sh", "write-agent-memory.sh", "write-system-contract.sh", "add-orientation.sh", "reprovenance-twin-contracts.sh"] },
    kinds: ALL,
    reason_class: "persistent memory or contract write",
    reason: "launch.ts:237-238: persistent memory, orientation and contract writes Loomwright keeps for a human-approved fact (invariant 3).",
    consequence: "consequence if denied: the run proposes memory candidates in its result; nothing is written to the committed stores.",
  },
  {
    id: "harness-hooks",
    match: { type: "script", deny: NOT_LISTED, scripts: ["reproject-state-on-terminal.sh", "session-resume.sh", "close-stranded-run.sh", "seed-run-owner.sh"] },
    kinds: ALL,
    reason_class: "harness hook, never the session",
    reason: "launch.ts:239: SessionStart / SessionEnd / PostToolUse hook helpers the harness fires; the instructions name them to explain recovery, not as calls.",
    consequence: "consequence if denied: none (the session never calls a hook itself).",
  },
  {
    id: "helpers-refused-subcommand",
    match: { type: "script", deny: NOT_LISTED, scripts: ["automate-helpers.sh"], text: "^\\S*automate-helpers\\.sh\"? (gate-eval|trail-pr|closeout|closeout-others|init-check|phase-check|wave-build|lane-[a-z-]+|finalize-empty)\\b" },
    kinds: [...AUTOMATE, ...MERGE],
    reason_class: "refused subcommand or driver option",
    reason: "LOOMWRIGHT_DENIED_SUBCOMMANDS: these merge (`gate-eval`), push and open a trail PR (`trail-pr`, `closeout*`, `finalize-empty`), or drive lanes (`init-check --parallel`, `phase-check`, `lane-*`); the driver runs what safe mode needs itself.",
    consequence: "consequence if denied: the session cannot merge or publish past the gate; the driver's own gate and close-out still run.",
  },
  {
    id: "driver-ticket-merge-parked",
    match: { type: "script", deny: NOT_LISTED, scripts: ["automate-next-step.sh"], text: "^(?!.*\\[).*\\s--merge-parked\\b" },
    kinds: AUTOMATE,
    reason_class: "refused subcommand or driver option",
    reason: "LOOMWRIGHT_DRIVER_ARGUMENTS (`automate_run`): a ticket or resume run's driver never takes `--merge-parked`, which runs gate-eval's merge directly.",
    consequence: "consequence if denied: a ticket run cannot merge a parked item; a merge is its own `merge_parked` run.",
  },
  {
    id: "driver-merge-loop-option",
    match: { type: "script", deny: NOT_LISTED, scripts: ["automate-next-step.sh"], text: "^(?!.*\\[).*\\s--(start|resume)\\b" },
    kinds: MERGE,
    reason_class: "refused subcommand or driver option",
    reason: "LOOMWRIGHT_DRIVER_ARGUMENTS (`merge_parked*`): a merge run's driver never takes `--start` / `--resume` (the per-item loop, whose tail could gate under another mode).",
    consequence: "consequence if denied: a merge run cannot pick or resume another item; its one entry is `--merge-parked <dir> --run <id>`.",
  },
  {
    id: "driver-merge-sample-run-file",
    match: { type: "script", deny: NOT_LISTED, scripts: ["automate-next-step.sh"], text: "^bash automate-next-step\\.sh sample --session-id sample-session$", files: ["scripts/automate-next-step.sh"] },
    kinds: MERGE,
    reason_class: "shell composition",
    reason: "the driver's printed self-invocation (automate-next-step.sh:2152, `$(ns_sq \"$RF\")`) decided with the test's literal `sample` run file, which a merge run's run-id pin refuses (`namesOtherRun`); the driver prints the pinned run's own file.",
    consequence: "consequence if denied: none for the real line; a call naming another run's file is refused, as the pin intends.",
  },
  {
    id: "driver-usage-synopsis",
    match: { type: "script", deny: NOT_LISTED, scripts: ["automate-next-step.sh"], text: "\\s\\[--(run|start) sample\\b", files: ["skills/automate-loop/helpers.md"] },
    kinds: [...AUTOMATE, ...MERGE],
    reason_class: "advisory, never instructed",
    reason: "the helper catalog's driver synopsis (`--resume <automate_dir> [--run <run_id>|latest]`, `<runfile> [--start pick|run|drain] [--result <json>]`): its literal retry keeps the unquoted `[`, which the driver check refuses (fail closed).",
    consequence: "consequence if denied: none; the session issues one concrete form, decided on its own (skills/automate-loop/SKILL.md:40, per-item-loop.md:22).",
  },
  {
    id: "meta-sync-push",
    match: { type: "script", deny: NOT_LISTED, scripts: ["meta-sync.sh"], text: "\\bpush\\b" },
    kinds: AUTOMATE,
    reason_class: "refused subcommand or driver option",
    reason: "LOOMWRIGHT_DENIED_SUBCOMMANDS: `meta-sync.sh push` pushes the metadata branch past the approval gate (branch mode only).",
    consequence: "consequence if denied: branch-mode metadata is not pushed by the session.",
  },

  // ---- Gaps: scripts the instructions call that a kind's policy does not admit (25c) ----
  {
    id: "automate-missing-scripts",
    match: {
      type: "script",
      deny: NOT_LISTED,
      scripts: [
        "drain-rounds.sh", "wait-for-checks.sh", "classify-bot-review.sh", "ci-run-probe.sh", "drain-gh-read.sh", "drain-subfloor-decision.sh",
        "guard-arm.sh", "wrap-external-text.sh", "notify-desktop.sh", "pr-postmortem-gather.sh",
      ],
    },
    kinds: AUTOMATE,
    reason_class: "script not admitted for this kind",
    reason: "the run's inline `/review-pr` drain calls the review-heal scripts REVIEW_PR_RUN_POLICY admits, but AUTOMATE_RUN_POLICY lists none of them (found by 25a; not in 25c's list).",
    consequence: "consequence if denied: the inline drain cannot read CI, count rounds or wrap bot text with Loomwright's helpers, and does it by hand or stops.",
    filed: "25c",
  },
  {
    id: "automate-unlisted-scripts",
    match: {
      type: "script",
      deny: NOT_LISTED,
      scripts: [
        "reconcile-jobs.sh", "phase45-ci-read.sh", "resolve-routing.sh", "setup-memory.sh", "format-twin-delta.sh", "stamp-requirement-status.sh",
        "audit-rules.sh", "rules-audit-line.sh", "build-floor.sh", "phase-timing.sh", "proc-registry.sh", "status-line.sh", "setup-base-branch.sh",
      ],
    },
    kinds: AUTOMATE,
    reason_class: "script not admitted for this kind",
    reason: "readers and `.supervisor/` bookkeeping the 18.1.2 instructions call that no run policy lists; 25c names reconcile-jobs.sh and phase45-ci-read.sh, the rest are not in 25c's list (found by 25a).",
    consequence: "consequence if denied: the step is done by the model or skipped (seen live: Phase 4.5's CI read by hand, the brief left in in-progress/, events 33816-33825).",
    filed: "25c",
  },
  {
    id: "lanes-scope-outside",
    match: { type: "script", deny: NOT_LISTED, scripts: ["automate-lanes.sh"], text: "\\bscope-outside\\b" },
    kinds: ALL,
    reason_class: "script not admitted for this kind",
    reason: "Launch Pad's LP-SCOPE gate calls `automate-lanes.sh scope-outside` (read-only); automate-lanes.sh is excluded whole. 25c admits this one subcommand.",
    consequence: "consequence if denied: the LP-SCOPE gate cannot compute which files fall outside the item's Touches.",
    filed: "25c",
  },
  {
    id: "review-missing-scripts",
    match: { type: "script", deny: NOT_LISTED, scripts: ["read-rules.sh", "module-shape-facts.sh", "read-project-memory.sh", "resolve-routing.sh", "setup-base-branch.sh"] },
    kinds: REVIEW,
    reason_class: "script not admitted for this kind",
    reason: "readers the review-pr run's code-reviewer and drain call that REVIEW_PR_RUN_POLICY does not list (AUTOMATE_RUN_POLICY admits the first three; found by 25a, not in 25c's list).",
    consequence: "consequence if denied: the review reads no house rules, module-shape facts or project memory, and routes every seat to the default.",
    filed: "25c",
  },
  {
    id: "merge-missing-scripts",
    match: {
      type: "script",
      deny: NOT_LISTED,
      scripts: [
        "reconcile-jobs.sh", "setup-memory.sh", "worktree-salvage.sh", "worktree-audit.sh", "build-floor.sh", "classify-bot-review.sh",
        "phase-timing.sh", "stamp-requirement-status.sh", "wrap-external-text.sh",
      ],
    },
    kinds: MERGE,
    reason_class: "script not admitted for this kind",
    reason: "helpers the automate skill names that MERGE_PARKED_RUN_POLICY does not list (it is AUTOMATE_SCRIPTS less the drain); found by 25a, not in 25c's list.",
    consequence: "consequence if denied: a merge run's close-out bookkeeping is left to the driver, which runs it itself where it needs it.",
    filed: "25c",
  },

  // ---- Not instructions: Loomwright's own tests, sourced libraries, usage synopses, prose ----
  {
    id: "loomwright-own-tests",
    match: {
      type: "script",
      deny: NOT_LISTED,
      text: "^(scripts/)?test-[A-Za-z0-9_.-]+\\.sh$",
      files: ["skills/automate-loop/SKILL.md", "skills/automate-loop/helpers.md", "skills/automate-loop/invariants.md", "skills/review-heal/SKILL.md", "skills/state-management/SKILL.md"],
    },
    kinds: ALL,
    reason_class: "advisory, never instructed",
    reason: "Loomwright's own repo tests (`test-*.sh`), named as the proof behind a contract; a run never runs them.",
    consequence: "consequence if denied: none.",
  },
  {
    id: "sourced-libraries",
    match: { type: "script", deny: NOT_LISTED, scripts: ["exec-acceptance-lib.sh", "propose-common.sh"] },
    kinds: ALL,
    reason_class: "advisory, never instructed",
    reason: "sourced libraries (no main): the instructions name them as the shared definition, never as a call.",
    consequence: "consequence if denied: none.",
  },
  {
    id: "usage-synopsis",
    match: { type: "script", deny: SHELL_META, text: "\\S\\|\\S|\\| --", files: ["skills/automate-loop/helpers.md", "skills/automate-loop/per-item-loop.md", "skills/review-heal/SKILL.md"] },
    kinds: ALL,
    reason_class: "advisory, never instructed",
    reason: "a usage synopsis (`a|b|c` alternatives, `[--opt]` optional parts), not a command line; the rail refuses the unquoted `|` and `[` it holds.",
    consequence: "consequence if denied: none; the session issues one concrete form, which is decided on its own.",
  },
  {
    id: "helpers-calling-convention",
    match: { type: "command", deny: NOT_LISTED, text: "^bash sample$", files: ["skills/automate-loop/helpers.md"] },
    kinds: [...AUTOMATE, ...MERGE],
    reason_class: "advisory, never instructed",
    reason: "the helper catalog's calling convention `bash \"${CLAUDE_PLUGIN_ROOT}/scripts/automate-helpers.sh <subcommand> [args…]\"` (one quoted word, a synopsis): each subcommand the catalog lists is an entry decided on its own.",
    consequence: "consequence if denied: none.",
  },
  {
    id: "run-lock-force-unlock",
    match: { type: "script", deny: NOT_LISTED, scripts: ["run-lock.sh"], text: "--force-unlock\\b" },
    kinds: [...AUTOMATE, ...MERGE],
    reason_class: "refused subcommand or driver option",
    reason: "LOOMWRIGHT_DENIED_SUBCOMMANDS: `run-lock.sh … --force-unlock` breaks the run lock unconditionally (Loomwright's own human-only escape hatch); the helper catalog's synopsis lists it as optional.",
    consequence: "consequence if denied: the session cannot break `/automate`'s single-drain ownership (invariant 4); `acquire` / `release` / `status` stay admitted.",
  },
  {
    id: "helpers-sweep-synopsis",
    match: { type: "script", scripts: ["automate-helpers.sh"], deny: NOT_LISTED, text: "\\bsweep \\[--apply\\]" },
    kinds: [...AUTOMATE, ...MERGE],
    reason_class: "advisory, never instructed",
    reason: "the `sweep [--apply]` synopsis: the rail refuses the unquoted `[` (fail closed); `sweep` itself is admitted.",
    consequence: "consequence if denied: none; the session issues `sweep` or `sweep --apply`.",
  },
  {
    id: "claude-usage",
    match: {
      type: "command",
      text: "^claude (--agent (loomwright|…):(launch-pad|review-pr|supervisor)-runner|-p|\"<prompt>\")$",
      files: [
        "agents/launch-pad.md", "commands/launch-pad.md", "commands/review-pr.md", "commands/supervisor.md", "skills/automate-loop/SKILL.md",
        "skills/review-heal/SKILL.md", "skills/review-heal/dispatch.md",
      ],
    },
    kinds: ALL,
    reason_class: "advisory, never instructed",
    reason: "`claude --agent …-runner` is the owner's way to run a phase standalone, and `claude -p` / `claude \"<prompt>\"` describe what Loomwright's own dispatchers start; a kernel run never starts `claude` (invariant 2).",
    consequence: "consequence if denied: none for the session.",
  },
  {
    id: "process-wait-advice",
    match: { type: "command", text: "^(pgrep -f|pkill -f <pattern>)$", files: ["agents/worker.md", "skills/automate-loop/per-item-loop.md"] },
    kinds: AUTOMATE,
    reason_class: "advisory, never instructed",
    reason: "the worker and per-item loop name `pgrep -f` / `pkill -f` to warn against waiting on them (the wait matches its own shell).",
    consequence: "consequence if denied: none.",
  },
  {
    id: "orchestrator-cd-example",
    match: { type: "command", text: "^cd /path/to/project$", files: ["agents/orchestrator.md"] },
    kinds: AUTOMATE,
    reason_class: "advisory, never instructed",
    reason: "an example path in the orchestrator's prose; a run session's cwd is its checkout.",
    consequence: "consequence if denied: none.",
  },
  {
    id: "prose-misread",
    match: {
      type: "command",
      text: "^(diff review\\)|diff sample \\{fixable, each bot-sourced|git worktree \\(the sole-writer)",
      files: ["skills/review-heal/SKILL.md", "skills/self-heal-advisory/completion-tail.md"],
    },
    kinds: [...AUTOMATE, ...REVIEW],
    reason_class: "advisory, never instructed",
    reason: "prose in backticks that starts with a program word (`diff review): …`, `git worktree (the sole-writer …`), not a command; the first is also matched as the part the test decides (`diff sample {fixable, …`).",
    consequence: "consequence if denied: none.",
  },
  {
    id: "never-do-this",
    match: {
      type: "command",
      text: "^(PATHS=|grep -rnE? \"(gh pr merge --squash|800 changed))",
      files: ["skills/automate-loop/invariants.md", "skills/preflight-sync/SKILL.md", "skills/supervisor-readiness/SKILL.md"],
    },
    kinds: [...AUTOMATE, ...MERGE],
    reason_class: "advisory, never instructed",
    reason: "a counter-example the text marks NEVER, or an invariant grep Loomwright's maintainers run over the plugin repo, not over the host checkout.",
    consequence: "consequence if denied: none.",
  },
  {
    id: "never-hand-rolled-file-ops",
    match: {
      type: "command",
      deny: NOT_LISTED,
      text: "^(rm -rf|git reset|git mv|git mv -k …|mv …)$",
      files: ["skills/automate-loop/helpers.md", "skills/automate-loop/per-item-loop.md", "skills/self-heal-advisory/completion-tail.md"],
    },
    kinds: [...AUTOMATE, ...MERGE],
    reason_class: "advisory, never instructed",
    reason: "a file or git operation the text names to forbid it: `sweep` removes a worktree \"never `rm -rf`\" (helpers.md:38), the trail sync does \"No `git reset`\" (per-item-loop.md:60), and a job move is \"never a hand-rolled `mv`/`git mv`\" (completion-tail.md:277).",
    consequence: "consequence if denied: none.",
  },
  {
    id: "reviewer-bash-counter-example",
    match: { type: "command", deny: NOT_LISTED, text: "^echo$", files: ["agents/code-reviewer.md"] },
    kinds: [...AUTOMATE, ...REVIEW],
    reason_class: "advisory, never instructed",
    reason: "the code reviewer's read-only warning (\"`echo > file`, `sed -i`, `git commit` would all succeed\"): a counter-example, decided here as its `echo` part.",
    consequence: "consequence if denied: none.",
  },
  {
    id: "commit-wrong-example",
    match: { type: "command", text: "^git commit -m '```bash", files: ["skills/commit/SKILL.md"] },
    kinds: AUTOMATE,
    reason_class: "advisory, never instructed",
    reason: "the commit skill's ❌ WRONG example (a fenced message).",
    consequence: "consequence if denied: none.",
  },

  // ---- Gaps the rail's quote handling causes (25b) ----
  {
    id: "quoted-metacharacters",
    match: {
      type: "command",
      deny: SHELL_META,
      text: "^(git commit -m \"feat\\(auth\\)|jq 'has\\()",
      files: ["commands/automate.md", "skills/commit/SKILL.md"],
    },
    kinds: [...AUTOMATE, ...MERGE],
    reason_class: "quoted text the rail reads as shell",
    reason: "a multi-line commit message: the newline sits inside quotes, but the rail refuses any newline (observed: the Co-Authored-By trailer, events 29902-33100).",
    consequence: "consequence if denied: the commit goes in without its body or trailer, or not as a conventional commit (session 231, c54de0b).",
    filed: "25b",
  },
  {
    id: "quoted-metacharacters-scripts",
    match: { type: "script", deny: SHELL_META, text: "(\\(attempt N/3\\)|\"reconcile-status: would stamp)", files: ["commands/launch-pad.md", "skills/automate-loop/resume.md"] },
    kinds: [...AUTOMATE, ...MERGE],
    reason_class: "quoted text the rail reads as shell",
    reason: "a driver or marker call whose note holds `(`…`)`: `launch-pad-phase.sh 5.5 PASS (attempt 1/3)` (observed, event 33441) and a quoted progress note.",
    consequence: "consequence if denied: the call is retried with the note stripped.",
    filed: "25b",
  },

  // ---- Shell composition and variables the rail refuses by design ----
  {
    id: "shell-variables",
    match: { type: "command", deny: SHELL_META, text: "^(?!PATHS=|grep -rnE? \"(gh pr merge --squash|800 changed))(?!.*(&&|\\|\\||\\s\\|\\s|\\s\\d?>>?(\\s|$)|\\s\\d>\\S|2>&1|<<)).*\\$" },
    kinds: ALL,
    reason_class: "shell composition",
    reason: "a template variable or substitution (`\"$BASE_BRANCH\"`, `\"$HEAD_REF\"`, `${CLAUDE_PLUGIN_ROOT}`, `$(date …)`): the session fills in the value; the rail refuses `$` (25b keeps it refused). The test decides the literal retry too, and an unadmitted program in it needs its own row.",
    consequence: "consequence if denied: the session retries with the literal value, which is admitted only where the retry's own decision is (a retry denied again has its own row).",
  },
  {
    id: "shell-variables-scripts",
    match: { type: "script", deny: SHELL_META, text: "^(?!.*(\\S\\|\\S|\\| --)).*\\$" },
    kinds: ALL,
    reason_class: "shell composition",
    reason: "a script call with a template variable or captured output (`\"$FIX_FLOOR\"`, `FIX_FLOOR=$(bash … fix-floor.sh resolve …)`, `$fix_cycles`): the session runs the call and fills the value in. The test decides that literal call too (a refused script has its own row).",
    consequence: "consequence if denied: the session retries with the literal value, which is admitted only where the script and its arguments are (a retry denied again has its own row).",
  },
  {
    id: "shell-compound",
    match: { type: "command", deny: SHELL_COMPOUND, text: "^(?!PATHS=|grep -rnE? \"(gh pr merge --squash|800 changed)).*(&&|\\|\\||\\s\\|\\s|\\s\\d?>>?(\\s|$)|\\s\\d>\\S|2>&1|<<)" },
    kinds: ALL,
    reason_class: "shell composition",
    reason: "a pipe, chain, redirect or heredoc (`a && b`, `x | y`, `> file`, `<<'EOF'`): the rail refuses compound commands by design (25b's non-goal). The test decides each part too, and a denied part has its own row.",
    consequence: "consequence if denied: the session runs the parts one by one, or writes the file with Write.",
  },
  {
    id: "composition-builtins",
    match: {
      type: "command",
      deny: NOT_LISTED,
      text: "^(printf (-- '--(repeat-check-failure|unresolved-bot-feedback)'|'%s' sample)|\\[ sample = true \\]|true)$",
      files: ["skills/autonomous-loop/SKILL.md", "skills/review-heal/dispatch.md", "skills/self-heal-advisory/escalation.md"],
    },
    kinds: [...AUTOMATE, ...REVIEW],
    reason_class: "shell composition",
    reason: "a part that only feeds or guards another: `printf '%s' \"$BLOCK_TEXT\" |` feeding the Launch Pad validator, `$( [ \"$x\" = true ] && printf -- '--flag' )` building a postmortem flag, and `|| true` after a best-effort `gh pr close`.",
    consequence: "consequence if denied: none of its own; the session passes the value or flag itself (the call it feeds is decided, and has its own row where denied).",
  },
  {
    id: "driver-shell-quoting",
    match: { type: "command", deny: NOT_LISTED, text: "^ns_sq sample$", files: ["scripts/automate-next-step.sh"] },
    kinds: [...AUTOMATE, ...MERGE],
    reason_class: "shell composition",
    reason: "the driver's own quoting function (`ns_sq`, automate-next-step.sh:1993) in the source of a line it prints; the session receives the line expanded (`bash '<path>' '<run file>' --session-id …`), which is decided as the driver call.",
    consequence: "consequence if denied: none; the session never calls `ns_sq`.",
  },

  {
    id: "rubric-awk-function",
    match: { type: "command", deny: SHELL_META, text: "^awk '\\n", files: ["skills/autonomous-loop/SKILL.md"] },
    kinds: AUTOMATE,
    reason_class: "shell composition",
    reason: "`has_rubric()`'s multi-line awk program inside a shell function definition (INIT's rubric check), run as one script.",
    consequence: "consequence if denied: the session reads the brief with Read and looks for the `## Outcomes Rubric` bullets itself.",
  },

  // ---- Gaps: programs and subcommands the run needs (25c) ----
  {
    id: "git-file-and-worktree-ops",
    match: {
      type: "command",
      deny: NOT_LISTED,
      text: "^(git -C \\.\\./\\S+ (add -A|commit -m \"subtask: \\{subtask_a\\} — \\{title\\}\"|merge --no-ff feature/\\S+)|git merge feature/\\S+ --no-ff( -m \"merge: \\{subtask_[abc]\\} \\{title\\}\")?|mv \\.supervisor/jobs/pending/<this-session-id>-\\*\\.md \\.supervisor/jobs/failed/|cp \\.supervisor/state\\.md (\"\\.supervisor/history/sample-sample\\.md\"|\\{scratchpad\\}/supervisor-state\\.md))$",
      files: [
        "agents/execute-manager.md", "agents/supervisor.md", "skills/async-orchestration/SKILL.md", "skills/async-orchestration/finalize.md",
        "skills/autonomous-loop/SKILL.md", "skills/state-management/SKILL.md", "skills/workflow-management/SKILL.md",
      ],
    },
    kinds: AUTOMATE,
    reason_class: "program or subcommand not admitted",
    reason: "the parallel path's `git -C ../<worktree> add -A|commit -m|merge --no-ff feature/…`, a local `git merge feature/<subtask> --no-ff`, and `mv` / `cp` of `.supervisor/` files: 25c admits these confined to the checkout (`cp` is not in 25c's list).",
    consequence: "consequence if denied: an item that moves a `.supervisor/` file, or uses the Supervisor's parallel path, cannot finish (stale brief left in in-progress/, session 238).",
    filed: "25c",
  },
  {
    id: "git-subcommands-unlisted",
    match: {
      type: "command",
      deny: NOT_LISTED,
      text: "^git (pull( --ff-only)?|restore --staged -- <path>|check-ref-format --branch <value>|remote set-head origin -a|ls-tree -r --name-only sample|check-ignore -q --no-index sample)$",
      files: [
        "agents/launch-pad.md", "skills/automate-loop/helpers.md", "skills/automate-loop/per-item-loop.md", "skills/preflight-sync/SKILL.md",
        "skills/state-management/SKILL.md", "skills/supervisor-config/SKILL.md",
      ],
    },
    kinds: [...AUTOMATE, ...MERGE],
    reason_class: "program or subcommand not admitted",
    reason: "git subcommands the 18.1.2 helpers, per-item loop and Launch Pad use (`pull --ff-only`, `restore --staged`, `check-ref-format`, `remote set-head`, `ls-tree -r --name-only \"origin/$BASE_BRANCH\"` for a cited ref, `check-ignore -q --no-index` in the `.supervisor/` gitignore probe) that RUN_BASH_PREFIXES does not list (found by 25a, not in 25c's list).",
    consequence: "consequence if denied: the session cannot fast-forward its base, unstage a path, validate a branch name, resolve a cited ref by suffix (`resolves: no`) or probe `.supervisor/`'s ignore state with git.",
    filed: "25c",
  },
  {
    id: "git-branch-glob",
    match: { type: "command", deny: ["loomwright_run_state"], text: "^git branch --list sdk-spike/subtask-\\*$", files: ["agents/supervisor.md", "commands/supervisor.md"] },
    kinds: AUTOMATE,
    reason_class: "program or subcommand not admitted",
    reason: "`git branch --list sdk-spike/subtask-*`: the run-state guard refuses any git word with a glob (a pathspec could reach `.supervisor/automate/`), though here it is a branch pattern (found by 25a, not in 25c's list).",
    consequence: "consequence if denied: the SDK-spike branch check is skipped (that path is off by default).",
    filed: "25c",
  },
  {
    id: "reviewer-scratch-repro",
    match: { type: "command", deny: NOT_LISTED, text: "^(git -c user\\.name=r -c user\\.email=r@x …|git init|mktemp -d|sed -i|tar -x -C sample|cd sample|git -C sample archive HEAD|rm -rf)$", files: ["agents/code-reviewer.md", "agents/worker.md"] },
    kinds: ALL,
    reason_class: "program or subcommand not admitted",
    reason: "the reviewer's and worker's scratch-dir repro (`mktemp -d`, `git init`, `git -c user.name=…`, `sed -i`, `cd \"$SCRATCH\"`, `git -C <checkout> archive HEAD | tar -x -C \"$SCRATCH/tree\"`, `rm -rf` of the scratch dir only): outside the checkout 25c's confinement still refuses them (not in 25c's list).",
    consequence: "consequence if denied: the self-review and code review skip their adversarial repro in a kernel run.",
    filed: "25c",
  },
  {
    id: "text-and-runtime-tools",
    match: {
      type: "command",
      deny: NOT_LISTED,
      text: "^(awk (-v|sample sample)|sed -n|python3 sample --raw|find (\"sample/FETCH_HEAD\" -mmin \\+1440|… -mmin|\\.supervisor/jobs/done \\.supervisor/jobs/failed -name \"\\*\\.md\" -mtime \\+30 -delete))$",
      files: [
        "agents/launch-pad.md", "agents/rubric-grader.md", "skills/automate-loop/SKILL.md", "skills/autonomous-loop/SKILL.md", "skills/preflight-sync/SKILL.md",
        "skills/supervisor-readiness/SKILL.md",
      ],
    },
    kinds: ALL,
    reason_class: "program or subcommand not admitted",
    reason: "`awk` (`has_rubric()`'s rubric check, `awk -v` in the loop), `sed -n` (the rubric grader's line reads), `find` (`-mmin +1440` for FETCH_HEAD's age; `-mtime +30 -delete` for old briefs) and `python3` (the inline Launch Pad result validator) are not in RUN_BASH_PREFIXES: `awk`, `sed` and `find` can run or write (`system()`, `w`, `-exec`) and `python3` runs any code (found by 25a, not in 25c's list).",
    consequence: "consequence if denied: the rubric check, the fetch-age column and the Launch Pad block validation are done by the model with Read, and old briefs stay.",
    filed: "25c",
  },
  {
    id: "beads-probe",
    match: { type: "command", deny: NOT_LISTED, text: "^bd --version$" },
    kinds: [...AUTOMATE, ...REVIEW],
    reason_class: "program or subcommand not admitted",
    reason: "the optional Beads detection `test -d .beads && bd --version`: `bd` is not in RUN_BASH_PREFIXES (found by 25a, not in 25c's list).",
    consequence: "consequence if denied: `beads_active` is false and the run works without Beads.",
    filed: "25c",
  },
  {
    id: "sdk-runner-spike",
    match: { type: "command", deny: NOT_LISTED, text: "^(npm install|node sample --brief sample --branch sample)$", files: ["agents/supervisor.md", "commands/supervisor.md", "skills/supervisor-config/SKILL.md"] },
    kinds: AUTOMATE,
    reason_class: "program or subcommand not admitted",
    reason: "the Supervisor's `--sdk-runner` spike (experimental, off by default): `npm install` in the plugin's `sdk-spike/` and `node …/sdk-spike/dist/runner.js`, an Agent SDK runner that drives worker sessions the kernel does not own (invariant 2). The spike's `npm run build` part is counted under project-checks.",
    consequence: "consequence if denied: none in a kernel run, which never passes `--sdk-runner`.",
  },
  {
    id: "gh-run-rerun",
    match: {
      type: "command",
      text: "^gh run rerun( sample --failed| \" \\+ \\(\\.run_id // \"<run_id>\"\\) \\+ \" --failed)?$",
      files: ["scripts/review-heal-next-step.sh", "skills/review-heal/escalation.md"],
    },
    kinds: [...AUTOMATE, ...REVIEW],
    reason_class: "program or subcommand not admitted",
    reason: "the drain's escalation re-runs a failed CI run; RUN_BASH_PREFIXES lists only `gh run view` (an outward write; found by 25a, not in 25c's list).",
    consequence: "consequence if denied: a flaky required check is escalated instead of re-run.",
    filed: "25c",
  },
  {
    id: "task-output",
    match: { type: "tool", tools: ["TaskOutput"] },
    kinds: [...AUTOMATE, ...REVIEW],
    reason_class: "tool not granted",
    reason: "the Execute Manager waits on a background worker with `TaskOutput`; RUN_TOOLS does not grant it. 25c admits it.",
    consequence: "consequence if denied: the Supervisor's parallel path cannot collect a background worker's result.",
    filed: "25c",
  },
  {
    id: "lsp",
    match: { type: "tool", tools: ["LSP"] },
    kinds: [...AUTOMATE, ...REVIEW],
    reason_class: "tool not granted",
    reason: "workers and reviewers run LSP diagnostics \"when available\" (advisory input only); RUN_TOOLS does not grant it (found by 25a, not in 25c's list).",
    consequence: "consequence if denied: no LSP diagnostics; type errors come from the project's own checks.",
    filed: "25c",
  },
  {
    id: "web-tools",
    match: { type: "tool", tools: ["WebFetch", "WebSearch", "NotebookEdit"] },
    kinds: [...AUTOMATE, ...REVIEW],
    reason_class: "tool not granted",
    reason: "RUN_TOOLS grants no web fetch or search: a run reads untrusted ticket and PR text, and a fetch is an outward channel (invariant 3); no notebook is edited by a run.",
    consequence: "consequence if denied: agents that list them in `tools:` work without them.",
  },

  // ---- Gaps: running the repo's code (25d) ----
  {
    id: "project-checks",
    match: {
      type: "command",
      deny: NOT_LISTED,
      text: "^(npm (test|run (build|lint))|tsc --noEmit|go vet|bash scripts/ci-local\\.sh --affected)$",
      files: [
        "agents/code-reviewer.md", "agents/supervisor.md", "agents/worker.md", "commands/supervisor.md", "skills/supervisor-config/SKILL.md",
        "skills/workflow-management/SKILL.md",
      ],
    },
    kinds: [...AUTOMATE, ...REVIEW],
    reason_class: "runs project code",
    reason: "the worker and reviewer run the project's own checks (`npm test`, `npm run build|lint`, `tsc --noEmit`, `go vet`, `scripts/ci-local.sh`). 25d admits exactly the repo's declared checks.",
    consequence: "consequence if denied: the worker cannot verify its change and the Supervisor checkpoints with no PR (24a, events 38063-38078).",
    filed: "25d",
  },
  {
    id: "bash-c",
    match: {
      type: "command",
      deny: NOT_LISTED,
      text: "^bash -c( '\\.\\.\\.')?$",
      files: [
        "agents/code-reviewer.md", "skills/preflight-sync/SKILL.md", "skills/self-heal-advisory/completion-tail.md", "skills/self-heal-advisory/on-entry.md",
        "skills/supervisor-readiness/SKILL.md",
      ],
    },
    kinds: [...AUTOMATE, ...REVIEW],
    reason_class: "runs eval / bash -c",
    reason: "`bash -c` runs any command line past the rail; `bash` is never a prefix (launch.ts:266-270).",
    consequence: "consequence if denied: the session issues the inner command itself, which the rail decides.",
  },

  // ---- Unparsed: pseudocode and compound shell blocks, each anchored on its known lines ----
  {
    id: "autonomous-init-pseudocode",
    match: {
      type: "unparsed",
      files: ["skills/autonomous-loop/SKILL.md"],
      text: "^(if --single-iteration: +multi_iter=false|elif --allow-multi-iteration (AND --single-iteration|alone):.*|non_interactive=(true|false)|if \\[ ! -t 0 \\] \\|\\| \\[ -n \"\\$CI\" \\]:|if non_interactive AND multi_iter AND NOT --non-interactive-fallback:|if max_iterations < 1 OR max_iterations > 10:|\"ERROR: (/autonomous multi-iteration mode requires interactive terminal\\.|--max-iterations must be 1\\.\\.10 \\(got: \\$max_iterations\\)\\.|cannot combine --allow-multi-iteration with --single-iteration\\.)|Cap rationale: stacked-PR review burden .*|Pick one: drop --allow-multi-iteration .*|\"|else: +multi_iter=true; print_v14_migration_hint|emit AUTONOMOUS_RUN\\.status=\"aborted\", status_reason=\"(non_interactive_without_fallback|invalid_max_iterations|conflicting_mode_flags)\"|print to stderr:|exit|Detected: stdin is not a TTY \\(\\$\\(\\[ ! -t 0 \\] .*|Multi-iter gates \\(rubric, no-rubric, adjudication\\) need AskUserQuestion\\.|Recovery \\(pick one\\):|\\([ab]\\) /autonomous \\\\\"<requirement>\\\\\" (--single-iteration )?--non-interactive-fallback|--allow-multi-iteration is DEPRECATED in v14\\.0\\.0 \\(multi-iter is default\\)\\.|--single-iteration explicitly disables multi-iter for v13-compat\\.)$",
    },
    kinds: AUTOMATE,
    reason_class: "unparsed",
    reason: "`/autonomous` INIT's flag-resolution and argument-check pseudocode in a bash fence (`if --single-iteration: …`, `if max_iterations < 1 OR …`, `emit AUTONOMOUS_RUN.status=…`, `print to stderr:`, `exit`) and its quoted error texts, not commands.",
    consequence: "consequence if denied: none; the model follows the logic.",
  },
  {
    id: "rubric-check-guard",
    match: { type: "unparsed", files: ["skills/autonomous-loop/SKILL.md"], text: "^(has_rubric\\(\\) \\{|\\}|if ! has_rubric \"\\$current_brief_path\"; then|status=aborted; status_reason=\"rubric_dropped_from_brief\"; exit|fi)$" },
    kinds: AUTOMATE,
    reason_class: "unparsed",
    reason: "real shell the extractor reads line by line: the `has_rubric() {` … `}` function definition and its `if ! has_rubric \"$current_brief_path\"; then status=aborted; … exit fi` guard (PLAN step 6's rubric check); a compound the rail refuses by design.",
    consequence: "consequence if denied: the session reads the brief with Read and looks for the `## Outcomes Rubric` bullets itself (its awk part is text-and-runtime-tools).",
  },
  {
    id: "review-dispatch-probe",
    match: {
      type: "unparsed",
      files: ["commands/supervisor.md", "skills/self-heal-advisory/completion-tail.md"],
      text: "^(if awk -v url=\"\\{PR_URL\\}\" '\\$0 == url \\|\\| \\$2 == url \\{ found=1; exit \\} END \\{ exit\\(found \\? 0 : 1\\) \\}' \\.supervisor/review-dispatch/\\* 2>/dev/null; then|UM_DISPATCHED=true|UM_LOG=\"\\$\\(grep -rlF \"\\$\\(printf 'url=%s\\\\t' \"\\{PR_URL\\}\"\\)\" \\.supervisor/logs/review-pr-dispatch-\\*\\.log 2>/dev/null \\| head -1\\)\"|else|UM_DISPATCHED=false; UM_LOG=|fi)$",
    },
    kinds: AUTOMATE,
    reason_class: "unparsed",
    reason: "real shell, one `if awk … .supervisor/review-dispatch/* …; then UM_DISPATCHED=true; UM_LOG=\"$(grep -rlF … | head -1)\" else UM_DISPATCHED=false; UM_LOG= … fi` block read line by line: a compound the rail refuses by design.",
    consequence: "consequence if denied: the session reads `.supervisor/review-dispatch/` with Read and sets the flag itself (its awk part is 25c's).",
  },
  {
    id: "gitignore-probe",
    match: {
      type: "unparsed",
      files: ["skills/state-management/SKILL.md"],
      text: "^(gi=ignored|for p in \\.supervisor/state\\.md \\.supervisor/logs/x\\.json; do|case \\$\\? in 0\\) ;; 1\\) gi=append ;; \\*\\) gi=fallback; break ;; esac|done|\\[ \"\\$gi\" = fallback \\] && grep -qxF '\\.supervisor/' \\.gitignore 2>/dev/null && gi=ignored|case \"\\$gi\" in|append\\) +gx=\"\\$\\(git rev-parse --git-path info/exclude\\)\" && mkdir -p \"\\$\\(dirname \"\\$gx\"\\)\" && echo '\\.supervisor/' >> \"\\$gx\" ;;|fallback\\) echo '\\.supervisor/' >> \\.gitignore ;;|esac)$",
    },
    kinds: AUTOMATE,
    reason_class: "unparsed",
    reason: "real shell, the `.supervisor/` gitignore probe (`gi=ignored`, `for p in …; do … case $? in … esac … done`, `case \"$gi\" in append) … >> \"$gx\" ;; fallback) echo '.supervisor/' >> .gitignore ;; esac`) read line by line: a compound the rail refuses by design.",
    consequence: "consequence if denied: the session runs the parts one by one (its `git check-ignore` part is git-subcommands-unlisted, 25c).",
  },
  {
    id: "preflight-base-tip",
    match: { type: "unparsed", files: ["skills/preflight-sync/SKILL.md"], text: "^BASE_TIP=\\$\\(git rev-parse --short \"origin/\\$BASE_BRANCH\"\\)$" },
    kinds: AUTOMATE,
    reason_class: "unparsed",
    reason: "real shell, preflight-sync's `BASE_TIP=$(git rev-parse --short \"origin/$BASE_BRANCH\")`: an assignment from a command substitution, which the rail refuses by design (`$`, `(`).",
    consequence: "consequence if denied: the session runs `git rev-parse --short origin/<base>` itself (an admitted prefix, launch.ts:182) and reads the sha from its output.",
  },
  {
    id: "commit-message-examples",
    match: {
      type: "unparsed",
      files: ["skills/commit/SKILL.md"],
      text: "^(feat\\(auth\\): add jwt token refresh endpoint|Implement refresh token endpoint with sliding window expiration\\.|fix\\(gateway\\): correlation ID not propagated to upstream|refactor\\(nestjs\\): extract service validation logic|chore: update dependencies|Closes BD-(45|67|78|89))$",
    },
    kinds: AUTOMATE,
    reason_class: "advisory, never instructed",
    reason: "the commit skill's \"Common Patterns\" sample commit messages, written in a bash fence: message text, not commands.",
    consequence: "consequence if denied: none.",
  },
  {
    id: "driver-dynamic-launch",
    match: { type: "unparsed", files: ["scripts/automate-next-step.sh"], text: "^\\$[aw]$" },
    kinds: [...AUTOMATE, ...MERGE],
    reason_class: "unparsed",
    reason: "the driver's `run launch` text names the `phase-wait` / `phase-answer` commands through shell variables; it is printed only for a fresh-phase launch, which `--inline-phases` never takes.",
    consequence: "consequence if denied: none in safe mode.",
  },
] satisfies readonly RunExclusion[]);

/** One command a Loomwright script the run policies admit runs itself, past the rail: recorded, not judged here (25h decides). */
export interface PastTheRail {
  readonly id: string;
  /** Install-relative path of the script whose line runs it. */
  readonly script: string;
  readonly line: number;
  /** A substring the cited line must hold (a moved line fails the test). */
  readonly anchor: string;
  readonly runs: string;
  readonly condition: string;
  readonly kinds: readonly RunSessionKind[];
}

/** What admitted scripts run past the rail (read from 18.1.2; the probe of 25h observes them). */
export const PAST_THE_RAIL: readonly PastTheRail[] = Object.freeze([
  {
    id: "rh-gh-pr-comment",
    script: "scripts/review-heal-next-step.sh",
    line: 290,
    anchor: 'pr comment "$PR" --body',
    runs: "`gh pr comment` on the PR (`rh_comment`, lines 289-291)",
    condition: "an escalation or findings comment, called at lines 812, 821 and 998",
    kinds: [...AUTOMATE, ...REVIEW],
  },
  {
    id: "rh-send-webhook",
    script: "scripts/review-heal-next-step.sh",
    line: 318,
    anchor: 'bash "$HERE/send-webhook.sh" --event-type gate',
    runs: "`send-webhook.sh` (an outward POST when a webhook is configured)",
    condition: "a review_heal_ready / review_heal_escalated gate",
    kinds: [...AUTOMATE, ...REVIEW],
  },
  {
    id: "rh-postmortem-dispatch",
    script: "scripts/review-heal-next-step.sh",
    line: 323,
    anchor: 'bash "$HERE/dispatch-pr-postmortem.sh"',
    runs: "a detached `dispatch-pr-postmortem.sh`, which starts headless `claude` (unless `RH_POSTMORTEM_CMD` is set)",
    condition: "`rh_postmortem_call`, reached once per drain end",
    kinds: [...AUTOMATE, ...REVIEW],
  },
  {
    id: "rh-postmortem-once",
    script: "scripts/review-heal-next-step.sh",
    line: 1098,
    anchor: "rh_once postmortem rh_postmortem_call",
    runs: "the postmortem dispatch above",
    condition: "a terminal drain with auto postmortem on",
    kinds: [...AUTOMATE, ...REVIEW],
  },
  {
    id: "ans-merge-watch",
    script: "scripts/automate-next-step.sh",
    line: 814,
    anchor: 'nohup bash "$HERE/automate-merge-watch.sh"',
    runs: "a detached `automate-merge-watch.sh` watcher (pushes a trail PR and posts a webhook at close-out)",
    condition: "an item parked `awaiting_merge` while `NEXT_STEP_WATCH_CMD` is unset (the kernel does not set it; seam at line 810)",
    kinds: [...AUTOMATE, ...MERGE],
  },
  {
    id: "helpers-gate-eval-merge",
    script: "scripts/automate-helpers.sh",
    line: 1179,
    anchor: '"$GH" pr merge --squash --match-head-commit "$live_head"',
    runs: "the squash merge of `gate-eval`, Loomwright's one merge executor (the anchor's line)",
    condition: "the driver's `--merge-parked` gate on a `go` (the kernel's sanctioned merge, invariant 4)",
    kinds: MERGE,
  },
  {
    id: "meta-sync-push",
    script: "scripts/meta-sync.d/commands.sh",
    line: 23,
    anchor: 'g push -q origin "$c:refs/heads/$BRANCH"',
    runs: "`git push` of the metadata branch through meta-sync's git wrapper",
    condition: "branch mode's first metadata push (`meta-sync.sh init`), run by the driver",
    kinds: AUTOMATE,
  },
] satisfies readonly PastTheRail[]);
