# Phase 2 evidence: which notifier works from a launchd agent

The notifications feature ([`docs/architecture/notifications.md`](../architecture/notifications.md)) posts a native macOS notification whose click should open Terminal on `studio notifications show <id>`. Plain `osascript display notification` has no click action, and the kernel runs as a launchd agent (`studio service install`, D31) with no terminal. So the requirement asked for the candidates to be probed from a launchd agent and one to be chosen. This page holds what the worker ran and saw on the owner's Mac on 2026-10-15, then a section for what only the owner can see.

## 1. Machine-observed: p11 under a launchd agent

**Re-run by the worker, 2026-10-15 15:57 UTC, macOS 26.6.2 (25G83), Node v24.11.1, terminal-notifier 2.0.0 (Homebrew).** This run is of the current probe, which passes osascript's text after a `--` end-of-options marker. It replaces the output of the first run of 2026-10-15, which was made before that change.

The command, from the repo root:

```bash
cd probes && node p11-notifier-under-launchd.mjs
```

What it does: it writes a plist into a fresh temp dir and loads it into the user's GUI domain (`launchctl bootstrap gui/<uid> <plist>`, `RunAtLoad`, no `KeepAlive`). The agent runs a copy of the probe in `--inner` mode, which tries each candidate with argv arrays only and writes the results to a JSON file. The outer process then **always** runs `launchctl bootout gui/<uid>/dev.loomwright-studio.p11-notifier-probe`, deletes the plist, and checks that the service is gone. It installs nothing, grants nothing, and posts two visible test notifications. The test title and body contain shell metacharacters, quotes, a newline, `$(touch /tmp/p11-never)` and `(a, b)`.

Output (verbatim):

```text
p11 notifier probe — macOS 26.6.2, node v24.11.1
launchd agent dev.loomwright-studio.p11-notifier-probe in gui/501, plist /var/folders/jh/sbkxjbkj7y959rkxq2m61rbw0000gn/T/p11-notifier-vSNH4a/dev.loomwright-studio.p11-notifier-probe.plist
launchctl bootstrap: exit 0
launchctl bootout: exit 0
after cleanup: launchctl print exit 113 (113 = no such service); plist removed: true
inside the agent: ppid 1 (1 = launchd), XPC_SERVICE_NAME "dev.loomwright-studio.p11-notifier-probe", PATH "/usr/bin:/bin:/usr/sbin:/sbin"

osascript at /usr/bin/osascript (click action: no)
  post: exit 0, 98 ms, stdout "", stderr ""

terminal-notifier at /opt/homebrew/bin/terminal-notifier (click action: yes)
  -version: exit 0, "terminal-notifier 2.0.0."
  post: exit 0, 186 ms, stdout "", stderr ""
  -list p11-1792079830106: exit 0
    GroupID	Title	Subtitle	Message	Delivered At
    p11-1792079830106	Studio p11: (a, b) "quoted" $(touch /tmp/p11-never)	(null)	p11 probe 1792079830106
    line 2: ; | & ` $HOME '"' -execute	2026-10-15 15:57:10 +0000

terminal-notifier at /usr/local/bin/terminal-notifier: not present

click marker (exists only after the terminal-notifier banner is clicked): /var/folders/jh/sbkxjbkj7y959rkxq2m61rbw0000gn/T/p11-click-1792079830106
full result: /var/folders/jh/sbkxjbkj7y959rkxq2m61rbw0000gn/T/p11-notifier-vSNH4a/result.json
```

Read off it:

- **Both candidates post from inside a launchd agent.** The probe ran with `ppid 1` and launchd's own `XPC_SERVICE_NAME` and minimal `PATH`. osascript exited 0 in 98 ms, and terminal-notifier exited 0 in 186 ms.
- **terminal-notifier's post reached Notification Center**, and its text arrived exactly as sent: `-list <group>` (terminal-notifier reading back what Notification Center holds for its group) shows the title and the two-line body verbatim, metacharacters included.
- **Nothing in the text ran.** `/tmp/p11-never` did not exist after the re-run (`ls`: "No such file or directory").
- **Nothing was left behind.** `bootout` exited 0, `launchctl print` then answered 113 (no such service), and the plist was removed. `~/Library/LaunchAgents` was never written.
- **First attempt, kept as a finding.** The first run started the agent on the probe file in the repo, under `~/Documents`, and the agent failed with `EPERM: operation not permitted, open '…/probes/p11-notifier-under-launchd.mjs'`. This is D31: a launchd agent can't read a macOS-protected folder. The probe now runs a copy of itself from its temp dir, the same way the kernel runs its install copy. That run's temp dir was deleted.

## 2. Machine-observed: argument parsing, from a terminal

**Run by the worker, 2026-10-15, from an interactive shell (not under launchd).** These runs pinned down how text must be passed to terminal-notifier. Every test notification was removed afterwards with `terminal-notifier -remove <group>` (`-list ALL` then showed none of them). Other notifications in the owner's Notification Center were not touched, and are not quoted here.

- **Cocoa parses argv values as property lists.** `terminal-notifier -title '(a, b)' -message '"quoted"' …` never exited; it was killed after a minute, with exit 143. The same values passed as a quoted plist string (`"(a, b)"`) posted at once. `(a, b)` is old-style plist syntax for an array, and `"quoted"` for a string without its quotes. So untrusted text must never be a bare `-key value` argument.
- **A quoted plist string round-trips exactly.** Each of these titles, sent as `"…"` with `\` and `"` escaped, came back from `-list` identical: `(a, b)`, `"quoted"`, `-execute`, `back\slash \n esc`, a title with a newline, `{k = v;}`, `<00ff>`, `emoji 🔔 ü`, `$(touch /tmp/never2)`, and the empty string. All exited 0.
- **A body on stdin is taken literally.** These bodies came back from `-list` as sent, apart from one trailing newline: `(a, b)`, `\[x`, `-execute x`, `"only"`, a body containing `$(touch /tmp/never) "q" -x` on a second line, and the empty string. None of `/tmp/never`, `/tmp/never2` or `/tmp/p11-never` existed afterwards.
- **The binary:** `strings` on `terminal-notifier.app/Contents/MacOS/terminal-notifier` shows `NSUserNotificationCenter` / `NSUserNotification`, which is Apple's deprecated API, and `executeShellCommand:` with `/bin/sh`, so `-execute` runs through a shell. This is why the click command holds only kernel-owned paths and the integer id.

