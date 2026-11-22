# Supervisor Job: 25b — The rail reads quoted text as text

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-20-174137/L2
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-25/2026-11-20-120100-25b-the-rail-reads-quoted-text-as-text.md
- **Base commit:** 9b3ca660fba2decaaef7c34aa08f4d5b2ec91bfd

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest in `kernel/`; a pure string parser, no new stack |
| 2 | Dependency Availability | GO | No dependency: `shell-quote` / `shlex` / `bash-parser` are absent from `kernel/package.json` and the lockfile (0 hits) and are not wanted (Design decisions) |
| 3 | Architecture Fit | GO | Changes the policy's Bash gate (`decideToolUse`) inside the fixed safety kernel (invariant 3), owner-approved in the requirement's Owner decisions |
| 4 | Scope vs Supervisor Capability | CAUTION | 1 subtask, 9 files (7 modify, 2 create); 5 of them are outside the requirement's `## Touches` (shared parser module + its test, `loomwright-scripts.ts`, a closed list in `phase-4-exit-live.test.ts`, `docs/architecture/approvals.md`) — recorded in `## Scope widening` for the coordinator |
| 5 | Hard Blockers | GO | None |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make the policy's Bash gate judge a command by its shell meaning: a metacharacter inside quotes is text, while unquoted pipes, redirects, chains, substitutions and anything the parser does not model stay refused.

**Problem Statement:**
The owner needs kernel-run sessions to commit with a `Co-Authored-By: … <…>` trailer, answer the Loomwright drivers with a `--result` note holding `(`, `;` or `$`, and pass text such as `PASS (attempt 1/3)` or a PR body, because each of these is refused today.
Currently, `decideToolUse` refuses any of `[;&|<>()$` + backtick + newline/CR anywhere in the raw command (`SHELL_METACHARACTERS`, `kernel/src/sessions/policy.ts`), quoted or not. This causes a retry with the note stripped on every such call (events 29820 → 38082 in the requirement) and one lost commit trailer (session 231, `c54de0b`).
Success looks like: every observed quoted-only denial is admitted by `decideToolUse`, every genuine compound form is still refused exactly as today, and anything the parser cannot model is refused with a new reason `bash_unparsed`.

**Design (what the worker builds):**
- A new pure module `kernel/src/sessions/shell-words.ts` is the ONE quote-aware tokenizer. It exports `parseBashCommand(command: string): BashParse` where `BashParse` is `{ kind: "words"; words: string[] } | { kind: "metacharacter" } | { kind: "unparsed" }`, and it also backs the two existing word splitters (extract, see File Impact Map) so no third copy exists.
- Quoting rules it models (bash): single quotes keep everything literally to the next `'`; double quotes keep everything to the next unescaped `"`, a backslash there escapes only `"` and `\` (any other `\x` inside double quotes stays two characters, as bash keeps it); unquoted, a backslash escapes the next character when it is an ordinary character, a space or tab, or a quote (`Application\ Support` is one word, `\"hi\"` is the word `"hi"`, as bash reads them); space and tab separate words; adjacent quoted and unquoted parts join into one word.
- Outcome, first match wins:
  1. `unparsed` (→ `bash_unparsed`): an unterminated `'` or `"`; an unquoted trailing `\`; an unquoted `\` before a metacharacter (`; & | < > ( ) $` backtick), a newline or CR (an escape the parser does not model: fail closed rather than admit an escaped control character); `$'…'` or `$"…"` (ANSI-C / locale quoting); an unquoted heredoc or here-string marker `<<` (`<<-`, `<<<` included).
  2. `metacharacter` (→ `bash_shell_metacharacter`): any unquoted `;` `&` `|` `<` `>` `(` `)` `$` backtick, newline or CR; a `$` or backtick anywhere inside double quotes (expansion); a newline or CR anywhere, quoted or not (the fixed rail's `UNREADABLE_BASH_CHARS` refuses every C0 control character but tab, so a quoted newline admitted here would only be denied one layer later with a misleading reason).
  3. `words` otherwise.
- `decideToolUse` (Bash branch) calls `parseBashCommand` once, after the non-string check, in place of `SHELL_METACHARACTERS.test(command)`; the prefix rule then requires BOTH the existing raw-text form (`command === prefix || command.startsWith(`${prefix} `)`, unchanged) AND that the parsed words start with the prefix's own words (`parseBashCommand(prefix)`; a prefix that does not parse to words matches nothing). No command allowed today is widened except by quote admission. Two narrowings are intended and named (D-row, Risk Assessment): (a) an owner prefix whose own quoting is open (`git -c '`, `git -C \`) now admits nothing, because its quote would run into the command's arguments and make an argument read as part of the program; (b) an unterminated quote or an unquoted trailing `\` now answers `bash_unparsed`: today such a command is allowed under a plain prefix (`echo 'x`) or refused `bash_prefix_not_allowed` by the script matcher. (An unquoted `\` before a metacharacter, newline or CR was already refused today by the raw regex; only its reason changes.) `matchLoomwrightScript` and `bashTouchesLoomwrightRunState` keep reading words through the shared tokenizer.
- `ToolDecisionReason` gains `bash_unparsed` (a policy reason only; `RailDenyReason` is unchanged).
- `SHELL_METACHARACTERS` and its doc comment are removed or rewritten to describe the parsed rule (no dead regex left behind).

