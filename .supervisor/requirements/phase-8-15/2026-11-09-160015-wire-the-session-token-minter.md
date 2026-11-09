# 15 — Wire the session token minter into the shipped kernel

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/248

**Priority:** MVP · ROADMAP phase 8 (blocks item 14's live run) · D39, D41, invariants 2, 3, 4, 5

**As** the owner,
**I want** the installed kernel to mint a down-scoped GitHub token for a live, write-granted playbook session,
**so that** the phase 8 live run on `vikashruhilgit/studio-sandbox` can start instead of being refused `github_token_unavailable`.

## Problem

Item 04 defined the `SessionTokenMint` port (`kernel/src/sessions/github-session-auth.ts`), and item 03 built the function that fills it, `mintSessionToken(store, repos)` (`kernel/src/integrations/github/app-port.ts`). Nothing connects the two. `startKernel` (`kernel/src/kernel.ts:402`) passes no `sessionTokenMint` to the session manager, so every live, write-granted session is refused `github_token_unavailable` with `detail: no_minter`.

Item 14's CI walks (`kernel/test/phase-8-exit.test.ts`, `app/e2e/phase-8-exit.spec.ts`) cover this gap with a stand-in mint passed through `options.sessions`. Its runbook (`docs/evidence/phase-8-exit-runbook.md` §"Known preconditions") says not to start the live run until a follow-up item wires the real minter. This is that item.

## Scope

1. **The shipped daemon wires the real minter.** The kernel the installed service runs passes a `SessionTokenMint` that calls `mintSessionToken(store, repos)` on the kernel's own store, and maps its result to the port's `SessionTokenMintResult`:
   - success ⇒ `{ ok: true, token, expires_at }`;
   - failure ⇒ `{ ok: false, error, message }`, where `message` is a short fixed text per error code (plus the HTTP status when there is one). It never carries the token.
2. **Where it is wired is the design's call, within one rule:** follow the existing `githubClient` pattern. `daemonKernelDeps` (`kernel/src/daemon-deps.ts`) supplies the real one, and a composition that supplies none (the tests, a caller of `startKernel` with no deps) stays fail closed (`no_minter`), exactly as now. The store opens inside `startKernel`, so the dependency takes the store (for example a `KernelDeps` field that builds the mint from the store) rather than a ready-made function. A minter passed through `options.sessions` (the CI walks' stand-in) must keep working and must win over the default, so item 14's tests run unchanged.
3. **Docs that say "no minter is wired yet" are updated to say what is now true:**
   - `kernel/src/kernel.ts:402` comment;
   - `docs/architecture/draft-mode.md` ("Fail closed": `no_minter` now means a composition without the daemon's deps);
   - `docs/architecture/automate.md:100`;
   - `docs/ARCHITECTURE.md:284` (the sentence "The kernel wires no token minter yet…");
   - `docs/DECISIONS.md` D41's "Until the kernel wires a token minter…" sentence: add a dated note, never rewrite a decision's reasoning;
   - `docs/OPEN_QUESTIONS.md:128` ("Not wired yet") and the phase 8 exit entry's "Known preconditions" bullet (line 248): mark the minter precondition met, keep the `no_repos` one;
   - `docs/evidence/phase-8-exit-runbook.md` §"Known preconditions": the same.

## Acceptance criteria

- **AC1.** With the daemon's deps, a live playbook session whose agent holds `github: write` and whose linked poll names a repo the App reaches gets a token: the test supplies `mintSessionToken`'s GitHub call as a fake (no network, no Keychain), and checks that `<dataDir>/session-github/session-<id>/` is written and the session is not refused.
- **AC2.** With the daemon's deps and a mint that fails (no App in use ⇒ `no_credentials`; a repo outside the App's reach ⇒ `repo_not_reached`; an HTTP error), the session is refused `github_token_unavailable` with `detail` `mint_failed: <error>: <message>`, no row, no spawn, no token directory. No `detail` or event carries a token.
- **AC3.** With no deps (`startKernel(options)` alone), the behaviour is exactly today's: refused `no_minter`. A test pins it.
- **AC4.** A `sessionTokenMint` passed through `options.sessions` is the one used, over the daemon default. Item 14's `kernel/test/phase-8-exit.test.ts` and `app/e2e/phase-8-exit.spec.ts` pass unchanged.
- **AC5.** `daemonKernelDeps()` still builds without reading the Keychain or touching the network (its existing test's promise): the minter reads nothing until a session asks for a token.
- **AC6.** Every doc line listed in Scope 3 reads true against the code; `bash scripts/check-docs.sh` passes.
- **AC7.** Mutation pin: removing the wiring from the daemon's deps turns AC1's test red.

## Out of scope

- The `no_repos` refusal for a `clickup.tasks`-polled playbook (a ClickUp poll names no repo). The runbook already works around it with a never-matching GitHub poll; changing which repos a playbook's token covers is a separate decision.
- The live run itself, its evidence file and phase 8's ROADMAP ✓ (item 14, the owner).
- Any change to `mintSessionToken`, `SESSION_TOKEN_PERMISSIONS`, the token files (D41), the rail, the approval gate or `merge_blocked`.

## Touches

- `kernel/src/kernel.ts`
- `kernel/src/daemon-deps.ts`
- `kernel/src/sessions/types.ts` (only if the option's doc comment needs it)
- `kernel/test/daemon-deps.test.ts` or `kernel/test/kernel-daemon.test.ts` (whichever already covers `daemonKernelDeps`), plus one new test file if the walk needs its own
- `docs/architecture/draft-mode.md`, `docs/architecture/automate.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/OPEN_QUESTIONS.md`, `docs/evidence/phase-8-exit-runbook.md`

## Verify

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e` (item 14's app walk must still pass)
- `bash scripts/check-docs.sh`

## Depends on

03, 04 (both merged). Unblocks 14's live run.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-09T12:13:33Z
- **Brief:** .supervisor/jobs/done/2026-11-09-wire-the-session-token-minter.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/248
