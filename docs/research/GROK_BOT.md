# Research: Grok Bot (xAI)

Researched 2026-09-26. **Caveat:** these come from third-party write-ups (Composio, Vellum, MindStudio, MemoryLake), not xAI's own docs, and the product is an early beta launched 2026-08-11. Treat the details as approximate.

## How it works

- **A persistent cloud computer.** One always-on VM per account, with a browser, files and a terminal. Bots keep working with the user's laptop closed, and state persists between sessions.
- **Named bots with roles.** Each bot has a job, tools, its own role, preferences, and summaries of earlier work.
- **Routines** run on a schedule or after an event, without a prompt.
- **Skills learned from use.** A process that worked can be saved as a skill (steps, decision rules, output requirements, approval boundaries). A bot can also watch a browser workflow and draft a skill from it.
- **Chief of staff + specialists.** 2–6 bots share a group chat; the lead hands work to specialists, and they pass ownership between themselves.
- **Approvals.** Allow once / deny / always allow per action; Auto Review modes (require approval / always allow).
- **Tools.** Connectors (Gmail, Calendar, Drive, Outlook, Teams, SharePoint, Salesforce), plugins, and MCP servers.

## Its weaknesses, which Studio targets

| Grok Bot | Studio |
|---|---|
| Memory can't be inspected, corrected, exported or deleted | Memory is plain markdown files |
| All bots share one VM and one set of credentials, so they aren't separate security boundaries | Each agent has its own permission policy and integrations |
| Custom MCP servers must be publicly reachable | Runs locally next to private tools and repos |
| Desktop app + iPhone only | Desktop app, plus optional connectors (Slack, …) |
| xAI models only | Claude via the Agent SDK; auth is pluggable |
| Cloud only (its strength: runs with the laptop closed) | Local first; an always-on host is roadmap phase 10 |

## Sources

- [A Guide to Grok Bot — Composio](https://composio.dev/content/guide-to-frok-bot)
- [Official Grok Bot Breakdown (2026) — Vellum](https://www.vellum.ai/blog/official-grok-bot-breakdown)
- [Grok Bot agents: chief of staff, routines, skills — MindStudio](https://www.mindstudio.ai/blog/grok-bot-tips-and-hacks)
- [Grok Bot per-bot memory — MemoryLake](https://www.memorylake.ai/en/blogs/grok-bot-per-bot-memory)
