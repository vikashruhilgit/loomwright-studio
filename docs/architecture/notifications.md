# Notifications

The notifications feature (phase 2, D11, D17) records a notification for the owner, posts it once as a native macOS notification whose click opens Loomwright Studio on what it names (its deep link), and lists every notification in the `studio` CLI. Code: `kernel/src/notifications/`. Evidence for the notifier choice: [`docs/evidence/phase-2-notifier-probe.md`](../evidence/phase-2-notifier-probe.md).

It is a mechanism (invariant 1). It never decides what is worth notifying, how often, or what counts as urgent: that is the caller's policy (a trigger's, an agent's). Notification text is untrusted data (invariant 3): it is stored as given, posted as plain text, and never reaches a shell or a parser.

## The record

`recordNotification(store, {source, title, body, sessionId?}, now)` is the one way to create a notification, and other features call it. It writes exactly one `notifications` row (migration 11) with status `pending`, and, in the same transaction, one `notification_created` event (`{id, source}`, linked to `sessionId` when given). Delivery happens after the commit, on a later loop tick.

| Field | Rule |
|---|---|
| `source` | `trigger:<id>` (a positive integer), `agent:<name>` or `kernel:<reason>` (one line of text, no control characters), at most 200 characters. Anything else throws `InvalidNotificationError` before anything is written. |
| `title` | 1-200 characters, no NUL. |
| `body` | At most 4000 characters (may be empty), no NUL. |
| `deep_link` | Always `loomwright-studio://notifications/<id>`, built from the inserted row's own id in the same transaction. |
| `delivery_status` | `pending`, then exactly once one of `delivered`, `failed` or `unsupported` (a closed set, checked in code), with `delivery_detail`. `delivered_at` is set when a native notification was handed to macOS. |

A title or body that breaks a rule throws `InvalidNotificationError` before anything is written. A NUL is refused because it cannot be relied on to be posted: an argv item cannot hold a NUL, the title is always an argv item, so a NUL in the title can never be posted, and a NUL in the body cannot be posted by osascript (its body is an argv item). terminal-notifier takes the body on stdin, and how it handles a NUL there is unprobed. Recorded anyway, an argv NUL would make the spawn fail and the row end `failed`. An empty body is fine: run by hand on the owner's Mac, terminal-notifier exited 0 on an empty stdin body and Notification Center held the notification ([evidence](../evidence/phase-2-notifier-probe.md#2a-an-empty-body-spawned-as-the-kernel-spawns-it)).

