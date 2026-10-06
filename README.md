# Loomwright Studio

> ⚠️ **Early development — not ready for use.**
> Studio is under active construction. Features are incomplete, things will break, data formats will change without migration, and there is no support. Watch the repo if you're interested, but please don't depend on it yet. No releases or builds have been published.

Loomwright Studio is a desktop app for an always-available AI partner that runs your development work. You talk to **Wright**, the lead agent. Wright remembers, plans, and keeps a task table. It starts and stops its own work sessions, sets up schedules, triggers and hooks, and hands jobs to a crew of specialist agents. Under the hood it uses [Loomwright](https://github.com/vikashruhilgit/loomwright), a Claude Code plugin for planning, parallel execution, review, and self-healing PRs.

Nothing is predefined. You describe a duty in plain English, for example "review any PR where I'm the requested reviewer" or "work these tickets through to reviewed PRs". Wright writes the playbook, shows you a dry run, and switches it on only after you approve.

## Status

**Phase 0** (design system and high-fidelity mockups) is done; see [`docs/DESIGN.md`](docs/DESIGN.md). **Phase 1**, the kernel in [`kernel/`](kernel/), is done (2026-10-06): its exit criterion (`kill -9` mid-session, then restart and resume with no duplicated work) passed live on the owner's machine, under launchd, on the subscription token; see [`docs/evidence/`](docs/evidence/) and [`docs/ROADMAP.md`](docs/ROADMAP.md). Next is phase 2, the brain and the Loomwright adapter.

## Run the kernel as a launchd agent

macOS only. The kernel can run in the background as a per-user launchd agent that starts at login and is restarted if it crashes. From `kernel/`:

```sh
npm ci && npm run build
node dist/cli/index.js service install     # copies the kernel, writes and loads the agent, checks it starts
node dist/cli/index.js status              # talks to the running kernel
node dist/cli/index.js service uninstall   # unloads it, removes the plist and the install copies
```

(`studio` is the package's `bin` name for `dist/cli/index.js`.)

- The agent's label is `com.loomwright.studio.kernel` and its plist is `~/Library/LaunchAgents/com.loomwright.studio.kernel.plist`. Install and uninstall touch no other file there.
- Check it with `launchctl print gui/$(id -u)/com.loomwright.studio.kernel`.
- Logs are in `<dataDir>/logs/` (`kernel.out.log`, `kernel.err.log`). The data dir is `~/.loomwright-studio`, or `STUDIO_DATA_DIR` if it was set when you ran `service install`.
- The kernel reads its credentials from the macOS Keychain through `/usr/bin/security`. If macOS shows a Keychain prompt for `security` when the agent starts, choose **Always Allow** once. Never put a token in a file or in the plist to get around the prompt.
- **The agent runs an install copy, never this checkout.** `service install` copies the built kernel (`dist/`, `package.json` and the production `node_modules`, taken from `package-lock.json`, including `better-sqlite3`'s compiled module and the SDK's platform package with the CLI binary) to `<dataDir>/app/<kernel version>/`, writing it to a temporary sibling dir and renaming it into place. The plist runs that copy's `dist/daemon.js` with the `node` you ran `service install` with. After a rebuild or a Node change, run `service install` again: the same version's copy is replaced, and older versions are removed once the new kernel has passed the start check. Run it from the checkout, not from an installed copy (that is refused). The first copy is slow: the SDK's platform package is about 200 MB.
- **Repos and the install location stay out of macOS-protected folders (D31).** A launchd agent can't read `~/Documents`, `~/Desktop`, `~/Downloads` or iCloud Drive (`~/Library/Mobile Documents`), and a bare `node` can't be granted access. So `service install` refuses an install target inside one (set `STUDIO_DATA_DIR` elsewhere), and the kernel refuses to start or resume a session whose `cwd` is inside one (`protected_cwd`). This checkout may live in `~/Documents`: the agent runs from its copy. The repos agents work on must not.
- **The start check.** After loading the agent, `service install` waits up to 15 s for the new kernel to answer `GET /status` on its loopback API (with the token from the Keychain; an `api.json` left by the previous kernel never counts, its pid must be the one `launchctl print` reports for the job). Only then does it print "installed and loaded", with the kernel version and the install path. If the kernel doesn't answer, it prints `launchctl print`'s `last exit code` and the last 20 lines of `kernel.err.log`, boots the agent out and removes the plist (so launchd can't restart the broken kernel in a loop, or at the next login), keeps the install copy and the data dir, and exits non-zero.
- **Keychain prompt during the start check.** On the first start the kernel reads its credentials and creates and reads back the API token through `/usr/bin/security`; if macOS shows a Keychain prompt for `security`, answer it (**Always Allow**) within the 15 s. If the check failed and the log tail shows a Keychain failure, the output says so: choose Always Allow at the prompt, then run `service install` again.
- If the plist's `node` is under a version manager (`~/.nvm`, `~/.volta`, `~/.asdf`, `~/.fnm`, `~/.nodenv`, `~/.local/share/fnm`), `service install` warns that the agent stops working if that Node version is removed, and installs anyway.
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
