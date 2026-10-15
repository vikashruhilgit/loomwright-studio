# Phase 2 evidence: which notifier works from a launchd agent

The notifications feature ([`docs/architecture/notifications.md`](../architecture/notifications.md)) posts a native macOS notification whose click should open Terminal on `studio notifications show <id>`. Plain `osascript display notification` has no click action, and the kernel runs as a launchd agent (`studio service install`, D31) with no terminal. So the requirement asked for the candidates to be probed from a launchd agent and one to be chosen. This page holds what the worker ran and saw on the owner's Mac on 2026-10-15, then a section for what only the owner can see.

## 1. Machine-observed: p11 under a launchd agent

**Run by the worker, 2026-10-15, macOS 26.6.2 (25G83), Node v22.14.0, terminal-notifier 2.0.0 (Homebrew).**

The command, from the repo root:

```bash
cd probes && node p11-notifier-under-launchd.mjs
```

What it does: it writes a plist into a fresh temp dir and loads it into the user's GUI domain (`launchctl bootstrap gui/<uid> <plist>`, `RunAtLoad`, no `KeepAlive`). The agent runs a copy of the probe in `--inner` mode, which tries each candidate with argv arrays only and writes the results to a JSON file. The outer process then **always** runs `launchctl bootout gui/<uid>/dev.loomwright-studio.p11-notifier-probe`, deletes the plist, and checks that the service is gone. It installs nothing, grants nothing, and posts two visible test notifications. The test title and body contain shell metacharacters, quotes, a newline, `$(touch /tmp/p11-never)` and `(a, b)`.

Output (verbatim):

```text
p11 notifier probe — macOS 26.6.2, node v22.14.0
launchd agent dev.loomwright-studio.p11-notifier-probe in gui/501, plist /var/folders/jh/sbkxjbkj7y959rkxq2m61rbw0000gn/T/p11-notifier-nNhmti/dev.loomwright-studio.p11-notifier-probe.plist
launchctl bootstrap: exit 0
launchctl bootout: exit 0
after cleanup: launchctl print exit 113 (113 = no such service); plist removed: true
inside the agent: ppid 1 (1 = launchd), XPC_SERVICE_NAME "dev.loomwright-studio.p11-notifier-probe", PATH "/usr/bin:/bin:/usr/sbin:/sbin"

osascript at /usr/bin/osascript (click action: no)
  post: exit 0, 95 ms, stdout "", stderr ""

terminal-notifier at /opt/homebrew/bin/terminal-notifier (click action: yes)
  -version: exit 0, "terminal-notifier 2.0.0."
  post: exit 0, 175 ms, stdout "", stderr ""
  -list p11-1792025703057: exit 0
    GroupID	Title	Subtitle	Message	Delivered At
    p11-1792025703057	Studio p11: (a, b) "quoted" $(touch /tmp/p11-never)	(null)	p11 probe 1792025703057
    line 2: ; | & ` $HOME '"' -execute	2026-10-15 00:55:03 +0000

terminal-notifier at /usr/local/bin/terminal-notifier: not present

