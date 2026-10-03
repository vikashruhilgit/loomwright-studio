# Loomwright Studio

> ⚠️ **Early development — not ready for use.**
> Studio is under active construction. Features are incomplete, things will break, data formats will change without migration, and there is no support. Watch the repo if you're interested, but please don't depend on it yet. No releases or builds have been published.

Loomwright Studio is a desktop app for an always-available AI partner that runs your development work. You talk to **Wright**, the lead agent. Wright remembers, plans, and keeps a task table. It starts and stops its own work sessions, sets up schedules, triggers and hooks, and hands jobs to a crew of specialist agents. Under the hood it uses [Loomwright](https://github.com/vikashruhilgit/loomwright), a Claude Code plugin for planning, parallel execution, review, and self-healing PRs.

Nothing is predefined. You describe a duty in plain English, for example "review any PR where I'm the requested reviewer" or "work these tickets through to reviewed PRs". Wright writes the playbook, shows you a dry run, and switches it on only after you approve.

## Status

**Phase 0** (design system and high-fidelity mockups) is done; see [`docs/DESIGN.md`](docs/DESIGN.md). **Phase 1**, the kernel, is under construction in [`kernel/`](kernel/). Its exit criterion (`kill -9` mid-session, then restart and resume with no duplicated work) is covered by a deterministic test, but the live run on the owner's machine is still open: see "Phase 1 exit: live run" in [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Run the kernel as a launchd agent

macOS only. The kernel can run in the background as a per-user launchd agent that starts at login and is restarted if it crashes. From `kernel/`:

```sh
npm ci && npm run build
node dist/cli/index.js service install     # writes and loads the agent
node dist/cli/index.js status              # talks to the running kernel
node dist/cli/index.js service uninstall   # unloads it and removes the plist
```

(`studio` is the package's `bin` name for `dist/cli/index.js`.)

- The agent's label is `com.loomwright.studio.kernel` and its plist is `~/Library/LaunchAgents/com.loomwright.studio.kernel.plist`. Install and uninstall touch no other file there.
- Check it with `launchctl print gui/$(id -u)/com.loomwright.studio.kernel`.
- Logs are in `<dataDir>/logs/` (`kernel.out.log`, `kernel.err.log`). The data dir is `~/.loomwright-studio`, or `STUDIO_DATA_DIR` if it was set when you ran `service install`.
- The kernel reads its credentials from the macOS Keychain through `/usr/bin/security`. If macOS shows a Keychain prompt for `security` when the agent starts, choose **Always Allow** once. Never put a token in a file or in the plist to get around the prompt.
- The plist points at this checkout's `dist/daemon.js` and the `node` you ran `service install` with. After moving the checkout or changing Node, run `service install` again.
- **If the kernel fails to start:** a failure a retry can't fix (another kernel holds the data dir's lock, a bad argument, an auth provider not in this build) is not restarted; `launchctl print` then shows the agent not running with last exit code 0, and `kernel.err.log` says why. Any other start failure (a Keychain read, for example) is retried at most once a minute, with one line in `kernel.err.log` each time. To stop a retrying kernel, run `service uninstall`.
- `service install` over a loaded agent waits up to 5 s for the old one to unload; if it is still loaded it stops with one line saying to run `service install` again. A plist installed before this behaviour keeps the old restart loop (every 10 s) until you run `service install` again.

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
