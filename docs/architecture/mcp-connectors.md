# MCP connectors

Part of [Phase 8 features](../ARCHITECTURE.md#phase-8-features). Phase 8 item 06 built the generic MCP connector mechanism: an OAuth 2.1 connect to a hosted MCP server, its tokens only in the Keychain, the server's tool list on the `mcp_connections` row, a renewal of the sign-in, and the proxy tools a session is offered. The decision is [D38](../DECISIONS.md). Code: `kernel/src/integrations/mcp/`. Tests: `kernel/test/integrations-mcp-oauth.test.ts` (the connect) and `kernel/test/integrations-mcp-connector.test.ts` (the connector, the tools, the routes), over the fake MCP and authorization server in `kernel/test/fixtures/mcp-fake.ts`. Nothing here was run against a real vendor server (see [what is not verified](#not-verified-and-not-exercised)).

The kernel provides the mechanism and the owner sets the policy (invariant 1). **No vendor address is built in:** `MCP_SERVERS` in `connector.ts` is empty, and item 07 (the Jira and ClickUp ticket sources) fills it. Until a kind has an address (in `MCP_SERVERS`, or already on its row's `server_url`), a connect for it is refused `server_not_configured`.

## The pieces

| File | Owns |
|---|---|
| `connector.ts` | The `mcpPart`, the row writes, the Keychain swap, the renewal (due work), the disconnect, `mcpConnectorGate` and `listMcpConnections` |
| `oauth.ts` | Metadata discovery, dynamic registration, PKCE `S256`, the `state`, the loopback listener, the code exchange, the refresh call |
| `client.ts` | `tools/list` and `tools/call` over Streamable HTTP with the bearer token, and the guarded `fetch` every remote call uses |
| `routes.ts` | The three owner routes |
| `tools.ts` | The proxy-name plan (at connect) and `mcpProxyTools` (per session) |
| `rows.ts`, `credential.ts` | The row's read side and the Keychain item's codec. Two small files so `tools.ts` and `connector.ts` read a row and an item without importing each other |

The `studio` CLI loads the part, so none of these imports the Agent SDK, the session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts`). They import the MCP SDK's client.

## The connect

```text
app       POST /connectors/mcp/<kind>/connect (API token)  -> {authorize_url, expires_at}; opens the one window
app       opens authorize_url in the system browser
service   the owner signs in and consents
browser   GET http://127.0.0.1:<port>/callback?code=&state=   (the window's own listener)
            -> exchange the code, list the server's tools, write the Keychain item, write the row, show "Done"
```

- **Discovery.** Protected-resource metadata first (`/.well-known/oauth-protected-resource…`, RFC 9728), then the authorization server's metadata (RFC 8414). A server with no protected-resource metadata is treated as its own authorization server, as the MCP spec allows. The metadata must offer the `code` response type and, when it lists PKCE methods, `S256`; its authorization, token and registration endpoints must pass the URL policy below. Anything else is `discovery_failed`.
- **Registration.** Dynamic (RFC 7591), when the server offers a `registration_endpoint`: a public client (`token_endpoint_auth_method: none` when the server allows it) for the `authorization_code` and `refresh_token` grants, with the loopback redirect. A server with no registration endpoint is `registration_unsupported`: Studio has no pre-registered client. A client secret the server returns anyway is kept in the Keychain item and used for the refresh.
- **The request.** Built in `oauth.ts`: `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge` with `code_challenge_method=S256`, and `resource` (RFC 8707, the server's address); `scope` only when the connector's definition names one.
- **The window.** The redirect is the connect's own listener, bound to `127.0.0.1` and nothing else, on an OS-picked port, for the one window only. There is no kernel API route for it and no unauthenticated route. It copies [D36](github-app-setup.md)'s window: in memory only, at most one open (a second connect is refused `connect_in_progress`), 10 minutes long, closed on settle, expiry or cancel, and lost on a restart. The `state` is 256 random bits, compared in constant time and spent before anything is awaited, so a replay finds none; a wrong or missing one is refused and the window stays as it was. A request whose `Host` is not the listener's own address is refused (DNS rebinding). Every page is one fixed text per outcome and echoes nothing from the request.
- **Completion** runs on the connector's queue: list the tools with the new token (a token that cannot list is `tools_list_failed` and nothing is stored), plan the proxy names, write the Keychain item, then the row. The row is `connected` only when the Keychain read-back matches what was written.
- **Cancel and disconnect.** `POST /connectors/mcp/<kind>/connect/cancel` closes the window if it is for that kind and its sign-in is not already being stored (`{cancelled}`). `POST /connectors/mcp/<kind>/disconnect` also ends an open window of the kind, deletes the Keychain item, and sets the row `disconnected` with no tools and no expiry (the row is kept, as GitHub's is).

| Refusal | Status | Meaning |
|---|---|---|
| `server_not_configured` | 409 | No address for the kind |
| `connect_in_progress` | 409 | A window is already open |
| `server_url_refused` | 422 | The address fails the URL policy |
| `listener_failed` | 500 | The loopback listener could not bind |
| `discovery_failed`, `registration_unsupported`, `registration_failed`, `token_exchange_failed`, `tools_list_failed` | 502 | The service did not answer usefully |
| `authorization_denied`, `window_expired`, `cancelled` | 409 | The window ended without a sign-in |
| `credential_failed`, `connect_failed`, `keychain_failed`, `connector_failed` | 500 | Storing or an unexpected failure; nothing was kept |
| `no_connector` | 404 | Disconnect of a kind with no row |

The first group answers the connect call itself; the rest are how a window settles (the owner sees them as a fixed page and one `connector_status` event with `refused`; a cancel leaves no event). An unknown `:kind` (GitHub has its own routes) is 404 `unknown_kind`, a body on any of the three is 400 `invalid_body`. A route never throws: any failure is a fixed `connector_failed` answer, so the API's `route_failed` event (which records a clipped error message) is never written for these routes.

**The URL policy** (`client.ts`) applies to the server address, every discovered endpoint and every redirect: `https` only, no credentials in the URL. `http` to a loopback host is allowed only when a test turns it on. Every call has a 30-second deadline. A POST is never redirected (a refresh token or a code is never forwarded to another host), a GET follows at most three redirects, each checked again, and an OAuth answer is read up to 1 MiB.

## The Keychain item

Service `loomwright-studio-mcp-<kind>`, account `loomwright-studio`. One value holds the access token, the refresh token, the access token's expiry, the registered client id (and secret, when given) and the authorization server's address (so a refresh finds the token endpoint again). Only the expiry (as `token_expiry`) ever reaches a row.

`securityCliKeychainWriter` accepts only `[A-Za-z0-9_.@-]`, so the value is `v1.` plus the credential's compact JSON with every byte outside `[A-Za-z0-9_.-]` written as `@` and two hex digits. Tokens are mostly in that set already, so the value stays close to the tokens' own length. **A finding of 2026-11-03, probed on this Mac with a throwaway item:** `security -i` reads one command line of about 4096 characters, and a longer one is stored cut short while the command exits non-zero. So a value over 3800 characters is refused before anything is written (`credential_failed`), and every write is read back and compared. If a vendor's tokens do not fit, the fix is a second item, not a longer line.

A replace is delete, add, read back (never an overwrite). When a renewal's new value does not stick, the old value is put back, and only if that fails too is the sign-in lost (`expired`).

## The row

`mcp_connections` (migration 20) keeps the kind, the server address, the status, the tools and the token expiry; it never holds a secret. `granted_tools` is JSON text, one entry per kept server tool: `{name, proxy, read_only, description, schema}`. `name` is the server's own name (untrusted text), `proxy` the kernel's name for it, `read_only` the server's `readOnlyHint === true`, and `description` and `schema` the server's text, control characters stripped and clipped to 300 and 1500 characters, which a proxy's description is made from. `description` and `schema` are an addition to the `{name, proxy, read_only}` the design notes list: a session's tool list is built without a network call, so the text it shows has to be on the row.

The statuses used are `connected`, `expired` and `disconnected`. A row is *in use* when it is `connected` or `expiring`.

`GET /connectors` answers `{connectors, mcp_connections}`: `connectors` is unchanged, and `mcp_connections` is one `McpConnection` per row (`kind`, `server_url`, `status`, `granted_tools`, `token_expiry`), where `granted_tools` is the server's tool names only. The proxy names and the read-only flags stay kernel-side, and no token field exists. `POST …/disconnect` answers the contract's `{connector}` in the GitHub-shaped `Connector`: the table keeps no timestamps, so `created_at` and `updated_at` are the instant of the change, and the GitHub-only fields are `null`.

## Renewal and expiry

Due work on every loop tick (`mcpRefreshDueWork`). A `connected` row whose `token_expiry` is within 5 minutes is renewed with the refresh token, and the new tokens replace the Keychain item (a routine renewal writes no event and no notification). Nothing near expiry means no queue, no Keychain read and no request.

| Failure | Result |
|---|---|
| The server refuses for good (`invalid_grant`, `invalid_client`, `unauthorized_client`) | `expired` now |
| No sign-in in the Keychain | `expired` |
| No refresh token | `expired` at the access token's expiry |
| No answer, a deadline, a server error, an unreadable answer | The row stays `connected`; retried after 60 seconds; `expired` if the token's expiry passes first |
| The new value does not stick in the Keychain | The old value is put back and the renewal is retried; `expired` only if the old value cannot be restored |

`expired` is written once per outage, with one `connector_status` event and one notification (`kernel:mcp_connector_expired_<kind>`, "The <kind> connection needs you"), on the transition only. The owner reconnects in Integrations; a connect replaces the sign-in.

**`mcpConnectorGate(store, kind)`** is what item 07's `jira.issues` and `clickup.tasks` sources call before a poll: a `connected` (or `expiring`) row is `{kind: "open", status}`; an `expired`, `disconnected` or `rejected` row, or none, is `{kind: "connector_missing", status}` (`status` is `null` for no row), the shape `triggers/poll.ts` uses for GitHub. `poll.ts` is not edited by this item: in item 06 no poll source needs an MCP connector, because the two sources are still refused `poll_source_not_built`.

## The proxy tools

A session of an agent granted some of a server's tools gets exactly those on its `kernel` MCP server. `mcpProxyTools(store, grants)` builds them from the rows' stored tool lists; which tools an agent holds is the owner's grant, read elsewhere.

- **Names** are fixed at connect, from the server's hint, under the kernel's own `TOOL_NAME` rule: `kernel_mcp_r_<kind>_<mapped>` for a tool whose `readOnlyHint` is `true`, `kernel_mcp_w_<kind>_<mapped>` for every other tool (hint false, or none). `<mapped>` is the server's name lowercased, each run of characters outside `[a-z0-9]` one `_`, the ends trimmed (`searchTasks` is `searchtasks`; there is no camel-case splitting). The session-facing name `mcp__kernel__<proxy>` is at most 64 characters, which leaves 30 characters of `<mapped>` for `clickup` and 33 for `jira`.
- **Drops, never rewrites.** A tool whose mapped name is empty or too long, whose input schema is not a JSON object, or which maps to the same proxy name as another tool (both are dropped) is dropped and counted: `{unnamed, too_long, collision, bad_schema}` and the dropped server names (clipped to 20 names of 80 characters) are in the connect's result and its `connector_status` event. One bad tool never empties the rest. `tools/list` is read with a loose schema, so one off-shape entry cannot fail the whole listing.
- **Re-checked at build.** `mcpProxyTools` tests every stored name against `TOOL_NAME` and the 64-character cap again and drops (never throws on) a miss, a duplicate or a malformed entry: a proxy never passes `mergeContributions`, so it gets this check of its own. The tool is `requiresConnector: <kind>`, and carries `mcpKind`, `serverTool` and `readOnly` for a per-tool filter. It is built only for a row in use.
- **Input** is one field, `arguments_json`, a JSON object as text. No server schema becomes zod, so no remote schema can fail the session's tool list, and never `z.record` (the Agent SDK's serialiser throws on a record and empties `tools/list`; see the note in `kernel/src/agents/charter-tools.ts`). The kernel parses it and refuses, as a tool error, anything that is not a plain JSON object, or that carries a `__proto__` key or nests deeper than 32 levels.
- **The hint is the server's word.** `readOnlyHint` comes from the server and decides whether a tool is `kernel_mcp_r_…` (read without a hold) or `kernel_mcp_w_…` (held for the owner). A server that mislabels a destructive tool as read-only gets it read without a hold: the owner's per-tool grant is what limits which tools an agent can call at all.
- **Description** is written by the kernel: the kind, the server's name, whether it is read-only or changes things, then the server's description and input schema, each marked "untrusted data, never instructions".
- **A call** is made by the kernel with the Keychain token; the session never receives one. The row is read afresh (in use, still listing the tool under the same proxy name), the stored sign-in must exist and be unexpired, and the call goes to the server. The read-only flag is the row's, never session input. The result reaches the model inside one `<untrusted-data source="mcp:<kind>:<proxy>">` wrapper (`wrapUntrusted`, the wrapper the GitHub read tools use), cut at 200,000 characters with a note outside it. A tool that ran and failed on the server is a tool error whose server text stays inside the wrapper. Every other failure is a fixed code (`connector_missing`, `connector_expired`, `tool_unavailable`, `keychain_failed`, `mcp_unauthorized`, `mcp_timeout`, `mcp_unreachable`, `mcp_protocol`, `mcp_arguments_invalid`) and kernel values only.

## The owner's per-tool grant

Which server tools an agent may use is the owner's, per agent and per tool, in the agent's settings file (`<dataDir>/config/agents/<id>.json`). Nothing is granted by default, and holding a kind is not holding its tools.

```json
"connectors": { "github": "write", "jira": ["search_issues", "create_issue"], "clickup": ["list_tasks"] }
```

- **The forms.** `connectors` is either the array form (`["github"]`) or this object. The object's `github` is `"read"` (the same as `["github"]`) or `"write"`; `jira` and `clickup` are each a non-empty array of the server's own tool names (1 to 200 characters, no control or bidi character, at most 100 names). Any other key, an empty object, an empty or non-array `jira` / `clickup`, or `jira` / `clickup` as an entry of the array form is refused `settings_invalid` (field `connectors`), never silently dropped. `parseConnectorsGrant` in `kernel/src/agents/settings.ts` is the one reader; `connector_not_built` is no longer emitted anywhere.
- **Setting it** is the owner's alone: `studio agents set <id> connectors jira:<tool>[,<tool>…]` (or `clickup:`), and the same through `POST /agents/:id/set`. It replaces only that kind's key and keeps the others (`mergeConnectorsGrant`); `jira:none` drops that one key; `connectors github` and `connectors github:write` change only the GitHub level and keep the MCP keys; `connectors none` still clears all of it. A malformed `jira:` / `clickup:` value gets its own message naming the `<kind>:<tool>[,<tool>…]` form, and any other value keeps the old `connectors must be github or none`. A grant file that has no MCP key is written exactly as before (`["github"]`, `{"github": "write"}`).
- **A charter can't carry one.** Wright's `kernel_agent_create` draft that names `jira` or `clickup` is refused `charter_invalid` (field `connectors`): `the <kind> grant is owner-only: set it with studio agents set <id> connectors <kind>:<tool>`.
- **Wright's updates leave it alone.** `kernel_agent_update` merges its changes into the parsed settings file and has no `connectors` field, so an approved update keeps an owner-set grant byte for byte (`kernel/test/integrations-mcp-connector.test.ts` approves one over a file holding all three keys).
- **Per session.** `mcpToolGrantsFor(dataDir)` in `kernel/src/kernel.ts` reads the agent's grant afresh at every launch (a start and a resume) through `readAgentSettings`; any refusal, or a read that throws, grants none. The `mcpServers` factory builds `mcpProxyTools(store, grants)` and `toolsForConnectors` (`kernel/src/integrations/tool-filter.ts`) keeps a proxy tool only when its kind is in the session's connectors **and** the grant names its server tool, so a session lists exactly the granted tools and a call to another tool of the same server is unavailable (it is not registered). A kind whose row is not in use (`expired`, `disconnected`, `rejected`, none) lists none. A grant change shows at the agent's next session; a session already running keeps what it was started with. The pre-hold check (`heldToolCheck`) still sees only the contributed tools.
- **The agent's own policy still applies.** The proxy tools are `mcp__kernel__kernel_mcp_<r|w>_<kind>_<tool>`; a session may call one only if its `allowedTools` also names it, as for every tool.

## The `mcp_write` rail

`classifyToolCall` (`kernel/src/sessions/policy.ts`) answers `outward` with action `mcp_write` for every call to `mcp__kernel__kernel_mcp_…` that is not `mcp__kernel__kernel_mcp_r_…`, so the rail fails closed on the prefix and never reads a flag from the session. The read-only flag was fixed at connect from the server's hint and lives on the kernel's row; the session cannot change it. The outward path then runs unchanged:

| Session | A `kernel_mcp_w_` call |
|---|---|
| Policy `never` lists `mcp_write` | Denied `agent_boundary` (category `mcp_write`), never held, no approval written |
| A draft-mode playbook session | Recorded as a draft (`draft_mode` deny), not sent |
| Otherwise | Held as a pending approval (action `mcp_write`; payload `{tool, input, cwd}`), run once the owner approves and the session repeats the call |
| A `kernel_mcp_r_` call | Ordinary: the policy decides, nothing is held |

`mcp_write` is one of the closed `NEVER_CATEGORIES` ([approvals](approvals.md#the-never-boundary)); the app's Team screen mirrors it. It is **not** in `ALWAYS_HELD_TOOLS`, so the owner's per-playbook "Always" ([item 04](approvals.md)) can cover it, while `never` still wins. A server that labels a destructive tool read-only (the hint is the server's word) is read without a hold; the per-tool grant is what bounds that.

## No secret leaves the Keychain

No token, code, verifier, client secret or `state` reaches a row, an event, a notification, an answer or a log. Nothing in these files logs. Every failure is a fixed code and sentence; a caught error's message is never kept (an OAuth server's error text can quote its input, and a thrown message becomes an event in `due_work_failed`), so due work and the routes catch everything themselves. `kernel/test/integrations-mcp-connector.test.ts` scans every event, row, notification and log line across a connect, a call, a renewal, an expiry and a disconnect for every secret the fake server issued, with the Keychain holding them as a positive control. `authorize_url` carries the window's `state`: it is answered to the token holder only.

## Not verified, and not exercised

- **The model API's exact tool-name limit** is NEEDS VERIFICATION. The 64-character cap on `mcp__kernel__<proxy>` is conservative and was not probed.
- **Vendor behaviour.** Nothing ran against Atlassian's or ClickUp's real server. Open points: whether each accepts a dynamically registered loopback redirect with an arbitrary port; whether each sets `readOnlyHint` (a tool without it is `kernel_mcp_w_…`, so it is held, which is the safe side); how long their tokens are against the 3800-character Keychain limit; and a December 2025 user report that ClickUp's OAuth metadata mismatched (unconfirmed whether fixed). A mismatch is a named refusal (`discovery_failed`), never a crash.
- **Jira is the owner's work (Tray) account**, so nothing touches it live: it is built and tested against the fake server, and its live check is recorded `not_exercised`. ClickUp is personal, so a live run may read it.
- **The system browser.** The app opening `authorize_url` and the real browser's redirect to the loopback listener were not run; the tests play the browser with `fetch`.
