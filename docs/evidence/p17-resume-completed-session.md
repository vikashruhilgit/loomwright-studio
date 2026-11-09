# Evidence: resuming a completed SDK session (probe p17)

Thread continuity (17b, Part 1) continues a reply's thread either by resuming the earlier session's SDK conversation or by replaying the thread as quoted data. `SessionManager.resumeSession` only takes `interrupted` or `orphaned` rows, so whether the SDK resumes a session that ended normally (`result/success`) had never been observed. This page records what the probe saw.

**Result: a completed session resumes cleanly by its SDK session id, in the same process, from a fresh process, and after files in its cwd changed; the model kept the earlier exchange each time. A session whose saved conversation is gone, either because its transcript was deleted or because the id never existed, fails at once with a `result` message `error_during_execution` whose `errors` reads `No conversation found with session ID: <id>`. The failure comes before `system/init` and before any model turn, and costs 0 tokens.**

Verdict: PASS for Validation 2

## How it was run

- **Run by the worker on 2026-11-09** (runs at 15:28 and 15:29 UTC), macOS (Darwin 25.6.0), Node v24.11.1, `@anthropic-ai/claude-agent-sdk` **0.3.284** (the version pinned in `probes/package.json`, installed with `cd probes && npm ci`), bundled CLI **2.1.284** (`system/init.claude_code_version`).
- Script: [`probes/p17-resume-completed-session.mjs`](../../probes/p17-resume-completed-session.mjs). Run with `cd probes && node p17-resume-completed-session.mjs > out.json`. It ran twice, and the two runs agree on every field below.
- Auth was the machine's normal Claude login (`settingSources: ['user']`, `apiKeySource: "none"`), as in p5 and p7. Model: `claude-haiku-4-5-20251001`, `permissionMode: 'default'`.
- Each case starts its **own** seed session in a fresh scratch dir under `$TMPDIR` (`realpath`ed), so one case's resume can't put its marker into another case's transcript. The seed prompt is `The marker word is MARK<6 hex>. Remember it. Reply with exactly: NOTED` (`maxTurns: 1`, no tools). In case (c) the seed also uses the Read tool on `notes.txt`. Every seed ended `result/success` and replied `NOTED`.
- Each resume is a new `query()` with `resume: <seed's session id>`, the same cwd, `maxTurns: 1`, no tools, and the prompt `Earlier in this conversation I told you a marker word. Reply with only that word, or UNKNOWN if you do not have it.` Before every resume the probe also calls `getSessionInfo(id, { dir: cwd })` and `getSessionInfo(id)`, to see whether a check before the resume is possible.

## Results

| Case | What was done before the resume | `getSessionInfo` before resume | Resume outcome | Model knew the marker | Session id after resume |
|---|---|---|---|---|---|
| (a) same process | seed `query()` ended; resume in the same Node process | found (both forms) | `system/init` then `result/success`, `num_turns: 1`, 3.2 s (run 1) and 7.3 s (run 2) | **yes**: the reply was exactly the marker, both runs | same as the seed's |
| (b) fresh process | seed ended in the parent; resume from a child `node` process (a stand-in for a kernel restart) | found (both forms) | `system/init` then `result/success`, `num_turns: 1`, 2.8 s / 3.0 s | **yes**: the reply was exactly the marker, both runs | same as the seed's |
| (c) cwd touched | seed Read `notes.txt`; then `notes.txt` rewritten and `new.txt` created in the cwd | found (both forms) | `system/init` then `result/success`, `num_turns: 1`, 3.2 s / 3.1 s. No error and no warning about the changed file | **yes**: the reply was exactly the marker, both runs | same as the seed's |
| (d1) transcript gone | seed ended; its `~/.claude/projects/<sanitized cwd>/<id>.jsonl` deleted (the only copy found under `~/.claude/projects/*/`) | **not found** (`undefined`, both forms) | error, see below | no (no model turn) | no new transcript written |
| (d2) unknown id | a random UUID that never existed | **not found** (`undefined`, both forms) | the same error | no (no model turn) | no transcript written |

Run 1 resume usage for Haiku (`result.modelUsage`; in / out / cache-write / cache-read): (a) 20 / 216 / 29,369 / 28,991, (b) 20 / 155 / 8,741 / 48,569, (c) 28 / 389 / 12,041 / 80,203. (d1) and (d2): `modelUsage: {}`.

### (d): the exact error shape

The stream for (d1) and (d2) was identical apart from the id. In both runs the **first and only message** was this `result` message, at about 250-270 ms:

```json
{
  "type": "result",
  "subtype": "error_during_execution",
  "is_error": true,
  "session_id": "<the requested id>",
  "errors": ["No conversation found with session ID: <the requested id>"],
  "result": "",
  "num_turns": 0,
  "modelUsage": {}
}
```

(These are the fields the probe kept from the result message, not the whole message.)

