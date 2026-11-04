# Supervisor Job: The MCP connector mechanism — OAuth 2.1 connect, Keychain tokens, per-agent tool grants (phase 8 item 06)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L6 (Loomwright Studio)
- **CLAUDE.md:** ✓ Found (fresh: phases and invariants match the code at base)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160006-mcp-connector-mechanism-with-oauth.md
- **Base commit:** 20684c8f514a95d31860b0fdde4008d9fb1575d5

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest). `@modelcontextprotocol/sdk` 1.31.0 is already a kernel dependency (`kernel/package.json`; already imported by `kernel/src/tools/server.ts`), with its OAuth client helpers and Streamable HTTP client transport. No new dependency. |
| 2 | Dependency Availability | GO | Item 01 (foundation) is merged: `mcp_connections` (migration 020: `kind UNIQUE, server_url, status, granted_tools, token_expiry`), the empty `mcpPart`, `McpConnection` / `McpConnectResponse` in the app contract, and the three `p8-item-06` routes pinned as not served. The Keychain writer and deleter (`kernel/src/auth/keychain.ts`) and `recordNotification` exist. |
| 3 | Architecture Fit | GO | Fits the integrations part seam (one part per sub-file), the per-agent tool filter, the fixed rail (`classifyToolCall`), draft mode and the approval gate. |
| 4 | Scope vs Supervisor Capability | CAUTION | 25 distinct files (17 modify + 8 create) once the Touches list is widened (see the NO-GO override). That is over the `context-bound` bound (more than 12 files), so the work splits into 2 sequential subtasks. |
| 5 | Hard Blockers | NO-GO (owner override) | The requirement's binding rule says "Nothing is patched outside an item's Touches. A lane that needs another file stops and says so", and its ACs can't be met inside its 10 Touches. The owner was asked (LP-NO-GO, 2026-11-03) and chose **Override and continue**. In round 2 the owner chose **Widen: routes.ts + contract** for `GET /connectors` and **Allow github: "read"** for the grant's object form. The widened Touches list is in `## Owner overrides (Launch Pad, 2026-11-03)`. |

**Overall Verdict:** NO-GO (user override). The findings are HIGH risks below.

## Owner overrides (Launch Pad, 2026-11-03)

Recorded from the owner's AskUserQuestion answers in this Launch Pad session. They widen the requirement's `## Touches` for this item only. Every file a subtask may edit is in its `lanes:`, and a worker that needs any file beyond them stops and says so (the requirement's rule still holds for everything not listed here).

- **Round 1 (LP-NO-GO → "Override and continue").** Touches widen to: `kernel/src/integrations/index.ts`; `kernel/src/agents/settings.ts`; `kernel/src/agents/charter-files.ts`; `kernel/src/agents/roster.ts`; `kernel/src/kernel.ts`; `kernel/src/sessions/policy.ts`; `kernel/test/console-contract.test.ts`; `kernel/test/phase-8-foundation.test.ts`; `kernel/src/triggers/poll.ts`.
- **Round 2 ("Widen: routes.ts + contract").** `GET /connectors` lists MCP rows through an additive `mcp_connections` key, which adds `kernel/src/integrations/github/routes.ts` and `app/src/api/contract.ts`.
- **Round 2 ("Allow github: \"read\"").** The grant's object form accepts `github: "read" | "write"` beside `jira` / `clickup` tool-name arrays. `{github: "read"}` means the same as `["github"]`. The two pins that refuse it flip, which adds `kernel/test/sessions-github-session-auth.test.ts`.
- **Round 3 (the Launch Pad save gate, LP-SAVE-NOTE): four consequence files, confirmed by the owner's "Save and exit".** That gate's question names these four files, and this brief is saved only when the owner answers "Save and exit". The save is the owner's confirmation. Any other answer saves nothing.
  - The requirement's Scope 5 names the `never` category `mcp_write`, and adding it reaches every closed list that names the categories (see `## Closed enumerations touched`): `kernel/test/sessions-policy.test.ts` (the exact-list pin and the every-category-is-reached pin), `app/src/screens/team/model.ts` (the app's mirror of `NEVER_CATEGORIES`) and `docs/architecture/approvals.md` (the category table).
  - Removing `connector_not_built` (AC8) makes two sentences in `docs/ARCHITECTURE.md` false: the phase 8 seams bullet (`a \`jira\` or \`clickup\` grant in an agent's settings file or charter is refused \`connector_not_built\``) and the data-model row (`empty until phase 8 item 06 fills it`). Subtask 2 rewrites both. The stale comment at `app/src/api/contract.ts` (`refused \`connector_not_built\` until their items land`) is rewritten by Subtask 1, which already owns that file.
- **Kept out on purpose:** no new `kernel/src/agents/connector-grant.ts`. Grant parsing lives in `kernel/src/agents/settings.ts` (332 lines, under the threshold). `kernel/test/agents-connectors-grant.test.ts` is untouched, because `CONNECTORS_VALUE_MESSAGE` stays byte-identical. `kernel/src/agents/charter-tools.ts` is untouched (its update path is verify-only; see Risk Assessment). `docs/OPEN_QUESTIONS.md` is untouched: the tool-name-length verification note lives in `docs/architecture/mcp-connectors.md`.
- **Approved but not edited:** `kernel/src/triggers/poll.ts`. In item 06 no poll source can need an MCP connector: `jira.issues` / `clickup.tasks` are still refused `poll_source_not_built` until item 07. Instead, item 06 exports the gate that item 07's sources call (`mcpConnectorGate`), and AC4 tests that gate. The worker does not edit `poll.ts`.

## Task
**Goal:** Build the generic MCP connector mechanism: an OAuth 2.1 (PKCE, loopback redirect) connect to a hosted MCP server, its tokens only in the Keychain, the server's tool list on the `mcp_connections` row, an owner-only per-agent per-tool grant, and a session `kernel` server that proxies only the granted tools, holding every non-read-only call as the outward kind `mcp_write`.

