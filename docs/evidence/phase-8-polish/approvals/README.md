# Evidence: the merge approval card in Approvals (phase 8, item 13)

This is the polish-gate evidence for the merge approval card: a pending `kernel_merge_approval_request` approval drawn so the owner can read the repo, the PR, the head commit, CI, Loomwright's READY time and the repo's policy before allowing it. It offers **Allow once** and **Deny** only. Every screenshot comes from the built app running against the fixture kernel, in light and dark mode. They are evidence for the owner's review, not visual-regression baselines: the spec never compares pixels.

- Card: [`MergeApprovalCard.tsx`](../../../../app/src/screens/approvals/MergeApprovalCard.tsx), its payload reader [`subject.ts`](../../../../app/src/screens/approvals/subject.ts) (`MERGE_APPROVAL_ACTION`, `mergeApprovalOf`), mounted by [`ApprovalsScreen.tsx`](../../../../app/src/screens/approvals/ApprovalsScreen.tsx), styles in [`approvals.css`](../../../../app/src/screens/approvals/approvals.css)
- Unit tests: [`ApprovalsScreen.test.tsx`](../../../../app/src/screens/approvals/ApprovalsScreen.test.tsx) (`mergeApprovalOf` and "the merge approval card")
- Mirror pin: [`console-contract.test.ts`](../../../../kernel/test/console-contract.test.ts) reads `subject.ts` as text and compares `MERGE_APPROVAL_ACTION` with the kernel's
- e2e: [`approvals.spec.ts`](../../../../app/e2e/approvals.spec.ts) over the fixture's `mergeApproval(id)` in [`fixtures/approvals.ts`](../../../../app/e2e/fixtures/approvals.ts)
- Mockup: [`docs/design/mockups/phase-8.html`](../../../design/mockups/phase-8.html), views `merge-card`, `merge-card-allowed` and `merge-card-denied`

## How they were produced

```sh
cd app
npm run build
PHASE8_POLISH_EVIDENCE=1 npx playwright test e2e/approvals.spec.ts --workers=1 -g "phase 8: the merge card"
```

The spec writes screenshots here only when **`PHASE8_POLISH_EVIDENCE=1`** is set (the switch is shared with the other phase 8 polish folders). Before writing, it deletes every `*.png` in this folder, so the folder always matches the current states. Without the switch, the screenshots go to Playwright's per-test output directory, and a test asserts that no file in this folder changed during the run. Each shot is a full-window screenshot (1180 px wide, 2x, macOS, Electron 44) taken with `data-theme="light"` and then `data-theme="dark"` set on `<html>`, after checking that `color-scheme` reads that theme and that the ground colour differs between the two. The window is made 1240 px tall for these shots so the card, the payload and the decision buttons fit in one frame. The last test checks that this README and the folder list exactly the six files below.

## Screenshots

| Light | Dark | State | Matches in phase-8.html |
|---|---|---|---|
| [merge-card-light.png](merge-card-light.png) | [merge-card-dark.png](merge-card-dark.png) | **Pending.** Approval #7 (a `kernel_merge_approval_request` held from playbook `tickets-to-prs` v2) is selected. The card shows the PR and its URL as text, the repo, the head commit as 7 characters, CI, Loomwright READY and the repo policy, then "Approving does not merge." Under it are the exact payload, **Allow once A** and **Deny D**. There is no Always button. | The mockup's `merge-card` view: header "Allow PR #21 to go to Loomwright's gate", the Pull request / Repo / Head commit / CI / READY / Repo policy rows and the gate line. The mockup's "Open on GitHub" button is not built (see follow-up 5). |
| [merge-card-allowed-light.png](merge-card-allowed-light.png) | [merge-card-allowed-dark.png](merge-card-allowed-dark.png) | **After Allow once.** A was pressed: one `POST /approvals/7/approve` with `{"decision":"once"}`. The outcome ("allowed once") sits above the card, which stays. | `merge-card-allowed`: "allowed once", and nothing merged by Studio. |
| [merge-card-denied-light.png](merge-card-denied-light.png) | [merge-card-denied-dark.png](merge-card-denied-dark.png) | **After Deny.** D was pressed on the same card from a fresh kernel: one `POST /approvals/7/deny`. | `merge-card-denied`: "denied", and the PR stays parked. |

## What the specs check besides the screenshots

