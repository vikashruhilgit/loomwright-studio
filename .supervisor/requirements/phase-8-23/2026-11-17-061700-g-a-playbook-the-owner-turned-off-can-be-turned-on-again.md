# 23g — A playbook the owner turned off can be turned on again

## Status: in_progress

**Observed live (2026-11-17).** The owner turned off playbooks 17 and 18 (`studio playbooks off`) to stop runs during a kernel bug. Afterwards nobody can turn them back on:

- The kernel refuses Wright's enable request: "playbook was turned off by the owner; an agent cannot change, disable or re-enable it" (`kernel/src/playbooks/store.ts:448`; `enable.ts:178` refuses an owner-off playbook).
- The app's ON switch on an off playbook only reveals a note: "This playbook turns on when Wright asks and you approve it" (`app/src/screens/playbooks/parts.tsx`, `TurnOnNote`: "the owner has no route that turns a playbook on").
- The CLI has `playbooks off` but no `on`.

So an owner-off playbook is permanently off; the only way back is a new playbook (new id, so its dedupe history is lost), with a draft, dry run, enable, live switch, second dry run and second enable.

**Ask.** One owner route turns an owner-off playbook back on (for example: the owner's own switch sends the enable with the version's last dry run, or Wright may request the enable and the owner's approval clears the owner-off mark), never an agent alone.

<!-- loomwright:requirement-closeout -->
## Status: done_with_escalation
- **Completed:** 2026-11-28T07:31:55Z
- **Brief:** unknown
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/289
- **Owed:** a recorded live check of an owner-off playbook turned on through the owner's once-approval; an owner-off playbook with no dry run still cannot come back
