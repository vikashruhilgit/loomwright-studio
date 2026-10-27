# Integrations

Part of [Phase 6 features](../ARCHITECTURE.md#phase-6-features). Built and documented by **item 03** (the GitHub connector: token validation and the repos the token reaches), in the integrations feature's `github/connector.ts` and `github/routes.ts` parts (`kernel/src/integrations/github/`), and by **item 11** (the Integrations screen, `app/src/screens/integrations/`).

**Routes** (owner-only):

| Route | Answers |
|---|---|
| `GET /connectors` | `{connectors}`: every `connectors` row, none when nothing is connected |
| `POST /connectors/github/token` | body `{token}`; the row after the change, never the token |
| `POST /connectors/github/disconnect` | the row after the change |
| `GET /connectors/github/repos[?refresh=1]` | `{repos, verified_at}`: the repos the token reaches, as `owner/name`; `refresh=1` re-reads them from GitHub first |

**Contract types it fills** (`app/src/api/contract.ts`): `ConnectorKind`, `ConnectorStatus`, `Connector`, `ConnectorsResponse`, `ConnectorTokenBody`, `ConnectorChangeResponse`, `ConnectorReposQuery` and `ConnectorReposResponse`.

The credential is Studio's own fine-grained, read-only personal access token, which the owner creates for the personal repos they choose. It lives only in the Keychain item `loomwright-studio-github`: the `connectors` table (migration 17) holds its status, account, permissions, reachable repos and expiry, and never a secret. No route, log line or event carries the token. The kernel accepts only a token whose permissions are all read-only, and names the permission to drop otherwise. Studio runs no OAuth flow and never reuses the `gh` CLI's login. Every status change appends one `connector_status` event, shown in Wright's thread ([threads](threads.md#the-event-kinds)). GitHub is an optional connector (invariant 5): Studio works with none.

Today (the phase 6 foundation) migration 17 creates the `connectors` table, both parts are empty, the four routes answer 404, and the app's Integrations entry (`⌘5`) is a placeholder that fetches nothing.