The refusal covers `recordNotification` and `kernel_notify`. Its callers refuse a NUL first, with their own error: an approval refuses a NUL in its action (or in the agent's name) as `invalid_approval` before writing anything, and `kernel_approval_request` refuses one in `action` at argument validation ([approvals](approvals.md)). A trigger refuses a NUL in its text or its agent's name at registration, as `invalid_input`, and its `notify` fire records through `recordNotification`; a stored trigger the record refuses anyway is parked ([triggers](triggers.md)). The Loomwright version note shows each version through its one-line collapse, which turns control characters (C0 and DEL, NUL among them) into a space, so a NUL in a contract's `plugin_version` never reaches the record ([Loomwright](loomwright.md)).

## The deep-link scheme

Every notification carries `loomwright-studio://notifications/<id>`, recorded on the row and shown by `studio notifications`. The kernel does not register the scheme with macOS: Loomwright Studio.app does (phase 5), and opens these links. A terminal-notifier notification's click opens that same link (`-open`), so macOS brings the app forward on the notification. No shell and no Terminal is involved. Without the app installed, macOS has nothing to open the link with; `studio notifications show <id>` still prints the notification.

## Delivery

The feature contributes one due-work function. Each loop tick it takes the `pending` notifications, oldest first, at most 20 (the rest wait for the next tick), and posts each one once:

| Situation | Row |
|---|---|
| Not macOS | `unsupported`, `not macOS (<platform>): not posted`. Nothing is spawned. |
| terminal-notifier found | Posted with a click action that opens the deep link. `delivered`, `posted by <path>; a click opens loomwright-studio://notifications/<id> (needs Loomwright Studio.app)`. |
| No terminal-notifier, `/usr/bin/osascript` present | Posted without a click action. `unsupported`, `no click-capable notifier (no terminal-notifier at …): posted without a click action by /usr/bin/osascript`. |
| Neither | `unsupported`, `… and no /usr/bin/osascript: not posted`. |
| The notifier cannot be spawned, exits non-zero, is killed, or runs over 10 s (then it is killed) | `failed` with the clipped error, plus exactly one `notification_delivery_failed` event (`{id, error}`). |

A row is settled once: the write is conditional on `pending`, so a failed row gets one event and no later tick selects it again. There is no retry loop (D17). To try again, record a new notification.

### At most once, and what a crash does

Each delivery is a work step keyed `notification:<id>:deliver` that is **not re-runnable**: the step commits `started` before the notifier runs and `done` (with the outcome) after it, and the row is written from the stored outcome.

- **A crash between the post and `done`** leaves the step `started`. The next tick's claim marks it `failed:interrupted` (one `notify` event, `work_step_interrupted`, as for every interrupted step) and never runs the notifier again. The row ends `failed` with detail `interrupted` and one `notification_delivery_failed` event. The notification may or may not have appeared, but it never appears twice. This is stricter than the requirement, which accepted one duplicate after a crash.
- **A crash between `done` and the row write** leaves the row `pending`. The next tick's step returns the stored outcome without posting, and the row is written from it.

The kill switch stops the loop, and with it delivery. Notifications recorded meanwhile wait as `pending`.

## The notifier

The p11 probe ran each candidate from inside a launchd agent in the owner's GUI session (the way the kernel runs after `studio service install`), on macOS 26.6.2 ([evidence](../evidence/phase-2-notifier-probe.md)). Both exited 0, and terminal-notifier's own `-list` showed the notification held by Notification Center with its text intact:

- **terminal-notifier** (Homebrew, third-party, 2.0.0 on this Mac) is the only candidate with a click action (`-open <URL>`). The kernel uses it when it is at `/opt/homebrew/bin/terminal-notifier` or `/usr/local/bin/terminal-notifier`, and looks nowhere else (never `PATH`). Studio never installs it, and it is not an npm dependency.
- **`/usr/bin/osascript` `display notification`** ships with macOS but has no click action. It is the fallback when terminal-notifier is absent, so the notification still appears and the row says why there is no click.

How the text is passed (every process gets an argv array, never a shell string or `shell: true`):

- **osascript:** the title and body are the `on run argv` items, after a `--` end-of-options marker, never part of the script source. Without the `--`, a title of `-e` is read as an option and the body becomes AppleScript source that runs at compile time.
- **terminal-notifier:** the body goes on stdin. The title is passed as a quoted plist string, because Cocoa parses a `-key value` argument as a property list: when this was explored on the owner's Mac (see the evidence), an unquoted `(a, b)` title made terminal-notifier hang, while quoted titles came back exactly as sent.
- **The click:** `-open` with the notification's deep link, `loomwright-studio://notifications/<id>`, which terminal-notifier hands to macOS on click; macOS opens it in the app that registered the scheme (Loomwright Studio.app). The kernel builds the link from the validated integer id (`deepLinkFor`, the same function that writes the row's `deep_link`), never from the title, the body or the stored column, and quotes it as a plist string like `-title` and `-group`. No shell command, no Terminal and no `osascript` run on click.

The notifier runs with a fixed `PATH` and the user's `HOME`/`USER`/`LOGNAME`/`TMPDIR`/`LANG`, none of the daemon's own environment, so no credential reaches it.

### Limits

- **Whether the banner shows and the click works is not machine-checked.** The probe saw both notifiers exit 0 and Notification Center hold the terminal-notifier post. Whether a banner appeared, whether a click opens the app on the notification, and which permission prompts macOS showed are the owner's observation (the phase 5 runbook's `notification_click_opened_thread`). The tests pin only the argv. That terminal-notifier 2.0's `-open` hands a custom scheme to LaunchServices as it does an `https` URL is unverified until that run. If the click does not work (or Loomwright Studio.app is not installed, which the kernel does not check), the row still says `delivered` (the post succeeded), and the deep link and `studio notifications show <id>` still work. There is no fallback click.
- **macOS may ask for permissions once** (not yet observed, see the evidence): to allow notifications from the notifier. The click runs no script, so there is no Automation prompt. Studio grants nothing and never grants anything to `node` (D31).
- **terminal-notifier is a supply-chain dependency the owner chose to install.** It is used only from the two fixed Homebrew paths, it gets no notification text in argv except the quoted title, and without it delivery falls back to osascript with no click.
- **terminal-notifier 2.0.0 uses Apple's deprecated `NSUserNotification` API.** A future macOS may stop showing it. Rows would then still be `delivered` (it exits 0), so a probe rerun after a macOS upgrade is the check.
- **Display:** macOS shows a few lines of the body and may cut it. The full text is in `studio notifications show <id>`.

## `kernel_notify`