**Problem Statement:**
The owner needs Jira's and ClickUp's hosted MCP servers connected the way Claude desktop connects them, because those trackers accept OAuth 2.1 only (ClickUp takes no API key).
Today Studio has only the GitHub connector: no MCP client, no OAuth flow and no per-tool grant. `jira` / `clickup` grants are refused `connector_not_built`, and the three MCP routes are declared but not served.
That blocks item 07 (Jira and ClickUp ticket sources) and everything after it in phase 8.
Success looks like this: against a fake MCP server with a fake authorization server, the connect stores tokens in the Keychain only, a session of an agent granted one tool lists exactly that tool, and a non-read-only tool call is held (or drafted). A failed refresh marks the row `expired` and notifies the owner, and no token ever appears in a row, event or log.

## Acceptance Criteria

The first five are carried forward from the requirement word for word. AC6 to AC12 make the requirement's scope and the owner's overrides testable.

- [ ] AC1. Given the fake server, when the owner starts the connect, then the kernel opens one setup window, the browser return with a matching `state` stores the tokens in the Keychain, and the row reads `connected` with the server's tool names; a second use of the same `state` is refused.
- [ ] AC2. Given a session of an agent granted one tool, then its tool list carries exactly that tool, and a call to another tool on that server is unavailable.
- [ ] AC3. Given a tool without `readOnlyHint: true`, when a session calls it, then it is held for approval (or recorded in draft mode).
- [ ] AC4. Given a refresh failure, then the row reads `expired`, the owner is notified, and polls that need it are skipped `connector_missing`. (Item 06 proves this through the exported `mcpConnectorGate(store, kind)`: for an `expired` or missing row it answers `{kind: "connector_missing", status}`, the same shape `kernel/src/triggers/poll.ts` uses for GitHub. Item 07's `jira.issues` / `clickup.tasks` sources call it, and `poll.ts` is not edited here; see Owner overrides.)
- [ ] AC5. Given any event, row or log written during connect or call, then no token appears in it.
- [ ] AC6. Given the connect, when it runs against the fake authorization server, then it discovers the server's authorization metadata (protected-resource metadata, then authorization-server metadata), registers dynamically when the server offers a registration endpoint, and sends an authorization-code request with PKCE `S256` and a redirect of `http://127.0.0.1:<port>/…`. The loopback listener is bound to `127.0.0.1` only and closes when the window settles or expires. A second `connect` while a window is open is refused, and `connect/cancel` closes it.
- [ ] AC7. Given a connected row whose access token is near expiry, when the part's due work runs, then it refreshes and writes the new tokens to the Keychain item `loomwright-studio-mcp-<kind>` (never to a row). `POST /connectors/mcp/:kind/disconnect` deletes that Keychain item and sets the row `disconnected`.
- [ ] AC8. Given an agent's settings file, when it holds `connectors: {jira: ["<tool>"]}`, `{clickup: [...]}`, `{github: "read"}`, `{github: "write"}` or any mix of these keys, then it reads ok. `{github: "read"}` reads the same as `["github"]`. A jira or clickup value that is not a non-empty array of tool names, an unknown key, or `jira` / `clickup` in the array form (a jira grant always names its tools) is refused `settings_invalid` (field `connectors`), never silently dropped. The code `connector_not_built` is no longer emitted anywhere, since jira and clickup are now built; `UNBUILT_CONNECTORS` is removed. The owner sets it with `studio agents set <id> connectors jira:<tool>[,<tool>…]`, which replaces only that kind's key and keeps the others, or `jira:none` to drop that key. The same goes for `POST /agents/:id/set`. `connectors none` still clears all of it. Any other value is still refused with the existing `CONNECTORS_VALUE_MESSAGE` text `connectors must be github or none`, byte-identical. A malformed `jira:` / `clickup:` value gets its own message, which names the `<kind>:<tool>[,<tool>…]` form. A charter (Wright's draft) still can't carry a jira or clickup grant: refused `charter_invalid` (field `connectors`), with the message `the <kind> grant is owner-only: set it with studio agents set <id> connectors <kind>:<tool>`.
- [ ] AC9. Given a `kernel` MCP server built for a session, then every proxied tool result is wrapped as untrusted data (the same wrapping the GitHub read tools use), the session never receives a token, and the MCP call is made by the kernel with the Keychain token.
- [ ] AC10. Given a session policy whose `never` lists `mcp_write`, when the session calls a non-read-only proxied tool, then it is denied `agent_boundary` (category `mcp_write`), never held. `mcp_write` is in `NEVER_CATEGORIES` and in the app's mirror.
- [ ] AC11. Given `GET /connectors`, then the body carries the existing `connectors` key unchanged plus `mcp_connections`: one `McpConnection` per row, with no token field. `granted_tools` lists server tool names only (`string[]`, as the contract declares). The read-only flags and proxy names stay kernel-side. The three `p8-item-06` routes are served (the console-contract pin moves them from not-served to served), and `docs/architecture/mcp-connectors.md` describes what was built instead of "will".
- [ ] AC12. Given a server whose tools include a camelCase name, a hyphenated name, a name whose proxy would exceed the length cap, two names that map to the same proxy name, and one tool with an input schema the kernel can't use, then every proxy name matches the kernel's `TOOL_NAME` rule (`^kernel_[a-z0-9_]{1,64}$`) and the full session name `mcp__kernel__<name>` is at most 64 characters. The over-long name and both colliding names are dropped and counted in the connect's result and event, never rewritten into a clash. The bad-schema tool does not empty the session's tool list (every other granted tool is still listed).

## Phase 3: File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| mcp-core (Subtask 1) | `kernel/src/integrations/index.ts` (119), `kernel/src/integrations/github/routes.ts` (122), `app/src/api/contract.ts` (1604 — additive optional key on the existing `ConnectorsResponse`, its single authority), `kernel/test/console-contract.test.ts` (303), `kernel/test/phase-8-foundation.test.ts` (539 — only the existing `mcpPart`-is-empty pin is edited; no new responsibility added), `docs/architecture/mcp-connectors.md` (21) | `kernel/src/integrations/mcp/connector.ts`, `kernel/src/integrations/mcp/oauth.ts`, `kernel/src/integrations/mcp/client.ts`, `kernel/src/integrations/mcp/routes.ts`, `kernel/src/integrations/mcp/tools.ts`, `kernel/test/fixtures/mcp-fake.ts`, `kernel/test/integrations-mcp-connector.test.ts`, `kernel/test/integrations-mcp-oauth.test.ts` | HIGH |
| grant-session-rail (Subtask 2) | `kernel/src/integrations/tool-filter.ts` (19), `kernel/src/agents/settings.ts` (332), `kernel/src/agents/charter-files.ts` (568 — one refusal-message line changes; no new responsibility), `kernel/src/agents/roster.ts` (745 — the `set` verb's value dispatch calls `settings.ts`'s exported parser; no parsing is added here), `kernel/src/kernel.ts` (430), `kernel/src/sessions/policy.ts` (1129 — the single authority for the rail and `NEVER_CATEGORIES`; the `mcp_write` classification is a few lines beside `ALWAYS_HELD_TOOLS`), `app/src/screens/team/model.ts` (535 — one entry in the existing mirror list), `docs/architecture/approvals.md` (262 — one table row), `docs/ARCHITECTURE.md` (322 — two sentences that name `connector_not_built` / "empty until item 06"), `kernel/test/sessions-policy.test.ts` (491), `kernel/test/phase-8-foundation.test.ts` (539 — the grant pins), `kernel/test/sessions-github-session-auth.test.ts` (718 — one pin flips), `kernel/test/integrations-mcp-connector.test.ts` (created by Subtask 1; Subtask 2 adds the AC2, AC3 and AC10 cases), `docs/architecture/mcp-connectors.md` (written by Subtask 1; Subtask 2 adds the grant and rail paragraphs) | — | MEDIUM |

**Module layout (one home per new responsibility):**
- The MCP connection row, Keychain item, refresh due work, `mcpConnectorGate` and the filled `mcpPart` go in `kernel/src/integrations/mcp/connector.ts` (CREATE).
- Metadata discovery, dynamic registration, PKCE, the `state` and the loopback listener go in `kernel/src/integrations/mcp/oauth.ts` (CREATE).
- The MCP client calls (`tools/list`, `tools/call`) over Streamable HTTP with the bearer token go in `kernel/src/integrations/mcp/client.ts` (CREATE).
- The three owner routes go in `kernel/src/integrations/mcp/routes.ts` (CREATE).
- Building the proxy tools from a row's tools plus an agent's grant goes in `kernel/src/integrations/mcp/tools.ts` (CREATE).
- Grant parse, validate and merge goes in `kernel/src/agents/settings.ts` (332, under the threshold). It is the existing home of the `connectors` grant reader. Exported helpers (`parseConnectorsGrant`, `mergeConnectorsGrant`) are called by `charter-files.ts` (568) and `roster.ts` (745), so neither file over the threshold grows a parser; each only calls them.
- The `mcp_write` rail classification appends to `kernel/src/sessions/policy.ts` (1129 — the single authority for `classifyToolCall` and `NEVER_CATEGORIES`).
- The `mcp_connections` key on `GET /connectors` goes in `kernel/src/integrations/github/routes.ts` (122). It reads the rows through `mcp/connector.ts`'s exported list, so it adds no new SQL in `github/`.
- Extract row: the jira/clickup check exists in two places (`settings.ts` `unbuiltConnectorsProblem` and `charter-files.ts`'s inline `find`). Subtask 2 replaces both with one exported helper in `settings.ts` (`mcpGrantKindOf`), which `charter-files.ts` calls. That is an extract into the existing module, never a third copy.
- Tests: `integrations-mcp-*.test.ts` are CREATEs. `sessions-policy.test.ts` (491) and `sessions-github-session-auth.test.ts` (718) only have existing pins edited, plus one table row.

> **Validator-owned surfaces:** acceptance runs `bash scripts/check-docs.sh`. It scans every relative markdown link in `docs/`, `CLAUDE.md` and `README.md`, so any link added to `docs/architecture/mcp-connectors.md` or `docs/architecture/approvals.md` must resolve.

**Total estimated files:** 17 modify + 8 create = 25 distinct paths. Subtask 1 has 6 modify + 8 create. Subtask 2 has 11 modify of its own, plus 3 files shared after Subtask 1 (`phase-8-foundation.test.ts`, `integrations-mcp-connector.test.ts`, `mcp-connectors.md`).

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| Subtask 1 | Subtask 2 | `kernel/test/phase-8-foundation.test.ts`, `kernel/test/integrations-mcp-connector.test.ts`, `docs/architecture/mcp-connectors.md` | YES (Subtask 2 requires Subtask 1) |

## Design notes (binding for both subtasks)

- **The loopback redirect is the connect's own listener,** not a kernel API route. `oauth.ts` binds `127.0.0.1:0` only while the one window is open, so there is no new unauthenticated kernel route and no `contract.ts` route (RFC 8252 loopback, as the requirement's `http://127.0.0.1:<port>` says). The window copies D36's pattern (`kernel/src/integrations/github/app-setup.ts`): it lives in memory only, there is one at a time, it has a short lifetime, and each `state` is 256 random bits, compared in constant time and spent before anything is awaited. A restart loses the window.
- **Keychain item:** service `loomwright-studio-mcp-<kind>`. It holds one JSON value (access token, refresh token, expiry, the registered client id), written through `securityCliKeychainWriter` and deleted through `securityCliKeychainDeleter` (`kernel/src/auth/keychain.ts`). Only `token_expiry` reaches the row.
- **Proxy tool names are fixed by the kernel at connect time from the server's hint, and obey the kernel's own `TOOL_NAME` rule** (`const TOOL_NAME = /^kernel_[a-z0-9_]{1,64}$/;` in `kernel/src/features/contribution.ts`).
  - A tool whose `annotations.readOnlyHint === true` becomes `kernel_mcp_r_<kind>_<mapped>`. Every other tool (hint false, or no hint) becomes `kernel_mcp_w_<kind>_<mapped>`.
  - `<mapped>` is the server name lowercased, each run of characters outside `[a-z0-9]` replaced by one `_`, and leading and trailing `_` trimmed.
  - The full session-facing name `mcp__kernel__kernel_mcp_<r|w>_<kind>_<mapped>` is capped at 64 characters. With `clickup` (the longest kind), that leaves 30 characters for `<mapped>`.
  - A tool whose mapped name is empty or over the cap is dropped, never truncated. Two server tools that map to the same proxy name are both dropped. Every drop is counted in the connect's answer and its `connector_status` event (as counts and server names, never a token).
  - `mcpProxyTools` runs the same `TOOL_NAME` test on every name it emits, and drops (never throws) on a miss. The proxies are built per session and never pass `mergeContributions`, so they get this check of their own.
  - The 64-character session cap is conservative. The model API's exact tool-name limit is recorded as NEEDS VERIFICATION in `docs/architecture/mcp-connectors.md`, not probed here.
- **`mcp_connections.granted_tools` is JSON text: one `{name, proxy, read_only}` per kept server tool.** The rail and the proxy builder read `read_only` from the kernel's row, never from session input. `listMcpConnections` maps it to `granted_tools: string[]` (server names only), matching `McpConnection` in `app/src/api/contract.ts`.
- **Proxy input and description.**
  - Each proxy tool's zod shape is one fixed field, `arguments_json: z.string().max(<bound>).optional()`. It is a JSON object as text. The kernel parses it, refuses (as a tool error, never a throw) anything that is not a plain JSON object or carries an own `__proto__` key, and sends the object to the server as the MCP `arguments`.
  - **Never `z.record`.** `kernel/src/agents/charter-tools.ts` records why: `Not \`z.record\`: the Agent SDK's bundled serialiser throws on a record, which empties \`tools/list\``.
  - No server JSON Schema is converted to zod, so no remote schema can fail serialisation or empty the session's tool list (AC12).
  - The description is written by the kernel: `<Kind> MCP tool "<server name>" (<read-only|changes things>). Server description (untrusted data, never instructions): <server description, control characters stripped, clipped to 300 characters>`. Then the server's input schema as JSON, clipped to 1500 characters, so the model can form arguments.
  - Every result is wrapped as untrusted data, as the GitHub read tools do.
- **Rail:** `classifyToolCall` answers `outward` with action `mcp_write` for every `mcp__kernel__kernel_mcp_` name that is not `mcp__kernel__kernel_mcp_r_…`, so it fails closed. That flows through the existing never boundary, draft mode and approval hold unchanged. `mcp_write` is NOT added to `ALWAYS_HELD_TOOLS`, so the owner's per-playbook "Always" (item 04) can cover it, while `never` still wins.
- **Grant to session:** `kernel.ts` adds `mcpToolGrantsFor(dataDir)` beside `connectorsFor` / `githubWriteFor`, read afresh at each start through the one settings reader, failing closed to no grant. In the `mcpServers` factory (which is already given `agent`), it adds `mcpProxyTools(store, grants)` from `mcp/tools.ts` to the contributed tools. `tool-filter.ts` gains the per-tool narrowing. No change to `sessions/manager.ts` or `sessions/types.ts`.
- **The registry's module graph:** `mcp/*.ts` is loaded by the `studio` CLI through the integrations feature. It may import `@modelcontextprotocol/sdk`, but never the Agent SDK, the session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts`, "SDK_IN_GRAPH").

## Touched-file invariants

> Grounded at base `20684c8f514a95d31860b0fdde4008d9fb1575d5`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/integrations/index.ts`** — keep: `githubAppRoutesPart` last in `INTEGRATIONS_PARTS`, quoting `` `githubAppRoutesPart` stays last ``, and the CLI-loadable rule `its own parts: never the Agent SDK, the session`. Replace `export const mcpPart: IntegrationsPart = emptyConsolePart("mcp");` with an import from `./mcp/connector.js`, keeping the `mcpPart` export name and its position before `repoPolicyPart`. Pinned by: `kernel/test/phase-8-foundation.test.ts` `["mcp", "repo-policy", "github-app-routes"]` and `kernel/test/integrations-github-app-contract.test.ts`.
- **`kernel/src/integrations/github/routes.ts`** — keep: the existing body key `body: { connectors: listConnectors(req.store) }`. Only add `mcp_connections` beside it. Reuse: the file's `total(async () =>` wrapper. Mirror: `app/src/api/contract.ts` `export interface ConnectorsResponse {`.
- **`app/src/api/contract.ts`** — keep: `readonly connectors: readonly Connector[];`. Add `readonly mcp_connections?: readonly McpConnection[];` (optional, so the app fixtures that build `{ connectors: rows }` in `app/src/screens/integrations/model.test.ts` still typecheck). Keep the three entries with `origin: "p8-item-06"` exactly. Rewrite the stale `ConnectorKind` doc comment (`refused \`connector_not_built\` until their items land`) to say jira and clickup are MCP connectors with an owner-only per-tool grant. Mirror: `kernel/test/console-contract.test.ts` lists the same three.
- **`kernel/test/console-contract.test.ts`** — keep: its route list mirrors `contract.ts` line for line (`{ method: "POST", path: "/connectors/mcp/:kind/connect", origin: "p8-item-06" },`). Keep the origin entries, the phase 8 list in the test now titled `lists phase 8's seven routes as not yet served` (its `it(...)` title may be reworded, since three of them are now served) and its `expect(phase8.filter(isExisting)).toEqual([])`: `isExisting` is decided by origin, so it does not change. Also keep the 31-existing-routes count. Add one new assertion: the three `p8-item-06` routes are in `mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).routes`, while the `p8-item-03` and `p8-item-08` routes are not.
- **`kernel/test/phase-8-foundation.test.ts`** — keep: every pin not about item 06 (`CONNECTOR_KINDS is github, jira, clickup, frozen`, the `POLL_SOURCES` list, the migration-020 columns pin `["id", "kind", "server_url", "status", "granted_tools", "token_expiry"]`). Keep `other values stay refused with the one message`, whose `message: "connectors must be github or none"` stays byte-identical (four values, including `github:read`, are still refused by the `set` route).
  - Subtask 1: `for (const part of [mcpPart, repoPolicyPart])` keeps `repoPolicyPart` empty and asserts `mcpPart` is filled.
  - Subtask 2 flips exactly these AC8 pins, and no others:
    - (a) `a jira or clickup entry in the array is connector_not_built`: still refused `settings_invalid` / `connectors`, now with the message that a jira grant names its tools. `connector_not_built` must not appear.
    - (b) `a jira or clickup key in the object form is connector_not_built`: `{[kind]: "read"}` is still refused (not an array of tool names); `{[kind]: ["<tool>"]}` reads ok.
    - (c) `{ github: "write", jira: "read" }`: still refused, with no `connector_not_built`.
    - (d) `any other object form is refused too, never read as no grant`: `connectors: { github: "read" }` now reads ok; `connectors: {}` stays refused.
    - (e) `connectors [github] stays ok; jira or clickup is connector_not_built (charter_invalid, field connectors)`: keeps `error` and `field`, and its `toContain("connector_not_built")` becomes `toContain("owner-only")`.
  - Retitle each flipped `it(...)` to the new behaviour.
- **`kernel/src/integrations/tool-filter.ts`** — keep: type-only imports (`// Type-only imports, so the`) and `` `tools` is never mutated. It only `` (it only narrows). Every tool without `requiresConnector` is still listed. Mirror: `kernel.ts` call `toolsForConnectors(contributions.tools, connectors)`.
- **`kernel/src/agents/settings.ts`** — keep: the array form `connectors: z.array(z.enum(CONNECTOR_KINDS)).optional(),`, the `githubWrite` flag semantics (`True only when the file's \`connectors\` is the object \`{github: "write"}\``, which now means "the object form's `github` key is `write`"), and the refuse-never-drop rule `and silently not applying it: \`connector_not_built\``. Reuse: `invalid("connectors", …)`. Remove `const UNBUILT_CONNECTORS: readonly string[] = ["jira", "clickup"];`. The grant parse and merge helpers it exports (`parseConnectorsGrant`, `mergeConnectorsGrant`, `mcpGrantKindOf`) are this file's, with no new module. The module stays CLI-loadable (no Agent SDK import). Pinned by: `kernel/test/agents-connectors-grant.test.ts` (must stay green, unedited), `kernel/test/phase-8-foundation.test.ts`.
- **`kernel/src/agents/charter-files.ts`** — keep: `const unbuilt = charter.connectors?.find((kind) => kind === "jira" || kind === "clickup");` behaviour (refused `charter_invalid`, field `connectors`). Only the message changes (owner-only MCP grant), through `settings.ts`'s `mcpGrantKindOf`. Keep the CLI-loadable import rule (`The \`studio\` CLI loads this module`).
- **`kernel/src/agents/roster.ts`** — keep: `export const CONNECTORS_FIELD = "connectors";`, `connectors none` revoking everything, and `connectors github` / `connectors github:write`. Keep `const CONNECTORS_VALUE_MESSAGE = "connectors must be github or none";` byte-identical (pinned by `kernel/test/agents-connectors-grant.test.ts` and `kernel/test/phase-8-foundation.test.ts`, `message: "connectors must be github or none"`). A value starting `jira:` or `clickup:` is dispatched to `settings.ts`'s parser, and a malformed one gets that parser's own message. Widen `type SetValue = string | number | readonly string[] | { readonly github: "write" } | null;` only to the AC8 object form. The verb's help text names the new forms.
- **`kernel/src/kernel.ts`** — keep: `connectorsFor: connectorsFor(dataDir),`, `githubWriteFor: githubWriteFor(dataDir),` and `heldToolCheck: heldToolCheckOf(contributions.tools`, so the pre-hold check still sees only contributed tools. Any lookup that throws grants none ("a session lists fewer tools, never more"). Mirror: `kernel/src/sessions/manager.ts` passes `agent: config.agent` to `mcpServers`.
- **`kernel/src/sessions/policy.ts`** — keep: `export const ALWAYS_HELD_TOOLS: readonly string[] = Object.freeze([` exactly as is (three names), `const KERNEL_TOOL_PREFIX = "mcp__kernel__";`, the "Closed: a category is added only by a kernel change" rule, and `boundaryDecision` read before the dry-run branch. Reuse: the outward payload shape `{ tool: toolName, input: toolInput, cwd: payloadCwd }` and the `neverCategoriesOf` mapping style (`if (action.startsWith("gh api ")) return ["gh_api_write"];`). Pinned by: `kernel/test/sessions-policy.test.ts` (`expect(NEVER_CATEGORIES).toEqual([`), `kernel/test/kernel-tools.test.ts`, `kernel/test/approvals.test.ts`.
- **`app/src/screens/team/model.ts`** — mirror: `/** Mirrors the kernel's \`NEVER_CATEGORIES\`` keeps the kernel's order exactly; add `mcp_write` at the same position.
- **`kernel/test/sessions-policy.test.ts`** — keep: `expect(Object.isFrozen(NEVER_CATEGORIES)).toBe(true);` and the every-category-is-reached pin (`NEVER_CATEGORIES.filter((c) => !reached.has(c) && !NO_MATCHER_YET.includes(c))`). Add a rail row for a `mcp__kernel__kernel_mcp_w_…` call whose categories are `["mcp_write"]`, and never add `mcp_write` to `NO_MATCHER_YET`.
- **`kernel/test/sessions-github-session-auth.test.ts`** — keep: the name `"broken"` and the expectation `grant("broken")` → `false`. Change `write("broken", { ...BASE, connectors: { github: "read" } });` so "broken" holds a genuinely broken value (`{ github: "admin" }`). Add a separately named fixture (e.g. `"objreader"`, `{ github: "read" }`) whose `githubWriteFor` answer is `false`. The `expect([...])` line may grow by that one entry, with every existing entry's expected value unchanged.
- **`docs/ARCHITECTURE.md`** — keep: the `[MCP connectors](architecture/mcp-connectors.md)` link and the phase 8 seams bullet's other sentences (`POLL_SOURCES`, the poll source-adapter seam). Rewrite only `a \`jira\` or \`clickup\` grant in an agent's settings file or charter is refused \`connector_not_built\`` (to the owner-only per-tool grant) and `empty until phase 8 item 06 fills it`. Validated by `bash scripts/check-docs.sh` (every relative link must resolve).
- **`docs/architecture/mcp-connectors.md`** — keep: the `Part of [Phase 8 features](../ARCHITECTURE.md#phase-8-features).` link and the D38 link. Replace "**A stub.**" and the "will fill" section with what was built.

## Closed enumerations touched

> Sibling grep at base `20684c8`: `grep -rnF '"gh_api_write"' --exclude-dir=node_modules --exclude-dir=.supervisor --exclude-dir=evidence --exclude=CHANGELOG.md .` → 8 hits in 4 files; plus `grep -rnF 'gh_api_write' docs/architecture/*.md` → 1 hit.

- **`mcp_write`** (sibling: `gh_api_write`) — must be named in:
  - `kernel/src/sessions/policy.ts` — `export const NEVER_CATEGORIES = Object.freeze([` (`"gh_api_write",`) — extend; and `neverCategoriesOf` (`if (action.startsWith("gh api ")) return ["gh_api_write"];`) — extend with the `mcp_write` action.
  - `app/src/screens/team/model.ts` — the mirror `NEVER_CATEGORIES` (`"gh_api_write",`) — extend.
  - `kernel/test/sessions-policy.test.ts` — the exact-list pin (`"gh_api_write",` at the list) — extend; the rail table (`"gh api POST", ["gh_api_write"]`) — extend with an `mcp_write` row.
  - `docs/architecture/approvals.md` — the category table row `| \`gh_api_write\` |` — extend with a `mcp_write` row.
  - `kernel/test/phase-4-exit.test.ts` — `MASON_NEVER` is one charter's own never list — no change: not a closed list of every category.
  - `kernel/test/sessions-policy.test.ts:130` `never.push("gh_api_write")` — no change: builds a test policy, not a closed list.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions-policy.test.ts` — `expect(NEVER_CATEGORIES).toEqual([` | delete `"mcp_write",` in `kernel/src/sessions/policy.ts` |
| `kernel/test/sessions-policy.test.ts` — the new `mcp__kernel__kernel_mcp_w_` rail row with `["mcp_write"]` | In `kernel/src/sessions/policy.ts`, delete the line in `neverCategoriesOf` that maps the `mcp_write` action to `["mcp_write"]` |
| `kernel/test/integrations-mcp-oauth.test.ts` — the second use of one `state` is refused | In `kernel/src/integrations/mcp/oauth.ts`, delete the line that spends (clears) the window's `state` on first use |
| `kernel/test/integrations-mcp-connector.test.ts` — the AC2 session lists exactly the one granted tool | In `kernel/src/integrations/tool-filter.ts`, delete the per-tool name check, so the filter keeps every tool of a granted kind |
| `kernel/test/integrations-mcp-connector.test.ts` — the AC3 non-read-only call is held | In `kernel/src/integrations/mcp/tools.ts`, flip the prefix chosen for a tool with no hint from `kernel_mcp_w_` to `kernel_mcp_r_` |
| `kernel/test/integrations-mcp-connector.test.ts` — the AC4 refresh failure reads `expired` and notifies | In `kernel/src/integrations/mcp/connector.ts`, delete the `recordNotification` call on the refresh-failure transition |
| `kernel/test/integrations-mcp-connector.test.ts` — the AC5 no-token scan | In `kernel/src/integrations/mcp/connector.ts`, add the access token to the `connector_status` event payload; the scan must turn red |
| `kernel/test/console-contract.test.ts` — the three `p8-item-06` routes are served | In `kernel/src/integrations/mcp/routes.ts`, delete the `/connectors/mcp/:kind/disconnect` route entry |
| `kernel/test/phase-8-foundation.test.ts` — `{ github: "read" }` reads ok (AC8) | In `kernel/src/agents/settings.ts`, delete the `"read"` value from the accepted github values |
| `kernel/test/integrations-mcp-connector.test.ts` — AC12 camelCase / over-long / colliding names | In `kernel/src/integrations/mcp/tools.ts`, delete the `TOOL_NAME` test on emitted names, so a non-conforming name is emitted |
| `kernel/test/integrations-mcp-oauth.test.ts` — AC6 the listener is bound to 127.0.0.1 only | In `kernel/src/integrations/mcp/oauth.ts`, flip the listen host from `127.0.0.1` to `0.0.0.0` |
| `kernel/test/integrations-mcp-oauth.test.ts` — AC6 the authorization request carries PKCE `S256` | In `kernel/src/integrations/mcp/oauth.ts`, delete the `code_challenge_method` / `code_challenge` parameter from the authorization URL |
| `kernel/test/integrations-mcp-oauth.test.ts` — AC6 a second connect while a window is open is refused | In `kernel/src/integrations/mcp/oauth.ts`, delete the open-window check, so a second connect replaces the window |
| `kernel/test/integrations-mcp-oauth.test.ts` — AC6 cancel closes the window | In `kernel/src/integrations/mcp/oauth.ts`, delete the listener close call in the cancel path |
| `kernel/test/integrations-mcp-connector.test.ts` — AC7 refresh writes the Keychain item | In `kernel/src/integrations/mcp/connector.ts`, delete the Keychain writer call after a successful refresh |
| `kernel/test/integrations-mcp-connector.test.ts` — AC7 disconnect deletes the Keychain item and reads `disconnected` | In `kernel/src/integrations/mcp/connector.ts`, delete the Keychain deleter call in the disconnect path |
| `kernel/test/integrations-mcp-connector.test.ts` — AC9 results are wrapped as untrusted data | In `kernel/src/integrations/mcp/tools.ts`, return the server's raw result instead of the wrapped one |
| `kernel/test/integrations-mcp-connector.test.ts` — AC10 `never: [mcp_write]` denies `agent_boundary` | In `kernel/src/sessions/policy.ts`, delete the `neverCategoriesOf` line mapping the `mcp_write` action, so the call is held instead of denied |
| `kernel/test/integrations-mcp-connector.test.ts` — AC11 `GET /connectors` carries `mcp_connections` with no token field | In `kernel/src/integrations/github/routes.ts`, delete the `mcp_connections` key from the `GET /connectors` body |
| `kernel/test/phase-8-foundation.test.ts` — `mcpPart` is filled | In `kernel/src/integrations/index.ts`, restore `export const mcpPart: IntegrationsPart = emptyConsolePart("mcp");` in place of the import |
| `kernel/test/sessions-github-session-auth.test.ts` — the `{ github: "read" }` fixture reads with no write | In `kernel/src/agents/settings.ts`, make the object form's `github: "read"` set `githubWrite` (flip the `"write"` comparison to accept any github value) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | MCP connector core: OAuth 2.1 connect, Keychain tokens, tool list, routes, refresh, proxy-tool builder, fake server, docs | AC1, AC4, AC5, AC6, AC7, AC9 (wrapping and the kernel-side call in `mcp/tools.ts`), AC11, AC12 | 6 modify, 8 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Owner-only per-tool grant, session wiring and the `mcp_write` rail | AC2, AC3, AC8, AC9 (session side: no token in the session), AC10 | 14 modify (3 shared after #1), 0 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/integrations/mcp/connector.ts"}
  - {kind: "symbol", path: "kernel/src/integrations/mcp/connector.ts", name: "mcpPart"}
  - {kind: "symbol", path: "kernel/src/integrations/mcp/connector.ts", name: "mcpConnectorGate"}
  - {kind: "symbol", path: "kernel/src/integrations/mcp/connector.ts", name: "listMcpConnections"}
  - {kind: "file", path: "kernel/src/integrations/mcp/oauth.ts"}
  - {kind: "file", path: "kernel/src/integrations/mcp/client.ts"}
  - {kind: "file", path: "kernel/src/integrations/mcp/routes.ts"}
  - {kind: "file", path: "kernel/src/integrations/mcp/tools.ts"}
  - {kind: "symbol", path: "kernel/src/integrations/mcp/tools.ts", name: "mcpProxyTools"}
  - {kind: "file", path: "kernel/test/fixtures/mcp-fake.ts"}
  - {kind: "file", path: "kernel/test/integrations-mcp-connector.test.ts"}
  - {kind: "file", path: "kernel/test/integrations-mcp-oauth.test.ts"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "mcp_connections"}
requires: []
lanes:
  - "kernel/src/integrations/mcp/**"
  - "kernel/src/integrations/index.ts"
  - "kernel/src/integrations/github/routes.ts"
  - "app/src/api/contract.ts"
  - "kernel/test/fixtures/mcp-fake.ts"
  - "kernel/test/integrations-mcp-connector.test.ts"
  - "kernel/test/integrations-mcp-oauth.test.ts"
  - "kernel/test/console-contract.test.ts"
  - "kernel/test/phase-8-foundation.test.ts"
  - "docs/architecture/mcp-connectors.md"
external_requires:
  - "@modelcontextprotocol/sdk 1.31.0 (already a kernel dependency): client auth helpers and StreamableHTTPClientTransport"
  - "macOS /usr/bin/security (through kernel/src/auth/keychain.ts; tests use the injected stub writer/deleter)"

# Subtask 2
provides:
  - {kind: "symbol", path: "kernel/src/agents/settings.ts", name: "parseConnectorsGrant"}
  - {kind: "symbol", path: "kernel/src/kernel.ts", name: "mcpToolGrantsFor"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "mcp_write"}
  - {kind: "symbol", path: "app/src/screens/team/model.ts", name: "mcp_write"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/mcp/tools.ts", name: "mcpProxyTools"}
  - {from: "1", kind: "file", path: "kernel/test/integrations-mcp-connector.test.ts"}
  - {from: "1", kind: "file", path: "kernel/test/fixtures/mcp-fake.ts"}
lanes:
  - "kernel/src/agents/settings.ts"
  - "kernel/src/agents/charter-files.ts"
  - "kernel/src/agents/roster.ts"
  - "kernel/src/integrations/tool-filter.ts"
  - "kernel/src/kernel.ts"
  - "kernel/src/sessions/policy.ts"
  - "app/src/screens/team/model.ts"
  - "docs/architecture/approvals.md"
  - "docs/ARCHITECTURE.md"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/sessions-github-session-auth.test.ts"
  - "kernel/test/phase-8-foundation.test.ts"
  - "kernel/test/integrations-mcp-connector.test.ts"
  - "docs/architecture/mcp-connectors.md"
external_requires: []
```

Note: `kernel/test/agents-connectors-grant.test.ts` is not in any lane. `CONNECTORS_VALUE_MESSAGE` stays byte-identical, so its pins stay green unedited. If one goes red, that is a defect in the change, not a reason to edit the test.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | `kernel/test/phase-8-foundation.test.ts`, `kernel/test/integrations-mcp-connector.test.ts`, `docs/architecture/mcp-connectors.md` | YES (ordered: 2 requires 1, so sharing is legal; Subtask 2 re-checks that Subtask 1's cases still pass) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The requirement's Touches rule was overridden by the owner (source: Feasibility (Phase 2.5), NO-GO overridden) | HIGH | Every file is in a subtask's `lanes:`, and each is named in `## Owner overrides`. A worker needing any other file stops and says so. Code review checks that the diff touches nothing outside the two lanes' union. |
| Scope is over one worker's context: 25 distinct files (source: Feasibility (Phase 2.5)) | HIGH | Split `context-bound` into 2 ordered subtasks. Subtask 2 consumes only `mcpProxyTools` and the test fixture. |
| A session gets a token or an ungranted tool through a wiring slip (invariant 3) | HIGH | AC2, AC5 and AC9 tests. The session's env and MCP server config are scanned for the fake token. `heldToolCheckOf` stays on contributed tools only. Any grant lookup failure grants none. |
| ClickUp's server is in beta; a December 2025 user report named a mismatch in its OAuth metadata, unconfirmed whether fixed (source: requirement Risks) | MEDIUM | Item 06 tests only against the fake server. Discovery fails with a named refusal (never a crash), and item 07 owns ClickUp specifics. |
| Atlassian's endpoint path changed in 2026 (`/v1/sse` ended 2026-06-30) (source: requirement Risks) | MEDIUM | The server URL is data on the connector definition (item 07 fills `https://mcp.atlassian.com/v1/mcp`). Item 06 hard-codes no vendor URL. |
| Untrusted server text (tool names, descriptions, results) reaches a model or the rail (invariant 3) | HIGH | The kernel derives proxy names from a strict name pattern and drops anything else. Results are wrapped as untrusted data. The read-only flag comes from the kernel's stored row, never from session input. The rail fails closed (any `kernel_mcp_` name that is not `kernel_mcp_r_` is `mcp_write`). |
| A dry run of a playbook never actually reads through a read-only proxy tool, because `KERNEL_READ_TOOL` (`kernel/src/sessions/dry-run.ts`) matches only `_list` / `_get` | LOW | Out of item 06's scope. Noted for item 07, whose ticket sources run in dry runs. |
| Wright's `kernel_agent_update` re-renders settings from a charter that can't carry MCP grants, and could drop an owner's jira grant | MEDIUM | Verify-only: `kernel/src/agents/charter-tools.ts` already says the connectors grant takes effect only on create and `no later update changes it`. Subtask 2 adds one test in `kernel/test/integrations-mcp-connector.test.ts` showing an approved update leaves an owner-set `{jira: [...]}` grant intact. If that test goes red, the worker stops and reports: `charter-tools.ts` / `renderAgentSettingsJson` are not in any lane. Subtask 2 notes the result in `docs/architecture/mcp-connectors.md` (in its lanes, after Subtask 1). |
| Proxy names or schemas break the session's whole tool list (the Agent SDK serialiser throws on `z.record`; a bad name fails `TOOL_NAME`) | HIGH | `arguments_json: z.string()` only, so no server schema becomes zod. Names are mapped and capped under `TOOL_NAME` and 64 characters, with drops counted (AC12). The exact model-API tool-name limit is NEEDS VERIFICATION, recorded in `docs/architecture/mcp-connectors.md`. |
| The loopback listener port is taken, or a stale window is left after a crash | LOW | It binds port 0 (the OS picks), is memory only, and closes on settle, expiry or cancel. A restart loses it (same as D36). |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-03-mcp-connector-mechanism-with-oauth.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-03T13:12:18Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/223
- **Branch:** feature/mcp-connector-mechanism-with-oauth
- **Files changed:** 32
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Built the MCP connector mechanism (OAuth 2.1 PKCE loopback connect, Keychain-only tokens, tool list on the row, refresh to expired plus notify, mcpConnectorGate, the 3 routes and GET /connectors mcp_connections, kernel proxy tools) and the owner-only per-tool grant with the mcp_write rail, in 2 sequential subtasks. The owner widened the lanes twice mid-run: 4 consequence files after subtask 1, and docs/architecture/agents.md during heal. Heal round 1 found 2 MEDIUM issues (a Keychain read on every tick, stale agents.md text), fixed in c0dd38e. Round 2 PASSed with no findings. CI green. One LOW finding dismissed: the D38 wording in DECISIONS.md, left for the owner.

## Not verified
- **Atlassian and ClickUp real servers** — never run; Jira is the owner's Tray account and ClickUp's live run is item 07's (subtask 1)
- **the app opening authorize_url and a real browser redirecting to the loopback listener** — tests play the browser with fetch (subtask 1)
- **the connector writing the real login Keychain** — tests use the real security modules over a fake exec (subtask 1)
- **the model API's exact tool-name limit** — the 64-character session cap is conservative and was not probed (subtask 1)
- **the Integrations screen consuming mcp_connections and the disconnect answer** — app code was not run (subtask 1)
- **a real session running an approved mcp_write proxy call end to end** — the Agent SDK is faked (subtask 2)
- **the app Team screen showing mcp_write in its never list** — no UI was opened (subtask 2)
