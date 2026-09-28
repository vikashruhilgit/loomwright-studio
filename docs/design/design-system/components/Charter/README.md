A charter is how a crew member comes to exist, and it is the same object whether Wright drafts it from a sentence in Chat or the user fills it in from Team → New crew member. It becomes `memory/<agent>/role.md`, a plain file the user can edit later. Nothing is predefined: there are no role presets.

**Sections, each mapping to a kernel mechanism:** Identity (name, silhouette, hue), Persona (voice and judgement in one or two lines), Duties (plain English; Wright turns each into playbooks), Tools (the connectors this agent may call, each showing connected or not connected), Boundaries (what it may never do, on top of the kernel's fixed rails), Model, Limits (tokens per day and sessions at once), and the first playbook's dry run.

**Proposed values are marked.** Anything Wright chose rather than the user (the name, model, limits) carries a `proposed` tag in `ink-tertiary`, because policy is the user's (D4).

**Not-connected tools are allowed.** The agent can be created with them; its playbooks stay parked and the create toast says exactly which connector to add. Tools are chosen in their own picker dialog (name, one-line purpose, connection state, Connect), never as a checkbox row inside the charter form.

**Limits, not budgets.** On the Claude subscription the kernel cannot meter dollars; it meters tokens and sessions and parks work at the daily limit and at the weekly cap (D17). The charter, Team cards and the inspector therefore show tokens per day; dollar figures anywhere are labelled "≈ at API rates" and appear only as estimates.

**Actions:** Create (primary, `⏎`), Edit in English (`E`), a shape picker. Creating adds the agent to Crew with an empty thread, posts an event line in Wright's thread, and selects it on Team.

**Don't:** offer role presets; hide not-connected tools; show a dollar budget as if it were enforced; create an agent without showing its boundaries.