`kernel_notify(title, body, idempotency_key)` is the agents' tool (through the feature seam). It runs as one work step keyed `kernel_notify:session-<id>:<key>`, so a repeat with the same key in the same session (even after a resume or a restart) returns the first notification instead of recording another. The source is `agent:<the session's agent>`, or `agent:unknown` when the session has none, and the `notification_created` event is linked to the session. It returns `{id, deep_link, delivery_status}`. A NUL in the title or body is refused at argument validation, before the step runs: the result is an error (`isError`) naming the field, and nothing is recorded.

## API and CLI

Both routes need the bearer token, like every route:

- `GET /notifications[?limit=N]`: `{notifications: [...]}`, newest first. `N` is 1-500 and defaults to 50; anything else is `400 {"error":"invalid_limit"}`.
- `GET /notifications/:id`: `{notification, trigger?, session?}`. `trigger` (`{id, action, next_fire_at}`, or `null` when that trigger no longer exists) is present only for a `trigger:<id>` source. `session` (`{id, status}`, or `null`) is present only for an `agent:` source, and is read from the `notification_created` event. An unknown id is `404 {"error":"no_such_notification"}`, and an id that is not a positive integer is `400 {"error":"invalid_id"}`.

The `studio` subcommand:

- `studio notifications [--limit N] [--json]` prints one line per notification, newest first: id, time, source, delivery status, title and deep link. `--json` prints the API's answer.
- `studio notifications show <id>` prints the full record (with the deep link and the delivery detail), plus the trigger's id, action and next fire, or the session's id and status. A session that is unknown (the event has none) prints `session:   unknown`, and one whose row no longer exists prints `session:   #<id>, status unknown (no such row)`. An unknown id prints `studio: no such notification <id>` and exits 1.
- Bad usage prints the subcommand's usage and exits 2.

The text views (the list and `show`) print notification text as plain text. In a title, body, source or detail, every control character (C0, DEL and C1) is written as `\xNN`, and a line feed as `\n`, except in `show`'s body, where a line break stays a real line break. The bidi controls (U+202A-U+202E, U+2066-U+2069, U+061C, U+200E, U+200F) and the line and paragraph separators U+2028 and U+2029 are written as `\uNNNN`, lower-case hex, for example `\u202e`. So notification text can never move the cursor, recolour the terminal, reorder what it shows or fake a line of output.

`--json` does none of that escaping. It prints the API's JSON as `JSON.stringify` writes it: C0 control characters become JSON escapes (`\n`, `\u001b`), but DEL, the C1 characters, the bidi controls and U+2028/U+2029 are left raw. It is meant for a program to parse. To show the text in a terminal, use the text views.

## Testing

A test run refuses every direct spawn of the notifier binaries that the shipped code and the tests use. `kernel/vitest.config.ts` runs one setup file, `kernel/test/setup-no-real-notifier.ts`, before every test file. Unless `STUDIO_LIVE=1`, it installs the guard in `kernel/test/notifier-guard.ts`, which wraps `spawn`, `spawnSync`, `execFile` and `execFileSync` (by their file argument, or by the command's first word when the options say `shell: true`) and `exec` and `execSync` (by the command's first word) on `node:child_process`, and syncs the patch into the builtin's ESM namespace so that `notifier.ts`'s own `spawn` import is wrapped too. It refuses an executable whose basename is `terminal-notifier` or `osascript`, or whose path is one of the notifier's fixed paths (`TERMINAL_NOTIFIER_PATHS`, `OSASCRIPT_PATH`). Everything else runs untouched, and arguments are never inspected: a `/bin/sh -c` whose script mentions osascript still runs.

Not covered: a shell command whose first word is not the binary (for example `FOO=1 osascript …`, `cd x && osascript …`, or a `/bin/sh -c` script), `child_process.fork` with an `execPath`, and a differently-cased path on a case-insensitive volume. The guard catches a mistake, not a test written to get around it, so a new test that spawns anything notifier-like should inject a stub instead.

A refused call throws `real notifier refused in a test run: <file> (…)` before any process exists, and is recorded. `postNotification` catches that error and settles the row `failed` with the guard's text in its detail, so the setup file's `afterEach` also fails the offending test with `a real notifier was refused in this test: <file>`. Delivery runs on the loop tick, so a refusal can land after the test ends. The setup file's `afterAll` then fails the test file. `kernel/test/notifications-test-guard.test.ts` pins all of this.

**Inject a stub notifier** in a test that boots a kernel. Pass `contributions: stubNotifierContributions()` (from `kernel/test/notifier-stub.ts`, or `stubNotifierContributions(yourList)` for a composed list) to `startKernel`. It replaces only the notifications feature's due work with `createDeliveryDueWork({ platform: "linux", exec })`, so rows settle `unsupported` (`not macOS`) and nothing is spawned. Every other contribution passes through unchanged. To assert on what would be posted, build your own due work with `createDeliveryDueWork({ platform: "darwin", isExecutable, exec })` and a recording `exec`, as the exit tests do.

**`STUDIO_LIVE=1` (live harnesses)** turns the guard off: nothing is wrapped, and a live harness's notifications post as before. The guard's own pins that would reach a real notifier skip. The real-osascript quoting probe in `kernel/test/notifications.test.ts` runs only then (and only on macOS).

**Outside the guard:** kernels run as child processes (`kernel/test/fixtures/*.mjs`) do not load the setup file. Today neither can post. `triggers-crash.mjs` records notifications but runs only the triggers' due work, and `crash-harness.mjs` runs the shipped delivery but records no notification. A fixture that does both would post for real.
