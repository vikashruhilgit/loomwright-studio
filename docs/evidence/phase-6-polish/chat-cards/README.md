# Draft and poll cards in Chat threads: polish-gate evidence (phase 6, item 12)

Screenshots of the phase 6 thread cards, in light and dark, taken from the built app (`app/dist`, `app/dist-electron`) running against the fixture kernel (`app/e2e/fixture-kernel.ts` with the canned data in `app/e2e/fixtures/chat-integrations.ts`, built on `app/e2e/fixtures/chat.ts`). Each window is hidden (`app/e2e/electron-harness.ts`) and resized to 1180×1500 CSS px so the whole thread fits in one image. The default window is 1180×760.

The fixture's Wright thread holds two phase 5 event lines, two queued poll lines, two draft outputs (PR #401 with a short review body, PR #402 with a body of about 120 lines), a run of five consecutive `poll_item_skipped` items for one playbook (its dedupe key spec is `["item.id","item.revision"]`) and one `connector_status` line. Both draft bodies hold markup, a markdown link and a fake `</untrusted-data>` on purpose, to show they render as text.

## Screenshots

| State | Light | Dark | What it shows |
|---|---|---|---|
| Draft collapsed: both draft cards closed | `chat-cards-draft-collapsed-light.png` | `chat-cards-draft-collapsed-dark.png` | "Draft review for `<owner>/<repo>#<n>` (not sent)", the PR URL as text, and the permanent label "Draft mode: nothing was posted"; the queued lines, the collapsed skip card "5 unchanged PRs skipped" and the connector line around them |
| Draft expanded: the short draft open | `chat-cards-draft-expanded-light.png` | `chat-cards-draft-expanded-dark.png` | The review body read from `GET /drafts/:id`, as inert text (`<b>poll.ts</b>` and the markdown link are characters, not elements) |
| Draft long body: the 120-line draft open | `chat-cards-draft-long-body-light.png` | `chat-cards-draft-long-body-dark.png` | A long body scrolls inside the card (360px) instead of stretching the thread; the fake `</untrusted-data>` and `<script>` stay text |
| Skips collapsed: five consecutive skips as one card | `chat-cards-skips-collapsed-light.png` | `chat-cards-skips-collapsed-dark.png` | One card, "5 unchanged PRs skipped", with its time |
| Skips expanded: the same card open | `chat-cards-skips-expanded-light.png` | `chat-cards-skips-expanded-dark.png` | The five refs, each "Skipped `<ref>`: unchanged under key item.id, item.revision" |

There is no mockup for these cards. The gate matches the phase 5 card styles instead (`EventCard` event lines and the `.chat-card` look from `docs/evidence/phase-5-polish/chat/`): the same card surface, head, meta line and tokens, so light and dark follow the theme.

## How to regenerate

```sh
cd app
npm ci
node node_modules/electron/install.js   # once, if the Electron binary is missing
npm run build
npx playwright test e2e/chat-integrations.spec.ts e2e/chat.spec.ts --workers=1
```

The test "every designed state is screenshot in light and dark" deletes every PNG in this folder, then writes the 10 above. The test "the evidence README lists every screenshot, and nothing else" fails if this table, the spec's `SHOTS` and the files in this folder drift apart. `e2e/chat.spec.ts` is the phase 5 suite and writes `docs/evidence/phase-5-polish/chat/` only; running it here proves that set and its tests are unchanged.

The other tests in `e2e/chat-integrations.spec.ts` press real keys: J and K walk the phase 5 event lines and the phase 6 cards in display order (arrows never move between them, and J or K typed in the composer stay text), Enter on a draft card's toggle expands it and issues exactly one `GET /drafts/:id`, Enter on the skip group's toggle lists its five refs, and Enter on the connector line opens `#/integrations`.

## Owner findings

None yet. Record here anything the gate review finds, with the screenshot it is in.