**Out of scope (non-goals, verbatim intent):** admitting pipes, redirects, chains or command substitution, quoted or not; changing which programs are admitted (25c, 25d); changing the fixed rail (`classifyToolCall`, `UNREADABLE_BASH_CHARS`).

**Post-merge validation (not satisfiable inside this PR):** the requirement's Validation 3 (next live walk: no `bash_shell_metacharacter` denial on a quoted-only command in the run sessions' `tool_decision` events) is checked on the next live `/automate` walk, after merge.

## Design decisions
- decision: Where the quote-aware tokenizer lives and what it is built from
  chosen: Extract the two existing word splitters (`shellWords` in `kernel/src/sessions/policy.ts`, `shellWords` in `kernel/src/sessions/loomwright-scripts.ts`) into one new pure module `kernel/src/sessions/shell-words.ts`, extended with metacharacter and unparsed outcomes; both old names become thin wrappers with unchanged output
  rejected: Add the parser inside `policy.ts` — blast radius partial and module layout no: `policy.ts` is 1463 lines (past the 500-line threshold) and a third copy of the splitter would be written beside the two that exist
  rejected: An npm shell parser (`shell-quote`, `bash-parser`) — already in the lockfile: no (0 hits in `kernel/package.json` / `package-lock.json`); reversibility partial: its tokenizer would decide a safety-kernel refusal, and its expansion and operator semantics differ from the rail's fail-closed reading, so every refusal would need re-pinning against an outside model
  evidence: `grep -rn "shellWords" kernel/src` → `policy.ts:873 export function shellWords`, `loomwright-scripts.ts:243 function shellWords(args: string): string[] | undefined`, consumers `draft-mode.ts:11`, `dry-run.ts:7`; `grep -c "shell-quote\|shlex\|bash-parser" kernel/package.json kernel/package-lock.json` → 0, 0
  revisit when: the rail needs to admit a compound form (pipes, chains), which would need a real grammar, not a tokenizer
  status: confirmed