### 2a. An empty body, spawned as the kernel spawns it

**Run by the worker by hand, 2026-10-15 15:56 UTC, from an interactive shell (not under launchd), macOS 26.6.2 (25G83), Node v24.11.1, terminal-notifier 2.0.0.** The empty body in section 2 was piped from a shell. This run spawns terminal-notifier the way the kernel's `spawnNotifier` does: an argv array, stdio pipes, the kernel's fixed `PATH` plus `HOME`/`USER`/`LOGNAME`/`TMPDIR`/`LANG`, the title as a quoted plist string, and the body on stdin, here `""`, the pipe ended at once. Unlike the kernel, it passes no `-execute`, so a click runs nothing. It uses its own group, and removes it afterwards with `-remove <group>`.

The script, `empty-body-probe.mjs`, run from a scratch dir outside the repo:

```js
// Empty-body probe: terminal-notifier spawned as the kernel spawns it (argv
// array, stdio pipes, fixed env), with an empty stdin body. Prints what it did.
import { spawn } from "node:child_process";

const TN = "/opt/homebrew/bin/terminal-notifier";
const group = process.argv[2];
const quote = (t) => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
for (const k of ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG"]) if (process.env[k] !== undefined) env[k] = process.env[k];

function run(args, input) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(TN, args, { stdio: ["pipe", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 10_000);
    child.stdout.setEncoding("utf8").on("data", (c) => (stdout += c));
    child.stderr.setEncoding("utf8").on("data", (c) => (stderr += c));
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, timedOut, ms: Date.now() - started, stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const postArgs = ["-title", quote("Studio empty-body probe"), "-group", quote(group)];
console.log(`argv: ${JSON.stringify([TN, ...postArgs])}, stdin: ${JSON.stringify("")} (a pipe, ended at once)`);
const post = await run(postArgs, "");
console.log(`post: ${JSON.stringify(post)}`);
const list = await run(["-list", group], "");
console.log(`-list ${group}: ${JSON.stringify(list)}`);
const removed = await run(["-remove", group], "");
console.log(`-remove ${group}: ${JSON.stringify(removed)}`);
const after = await run(["-list", group], "");
console.log(`-list ${group} after remove: ${JSON.stringify(after)}`);
```

The command:

```bash
node empty-body-probe.mjs loomwright-studio-probe-empty-body-1
```

Output (verbatim):

```text
argv: ["/opt/homebrew/bin/terminal-notifier","-title","\"Studio empty-body probe\"","-group","\"loomwright-studio-probe-empty-body-1\""], stdin: "" (a pipe, ended at once)
post: {"status":0,"signal":null,"timedOut":false,"ms":182,"stdout":"","stderr":""}
-list loomwright-studio-probe-empty-body-1: {"status":0,"signal":null,"timedOut":false,"ms":108,"stdout":"GroupID\tTitle\tSubtitle\tMessage\tDelivered At\nloomwright-studio-probe-empty-body-1\tStudio empty-body probe\t(null)\t\t2026-10-15 15:56:56 +0000\n","stderr":""}
-remove loomwright-studio-probe-empty-body-1: {"status":0,"signal":null,"timedOut":false,"ms":92,"stdout":"* Removing previously sent notification, which was sent on: 2026-10-15 15:56:56 +0000\n","stderr":""}
-list loomwright-studio-probe-empty-body-1 after remove: {"status":0,"signal":null,"timedOut":false,"ms":99,"stdout":"","stderr":""}
```

Read off it:

- **An empty stdin body is not an error.** The post exited 0 in 182 ms with no output. It did not print its help and did not exit 1.
- **Notification Center held it, with an empty message.** `-list` shows the group, the title, and an empty `Message` column (two tabs in a row).
- **Nothing was left behind.** `-remove` removed it, and `-list` afterwards printed nothing.

So the kernel needs no change for an empty body: it is posted as exactly `""` on stdin and the row ends `delivered`. `kernel/test/notifications.test.ts` pins that stdin (`an empty body is posted to terminal-notifier as exactly empty stdin`). Whether the banner showed is the owner's to see, as for every post here.

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
