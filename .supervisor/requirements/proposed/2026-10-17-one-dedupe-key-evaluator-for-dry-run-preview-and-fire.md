# One dedupe-key evaluator for the dry-run preview and the fire-time check

## Status: proposed

**Follow-up of:** phase 3 item 07 (Wright dry-runs a playbook and asks to enable it), job `2026-10-17-playbook-dry-run-and-enable`, and item 08 (enabled playbooks fire once per dedupe key), which were built in parallel lanes.

## Problem

Two pieces of code evaluate a playbook's `dedupe_key_spec` (a JSON list of the closed `DEDUPE_KEY_FIELDS`: `playbook.id`, `playbook.version`, `trigger.id`, `trigger.scheduled_at`, `date`):

- item 07's preview, `previewDedupeKey` in `kernel/src/playbooks/dry-run.ts`: the key the next fire would get, shown in a dry run's result, the mirror and the enable approval. Format: `<field>=<value>` joined with `|`, in the spec's order; `date` is the fire's local date in the cron's zone (or at a `once` spec's own offset).
- item 08's fire-time evaluator in `kernel/src/playbooks/runs.ts`: the key that decides what a fire skips.

If the two ever differ (format, field order, how `date` is computed), the owner approves a playbook on a preview that is not what the kernel then checks. Today nothing forces them to agree.

## Scope

1. Once both items are on `main`, make item 08's evaluator the one implementation, exported from `runs.ts` (or a small shared module), and have `dry-run.ts` call it for the preview. Remove `previewDedupeKey`'s own logic.
2. One test pins that the preview for a fire equals the key the fire records for the same playbook, trigger and instant (a cron trigger across a zone's date boundary, and a `once` spec with a non-UTC offset).
3. Update `docs/architecture/dry-run.md` ("a preview; item 08 owns the fire-time check") to say the preview is the fire-time evaluator itself.

## Acceptance criteria

- [ ] Exactly one function computes a dedupe key from a spec; the dry run's preview and the fire use it.
- [ ] The pin in scope 2 is red when the two diverge.
- [ ] `cd kernel && npm run typecheck && npm test` and `bash scripts/check-docs.sh` pass.
