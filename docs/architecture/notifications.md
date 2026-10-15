# Notifications

The notifications feature (phase 2, D11, D17) records a notification for the owner, posts it once as a native macOS notification whose click opens Terminal on its details, and lists every notification in the `studio` CLI. Code: `kernel/src/notifications/`. Evidence for the notifier choice: [`docs/evidence/phase-2-notifier-probe.md`](../evidence/phase-2-notifier-probe.md).

It is a mechanism (invariant 1). It never decides what is worth notifying, how often, or what counts as urgent: that is the caller's policy (a trigger's, an agent's). Notification text is untrusted data (invariant 3): it is stored as given, posted as plain text, and never reaches a shell or a parser.

## The record

`recordNotification(store, {source, title, body, sessionId?}, now)` is the one way to create a notification, and other features call it. It writes exactly one `notifications` row (migration 11) with status `pending`, and, in the same transaction, one `notification_created` event (`{id, source}`, linked to `sessionId` when given). Delivery happens after the commit, on a later loop tick.

| Field | Rule |
|---|---|
| `source` | `trigger:<id>` (a positive integer), `agent:<name>` or `kernel:<reason>` (one line of text, no control characters), at most 200 characters. Anything else throws `InvalidNotificationError` before anything is written. |
| `title` | 1-200 characters. |
| `body` | At most 4000 characters (may be empty). |
| `deep_link` | Always `loomwright-studio://notifications/<id>`, built from the inserted row's own id in the same transaction. |
| `delivery_status` | `pending`, then exactly once one of `delivered`, `failed` or `unsupported` (a closed set, checked in code), with `delivery_detail`. `delivered_at` is set when a native notification was handed to macOS. |

## The deep-link scheme

Every notification carries `loomwright-studio://notifications/<id>`, recorded on the row and shown by `studio notifications`. Phase 2 does not register the scheme with macOS (the phase 5 app will, and will open the same links); in phase 2 the notification's click runs `studio notifications show <id>` in Terminal instead.

## Delivery

The feature contributes one due-work function. Each loop tick it takes the `pending` notifications, oldest first, at most 20 (the rest wait for the next tick), and posts each one once:

| Situation | Row |
|---|---|
| Not macOS | `unsupported`, `not macOS (<platform>): not posted`. Nothing is spawned. |
| terminal-notifier found | Posted with a click action. `delivered`, `posted by <path>; a click runs studio notifications show <id> in Terminal`. |
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

- **terminal-notifier** (Homebrew, third-party, 2.0.0 on this Mac) is the only candidate with a click action (`-execute`). The kernel uses it when it is at `/opt/homebrew/bin/terminal-notifier` or `/usr/local/bin/terminal-notifier`, and looks nowhere else (never `PATH`). Studio never installs it, and it is not an npm dependency.
- **`/usr/bin/osascript` `display notification`** ships with macOS but has no click action. It is the fallback when terminal-notifier is absent, so the notification still appears and the row says why there is no click.

How the text is passed (every process gets an argv array, never a shell string or `shell: true`):

- **osascript:** the title and body are the `on run argv` items, never part of the script source.
- **terminal-notifier:** the body goes on stdin. The title is passed as a quoted plist string, because Cocoa parses a `-key value` argument as a property list: when this was explored on the owner's Mac (see the evidence), an unquoted `(a, b)` title made terminal-notifier hang, while quoted titles came back exactly as sent.
- **The click:** `-execute` is a shell command that terminal-notifier runs on click. It has Terminal run, through `osascript … do script` with the command as an `argv` item, `STUDIO_DATA_DIR=<data dir> <node> <the kernel's cli/index.js> notifications show <id>`. It contains only the kernel's own paths (each quoted as one shell word) and the validated integer id, never notification text.

The notifier runs with a fixed `PATH` and the user's `HOME`/`USER`/`LOGNAME`/`TMPDIR`/`LANG`, none of the daemon's own environment, so no credential reaches it.

### Limits

- **Whether the banner shows and the click works is not machine-checked.** The probe saw both notifiers exit 0 and Notification Center hold the terminal-notifier post. Whether a banner appeared, whether the click opened Terminal, and which permission prompts macOS showed are the owner's observation in the evidence file. If the click does not work, the row still says `delivered` (the post succeeded), and the deep link and `studio notifications show <id>` still work.
- **macOS may ask for permissions once** (not yet observed, see the evidence): to allow notifications from the notifier, and, on the first click, Automation for terminal-notifier's `osascript` to control Terminal (`do script`). Studio grants neither and never grants anything to `node` (D31).
- **terminal-notifier is a supply-chain dependency the owner chose to install.** It is used only from the two fixed Homebrew paths, it gets no notification text in argv except the quoted title, and without it delivery falls back to osascript with no click.
- **terminal-notifier 2.0.0 uses Apple's deprecated `NSUserNotification` API.** A future macOS may stop showing it. Rows would then still be `delivered` (it exits 0), so a probe rerun after a macOS upgrade is the check.
- **Display:** macOS shows a few lines of the body and may cut it. The full text is in `studio notifications show <id>`.

## `kernel_notify`

`kernel_notify(title, body, idempotency_key)` is the agents' tool (through the feature seam). It runs as one work step keyed `kernel_notify:session-<id>:<key>`, so a repeat with the same key in the same session (even after a resume or a restart) returns the first notification instead of recording another. The source is `agent:<the session's agent>`, or `agent:unknown` when the session has none, and the `notification_created` event is linked to the session. It returns `{id, deep_link, delivery_status}`.

## API and CLI

Both routes need the bearer token, like every route:

- `GET /notifications[?limit=N]`: `{notifications: [...]}`, newest first. `N` is 1-500 and defaults to 50; anything else is `400 {"error":"invalid_limit"}`.
- `GET /notifications/:id`: `{notification, trigger?, session?}`. `trigger` (`{id, action, next_fire_at}`, or `null` when that trigger no longer exists) is present only for a `trigger:<id>` source. `session` (`{id, status}`, or `null`) is present only for an `agent:` source, and is read from the `notification_created` event. An unknown id is `404 {"error":"no_such_notification"}`, and an id that is not a positive integer is `400 {"error":"invalid_id"}`.

The `studio` subcommand:

- `studio notifications [--limit N] [--json]` prints one line per notification, newest first: id, time, source, delivery status, title and deep link. `--json` prints the API's answer.
- `studio notifications show <id>` prints the full record (with the deep link and the delivery detail), plus the trigger's id, action and next fire, or the session's id and status. An unknown id prints `studio: no such notification <id>` and exits 1.
- Bad usage prints the subcommand's usage and exits 2.

Text is printed as plain text: every control character in a title, body, source or detail is written as `\xNN`, so notification text can never move the cursor, recolour the terminal or fake a line of output. In `show`, line breaks in the body stay line breaks.
