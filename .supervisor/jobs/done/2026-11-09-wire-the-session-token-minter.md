# Supervisor Job: Wire the session token minter into the shipped kernel (phase 8 item 15)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (8 worktrees, one `prunable`; none on this item's paths)
- **Source requirement:** .supervisor/requirements/phase-8-15/2026-11-09-160015-wire-the-session-token-minter.md
- **Base commit:** f0cbd7cd294c9b3262ffee68ed85f0481f9ad6fc

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest (`kernel/`), the stack CLAUDE.md names; no new language or runtime |
| 2 | Dependency Availability | GO | No new package. Both halves exist on main: the port `SessionTokenMint` (`kernel/src/sessions/github-session-auth.ts`) and `mintSessionToken(store, repos, deps)` (`kernel/src/integrations/github/app-port.ts`) |
| 3 | Architecture Fit | GO | Follows the existing `KernelDeps.githubClient` / `daemonKernelDeps` seam exactly; invariant 2 holds (the kernel, not an LLM, mints); invariant 5 holds (no deps ⇒ fail closed, nothing required) |
| 4 | Scope vs Supervisor Capability | GO | ~11 files, well under 800 changed lines; no Decomposition Threshold reason fires: single subtask |
| 5 | Hard Blockers | GO | None: the AC1 walk fakes GitHub and the Keychain (the `integrations-github-write-tools.test.ts` and `integrations-github-app-port.test.ts` harnesses already do this) |

**Overall Verdict:** GO

## Task
**Goal:** The kernel the installed service runs (`daemon.ts` → `startKernel(parseArgs(args), daemonKernelDeps())`) gives the session manager a real `SessionTokenMint` built on `mintSessionToken(store, repos)` over the kernel's own store, while every composition without the daemon's deps stays fail closed (`no_minter`) and a minter passed through `options.sessions` still wins.

**Problem Statement:**
The owner needs the installed kernel to mint a down-scoped GitHub token for a live, write-granted playbook session, because the phase 8 live run on `vikashruhilgit/studio-sandbox` (item 14) cannot start without one.
Currently, `startKernel` passes no `sessionTokenMint` to `SessionManager` (`kernel/src/kernel.ts`, comment "No `sessionTokenMint` is wired here"), so every live, write-granted session is refused `github_token_unavailable` with `detail: no_minter`; item 14's CI walks hide this with a stand-in mint through `options.sessions`. This blocks the live run, and seven docs say "no minter is wired yet".
Success looks like: with `daemonKernelDeps()` a qualifying session gets its token directory; without deps the behaviour is byte-for-byte today's; item 14's tests pass unchanged; every listed doc line reads true.