About 0.85 to 0.9 s later (1.1 to 1.2 s in total) the `for await` over `query()` **threw** a plain `Error`, with message `Claude Code returned an error result: No conversation found with session ID: <id>`.

- **Before any model turn: yes.** No `system/init`, no `system/hook_*`, no `assistant` message, `num_turns: 0`, and `modelUsage: {}` (no tokens). Contrast cases (a) to (c): there, `system/hook_started` arrives at about 260 ms and `system/init` at about 370 ms, before any assistant message.
- **A check before the resume works in these runs:** `getSessionInfo(id, { dir: cwd })` returned `undefined` in exactly the (d) cases and found the session in (a) to (c), in both runs (10 of 10 calls). Its type docs (`sdk.d.ts`, `getSessionInfo`) say it also returns `undefined` for "a sidechain session, or has no extractable summary". So a session that is not gone could be reported missing. This was not observed, but the docs allow it.

### (d), supplementary: no credentials, an empty transcript, a non-UUID id

This was run once by the worker the same day as an adversarial check. It used a throwaway script outside the repo, with the same SDK. Each run had `HOME` relocated to an empty `mktemp -d` dir, `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` unset, and **`settingSources: []`** (the kernel's shape). So **no credential at all** was reachable:

| Input | First and only message | `errors[0]` |
|---|---|---|
| a random UUID | `result/error_during_execution` at 410 ms, `num_turns: 0` | `No conversation found with session ID: <id>` |
| a **0-byte** `<id>.jsonl` placed where the transcript belongs | `result/error_during_execution` at 164 ms, `num_turns: 0` | `No conversation found with session ID: <id>` (the same as a missing file) |
| `not-a-uuid` | `result/error_during_execution` at 179 ms, `num_turns: 0` | `Error: --resume requires a valid session ID or session title when used with --print. Usage: claude -p --resume <session-id\|title>. Provided value "not-a-uuid" is not a UUID and does not match any session title.` |

So the gone-conversation error is a **local check in the CLI before any auth or API contact**. It is the same under the kernel's isolated `settingSources: []` and with no login. A non-UUID value is also matched against session *titles*. The kernel's `sdk_session_id` always comes from `system/init` and is a UUID, so this does not affect it, but the error text differs.

## What this means for Part 1 (input to Subtask 3; not a decision)

- **Resume works in (a), (b) and (c).** Being completed, a process restart, and changed files in the cwd did not stop a resume or lose the earlier exchange. On this evidence none of them is a reason to replay.
- **Detecting a gone conversation (AC1 case iii).** The resume's first message carries the signal: `result` `subtype: "error_during_execution"`, `is_error: true`, and an `errors[0]` beginning `No conversation found with session ID:`. It arrives before any model turn and costs nothing, so falling back to one replay after it wastes no tokens. A `getSessionInfo` check before the resume agreed with this every time. It is still a weaker signal, because the docs allow `undefined` for sessions that are not gone, and it is an SDK runtime call, while `kernel/src/brain/handler.ts` imports only types from the session layer (Touched-file invariants). The error after the resume is the signal that needs neither.
- Where the kernel will see it (read, not run): `kernel/src/sessions/manager.ts` already formats a failed result as `result ${subtype} (is_error): ${errors.join("; ")}` (`resultErrorText`, lines 621-623). For this case that gives `result error_during_execution (is_error): No conversation found with session ID: <id>`. Because no `system/init` comes first, nothing from an init message is recorded for that attempt.

## Limits (not observed)

- **Auth shape.** Cases (a) to (c) used the normal login with `settingSources: ['user']`, so user hooks loaded (the `system/hook_*` messages). Only the (d) error was also seen under `settingSources: []` (supplementary above). Kernel sessions run isolated (`settingSources: []`, Loomwright by path, a token or key in the env; `kernel/src/sessions/manager.ts` line 1615). Transcripts should be in the same place, because the kernel strips `CLAUDE_CONFIG_DIR` from the child env (`kernel/src/auth/credential-env.ts` line 49), so the CLI uses `~/.claude/projects/`. That comes from reading the code; this probe did not run the kernel's own option shape.
- **Same cwd only.** Every resume used the seed's cwd. A resume from another cwd is the separate open question about a CLI `resume` launched in another cwd ([OPEN_QUESTIONS](../OPEN_QUESTIONS.md)). The kernel refuses that case with `cwd_changed` anyway.
- **Short gap.** Each resume ran seconds after its seed. A transcript removed by the CLI's own cleanup after a long gap was not waited for. Case (d1) reproduces the effect, a missing `<id>.jsonl`, by deleting the file.
- **One model and SDK version:** Haiku 4.5 on SDK 0.3.284. Re-run after an SDK upgrade (`probes/README.md`).
- The seed sessions' transcripts from cases (a) to (c) remain under `~/.claude/projects/-private-var-folders-…-T-p17-*` on the run machine. The probe does not delete them.
