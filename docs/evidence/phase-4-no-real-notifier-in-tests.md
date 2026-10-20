# Phase 4 evidence: no test run posts a real notification

On 2026-10-20 the owner got a real "Approval 1: kernel_agent_create …" notification from `npm test`, not from the service. The fix is a run-wide test guard (see [notifications, Testing](../architecture/notifications.md#testing)). This page records the manual check from acceptance criterion 1: during a full suite run on the owner's Mac, macOS logs no `terminal-notifier` or `osascript` process.

## The run

- **Date:** 2026-10-20, 10:34:37Z to 10:34:54Z (16:04 IST).
- **Machine:** the owner's Mac, macOS (Darwin 25.6.0), Node v24.11.1, vitest 5.0.3. terminal-notifier 2.0.0 is installed at `/opt/homebrew/bin/terminal-notifier`, so an unguarded kernel boot here would post through it.
- **Commit:** base `44151bc`, plus the change's uncommitted working-tree edits (`kernel/vitest.config.ts`, the guard, the stub helper, the seven stubbed test files, the pin file and the live-only osascript probe). This run is not of a commit.
- **How the guard was loaded:** a plain `npm test` (`vitest run`), which picks up `kernel/vitest.config.ts` (`defineConfig({ test: { setupFiles: ["./test/setup-no-real-notifier.ts"] } })`). An earlier run the same day loaded the same setup file through a scratch config outside the repo, and it showed the same counts and an empty capture.

The commands, run from `kernel/` by a bash script (in zsh, `log` is a shell builtin, so call `/usr/bin/log` or run it from bash). The log stream starts first, in the background:

```bash
log stream --predicate 'process == "terminal-notifier" OR process == "osascript"' > logstream.txt 2>&1 &
LS_PID=$!
sleep 2
npm test
sleep 3
kill "$LS_PID"
```

In the same tree, `npx vitest run test/notifications-test-guard.test.ts --reporter=verbose` showed all six guard pins passing, (b) included. (b) is the case that boots a kernel on the shipped contributions and has the guard refuse its delivery.

## What it showed

The suite:

```text
 Test Files  62 passed | 2 skipped (64)
      Tests  1683 passed | 10 skipped (1693)
```

The whole `log stream` capture (verbatim). Nothing appears after its header line:

```text
Filtering the log data using "process == "terminal-notifier" OR process == "osascript""
```

## Positive control: the predicate does see a notifier

An empty capture means something only if the predicate would show a notifier process. Right after the run, at 10:35:55Z, a fresh `log stream` with the same predicate was started, and `/usr/bin/osascript -e 'return 1'` (posts nothing) was run by hand outside vitest. The stream captured 31 lines: its two header lines, then 29 entries for that one process. For example:

```text
2026-10-20 16:05:55.920739+0530 0x4bd17b57 Default     0x0                  61045  0    osascript: (libxpc.dylib) [com.apple.xpc:connection] [0x1036cd7f0] activating connection: mach=true listener=fal…
2026-10-20 16:05:55.922763+0530 0x4bd17b57 Activity    0x29592460           61045  0    osascript: (libsystem_info.dylib) Retrieve User by ID
```

## Limits

- Under `STUDIO_LIVE=1` the guard is off by design, and on macOS the osascript quoting probe in `kernel/test/notifications.test.ts` runs (it spawns a real `/usr/bin/osascript` that posts nothing). This check covers the default run only.
- Kernels run as child processes (`kernel/test/fixtures/*.mjs`) are outside the guard. During this run they spawned no notifier either, since the capture is empty.
