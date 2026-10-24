# Team screen evidence (phase 5 item 14)

These are screenshots of the built app's Team screen in every designed state, in light and dark mode. Each one was taken by `app/e2e/team.spec.ts` against the fixture kernel, with the canned data in `app/e2e/fixtures/team.ts`. Wright, Mason (a comment-only reviewer with no limits) and Ada (turned off, with limits) are fixture agents. Every path in the fixture is under `/srv/studio-fixture`, so none of it is real data.

To regenerate the screenshots:

```sh
cd app && npm run build && TEAM_EVIDENCE=1 npx playwright test e2e/team.spec.ts --workers=1
```

Without `TEAM_EVIDENCE=1` the spec writes its screenshots to Playwright's per-test output directory, so CI never changes these files. The spec checks behaviour and never compares pixels, because fonts differ between macOS and the Ubuntu CI run. These files were captured on macOS on 2026-10-22.

## Screenshots

The "Mockup state" column names the Team state in `docs/design/mockups/gui-v1.html` (`renderTeam`) that each screenshot matches.

| Screenshot (light / dark) | Designed state | Mockup state | What it shows |
|---|---|---|---|
| `team-populated-light.png` / `team-populated-dark.png` | Populated | Default data, with no toggle on | Three cards in the `CardGrid`, Wright first as the whale with the crown. Wright's task line is its running brain message on its live session 12, with the working dot. Mason's long persona is clamped at two lines. Mason shows "14k today · no limit" and "0 sessions · no limit". Ada is `off`. |
| `team-empty-light.png` / `team-empty-dark.png` | Empty (Wright only) | The "Empty" toggle (`S.force.empty`: Wright's card alone) | Wright's card, "1 agent", and the note "No crew members yet. Create one from a charter, or ask Wright to propose one from a duty." |
| `team-loading-light.png` / `team-loading-dark.png` | Loading | The "Loading" toggle (`S.force.loading`: three skeleton cards) | Three skeleton cards before `GET /agents` answers. |
| `team-error-light.png` / `team-error-dark.png` | Error, with the kernel-unreachable band | The "Offline" toggle (`S.force.offline`: the `band dng` "Couldn't reach the kernel…") | The shell's band, then Team's "Couldn't load the team · Couldn't reach the kernel (connection_failed)." |
| `team-waiting-light.png` / `team-waiting-dark.png` | Waiting on you | A card whose agent has a pending approval (`agentState` = `waiting`: "Waiting on you · <title>") | Mason's task line reads "Waiting on you · Post a review on PR #412", with the waiting dot and the waiting avatar ring. |
| `team-inspector-light.png` / `team-inspector-dark.png` | Inspector open | A selected card (`S.selAgent`: `aside.insp`) | Mason's 320px inspector. It shows the role unclamped, the duties, and "Boundaries · guidance, not enforced". Apart from those sit "Permissions · enforced by the kernel", with allowed tools, Bash prefixes and the `never` list, each marked "enforced". |
| `team-told-apart-light.png` / `team-told-apart-dark.png` | Members told apart (phase 5 polish, 2026-10-24) | No mockup state: the collision roster (`teamFixture({ collision: true })`) | Two crew members named "Comment-only Reviewer" (one typed "comment-only reviewer ") with the same turtle and hue. Each card shows its id in muted mono under the name (`phase4-exit-mvg8wle4cf8f26`, `phase5-exit-1024`), and so does each Crew row. In the Crew sidebar the off Ada sorts after both, dimmed, with the word "off". Team's own card order is unchanged (Ada stays between the two). Wright's task line is its running message because `GET /sessions` reports session 12 `running`. A running message whose session the kernel reports ended (killed) now reads `idle` instead: that branch is pinned in `team.test.tsx`, not captured here. |
| `team-new-crew-member-light.png` / `team-new-crew-member-dark.png` | New crew member form | `newAgent()` (the "New crew member" charter form) | The form as it opens: empty, with no presets. Focus is on its heading, so the heading shows the focus ring. |

### How each state is produced

- **Loading:** a fixture route answers synchronously, so the fixture cannot hold `GET /agents` open, and `fixture-kernel.ts` is item 01's and stays unedited. The spec instead builds the real `App` into a gallery window (`launchGallery`), over a bridge that answers only `GET /status` and never answers any other read. That window is the gallery's bare `BrowserWindow`, not the app's, so this pair is 1456 px tall instead of 1520 px. The content is the same shell.
- **Error:** the app is launched on `unreachableDataDir()`, which writes an `api.json` naming a live pid and a port that nothing listens on. This is the smoke spec's "kernel unreachable" setup.
- **Dark mode:** the spec sets `data-theme` on the root element and checks that `--ground` differs between the two themes, so a dark capture that silently stayed light fails the run.
- **Sidebar in dark mode:** in these hidden-window captures the dark sidebar renders as flat grey instead of vibrancy. I saw this in the screenshots but did not establish the cause. The `components/` evidence from the gallery has no sidebar to compare against.

## What the spec proves (`app/e2e/team.spec.ts`)

| Test | Criteria |
|---|---|
| Three cards, Wright first as the whale, with each card's role, task, tokens, sessions and status | AC1. Also AC2's real-layout clamp (`-webkit-line-clamp: 2`, and the text is actually clipped) and the full persona as the card's `title`. |
| The waiting-on-you task line | AC1's first task-line branch |
| Empty, error, loading | AC10 states |
| The reviewer's inspector | AC3: enforced tools, Bash prefixes and `never`, kept apart from the guidance boundaries, plus model, limits, workspaces and memory paths. It also checks that `GET /agents/wright` is never requested, and that `GET /agents/mason` is requested so the check is not vacuous. |
| Create by keyboard alone | AC6 and AC9. The spec uses Tab, Enter, Space, arrow keys and typing only, and a pointer-event counter must read 0. This drives both picker dialogs. `POST /agents` is called once with the exact charter. The card is still absent 750 ms after the `201`, and it appears only after the fixture publishes the agent and appends `agent_created`. |
| Rename by keyboard alone | AC9. `POST /agents/mason/rename` is called with `{display_name}`, the card takes the new name from the feed's `agent_renamed`, and Escape closes the inspector with focus back on the card. |
| Ask Wright to draft it | AC7. `POST /ask` carries the owner's words, the hash becomes `#/chat`, and no `POST /agents` is made. |
| Told apart | Phase 5 polish (crew members told apart). Both colliding cards and both Crew rows show their own id, each row's `title` and `aria-label` (`<name> (<id>)`) carry it, Ada's Crew row is last, has the `off` class, reads "off", is dimmed (opacity below 1) and stays a visible, enabled button. |

The brief lists two pin mutations for this spec. Each one was applied to `app/src/screens/team/`, rebuilt, made the spec fail, and was then reverted:

| Mutation | Result |
|---|---|
| `tabIndex={-1}` on the New crew member Create control | Failed with "Tab never reached Create in 60 presses". |
| Add the returned agent to the roster locally on the `201` | Failed at the absent-after-`201` check: expected 3 cards, received 4. |
| `[...crew].sort(offLast)` → `[...crew]` in `app/src/screens/chat/CrewSection.tsx` (told apart, 2026-10-24) | Failed at the Crew row order: expected `[phase4-exit-mvg8wle4cf8f26, phase5-exit-1024, ada]`, received `ada` second. |

## Contract gaps found

None of these gaps was worked around by editing the kernel, `app/src/api/contract.ts` or `app/src/components/**`.

1. **`RosterEntry` has no role and no current task.** A crew member's role on its card is its charter `persona`, from one `GET /agents/:id` per crew member, refetched on `agent_*` events. Wright's role is the fixed words "Lead agent". The task line comes from `useResource("approvals")`: a `pending` approval the agent requested comes first. Next comes work, read from the agent's live sessions in `useResource("sessions")` (`starting` or `running`), never from a message's status alone: the kernel can leave a brain message `running` after its session ended, and the live exit run showed a killed request on an idle Wright that way. With a live session the line is the newest `running` message on one of those sessions, else "Session <id> running". With no live session it reads "idle". It reads a state only when all three lists were read. While any list is still loading the line reads "checking status…", and when one was refused it reads "status unavailable", with no dot and an alert naming the refusal. A pending approval still shows as waiting when only the messages are unread. A roster field for the role and the current task would remove the per-member detail calls.
2. **Nothing reports Wright's current `effort` or `delegation_depth`.** `GET /agents/wright` answers `409 reserved`, and the roster has only `model`, `tokens_per_day` and `sessions_at_once`. Both values stay editable through `POST /agents/wright/set` (item 07). The inspector shows them as "not reported" until they are set in this session. After a set it shows the `AgentSetResponse.new` value marked "· set this session", because no route reads it back and a hand edit of `wright.json` would not show. While the roster's `settings_error` says `wright.json` does not read ok, both read "unknown". Any value set this session is then dropped, so it does not come back when the file reads ok again. Neither value is ever guessed. Wright's model is always the roster's own read, never the set answer.
3. **`AgentCard` (`app/src/components/Card/Card.tsx`) cannot show what Team needs.** It needs a numeric `budget.limit`, so it cannot say "no limit". It also has no slot for sessions at once or for status. Team composes its own card from `CardGrid`, `formatTokens`, `budgetPercent`, `BUDGET_ATTENTION_PERCENT` and the `card-*` classes.
4. **The `Charter` component (`app/src/components/Charter/`) is not used as the form's preview.** Its limits need numbers (no "no limit"), and its tools carry a connector "connected" claim that SDK tool names such as `Read` or `Grep` do not have. The form summarises the tool policy as text instead.
5. **Chat does not read an agent from the hash yet.** "Open thread" and the `team.thread.*` commands go to `#/chat/<id>`. The shell routes on the first segment (`screenForHash`), so that address opens Chat. On this branch Chat is still the placeholder (item 13 is the sibling lane), so the agent segment is not used yet. Chat needs to honour `#/chat/<id>` for these to open the right thread.
6. **`Avatar` (`app/src/components/Avatar/Avatar.tsx`) has no unknown state.** `AvatarState` is one of six kernel states, each with a state word, and the label is always `name · <state word>[ · action]`. There is no prop that replaces the label. When approvals, messages or sessions were not read, the card and the inspector header still pass `idle` (the neutral pose), with the task line's words as the action. So the label and tooltip read "Mason · idle · status unavailable" (or "· checking status…"), and "idle" there is not a read state. The card's task line and dot claim nothing. The Avatar needs a neutral or unknown state with no state word. Until then the label keeps the false "idle".

## AC7: the path chosen for "Ask Wright to draft it"

**Path:** the owner's words go to Wright through `POST /ask` with no `agent` field (which means Wright). The text is "Draft a charter for a new crew member, for me to review before anything is created. What it should do, in my words: …". The app then opens Chat at `#/chat`, where Wright's reply and draft arrive. The reasoning is in the comment at `askWrightToDraft` in `app/src/screens/team/NewCrewMember.tsx`.

**Why this path, and not a pre-filled Chat composer:** `POST /ask` is a contract route, so it needs nothing from Chat (item 13, a sibling lane). A pre-fill would need Chat to read the request from the hash, and the shell passes on only the first segment.

**Nothing is created without the owner.** The owner presses the button with the words in view. Wright can only propose the charter through `kernel_agent_create`, which the kernel always holds for the owner's approval. The e2e test checks that this path makes no `POST /agents`.

## Other findings

- **The roster's `null` limits mean two things.** The kernel sends `tokens_per_day: null` and `sessions_at_once: null` both when a limit is unset and when it did not read the settings file. Team tells them apart by `settings_error`. With no error (or Wright's `model_unset`, where `wrightEntry` still sends the file's limits), `null` reads "no limit". With any other error, and with a crew member's `model_unset` (its `memberEntry` sends `null` limits for any refusal), it reads "limit unknown". A crew member's inspector shows a setting only from a settings file the kernel accepted (`settings.error === null`). A refused file arrives with its raw parsed content, so none of that content is shown as a value. A roster field saying whether the settings file was read would remove the inference.
- **The New crew member form is in the column, not a Dialog.** The mockup's `newAgent()` is a wide dialog. Dialogs never stack, and the tool picker and shape picker are each Team's own `Dialog`. Keeping the form in the column lets each picker open over it.
- **With no `window.api`, Team says so.** In a window without a preload (as `App.test.tsx` renders the shell), Team shows "This window has no connection to the kernel." instead of starting a store.
- **New crew member stays enabled when the kernel is unreachable.** The error screenshots show it. By the code, a create made then would get the bridge's `connection` answer, which `outcomeOf` in `model.ts` turns into "Couldn't reach the kernel (…)" as text. That was not run here. This is recorded as observed and was not changed.

## Limits of this evidence

- The pointer path for every action, and Set a field, Turn off and Turn on, are covered by `app/src/screens/team/team.test.tsx` (jsdom), not by this spec.
- The ⌘K commands (AC8) are pinned in `team.test.tsx`, not driven in Electron here.
- The screenshots other than `told-apart` were captured on 2026-10-22, before the Crew sidebar marked off members. In them Ada's Crew row is not yet dimmed and has no "off" word; regenerate them with the command above to bring them up to date.
- All screenshots come from one machine (macOS). The Ubuntu CI run executes the same assertions but does not write these files.
