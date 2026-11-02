# MCP connectors

Part of [Phase 8 features](../ARCHITECTURE.md#phase-8-features). **A stub.** Phase 8 item 01 (the foundation) ships the seam and this page; item 06 fills the seam and replaces the "will" sentences below with what it built. Nothing on this page runs yet. The decision is [D38](../DECISIONS.md).

## What exists today

- **The part.** The integrations feature has an empty `mcp` part (`kernel/src/integrations/index.ts`), placed before the `github-app-routes` part, which stays last. It contributes no tool, route, subcommand, handler or due work.
- **The kinds.** `CONNECTOR_KINDS` is `github`, `jira`, `clickup`. A `jira` or `clickup` grant in an agent's settings file or charter is refused `connector_not_built` until the connector exists, and the owner's `set connectors` route and verb still refuse every kind but `github`.
- **The table.** Migration 20 creates `mcp_connections`: kind, server url, status, granted tools and token expiry (see the [data model](../ARCHITECTURE.md#data-model)). It will never hold a secret. Nothing writes to it yet.
- **The contract.** `app/src/api/contract.ts` declares `McpConnectionKind`, `McpConnection` and `McpConnectResponse`, and lists three routes with origin `p8-item-06`: `POST /connectors/mcp/:kind/connect`, `POST /connectors/mcp/:kind/connect/cancel` and `POST /connectors/mcp/:kind/disconnect`. None is served yet, and `kernel/test/console-contract.test.ts` pins them as not served.

## What item 06 will fill

Each bullet is an owner decision from the phase 8 session of 2026-11-02, recorded in D38, not a description of built code.

- **Studio is an MCP client to each vendor's hosted server:** Atlassian Rovo MCP (`https://mcp.atlassian.com/v1/mcp`, Jira Cloud only) and ClickUp (`https://mcp.clickup.com/mcp`, OAuth-only and in beta; both as researched on 2026-11-02).
- **OAuth 2.1 in the system browser.** Studio runs the consent in the system browser and keeps the tokens in the Keychain. This is the vendor's consent for the vendor's server, never a claude.ai sign-in (invariant 6).
- **Only granted tools.** The kernel lists to each agent only the tools the owner grants it.
- **Tickets are poll items.** In the kernel, every connector's tickets reach a playbook as the same poll item shape, through the poll source-adapter seam ([triggers](triggers.md#poll-triggers)). The sources `jira.issues` and `clickup.tasks` are in `POLL_SOURCES` today and refused `poll_source_not_built` until their items land.
- **Optional, like GitHub.** Each tracker is its own connector on Integrations (D12, invariant 5); Studio works with none.
- **Which accounts are exercised.** Jira is the owner's work (Tray) account, so nothing touches it live: it is built and tested against a fake MCP server in CI, and its live check is recorded `not_exercised`. ClickUp is personal, so the live run may read it.