## Acceptance Criteria
- [ ] AC1 — Given a Bash command whose only metacharacters sit inside single quotes (e.g. `git commit -m 'fix (x); a | b'`), when `decideToolUse` decides it, then it is judged on its parsed words (prefix, script path, driver options profile) as if the quoted text were plain, and is admitted (`bash_prefix_allowed`) when those are.
- [ ] AC2 — Given a double-quoted part containing `$` or a backtick (e.g. `git commit -m "a $HOME"`, ``git commit -m "a `id`"``), when `decideToolUse` decides it, then it is refused `bash_shell_metacharacter`; and given a double-quoted part holding any other metacharacter (`;` `&` `|` `<` `>` `(` `)`), then that character is text and the command is judged on its words as in AC1.
- [ ] AC3 — Given an unquoted `;`, `&`, `&&`, `||`, `|`, `<`, `>`, `(`, `)`, `$`, a backtick, a newline or a carriage return, when `decideToolUse` decides, then it is refused `bash_shell_metacharacter` exactly as today (every case in the existing `metacharacters` table in `kernel/test/sessions-policy.test.ts` keeps its reason); and a newline or CR inside quotes is refused `bash_shell_metacharacter` too.
- [ ] AC4 — Given an unterminated single or double quote, an unquoted trailing `\` or an unquoted `\` before a metacharacter, a newline or CR, `$'…'`, `$"…"`, or a heredoc / here-string marker (`<<`, `<<-`, `<<<`), when `decideToolUse` decides, then it is refused (fail closed) with the new reason `bash_unparsed`.
- [ ] AC5 — Given the words the shared tokenizer computes, when the prefix check, the admitted-script path check (`matchLoomwrightScript`), the driver options profile (`asksDeniedSubcommand` / `asksDeniedDriverArgument`), the run-state check (`bashTouchesLoomwrightRunState`) and the rail's `~/.claude` read (`classifyToolCall`, `settings_write` / `agent_boundary`) run, then each reads those parsed words: a quoted argument is never taken as the program, and a denied driver option or subcommand stays refused however it is quoted (`'--trust-unprotected'`, `"gate-eval"`), while a `--result '<json>'` value holding `(`, `;` or `$` is read as one word, a policy prefix only matches when the parsed leading words equal the prefix's words, and a `~/.claude/…` path inside single or double quotes is still read by the rail as `~/.claude/` (outward `settings_write`, and `agent_boundary` under a `never: ["settings_write"]` policy).
- [ ] AC6 — Given the observed denials in the requirement, replayed as test cases in `kernel/test/sessions-policy.test.ts` under the run policy (`AUTOMATE_RUN_POLICY` shape: `RUN_BASH_PREFIXES` + admitted Loomwright scripts), when `decideToolUse` decides them, then each is admitted: `git commit -m "<subject>\n\nCo-Authored-By: Claude … <noreply address>"` written on one line (`-m` given twice, no newline), `bash <admitted>/supervisor-next-step.sh … --result '{"reason": "… (…) …"}'`, `bash <admitted>/automate-next-step.sh … --result '{"note": "a; b (c) $d"}'`, `bash <admitted>/launch-pad-phase.sh 5.5 'PASS (attempt 1/3)'` (when that script is admitted in the policy under test; otherwise its quoted-argument form is asserted against a prefix policy), and `gh pr create --title "fix(kernel): x" --body "a (b) <c>"`; and each genuine compound form from the denial inventory — `P=/x; bash $P/y.sh`, `ls && cat -A f`, `cat f > out 2>&1` — is still refused `bash_shell_metacharacter`. The rail outcome of the admitted replays is pinned too: `gh pr create …` stays `outward` (held), `gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'` is admitted by the policy and still `merge_blocked` by the rail, and `git commit -m 'push'` keeps the rail's documented over-hold.
- [ ] AC7 — Given the shared tokenizer, when its table test runs (`kernel/test/shell-words.test.ts`), then a pinned fuzz-style table of tricky inputs — at least `'a'"$b"` (metacharacter), `"\""` (words `"`), `'it''s'` (words `its`), `"a'b"` (words `a'b`), `'a"b'` (words `a"b`), `"a\\"` (words `a\`), `"a\$b"` (metacharacter), `$'x'` (unparsed), `'unterminated` (unparsed), `"unterminated` (unparsed), `a\` (unparsed), `a\;b` (unparsed), `\"hi\"` (words `"hi"`), `a\ b` (words `a b`), `cat <<EOF` (unparsed), `cat <<<x` (unparsed), `a'b;c'd` (words `ab;cd`), `''` (one empty word) — gives the stated outcome for each, and the two wrapped splitters keep their existing outputs (`shellWords` in `policy.ts` still returns `["echo", "unterminated here"]` for `echo 'unterminated here`; the Loomwright-script splitter still fails closed on an unquoted `UNQUOTED_EXPANSION` character).
- [ ] AC8 — Given the change, when `docs/DECISIONS.md` is read, then a new row with the next free D-number (D48 at base `9b3ca660`; re-check at implementation time and take the next free one if another lane took it) states the rule (quoted metacharacters are text; double-quoted `$`/backtick and quoted newlines are refused; unmodelled forms are `bash_unparsed`; prefix and script checks read parsed words) with its why and what was rejected (keeping the rail strict and changing Loomwright's instructions, per the owner decision of 2026-11-20); and `docs/architecture/automate.md` (its "The Bash rail may deny a live run mid-run" known limit and the "What stays denied" driver-script bullet) and `docs/architecture/approvals.md` (the paragraph that says "The policy has already refused shell control and substitution characters" and the `tool_decision` reasons row) describe the parsed rule and name `bash_unparsed`.
- [ ] AC9 — Given the change, when `cd kernel && npm test` runs, then the whole kernel suite passes (typecheck included), and reverting `decideToolUse` to the raw `SHELL_METACHARACTERS` test turns the AC6 trailer and `--result` replays red (requirement Validation 2; see `## Pin mutations`).

## Scope widening
- kernel/src/sessions/shell-words.ts
- kernel/src/sessions/loomwright-scripts.ts
- kernel/test/shell-words.test.ts
- kernel/test/phase-4-exit-live.test.ts
- docs/architecture/approvals.md
- accepted: LP-SCOPE 2026-11-21

## Touched-file invariants

> Grounded at base `9b3ca660fba2decaaef7c34aa08f4d5b2ec91bfd`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/sessions/policy.ts`** — keep: the non-string check runs first, `if (command === undefined) return { decision: "deny", reason: "bash_command_not_string" };`; the metacharacter/parse decision runs BEFORE the driver match (`// A Loomwright driver by exact path (AC15), after the metacharacter check: never a \`bash\` prefix.`); the raw-text prefix form `(command === prefix || command.startsWith(\`${prefix} \`))` and the empty-prefix guard `prefix.trim() !== ""`; the run-state check after an allow, `if (runPolicy && bashTouchesLoomwrightRunState(command)) return { decision: "deny", reason: "loomwright_run_state" };`; the fixed rail untouched, `if (UNREADABLE_BASH_CHARS.test(command)) return { kind: "deny", reason: "bash_shell_metacharacter" };` and `export type RailDenyReason = "protected_kernel_path" | "merge_blocked" | "bash_shell_metacharacter" | "bash_command_too_large";`; `decideToolUse` stays pure (`The kernel's tool decision. Pure: no I/O. Deny by default.`). reuse: the shared tokenizer for every word read; `shellWords` stays exported from `policy.ts` with identical output (re-export or wrapper), since `draft-mode.ts` (`import { MAX_RAIL_COMMAND_LENGTH, bashCommandOf, programCouldBe, shellWords } from "./policy.js";`), `dry-run.ts` (`import { bashCommandOf, shellWords } from "./policy.js";`) and tests import it from there. mirror: the hook's deny reason is the `ToolDecisionReason` string the manager records (`type GateReason = ToolDecisionReason | "kernel_gate_error" | "dry_run" | "held_refused";` in `kernel/src/sessions/manager.ts`); `ToolDecisionReason` is re-exported by `kernel/src/sessions/index.ts` (`export type { ToolDecision, ToolDecisionReason } from "./policy.js";`). fired by: `SessionManager`'s `PreToolUse` gate in `manager.ts` for every tool call. pinned by: `kernel/test/sessions-policy.test.ts` (`const metacharacters: [string, string][] = [`, `expect(bash("echo\thi")).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });`), `kernel/test/approvals.test.ts` (`expect(shellWords("echo 'unterminated here")).toEqual(["echo", "unterminated here"]);`), `kernel/test/automate-launch.test.ts` (`{ command: "git status | cat" })).toEqual({ decision: "deny", reason: "bash_shell_metacharacter" });`), `kernel/test/sessions-live.test.ts` (`` expect(await gate(`bash ${next} $(id)`)) ``).
- **`kernel/src/sessions/loomwright-scripts.ts`** — keep: its splitter's fail-closed contract, `const UNQUOTED_EXPANSION = /[*?[\]{}~^#!]/;` (an unquoted glob/brace/tilde/`^`/`#`/`!` → `undefined`), an unterminated quote or trailing backslash → `undefined`; `asksDeniedSubcommand` and `asksDeniedDriverArgument` returning `true` when `words === undefined` (`if (words === undefined) return true;`); `matchLoomwrightScript`'s path forms (`const PLAIN_PATH = /^\/[A-Za-z0-9_./@%+=:,-]*$/;`, a double-quoted path rejecting `/[\\$\`]/`, `if (after !== "" && !after.startsWith(" ")) return undefined;`). reuse: the shared tokenizer in `shell-words.ts` (the local `function shellWords(args: string): string[] | undefined` becomes a wrapper over it plus the `UNQUOTED_EXPANSION` check on unquoted characters, same outputs). mirror: `decideToolUse` runs the parse decision before `matchLoomwrightScript` (its doc: `The caller runs the shell-metacharacter check first (\`decideToolUse\`)`) — update that sentence to name the parsed check, the order stays. pinned by: `kernel/test/sessions-policy.test.ts` (`` expect(decide(driver, `--session-id s1 --result '{"a": 1}`)).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" }); `` — this unterminated-quote pin moves to `bash_unparsed` by AC4, the only intended reason change there) and `kernel/test/automate-launch-routes.test.ts` (`DENY = { decision: "deny", reason: "bash_prefix_not_allowed" }`).
- **`kernel/test/phase-4-exit-live.test.ts`** — keep: `pushDecisionOf` classifying a policy deny as `policy_deny`; `pushWitnessOf`'s contract (every witness it returns is allowed by the real `decideToolUse` under `[prefix]` and read as a push by the real rail). Intended changes, and only these: (1) the closed list `const POLICY_DENY_REASONS: readonly string[] = [` gains `"bash_unparsed"`; (2) the two open-quoting rows of `OTHER_FORM_PREFIXES`, `["git -c '", "git -c ' ' push origin main"],` and `["git -C \\", "git -C \\  push origin main"],`, move out of that list into the expected-null list of the "leaves out a prefix" test (beside `"git '", "git \\"`), because such a prefix now admits nothing (narrowing (a)); (3) `closedPrefix` and the `wordsClosed` helper, now unreachable for an allowed prefix (a prefix `decideToolUse` allows as a command parses closed), are removed or reduced, and `pushWitnessOf`'s doc stops describing open quoting. pinned by: itself (`expect(redirected).toEqual({ kind: "policy_deny", reason: "bash_shell_metacharacter", command: "git push origin main 2>&1" });` must still hold: an unquoted redirect stays `bash_shell_metacharacter`; `OTHER_FORM_PREFIXES.slice(0, 4)` keeps its first four rows unchanged).
- **`kernel/test/sessions-policy.test.ts`** — keep: every row of `const metacharacters: [string, string][] = [` with its reason `bash_shell_metacharacter`; the prefix word-boundary pins (`expect(bash(" echo hi")).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });`, `expect(bash("echo\thi"))…`) unchanged, since the raw prefix form is kept; every `DENY` row of the driver-profile tests other than those listed here. Intended reason changes to `bash_unparsed`, and only these: the unterminated-quote row `` `${runFile} --start run "--mode safe`, ``, the trailing-backslash row `` `${runFile} --start run \\`, `` (both move out of the `denied` list asserted `DENY` into a `bash_unparsed` assertion), and `` expect(decide(driver, `--session-id s1 --result '{"a": 1}`)) ``. The pin `` `--session-id s1 --result {\\"confirmed\\":true}` `` stays `bash_prefix_not_allowed` (its escape is modelled; the script matcher refuses its unquoted `{`). New cases are appended (AC1–AC6). Any other pin in the kernel suite that turns red is a narrowing not planned here: stop and report it rather than editing the pin.

## Closed enumerations touched

> Sibling grep at base `9b3ca660`: `grep -rnF 'bash_command_not_string' --exclude-dir=node_modules --exclude=CHANGELOG.md .` → hits in `kernel/src/sessions/policy.ts` (2), `kernel/test/sessions-policy.test.ts` (1), `kernel/test/phase-4-exit-live.test.ts` (1), `.supervisor/twin/contracts/kernel-src-sessions-policy.ts.md` (1), `.supervisor/jobs/done/2026-11-16-kernel-launches-triage-fix-and-merge.md` (1), plus this Launch Pad session's own `.supervisor/automate/…/stream.log` (transcript, not a list).

- **`bash_unparsed`** (sibling: `bash_command_not_string`) — must be named in:
  - `kernel/src/sessions/policy.ts` — the `ToolDecisionReason` union (`| "bash_command_not_string"`) — extend.
  - `kernel/test/phase-4-exit-live.test.ts` — `POLICY_DENY_REASONS` (`"tool_not_allowed", "bash_prefix_not_allowed", "bash_command_not_string", "bash_shell_metacharacter"`), the policy's own deny reasons — extend.
  - `docs/architecture/approvals.md` — the `tool_decision` event row listing the gate's reasons (`and \`bash_shell_metacharacter\` now also for a command the rail will not read`) — extend (name `bash_unparsed` as a policy reason).
  - `kernel/test/sessions-policy.test.ts` — a pin (`reason: "bash_command_not_string"`), not a list — no change.
  - `.supervisor/twin/contracts/kernel-src-sessions-policy.ts.md` — System Twin contract, rebuilt by Loomwright's builder, not hand-kept — no change.
  - `.supervisor/jobs/done/2026-11-16-kernel-launches-triage-fix-and-merge.md` — an archived brief — no change.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions-policy.test.ts` — AC6 replayed `Co-Authored-By` trailer and `--result` cases admitted | in `kernel/src/sessions/policy.ts` `decideToolUse`, replace the `parseBashCommand(command)` decision with the pre-25b `if (/[;&\|<>()$\`\n\r]/.test(command)) return { decision: "deny", reason: "bash_shell_metacharacter" };` — the replays turn red (requirement Validation 2) |
| `kernel/test/sessions-policy.test.ts` — AC3 unquoted metacharacter table | in `kernel/src/sessions/shell-words.ts`, make the unquoted-metacharacter branch append the character to the word instead of returning `metacharacter` — every row but newline and carriage return turns red (those two are refused by the separate anywhere-newline check; delete that check to turn them red) |
| `kernel/test/sessions-policy.test.ts` — AC2 double-quoted `$` / backtick refused | in `kernel/src/sessions/shell-words.ts`, delete the line that returns `metacharacter` for `$` or a backtick inside double quotes |
| `kernel/test/sessions-policy.test.ts` — AC4 unterminated quote / `$'…'` / heredoc → `bash_unparsed` | in `kernel/src/sessions/shell-words.ts`, flip the unterminated-quote branch's `kind: "unparsed"` → `kind: "words"` (and, for the heredoc row, delete the `<<` check line) |
| `kernel/test/sessions-policy.test.ts` — AC5 prefix reads parsed words (a prefix holding a quote, e.g. `echo "a`, does not admit `echo "a b"`) | in `kernel/src/sessions/policy.ts`, delete the parsed-word prefix comparison, keeping only the raw `startsWith` form |
| `kernel/test/sessions-policy.test.ts` — AC6 `gh api graphql -f query='mutation { mergePullRequest … }'` stays `merge_blocked` | in `kernel/src/sessions/policy.ts`, flip `const API_MERGE_MUTATION = /mergePullRequest\|enablePullRequestAutoMerge\|enqueuePullRequest/i;` to a regex that cannot match — the pin turns red |
| `kernel/test/shell-words.test.ts` — AC7 fuzz table (`'it''s'` → `its`, `"\""` → `"`) | in `kernel/src/sessions/shell-words.ts`, drop the double-quote `\"` escape handling (keep the backslash) — the `"\""` row turns red |
| `kernel/test/phase-4-exit-live.test.ts` — `POLICY_DENY_REASONS` names `bash_unparsed` | delete `"bash_unparsed"` from the `ToolDecisionReason` union in `kernel/src/sessions/policy.ts` — typecheck fails where `decideToolUse` returns it |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Quote-aware Bash policy gate (shared tokenizer, `bash_unparsed`, tests, D48 + docs) | all | 7 modify, 2 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/sessions/shell-words.ts"}
  - {kind: "symbol", path: "kernel/src/sessions/shell-words.ts", name: "parseBashCommand"}
  - {kind: "type", path: "kernel/src/sessions/shell-words.ts", name: "BashParse"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "bash_unparsed"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "shellWords"}
  - {kind: "file", path: "kernel/test/shell-words.test.ts"}
  - {kind: "symbol", path: "kernel/test/phase-4-exit-live.test.ts", name: "bash_unparsed"}
  - {kind: "symbol", path: "docs/DECISIONS.md", name: "bash_unparsed"}
  - {kind: "symbol", path: "docs/architecture/automate.md", name: "bash_unparsed"}
  - {kind: "symbol", path: "docs/architecture/approvals.md", name: "bash_unparsed"}
requires: []
lanes:
  - "kernel/src/sessions/shell-words.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/sessions/loomwright-scripts.ts"
  - "kernel/test/shell-words.test.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/phase-4-exit-live.test.ts"
  - "docs/DECISIONS.md"
  - "docs/architecture/automate.md"
  - "docs/architecture/approvals.md"
external_requires: []
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| tokenizer (extract) | `kernel/src/sessions/policy.ts` (1463), `kernel/src/sessions/loomwright-scripts.ts` (429) | `kernel/src/sessions/shell-words.ts` | HIGH |
| tests | `kernel/test/sessions-policy.test.ts` (1183), `kernel/test/phase-4-exit-live.test.ts` (1472) | `kernel/test/shell-words.test.ts` | HIGH |
| docs | `docs/DECISIONS.md` (53), `docs/architecture/automate.md` (193), `docs/architecture/approvals.md` (306) | — | HIGH |

**Module layout (`skills/supervisor-readiness/SKILL.md` §"Module layout"):**
- extract `shellWords` (copied in `kernel/src/sessions/policy.ts` and `kernel/src/sessions/loomwright-scripts.ts`) into `kernel/src/sessions/shell-words.ts` (CREATE); both old functions become thin wrappers with unchanged outputs. The new parse outcomes (`metacharacter` / `unparsed`) live in that module too — never a third splitter.
- `kernel/src/sessions/policy.ts` (1463) — appended: only the call site in `decideToolUse`, the `bash_unparsed` union member and the parsed-word prefix comparison (a few lines; `decideToolUse` is the single authority for the policy decision).
- `kernel/test/sessions-policy.test.ts` (1183) — appended: the replayed denials and the decision-level refusal table, because the requirement's Validation 1 names this file as their home; the tokenizer's own table goes to the new `kernel/test/shell-words.test.ts`.
- `kernel/test/phase-4-exit-live.test.ts` (1472) — appended: one value in the closed `POLICY_DENY_REASONS` list (the single authority for it).

**Blast-Radius / Impact Prediction (advisory):** `kernel/src/sessions/policy.ts` — DEPENDS_ON `kernel/src/sessions/types.ts`; DEPENDED_ON_BY `docs/ARCHITECTURE.md`, `kernel/src/sessions/index.ts`, `kernel/src/sessions/manager.ts`. Also reached through `shellWords`: `kernel/src/sessions/draft-mode.ts`, `kernel/src/sessions/dry-run.ts` (outputs unchanged by AC7).

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/sessions/policy.ts:80` | yes | HOLDS | ``const SHELL_METACHARACTERS = /[;&|<>()$`\n\r]/;`` | tip 24 hours ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Parser bugs are security bugs: a quote the tokenizer reads differently from bash lets a chained command through the policy | HIGH | Fail closed on every form not modelled (`bash_unparsed`); the AC7 fuzz table and the AC3 refusal table are pinned; the fixed rail still reads every admitted command (`classifyToolCall`) and stays unchanged; keep the raw-text prefix form so nothing allowed today is widened beyond quote admission |
| Quoted text now reaches the rail: `gh api … -f query='mutation { mergePullRequest … }'` or a quoted `push` word | HIGH | AC6 pins `merge_blocked` for the quoted GraphQL mutation and the documented `git commit -m 'push'` over-hold; `gh pr create` replays stay `outward` (held) |
| A replayed `gh pr create --body` (event 31706) or commit message held a real newline: a quoted newline stays refused here and by the rail's `UNREADABLE_BASH_CHARS` | MEDIUM | AC3 refuses quoted newlines on purpose (one consistent reason across both layers); replays are written on one line (`-m` given twice); a multi-line body needs `--body-file` or a rail change, which is out of scope (non-goal) and noted in the D-row |
| The replay cases are rebuilt from the requirement's text, not copied from studio.db (not reachable from this checkout) | MEDIUM | Each AC6 case reproduces the shape the requirement names (trailer `<…@…>`, `--result` JSON with `(`, `;`, `$`, `PASS (attempt 1/3)`, PR title with `(`); the post-merge live walk (requirement Validation 3) checks the real calls |
| Parallel lanes (25a/25c/25d) may also add a D-row and edit `docs/architecture/automate.md` or `policy.ts` | MEDIUM | AC8 takes the next free D-number at implementation time; rebase onto `main` before PR; keep edits to `policy.ts` local to `decideToolUse` and the reason union |
| Feasibility (Phase 2.5): 5 paths outside the requirement's Touches (shared tokenizer module + test, `loomwright-scripts.ts`, a closed list in `phase-4-exit-live.test.ts`, `docs/architecture/approvals.md`) | MEDIUM | Recorded under `## Scope widening` with `decision: pending-coordinator`; each is required by the module-layout extract rule, a closed enumeration or a doc that would otherwise go stale |
| The safety-kernel policy is tightened, not only loosened: an owner prefix with open quoting (`git -c '`, `git -C \`) now admits nothing, and an unterminated quote under a plain prefix (`echo 'x`, allowed today) is now `bash_unparsed` | MEDIUM | Intended (fail closed: an open quote in a prefix would read the command's arguments as part of the program); named in the D-row; the two `OTHER_FORM_PREFIXES` rows move to the expected-null list; any other newly red pin is reported, not edited |
| Four pins change reason from `bash_prefix_not_allowed` to `bash_unparsed` (sessions-policy.test.ts unterminated-quote and trailing-backslash driver rows, the `--result '{"a": 1}` row) | LOW | Intended by AC4; each call stays denied; listed in Touched-file invariants and updated in the same change |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-20-rail-reads-quoted-text-as-text.md
```


## Outcome
- **Status:** completed
- **Completed:** 2026-11-21T05:55:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/301
- **Branch:** feature/rail-reads-quoted-text-as-text
- **Files changed:** 9
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Added kernel/src/sessions/shell-words.ts (parseBashCommand) as the one quote-aware tokenizer; decideToolUse judges a Bash command's parsed words, admits quoted metacharacters as text, keeps unquoted compound forms, double-quoted $/backtick and line breaks as bash_shell_metacharacter, and refuses unmodelled forms as bash_unparsed. D48 plus automate/approvals docs updated. Kernel suite 5088 passed; Phase 4.5 review PASS with 3 LOW findings dismissed below the MEDIUM floor (2 stale comments in launch.ts / dry-run.ts, 1 pre-existing mergeBranch/REST merge gap in API_MERGE_MUTATION).

## Not verified
- **live /automate run session tool_decision events (requirement Validation 3)** — needs the next live walk after merge; no live runtime from this checkout (subtask 1)
