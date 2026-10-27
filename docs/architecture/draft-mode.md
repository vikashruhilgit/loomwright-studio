# Draft mode

Part of [Phase 6 features](../ARCHITECTURE.md#phase-6-features). Built and documented by **item 07** (draft mode records outward calls instead of sending them), in the integrations feature's `drafts.ts` part (`kernel/src/integrations/drafts.ts`) and the session policy (`kernel/src/sessions/policy.ts`).

**Routes** (owner-only):

| Route | Answers |
|---|---|
| `GET /drafts[?agent=…][&playbook=…][&item=…][&limit=N]` | `{drafts}`: the matching draft outputs, newest first |
| `GET /drafts/:id` | `{draft}`: one draft output |

**Contract types it fills** (`app/src/api/contract.ts`): `DraftOutput`, `DraftsQuery`, `DraftsResponse` and `DraftDetailResponse`.

A playbook's `mode` (`PLAYBOOK_MODES`: `draft` or `live`, default `draft`) is the user's policy, set like the playbook's other fields and owner-locked the same way: Wright only proposes it. Under `draft` the kernel denies, without asking, every outward call the session makes (`gh pr comment|review`, a non-GET `gh api`, any GitHub write), records it as one `draft_outputs` row (migration 17: session, agent, playbook, playbook run, item, tool and a bounded payload) and appends one `draft_output_recorded` event, which the agent's thread shows as a card ([threads](threads.md#the-event-kinds)). Nothing is sent. The payload is model output built from PR text: untrusted data. `live` is not built in phase 6: setting it is refused `live_mode_not_in_phase_6`.

Today (the phase 6 foundation) migration 17 creates `draft_outputs` and `playbooks.mode`, the session manager puts the playbook's `mode` and the agent's `connectors` into the policy input (`ToolPolicy.mode` and `ToolPolicy.connectors`), the policy ignores both, the part is empty, and the two routes answer 404.
