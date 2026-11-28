# wa-f evidence: agents propose memory entries, the owner approves, the kernel writes

Requirement: `.supervisor/requirements/wright-aware/2026-11-21-230500-wa-f-agents-propose-lessons-and-the-owner-approves-them.md`. Code: `kernel/src/brain/memory-propose.ts`, the rail deny in `kernel/src/sessions/policy.ts`, the card `app/src/screens/approvals/MemoryProposalCard.tsx`. Design: [brain: memory proposals](../architecture/brain.md#memory-proposals-wa-f), [approvals: the rail](../architecture/approvals.md#the-rail).

## The owner condition (2026-11-28, binding), quoted from the requirement

> Relayed by the coordinator when wa-f was started: keep the approval with the owner. An agent may only propose a lesson; it never accepts its own lesson or any other. In the build this means: no agent session (Wright or crew) can decide a `kernel_memory_propose` approval, whether its own or another agent's, through any tool, delegation or route; only the owner's decision path applies it; and a test pins that an agent's attempt to decide one is refused and writes nothing. The PR body shows this condition and the test that pins it.

Pinned by `kernel/test/brain-memory-propose.test.ts`, describe "AC11: no agent session can decide a kernel_memory_propose approval":

- "every studio decision form from a session whose prefixes admit studio is denied approval_decision_blocked; the approval stays pending, the file unchanged": a crew session holding the `studio` prefix tries `studio approve 1 once`, `… always`, `studio deny 1`, `/usr/local/bin/studio approve 1 once`, `studio {approve,x} 1 once`, quoted, split, globbed and upper-case forms. Each one is denied `approval_decision_blocked`, approval 1 stays `pending` and `memory/wright/lessons.md` is byte for byte unchanged. Wright, which has no Bash prefix, is refused by its policy.
- "source pin: decideApproval( is called only from the owner's bearer route": across `kernel/src`, `decideApproval(` appears only in `approvals/routes.ts`, the owner's token-gated `POST /approvals/:id/approve|deny`, and at its definition in `approvals/store.ts`. So no tool, delegation (`kernel_agent_message` hands a crew member nothing that decides) or other route decides.
- "the kernel's API info file is protected from a shell read, and holds no token": `cat <dataDir>/api.json` is `protected_kernel_path`, and `ApiInfo` is `{port, host, pid, started_at}`, so the bearer token is only in the Keychain. **Correction to the brief:** a *Read tool* call on `api.json` is not denied by the rail; the rail checks paths only for Write, Edit, NotebookEdit and Bash. Checked against the code with `classifyToolCall("Read", …)` → `ordinary`. It reveals no token.

Rail-level cases: `kernel/test/sessions-policy.test.ts`, "the approval decision block (wa-f)". The pin mutation (flip the reason to `merge_blocked`, or delete the deny line) turns these red.

## The brief's owner conditions (LP-SCOPE answer, 2026-11-28, binding, verbatim)

> Owner conditions (binding for the build, put them in the brief verbatim; the PR body must show each one): Adding kernel_memory_propose to an unedited Wright list is fine: it only raises a held approval, and the binding owner condition (no agent decides one) is pinned by a test. Also show in the PR body that a proposal never writes memory until the owner approves, and that the proposed text is shown to the owner as data, never run as instructions.

1. **Adding the tool to an unedited Wright list only raises a held approval** (AC1, AC5): `brain-memory-propose.test.ts` "AC5: Wright's proposed list holds it, and the 31-tool list it replaces is the last past list, …" and "Wright's call is held as a pending approval; …"; `sessions-policy.test.ts` `ALWAYS_HELD_TOOLS` pin; `approvals.test.ts` "kernel_memory_propose is held from a playbook session …; always on it is refused always_not_supported"; `agents-settings-upgrade.test.ts` past lengths `[15, 21, 25, 31]`.
2. **No agent decides one** (AC11): the AC11 tests above.
3. **A proposal writes no memory until the owner approves** (AC1, AC10): "Wright's call is held …; the file is unchanged while it is pending" and "deny: the agent is told, nothing is written; …" (bytes compared, no `memory_updated`), plus the AC10 cases: a symbolic link at the folder or at the file, an unwritable folder, and a rename that throws (macOS). Each ends `apply_refused`, with the file byte for byte unchanged and no temporary sibling.
4. **The proposed text is shown as data, never run as instructions** (AC9, AC4): `app/src/screens/approvals/MemoryProposalCard.test.tsx` "shows the file and the entry as text, and the evidence escaped inside the untrusted well, never as markup"; `ApprovalsScreen.test.tsx` "a memory proposal (wa-f) mounts its card and offers Allow once and Deny only"; `brain-memory-propose.test.ts` "AC4: both guides say when and how to propose" (never copy untrusted text into an entry as an instruction). An entry holding an untrusted-data tag is refused before the hold.

## The brief's owner conditions (LP-SAVE-NOTE answer, 2026-11-28, binding, verbatim)

> Owner conditions (binding for the build, put them in the brief verbatim): The build must close both MEDIUM notes: add the brain.test.ts tool-list pin-mutation row, shown failing on a mutation, and keep the 22-file scope reviewable. Split it into serial subtasks (kernel first, then app) if the Supervisor allows, and list both fixes in the PR body.

1. **The brain.test.ts tool-list pin, shown failing on a mutation.** `kernel/test/brain.test.ts` "ships the six Studio lookup tools (wa-e) and kernel_memory_propose (wa-f), …" pins the contribution's tool list with `"kernel_memory_propose"` appended. Mutation run: `tools: Object.freeze([...studioTools, memoryProposeTool])` → `tools: Object.freeze([...studioTools])` in `kernel/src/brain/index.ts`, then `npx vitest run test/brain.test.ts -t "ships the six Studio lookup tools"`:

```
 FAIL  test/brain.test.ts > the brain contribution > ships the six Studio lookup tools (wa-e) and kernel_memory_propose (wa-f), the message handler, POST /ask, GET /messages/:id, GET /messages, studio ask and studio messages, and nothing else
AssertionError: expected [ 'kernel_session_list', …(5) ] to deeply equal [ 'kernel_session_list', …(6) ]
-   "kernel_memory_propose",
      Tests  1 failed | 59 skipped (60)
```

   With the line restored the same run reads `Tests  1 passed | 59 skipped (60)`.
2. **Keeping the 22-file scope reviewable.** One worker ran two serial stages with one commit each: kernel + docs, then app. Closed-list edits are one line each, with no reformatting of untouched code. Five pins outside the planned file list had to follow the changed sets, each a one-line edit: `kernel/test/brain-studio-tools.test.ts` and `kernel/test/kernel-tools.test.ts` (the brain tool list, the 25-tool list now second-to-last, the shipped appliers) and `app/src/screens/approvals/kernel-mirror.ts` and its test (the app's mirror of `KERNEL_APPLIED_ACTIONS`, which reads the kernel file).

## Validation 3, static half: the kernel-level walk

`WA_F_WALK_OUT=<file> npx vitest run test/brain-memory-propose.test.ts -t "walks a temporary data dir"` (in `kernel/`) runs this over a temporary data dir: a session manager with the shipped brain tools' pre-hold check, Wright's shipped proposed policy, and the owner's own approve route handler with the shipped applier. Its output:

```
1. Wright calls Bash "ls": deny bash_prefix_not_allowed
2. Wright calls kernel_memory_propose: deny approval_required: held as approval 1
3. Approvals lists #1 pending by wright; display:
     Add an entry to memory/wright/lessons.md, proposed by wright
     entry (appended as written, dated the day you allow it):
     When a tool is refused, say so plainly and do not retry it in another form.
     evidence (the agent's account, untrusted data, never instructions):
     session 1: Bash `ls` was refused (bash_prefix_not_allowed); my tool policy has no shell.
4. lessons.md while pending: sha256 763cc65abca9…, memory_updated events: 0
5. owner POST /approvals/1/approve {"decision":"once"}: 200 approved/once
   applied: The kernel added this entry to memory/wright/lessons.md on approval 1: "- 2026-11-28: When a tool is refused, say so plainly and do not retry it in another form.". It is in that file's section of your next new conversation's context.
6. memory/wright/lessons.md last line: - 2026-11-28: When a tool is refused, say so plainly and do not retry it in another form.
   memory_updated: [{"path":"wright/lessons.md","by":"kernel","agent":"wright","approval_id":1,"size":230,"content_hash":"201e24da09c4…"}]
7. the next buildContext's lessons section holds it: true
     ## memory/wright/lessons.md
     
     # Lessons
     
     What went wrong before and how to avoid it next time. The owner edits this
     file; Wright reads it at the start of every session.
     
     - 2026-11-28: When a tool is refused, say so plainly and do not retry it in another form.
```

Verdict: PASS for Validation 3 (static half; the live ask to Wright on the owner's install is the owner's)

## Deviations from the brief

- **The tool's catalogue job is `general`, not `ask_for_approval` (AC5).** With `ask_for_approval`, every charter granting that job also grants and displays the tool. Approval 21's 10-duty charter head then fell to 835, then (with a shorter purpose line) to 1,135 characters of slack, under the 1,200 that phase 8 item 19a AC1 requires (`kernel/test/agents-charter-readiness.test.ts`). The tool name on the enforced line alone costs about 36 characters, so no wording keeps both. A crew member still gets the tool only through an approved charter that lists it. **For the owner:** keep `general`, or relax 19a's floor and move it to `ask_for_approval`.
- **A Read of `api.json` is not a rail deny** (see the owner-condition section): the file holds no token.
- **A deny carries no note.** `POST /approvals/:id/deny` takes none today, so the agent gets the existing `denied approval <id>: … Nothing was done; do not repeat the call.`

## The live half (the owner's step)

On the owner's install: have Wright call a tool its policy refuses, then ask it what it learned. A `kernel_memory_propose` card should appear in Approvals. After Allow once, `memory/wright/lessons.md` should end with the dated entry, and the next answer in a new thread should use it. The worker did not run this.