click marker (exists only after the terminal-notifier banner is clicked): /var/folders/jh/sbkxjbkj7y959rkxq2m61rbw0000gn/T/p11-click-1792025703057
full result: /var/folders/jh/sbkxjbkj7y959rkxq2m61rbw0000gn/T/p11-notifier-nNhmti/result.json
```

Read off it:

- **Both candidates post from inside a launchd agent.** The probe ran with `ppid 1` and launchd's own `XPC_SERVICE_NAME` and minimal `PATH`. osascript exited 0 in 95 ms, and terminal-notifier exited 0 in 175 ms.
- **terminal-notifier's post reached Notification Center**, and its text arrived exactly as sent: `-list <group>` (terminal-notifier reading back what Notification Center holds for its group) shows the title and the two-line body verbatim, metacharacters included.
- **Nothing in the text ran.** `/tmp/p11-never` did not exist afterwards (`ls`: "No such file or directory").
- **Nothing was left behind.** `bootout` exited 0, `launchctl print` then answered 113 (no such service), and the plist was removed. `~/Library/LaunchAgents` was never written.
- **First attempt, kept as a finding.** The first run started the agent on the probe file in the repo, under `~/Documents`, and the agent failed with `EPERM: operation not permitted, open '…/probes/p11-notifier-under-launchd.mjs'`. This is D31: a launchd agent can't read a macOS-protected folder. The probe now runs a copy of itself from its temp dir, the same way the kernel runs its install copy. That run's temp dir was deleted.

## 2. Machine-observed: argument parsing, from a terminal

**Run by the worker, 2026-10-15, from an interactive shell (not under launchd).** These runs pinned down how text must be passed to terminal-notifier. Every test notification was removed afterwards with `terminal-notifier -remove <group>` (`-list ALL` then showed none of them). Other notifications in the owner's Notification Center were not touched, and are not quoted here.

- **Cocoa parses argv values as property lists.** `terminal-notifier -title '(a, b)' -message '"quoted"' …` never exited; it was killed after a minute, with exit 143. The same values passed as a quoted plist string (`"(a, b)"`) posted at once. `(a, b)` is old-style plist syntax for an array, and `"quoted"` for a string without its quotes. So untrusted text must never be a bare `-key value` argument.
- **A quoted plist string round-trips exactly.** Each of these titles, sent as `"…"` with `\` and `"` escaped, came back from `-list` identical: `(a, b)`, `"quoted"`, `-execute`, `back\slash \n esc`, a title with a newline, `{k = v;}`, `<00ff>`, `emoji 🔔 ü`, `$(touch /tmp/never2)`, and the empty string. All exited 0.
- **A body on stdin is taken literally.** These bodies came back from `-list` as sent, apart from one trailing newline: `(a, b)`, `\[x`, `-execute x`, `"only"`, a body containing `$(touch /tmp/never) "q" -x` on a second line, and the empty string. None of `/tmp/never`, `/tmp/never2` or `/tmp/p11-never` existed afterwards.
- **The binary:** `strings` on `terminal-notifier.app/Contents/MacOS/terminal-notifier` shows `NSUserNotificationCenter` / `NSUserNotification`, which is Apple's deprecated API, and `executeShellCommand:` with `/bin/sh`, so `-execute` runs through a shell. This is why the click command holds only kernel-owned paths and the integer id.

## 3. The choice

**terminal-notifier, from a fixed absolute path, when present; else osascript without a click (`unsupported`).** osascript ships with macOS but cannot carry a click action at all. terminal-notifier is the only candidate that posted from the launchd agent with one (`-execute`), and the owner's Mac already has it. The kernel never installs it, never looks it up on `PATH` (only `/opt/homebrew/bin/terminal-notifier` and `/usr/local/bin/terminal-notifier`), passes the body on stdin and the title as a quoted plist string, and falls back to osascript when it is absent. The details and limits are in [the doc page](../architecture/notifications.md#the-notifier).

## 4. Owner observation

**Owner run: pending.** The worker cannot see the screen, click a notification, or answer a permission prompt, so none of this is claimed above.

### 4a. The probe's two notifications (from the 2026-10-15 run above, or a rerun)

Rerun the command in section 1 if the first run's notifications are gone. It posts two notifications and prints a click-marker path.

- osascript's notification appeared (yes / no), and which app it was attributed to:

```text
(pending)
```

- terminal-notifier's notification appeared (yes / no):

```text
(pending)
```

- After clicking terminal-notifier's notification, did Terminal open and print `p11: the click opened Terminal`? Does the marker exist (`ls <click marker path from the output>`)?

```text
(pending)
```

- Every permission prompt macOS showed (notifications for terminal-notifier or osascript? Automation, such as "terminal-notifier wants to control Terminal"?), and what was chosen:

```text
(pending)
```

### 4b. The installed kernel

Run `studio service install`, record one notification through an agent's `kernel_notify` (or a trigger, once the triggers feature lands), and wait one loop tick (about a second).

- `studio notifications` lists it with status `delivered` and its deep link (paste):

```text
(pending)
```

- The notification appeared (yes / no), and clicking it opened Terminal on `studio notifications show <id>`, showing the record (yes / no; paste what Terminal printed):

```text
(pending)
```

- Any permission prompt (paste the wording):

```text
(pending)
```

If the click does not open Terminal, the row still says `delivered` (the post succeeded), and `studio notifications show <id>` and the deep link still work. What to change next is the owner's decision.
