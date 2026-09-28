# Loomwright Studio

> ⚠️ **Early development — not ready for use.**
> Studio is under active construction. Features are incomplete, things will break, data formats will change without migration, and there is no support. Watch the repo if you're interested, but please don't depend on it yet. No releases or builds have been published.

Loomwright Studio is a desktop app for an always-available AI partner that runs your development work. You talk to **Wright**, the lead agent. Wright remembers, plans, and keeps a task table. It starts and stops its own work sessions, sets up schedules, triggers and hooks, and hands jobs to a crew of specialist agents. Under the hood it uses [Loomwright](https://github.com/vikashruhilgit/loomwright), a Claude Code plugin for planning, parallel execution, review, and self-healing PRs.

Nothing is predefined. You describe a duty in plain English, for example "review any PR where I'm the requested reviewer" or "work these tickets through to reviewed PRs". Wright writes the playbook, shows you a dry run, and switches it on only after you approve.

## Status

Pre-code. The design is written down in [`docs/`](docs/). Work starts with **phase 0: design system and high-fidelity mockups**, approved before any app code is written. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Docs

| Doc | What it covers |
|---|---|
| [`docs/VISION.md`](docs/VISION.md) | What Studio is, who it's for, and how it differs from Grok Bot and others |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every decision made so far, with the reasoning and the alternatives rejected |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Kernel / brain / surfaces, data model, kernel tools, safety kernel |
| [`docs/UI.md`](docs/UI.md) | Design principles, screens, phase 0 deliverables |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phases and their exit criteria |
| [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) | Owner to-dos and things still to verify |
| [`docs/research/`](docs/research/) | Background research: Grok Bot, naming, licensing and billing, Electron vs Tauri |
| [`docs/reference/`](docs/reference/) | Prior art carried over from Loomwright |

## License

Loomwright Studio is **source-available** under the [PolyForm Shield License 1.0.0](LICENSE.md). You may use, modify, and share it for any purpose, including at work, except to provide a product that competes with it or with a product the licensor provides using it. Commercial rights stay with the author.

"Powered by Claude." Studio is not Claude Code and is not an Anthropic product.
