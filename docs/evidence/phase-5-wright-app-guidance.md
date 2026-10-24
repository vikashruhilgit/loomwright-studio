# Phase 5 evidence: Wright points the owner to the app, not to `studio` commands

In the phase 5 live exit run Wright told the owner to type `studio playbooks set 3 model <id>` and `studio approve 6` / `studio deny 6`, though the app already does both ([runbook](phase-5-exit-runbook.md)). Wright repeats what the kernel tells it. This item changed two texts:

- **The held-call reason** (`kernel/src/sessions/manager.ts`, the PreToolUse gate's `permissionDecisionReason` for a held call) now says `The owner decides in Studio's Approvals (approval <id>)` instead of `The owner decides (studio approve <id> once, or studio deny <id>)`. The rest of the reason is unchanged.
- **Wright's first-run guidance** (`ROLE_TEMPLATE` in `kernel/src/brain/templates.ts`, shown verbatim in [brain: the first-run `role.md`](../architecture/brain.md#the-first-run-rolemd)) has a new `## Where the owner acts` section: name the app's control (Approvals; a playbook card's Set, Run now and Turn off; Team's inspector), and mention a `studio` command only when the owner asks for the CLI.

This page records the rest: every other `studio` command in `kernel/src` that a model reads, for a follow-up item. None of them is changed here (the requirement's Scope 3 changes only the texts inside its Touches).

## The grep

Run from the repo root on 2026-10-24, on this branch:

```bash
grep -rn 'studio ' kernel/src
```

Lines that are whole comments (`//` or ` *`) were dropped by hand, and each remaining hit was read in its file to see who reads the text. A second grep, for a line ending in `studio` (a command broken across a `+` concatenation), found six lines, all comments, so no string is split that way:

```bash
grep -rnE 'studio["`'"'"']? *(\+|,)?$' kernel/src
```

Line numbers below are at base `e6233a9`.

## Model-read hits outside this item's Touches

A model reads each of these: a tool result, a tool error or refusal, a tool description, or a file whose path a tool returns to the agent.

| File | The text (quoted) | Who reads it | Proposed app-control wording |
|---|---|---|---|
| `kernel/src/approvals/tool.ts:27` (`messageFor`) | `Approval ${id} is pending: the owner decides (studio approve ${id} once, or studio deny ${id}). ` | The calling agent (Wright or a crew member): it is the `message` field of the `kernel_approval_request` tool result. | `Approval ${id} is pending: the owner decides in Studio's Approvals (approval ${id}). ` (the same wording as the held-call reason). |
| `kernel/src/playbooks/dry-run.ts:458` | `model: playbook ${row.id} has no model; the kernel never picks one (the owner sets it with studio playbooks set ${row.id} model <id>)` | Wright (or the crew member drafting): the `kernel_playbook_dry_run` tool error when the playbook has no model. The likely source of the live run's "set one with `studio playbooks set 3 model <id>`". | `… the kernel never picks one (the owner sets it with Set model on the playbook's card in Studio)`. The card's Set form offers `model` (`SET_FIELDS` in `app/src/screens/chat/cards.tsx`). |
| `kernel/src/agents/charter-tools.ts:597` (`updateFitRefusal`) | ``the owner changes config/agents/${m.row.id}.json by hand (or with `studio agents set` for a scalar field, `studio agents rename` for the display name), and Wright can change the member once its settings fit`` | Wright: a `kernel_agent_update` refusal (`invalid_input`) returned before the hold. | `the owner changes config/agents/${m.row.id}.json by hand (or with Set a field or Rename in Team's inspector), and Wright can change the member once its settings fit`. |
| `kernel/src/playbooks/mirror.ts:156` (`renderPlaybookMirror`) | ``Edits here are not read: the owner changes a playbook with `studio playbooks set` and turns it off with `studio playbooks off`.`` | Any agent that Reads the mirror `memory/playbooks/<slug>.md`: the playbook tools return its path (`mirror`) and Wright has Read, Glob and Grep. The owner reads it too. | `Edits here are not read: the owner changes a playbook with Set on its card in Studio and turns it off with Turn off.` |
| `kernel/src/playbooks/mirror.ts:167` (same file) | ``(`studio triggers` shows the live schedule)`` | As above. | Name the app's view of the trigger (the playbook card is passed the linked trigger). The follow-up confirms which control shows the live next fire before wording it. |
| `kernel/src/notifications/tool.ts:31` (`kernel_notify`'s description) | `Send the owner a notification: a native macOS notification plus an entry in studio notifications.` | Every agent offered `kernel_notify`: a tool description is part of the model's tool list. It names the CLI's list, not a command to tell the owner, so it is the weakest of these. | `… plus an entry in Studio's notifications.` The follow-up confirms the app's name for the place a notification opens (the menu bar's deep link). |

## Notification bodies: not model-read

- `kernel/src/approvals/store.ts:286`: `Decide: studio approve ${id} once, or studio deny ${id}.` (the held approval's notification body).
- `kernel/src/playbooks/runs.ts:353`: `Turn it on with studio agents on ${e.agent}.` (a fired playbook whose agent is off).

No model reads a notification body. The body is stored by `recordNotification` and read back only by `getNotification` and `listNotifications` (`kernel/src/notifications/record.ts`). Their only callers are `kernel/src/notifications/routes.ts` (`GET /notifications` and `GET /notifications/:id`, which the app, the menu bar and `studio notifications` call) and `kernel/src/notifications/deliver.ts` (the macOS notifier). No kernel tool returns another notification's body, and Wright's context (`kernel/src/brain/context.ts`) does not include notifications. These texts are owner-facing. They still name CLI commands to the owner, so the follow-up may want app wording there too, but they cannot teach Wright a command.

Two other owner-facing hits, also not model-read:

- `kernel/src/budget/internal.ts:391`: the `hint` (`studio session abandon <id>`) of an `agent_sessions_at_once` refusal. It is written only into event payloads (`admission_refused` and the hourly `notify`). The `AdmissionRefusedError` message (`kernel/src/sessions/manager.ts`, `#admit`) does not carry it, and its consumers (`kernel/src/brain/handler.ts`, `kernel/src/playbooks/runs.ts`) read only the reason and the retry time.
- `kernel/src/notifications/notifier.ts:301`: the delivery detail (`a click runs studio notifications show <id> in Terminal`), stored on the notification row for the owner.

## CLI output: not model-read

Every other hit is the CLI's own help, usage, stdout or stderr (for example `kernel/src/approvals/cli.ts`, `kernel/src/cli/index.ts`, `kernel/src/agents/roster.ts`, `kernel/src/playbooks/drafts.ts`, `kernel/src/brain/cli.ts`, `kernel/src/service/launchd.ts`). The owner reads it in a terminal, and no model reads it.

## AC3: the live rerun (owner check at the phase 5 rerun)

Whether Wright's replies in flows 2 and 3 of the [phase 5 runbook](phase-5-exit-runbook.md) contain no `studio` command is the owner's check at the phase 5 rerun. The worker can't verify it: it needs the packaged app, the launchd kernel and a real Wright session.

**Prerequisite before the rerun.** `role.md` is written only when it is absent, and an existing file is never overwritten ([brain: Files](../architecture/brain.md#files)). The owner's `~/.loomwright-studio/memory/wright/role.md` (or under `$STUDIO_DATA_DIR`) therefore keeps the old text. Before the rerun, the owner copies the `## Where the owner acts` section from [the template](../architecture/brain.md#the-first-run-rolemd) into that file, between `## Who decides` and `## Your crew`, or removes the file so the kernel writes the new template on Wright's next message (the owner's own edits to it are then lost). The held-call reason needs no owner step: the kernel builds it on every hold.

Even with both changes, the hits listed under [Model-read hits](#model-read-hits-outside-this-items-touches) still name `studio` commands to Wright (most likely the dry run's missing-model error and `kernel_approval_request`'s result), so a `studio` command in the rerun may come from one of them rather than from this item's texts.
