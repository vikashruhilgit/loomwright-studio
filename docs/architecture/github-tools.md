# GitHub tools

Part of [Phase 6 features](../ARCHITECTURE.md#phase-6-features). Built and documented by **item 06** (read-only GitHub tools that return PR text as untrusted data), in the integrations feature's `github/tools.ts` part (`kernel/src/integrations/github/tools.ts`).

**Tools:** `kernel_github_pr_get`, `kernel_github_pr_diff`, `kernel_github_pr_files` and `kernel_github_pr_comments`. They fetch with Studio's own token ([integrations](integrations.md)) and return everything wrapped as untrusted data, `<untrusted-data source="github:<owner>/<repo>#<n>">` (invariant 3).

**Routes:** none. **Contract types:** none: the tools are kernel MCP tools, which the app never calls.

Each tool is defined with `requiresConnector: "github"`, so the per-agent tool filter (`toolsForConnectors` in `kernel/src/integrations/tool-filter.ts`, applied where `kernel/src/kernel.ts` builds each launch's `kernel` server) lists it only in sessions of an agent whose enforced settings (`config/agents/<id>.json`) carry `connectors: ["github"]`. A session never lists an ungranted tool, so it can't call one. Sessions of a granted agent can't run the `gh` binary, so no raw PR text reaches the model unwrapped.

Today (the phase 6 foundation) the part is empty: the filter and the `requiresConnector` flag exist, and no shipped tool carries the flag.