**Design (the requirement leaves placement to the design within one rule; this brief fixes it so the pins below are machine-applicable):**
- `KernelDeps` gains `readonly sessionTokenMintFor?: (store: Store) => SessionTokenMint;` (doc comment in the style of `githubClient`'s: default none ⇒ a live, write-granted session is refused `no_minter`; the shipped daemon passes the real one via `daemonKernelDeps`).
- `startKernel`, after the store opens, builds `const mintOf = deps.sessionTokenMintFor === undefined ? {} : { sessionTokenMint: deps.sessionTokenMintFor(store) };` (the same absent-stays-absent idiom as `githubOf`) and spreads `...mintOf` in the `SessionManager` options **immediately before** `...options.sessions`, so a `sessionTokenMint` in `options.sessions` overrides it (AC4). The `kernel.ts` comment on the `githubWriteFor` line is rewritten to say what is now true.
- `daemonKernelDeps(clientDeps)` returns an object literal with `githubClient` first and then the minter written **non-shorthand on exactly one line**: `sessionTokenMintFor: (store) => daemonSessionTokenMint(store, appDeps),` (the literal `sessionTokenMintFor:` appears on that one line of `daemon-deps.ts` only, so the pin mutations below delete one whole property and leave valid code). `daemonSessionTokenMint(store, appDeps)` returns `(repos) => mintSessionToken(store, repos, appDeps).then(toSessionTokenMintResult)`, where `appDeps` comes from `clientDeps` (when `clientDeps.keychain` or `clientDeps.fetch` is given, `{ tokens: createGitHubAppTokens({ keychain, fetch, now, … }) }`, constructed once per `daemonKernelDeps` call — safe because the holder reads the Keychain and sends a request only when a mint is called (`keychain ??= securityCliKeychain()` inside `readItem`); with neither, `{}` so `mintSessionToken` uses the process-wide `githubAppTokens`). Nothing reads the Keychain or the network until a mint runs (AC5).
- `toSessionTokenMintResult` (in `daemon-deps.ts`, exported for the test): `ok` ⇒ `{ ok: true, token, expires_at }`; failure ⇒ `{ ok: false, error, message }` where `message` comes from a `Record<GitHubSessionTokenError, string>` of short fixed texts (so `tsc` fails if a code is ever added without a text), with ` (HTTP <status>)` appended on its own line of code (`` ` (HTTP ${status})` ``) when `status` is present. The message is built from the code and the status only, never from the token or any caught error. Each fixed text is at most 120 characters, so `mint_failed: <code>: <text> (HTTP nnn)` stays under `GithubSessionAuth`'s 200-character `detail` cut (`MAX_DETAIL_CHARS`) and AC2 can assert it exactly.

## Acceptance Criteria
- [ ] **AC1.** Given a kernel started with `daemonKernelDeps({ keychain, fetch, now })` over a fake Keychain holding a stored App and a fake `fetch` answering `POST /app/installations/{id}/access_tokens` (no network, no real Keychain), a GitHub connector row `method: app`, in use, reaching `o/r` with every `SESSION_TOKEN_PERMISSIONS` entry at write, a `live` playbook whose linked poll trigger names `o/r`, and an agent holding `github: write`, when a real session of that playbook starts, then `<dataDir>/session-github/session-<id>/` exists (with `token` and `gh/hosts.yml`), no `session_refused` event is recorded for it, and the fake saw exactly one scoped mint request naming `r`.
- [ ] **AC2.** Given the daemon's deps and a mint that fails — (a) no App in use (connector row absent or `method` not `app`) ⇒ `no_credentials`; (b) the poll names a repo outside the App's reach ⇒ `repo_not_reached`; (c) the fake `fetch` answers the access-token POST with an HTTP error ⇒ `http_error` — when the session starts, then it is refused with one `session_refused` event `{reason: "github_token_unavailable", detail: "mint_failed: <error>: <message>"}` whose `<message>` is that code's fixed text (with `HTTP <status>` for (c)), and there is no `sessions` row, no spawn and no token directory; and no event payload or `detail` in the store contains the fake token string.
- [ ] **AC3.** Given `startKernel(options)` with no `sessionTokenMintFor` in deps (the tests' composition), when a live, write-granted session starts, then it is refused `github_token_unavailable` with `detail: "no_minter"` exactly as today; a test pins it at the `startKernel` level.
- [ ] **AC4.** Given the daemon's deps and a `sessionTokenMint` passed through `options.sessions`, when a qualifying session starts, then the `options.sessions` minter is called and the daemon default is not (the fake `fetch` sees no access-token POST); and `kernel/test/phase-8-exit.test.ts` and `app/e2e/phase-8-exit.spec.ts` pass with no edit to either file.
- [ ] **AC5.** Given `daemonKernelDeps({ keychain, fetch })` with recording fakes, when it is built and `sessionTokenMintFor(store)` is called (but the returned mint is not), then the recorded Keychain reads and requests are both empty; the existing `kernel-daemon.test.ts` pin is updated from `["githubClient"]` to `["githubClient", "sessionTokenMintFor"]` and keeps its no-read/no-request assertions.
- [ ] **AC6.** Given the doc lines in the Doc updates list below, when they are read against the code after this change, then each states what is now true (the daemon wires the minter; `no_minter` now means a composition without the daemon's deps; the `no_repos` precondition stays), D41 gets a dated note (`2026-11-09`) without its reasoning rewritten, and `bash scripts/check-docs.sh` exits 0.
- [ ] **AC7.** Given the AC1 test, when the `sessionTokenMintFor:` line is deleted from `daemonKernelDeps`'s returned object in `kernel/src/daemon-deps.ts`, then the AC1 test fails (the session is refused `no_minter`); see `## Pin mutations`.

**Doc updates (AC6):**
- `kernel/src/kernel.ts` — the comment on the `githubWriteFor:` line ("No `sessionTokenMint` is wired here (a later item wires item 03's)…").
- `kernel/src/kernel.ts` — the JSDoc of `export function githubWriteFor(dataDir: string)`: "The kernel wires no token minter yet (item 03's is wired by a later item), so until then a live session with the write grant is refused `github_token_unavailable`." → the daemon's deps wire the minter; a composition without them is refused `no_minter`.
- `kernel/src/sessions/types.ts` — `sessionTokenMint`'s doc comment "(the kernel wires none yet)".
- `docs/architecture/draft-mode.md` — §"The token" sentence "The kernel wires no minter yet: wiring it is a follow-up item…" and §"Fail closed" (`no_minter` now means a composition without the daemon's deps).
- `docs/architecture/automate.md` — the bullet "**No token minter is wired yet.**".
- `docs/ARCHITECTURE.md` — the sentence "The kernel wires no token minter yet, so until that follow-up a live session with the write grant is refused `github_token_unavailable`."
- `docs/DECISIONS.md` — D41's "Until the kernel wires a token minter, such a session is refused `github_token_unavailable`." gets a dated note after it; nothing else in the row changes.
- `docs/OPEN_QUESTIONS.md` — the "**Not wired yet.**" bullet (phase 8 item 04) and the phase 8 exit entry's "**Known preconditions:**" bullet: the minter precondition marked met (naming this item), the `no_repos` one kept.
- `docs/evidence/phase-8-exit-runbook.md` — §"Known preconditions" bullet "**The kernel wires no session-token minter yet.**": marked met; the `no_repos` bullet kept; and the section's intro sentence ("Two facts the CI walks prove, and that the live run meets as written. Check both before spending the subscription.") adjusted so it stays true with one precondition met.

## Touched-file invariants

> Grounded at base `f0cbd7cd294c9b3262ffee68ed85f0481f9ad6fc`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/kernel.ts`** — keep: the store opens before any session wiring and nothing side-effecting runs before it (`// Before the store opens: a deterministically broken composition has no side effect.`), so `sessionTokenMintFor(store)` is called only after `const store = (deps.openStore ??`; keep the caller's session options spread so it can override (`...options.sessions,`) and place the default mint before it; keep `onMessage`, `admission`, `connectorsFor`, `githubWriteFor` after the spread unchanged; reuse: the absent-stays-absent idiom `const githubOf = deps.githubClient === undefined ? {} : { github: deps.githubClient };`; mirror: the `KernelDeps.githubClient` doc-comment shape (`The shipped\n   * daemon passes the real client (\`daemonKernelDeps\`, daemon-deps.ts).`); the `options.sessions` type (`Pick<SessionManagerOptions, "loomwrightPath" | "installedPluginsPath" | "stopGraceMs" | "authTimeoutMs" | "resumeBackoffMs">`) is not widened — item 14's tests pass `sessionTokenMint` through a variable, which TypeScript accepts, and AC4 requires them unchanged; pinned by: `kernel/test/kernel-daemon.test.ts`, `kernel/test/phase-8-exit.test.ts` (`startKernel({ dataDir, env: { PATH: "/usr/bin" }, sessions: sessionOptions, contributions }, d)`), `app/e2e/phase-8-exit.spec.ts`.
- **`kernel/src/daemon-deps.ts`** — keep: the module's promise "Builds the client only: no Keychain read and no request until a poll runs" extended to the minter (no read, no request until a session asks for a token); keep `daemon.ts`'s call shape `startKernel(parseArgs(args), daemonKernelDeps())` (pinned verbatim by `kernel-daemon.test.ts`); keep `daemonKernelDeps(clientDeps: GitHubClientDeps = {})`'s signature, since `kernel/test/integrations-github-app-port.test.ts` (`daemonKernelDeps({ keychain: w.keychain, fetch: w.fetch, now: w.env.now }).githubClient`) and `kernel/test/playbooks-dry-run-poll.test.ts` (`daemonKernelDeps(o.daemon)`) call it; reuse: `mintSessionToken` and `createGitHubAppTokens` as they are (no change to either, requirement Out of scope); mirror: the port's result shape `| { readonly ok: false; readonly error: string; readonly message: string };` (`github-session-auth.ts`) and `mintSessionToken`'s `| { readonly ok: false; readonly error: GitHubSessionTokenError; readonly status?: number };` (`app-port.ts`); the message never carries a token (`It never carries the token`, requirement Scope 1); pinned by: `kernel/test/kernel-daemon.test.ts` (`expect(Object.keys(d)).toEqual(["githubClient"]);` — updated by AC5).
- **`kernel/src/sessions/types.ts`** — comment-only change on `sessionTokenMint` (`` `github_token_unavailable` (the kernel wires none yet). ``); no type or field changes.
- **`kernel/test/kernel-daemon.test.ts`** — keep: the `daemon.ts` source pin (`expect(daemonSource).toContain("startKernel(parseArgs(args), daemonKernelDeps())");`) and the `expect(reads).toEqual([]);` / `expect(requests).toEqual([]);` assertions; only the keys pin and the test title change.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/daemon-session-token-mint.test.ts` — AC1 (daemon deps mint a token) | delete `sessionTokenMintFor:` in `kernel/src/daemon-deps.ts` |
| `kernel/test/daemon-session-token-mint.test.ts` — AC4 (`options.sessions` minter wins) | move `...mintOf,` in `kernel/src/kernel.ts` to after `...options.sessions,` (reviewer-applied: the daemon default then overrides the stand-in and the fake sees an access-token POST) |
| `kernel/test/daemon-session-token-mint.test.ts` — AC3 (no deps ⇒ `no_minter`) | in `kernel/src/kernel.ts` replace `deps.sessionTokenMintFor === undefined ? {}` with a branch that wires `mintSessionToken` by default (reviewer-applied: the no-deps session then gets `mint_failed: no_credentials`, not `no_minter`) |
| `kernel/test/kernel-daemon.test.ts` — `Object.keys(d)` | delete `sessionTokenMintFor:` in `kernel/src/daemon-deps.ts` |
| `kernel/test/daemon-session-token-mint.test.ts` — AC2 (c) (`HTTP <status>` in the http_error detail) | delete `(HTTP ${status})` in `kernel/src/daemon-deps.ts` |
| `kernel/test/daemon-session-token-mint.test.ts` — AC2 (a) (`no_credentials` fixed text) | change the `no_credentials` entry's text in the fixed-message `Record` in `kernel/src/daemon-deps.ts` to any other string (reviewer-applied: the asserted exact `detail` then differs) |
| `kernel/test/daemon-session-token-mint.test.ts` — AC2 (no token in any event or detail) | in `kernel/src/daemon-deps.ts` append the minted token to the failure `message` (reviewer-applied: e.g. map a failure after a fake success so `message` carries `ghs_…`; the no-token assertion then fails) |
| `kernel/test/daemon-session-token-mint.test.ts` — AC5 (no Keychain read or request after `sessionTokenMintFor(store)`) | in `kernel/src/daemon-deps.ts` call the holder's mint eagerly inside `sessionTokenMintFor` before returning the mint (reviewer-applied: the recorded Keychain reads become non-empty) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Wire `mintSessionToken` through `daemonKernelDeps` into `startKernel`, pin it, and update the docs | all | 10 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/kernel.ts", name: "sessionTokenMintFor"}
  - {kind: "symbol", path: "kernel/src/daemon-deps.ts", name: "sessionTokenMintFor"}
  - {kind: "symbol", path: "kernel/src/daemon-deps.ts", name: "toSessionTokenMintResult"}
  - {kind: "symbol", path: "kernel/src/daemon-deps.ts", name: "daemonSessionTokenMint"}
  - {kind: "file", path: "kernel/test/daemon-session-token-mint.test.ts"}
  - {kind: "symbol", path: "kernel/test/kernel-daemon.test.ts", name: "sessionTokenMintFor"}
requires: []
lanes:
  - "kernel/src/kernel.ts"
  - "kernel/src/daemon-deps.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/test/kernel-daemon.test.ts"
  - "kernel/test/daemon-session-token-mint.test.ts"
  - "docs/architecture/draft-mode.md"
  - "docs/architecture/automate.md"
  - "docs/ARCHITECTURE.md"
  - "docs/DECISIONS.md"
  - "docs/OPEN_QUESTIONS.md"
  - "docs/evidence/phase-8-exit-runbook.md"
external_requires: []
```

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel wiring | `kernel/src/kernel.ts` (485 — appended: the one `KernelDeps` field and a two-line spread beside `githubOf`, the composition's single authority), `kernel/src/daemon-deps.ts` (18 — home of the daemon's mint builder and `toSessionTokenMintResult`), `kernel/src/sessions/types.ts` (644 — comment only, no new responsibility) | — | HIGH |
| tests | `kernel/test/kernel-daemon.test.ts` (315 — the keys pin only) | `kernel/test/daemon-session-token-mint.test.ts` (new home for the AC1–AC4 walk and AC5 laziness; reuses `fakeSessions`, `makePluginDir`, `stubProvider` from `kernel/test/session-fakes.js` and the fake-App setup pattern of `kernel/test/integrations-github-app-port.test.ts`, no third copy of a helper those export) | HIGH |
| docs | `docs/architecture/draft-mode.md` (83), `docs/architecture/automate.md` (122), `docs/ARCHITECTURE.md` (323), `docs/DECISIONS.md` (48), `docs/OPEN_QUESTIONS.md` (258), `docs/evidence/phase-8-exit-runbook.md` (187) | — | HIGH |

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` scans relative links in `docs/`, `CLAUDE.md`, `README.md` and decision-number uniqueness in `docs/DECISIONS.md`; the doc edits add no links and no decision number, so no further surface is owned.

**Total estimated files:** 10 modify + 1 create

### Blast-Radius / Impact Prediction

| Touched Subsystem | Depends On (`DEPENDS_ON`) | Depended-on-by — derived dependents (`DEPENDED_ON_BY`) | Source Contract | Incident History |
|-------------------|---------------------------|-------------------------------------------------------|-----------------|------------------|
| `kernel/src/kernel.ts` | `kernel/src/sessions/manager.ts`, `kernel/src/store/store.ts`, `kernel/src/api/server.ts`, `kernel/src/loop/loop.ts`, `kernel/src/tools/server.ts` | `kernel/test/phase-4-exit.test.ts`, `kernel/test/phase-6-exit.test.ts`, `kernel/test/phase-6-exit-live.test.ts`, `app/e2e/phase-5-exit.spec.ts`, `kernel/test/fixtures/crash-harness.mjs` | — | — |

**Predicted ripple beyond directly-touched files:** every `startKernel` caller without `sessionTokenMintFor` in deps is unaffected by construction (the spread adds nothing); `daemon.ts` gains the minter through `daemonKernelDeps()` with no edit. `kernel/test/playbooks-dry-run-poll.test.ts` spreads all of `daemonKernelDeps(o.daemon)` into its `KernelDeps`, so its daemon-backed kernel also gets the real minter; no behaviour change is expected (the manager mints only for a `live` playbook's real session, and a dry run is not one), and the worker confirms that test stays green unedited.

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/kernel.ts:402` | yes | HOLDS | `// The owner's GitHub write grant, read the same way. No \`sessionTokenMint\` is wired here (a later item wires item 03's)…` | tip 20 minutes ago, fetched <1h |
| `docs/architecture/automate.md:100` | yes | HOLDS | `- **No token minter is wired yet.** A live write session is refused \`github_token_unavailable\`…` | tip 20 minutes ago, fetched <1h |
| `docs/ARCHITECTURE.md:284` | yes | HOLDS | `…The kernel wires no token minter yet, so until that follow-up a live session with the write grant is refused…` | tip 20 minutes ago, fetched <1h |
| `docs/OPEN_QUESTIONS.md:128` | yes | HOLDS | `- **Not wired yet.** The kernel defines the \`SessionTokenMint\` port but wires no minter…` | tip 20 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The default minter placed after `...options.sessions` would silently override item 14's stand-in, and its walks would then hit a real (faked-out-of-reach) App path | HIGH | Spread `...mintOf` immediately before `...options.sessions`; AC4 pins it with a mutation; run both item 14 walks unchanged |
| A failure message built from a caught error or the token leaks a secret into the `session_refused` event | HIGH | Messages come only from the fixed `Record<GitHubSessionTokenError, string>` plus the numeric status; AC2 asserts no event or detail contains the fake token |
| Building the holder eagerly in `daemonKernelDeps()` reads the Keychain at daemon start (breaks AC5 and the existing laziness promise) | MEDIUM | `createGitHubAppTokens` is lazy (`keychain ??= securityCliKeychain()` on first call); build it inside the mint or memoize on first mint; AC5 records reads/requests after `sessionTokenMintFor(store)` |
| A second holder (the mint's) beside the client's holder doubles installation-token mints | LOW | Acceptable: a session token is `mintScoped` (never held) anyway; `mintSessionToken` runs on the shared `githubCredentialLock`, so no interleaving with connector writes |
| `kernel/src/sessions/github-session-auth.ts` keeps its item-04 sentence "this item defines the port and wires none" | LOW | It describes item 04 (the port's author) and stays true of that module, which still wires nothing; it is outside the requirement's Touches, so left as is |
| The AC1 walk must stand up an App in use with a reach list and permissions; a wrong row shape yields `no_credentials`/`needs_permissions` and a confusing red | MEDIUM | Seed the connector row through the port as `integrations-github-app-port.test.ts` does (`storeApp` then `recordInstallation` over the fake fetch), or insert `method`, `status`, `reachable_repos_json`, `account_login` and the permissions exactly as `connectorView` reads them |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Verify
- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e` (item 14's app walk must still pass)
- `bash scripts/check-docs.sh`

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-09-wire-the-session-token-minter.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-09T12:04:20Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/248
- **Branch:** feature/wire-the-session-token-minter
- **Files changed:** 11
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** KernelDeps.sessionTokenMintFor wired; daemonKernelDeps mints lazily via mintSessionToken with fixed token-free failure texts; no deps stays no_minter; options.sessions minter wins. New daemon-session-token-mint.test.ts pins AC1–AC5; docs updated, D41 dated note. Phase 4.5 code review PASS first round (3 LOW dismissed below MEDIUM floor); required ci green; pin mutations 1/2/4 hand-verified by Supervisor, 3/5–8 applied by the reviewer — all held (one eager-mintSessionToken variant of row 8 survives, LOW, dismissed).

## Not verified
- **app e2e specs other than e2e/phase-8-exit.spec.ts** — only that spec was run; a full e2e run rewrites evidence PNGs outside this lane (subtask 1)
- **the installed launchd daemon with a real GitHub App and Keychain** — only fakes were driven; that is item 14's live run (subtask 1)
- **reviewer-applied pin mutations (token in failure message; eager mint)** — not applied by the worker; later applied by the Phase 4.5 reviewer (subtask 1)