| Where | What it asserts |
|---|---|
| e2e, "a merge approval is a merge card" | The heading, repo, URL text, 7-character head (the full SHA is its `title`), CI, READY, policy and the gate line are in the card; the card holds no `a` and no `[href]`; the buttons are Allow once and Deny, none says merge, and there is no Always button; Shift+A sends nothing and says a merge is asked every time; a non-merge approval keeps its Always button; Allow once sends exactly one `{"decision":"once"}`. |
| e2e, "flat payload shape" | The fields are read from the payload's top level too; a CI, READY or policy field the request did not carry reads "not in the request"; D sends one deny. |
| unit, `mergeApprovalOf` | Fields are read as the kernel's `hasMergeApproval` reads them: only from `payload.input` of the rail's `{tool, input, cwd}` when `payload.tool` is `mcp__kernel__kernel_merge_approval_request`, never from the payload's top level (a flat payload draws no card, and a top-level field never changes the PR shown; changed in the item 09 follow-up, which made the kernel read `payload.input`); any other action, a `repo` that is not `owner/name`, a `pr` that is not a positive safe integer, or a `head_sha` that is not 7 to 40 lowercase hex characters gives no card and builds no URL; a missing or wrongly typed `ci`, `ready_at` or `policy` is `undefined`. |
| unit, the card | The PR URL is text; payload strings are escaped; no Always button; the `⇧A` command is disabled for a merge approval and enabled for another; Shift+A and a direct run of the `⇧A` command send nothing, using a rail-held, playbook-session approval for which `alwaysRefusalFor` has nothing to say, so only the merge guard stops them; a merge-action approval whose fields do not validate offers no Always either. |
| kernel, `console-contract` | `MERGE_APPROVAL_ACTION` in `subject.ts` equals the kernel's `MERGE_APPROVAL_ACTION`. |

## Follow-ups (for item 09, and the owner)

1. **Payload keys item 09 must match.** Only `repo`, `pr` and `head_sha` are fixed by code today (the kernel's `hasMergeApproval` reads `$.repo`, `$.pr` and `$.head_sha`). The card reads `ci`, `ready_at` and `policy` as strings; all six names live in `MERGE_PAYLOAD_KEYS` in `subject.ts`. If item 09 files `ci_state` or another name, the card shows "not in the request" for it, never a guess. The card never reads anything it was not told to.
2. **`hasMergeApproval` reads `$.repo` at the payload's top level; a rail-held tool approval's payload is `{tool, input, cwd}`.** If item 09 holds the tool through the rail, `policyMet` would never see the approval. The card reads either shape but with the kernel's precedence (the top level first, `payload.input` only when the top level carries none of the three keys, no card when both carry them and differ), so it never shows a PR the kernel would not authorise; the kernel reader still does not read `payload.input`. This item changes no kernel source.
3. **The kernel's `always` refusal.** The kernel refuses `always` only for approvals the rail did not hold, so a merge approval held through the rail from a playbook session is eligible for an `always` grant. This screen never sends one (its `decide()` guard), but the real close is item 09's: `kernel_merge_approval_request` belongs in `ALWAYS_HELD_TOOLS` ("never covered by an always grant").
4. **Chat's inline approval card applies the same guard.** `ApprovalCard` in `app/src/screens/chat/cards.tsx` keys on the same `isMergeApproval`: a merge-action approval gets no Always button (EventCard's `offerAlways={false}`), and Shift+A sends nothing and shows the same `MERGE_ALWAYS_REFUSED` line (now in `subject.ts`, shared by both screens). A non-merge playbook approval keeps Always. `cards.test.tsx` covers both. This is the app's side only; follow-up 3's kernel close remains item 09's.
5. **The PR URL is text, not a link.** `app/electron/open-external.ts` allows exactly three addresses and does not admit PR URLs. A clickable link is a follow-up that edits that allowlist and its test.
6. **A merge-action approval whose `repo`, `pr` or `head_sha` does not validate** (or whose top level and `input` disagree) is drawn as a generic approval (no card, no URL), and still offers only Allow once and Deny: the no-Always gate (button, `⇧A` command, `decide()` refusal) is keyed on the action (`isMergeApproval`), not on field validity. Such an approval cannot satisfy the kernel's reader either; item 09's kernel-side refusal in follow-up 3 remains the real close for rail-held ones.
