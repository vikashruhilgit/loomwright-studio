# 16 — Who owns the PR-review duty: Wright or a reviewer crew member

## Status: ready

**Priority:** MVP · ROADMAP phase 6 · D22, invariants 1 and 3 · owner chose B (2026-10-29)

**As** the owner,
**I want** the one-sentence review duty to land on the agent I expect, with a GitHub grant I chose,
**so that** Wright doesn't take on GitHub read access as a side effect of a duty I meant for a reviewer.

## Problem

Found in the first live run (2026-10-29). Given the runbook's sentence, "Review every open PR on vikashruhilgit/studio-sandbox when it changes. Check every 2 minutes. Draft only.", Wright drafted **no reviewer charter**. It created playbook 5 owned by `wright` itself. Its first dry run stopped `needs_github`, and Wright asked the owner to add `"github"` to `connectors` in `wright.json`. The owner chose to grant it for this run. `connectors: ["github"]` and the four `mcp__kernel__kernel_github_pr_*` tools were added to `~/.loomwright-studio/config/agents/wright.json`. After that, stages 2, 4, 5, 7 and 8 passed.

This adds to the open finding in `docs/OPEN_QUESTIONS.md` ("The shipped guidance and the playbook rule disagree on order"). The guidance in `kernel/src/brain/templates.ts` tells Wright to draft a reviewer charter and then its playbook in the same turn. A crew member's playbook is refused until the charter is approved (`kernel/src/playbooks/drafts.ts`). A real model took the path that works, which is to own the duty itself.

## Owner decision (2026-10-29): B

The owner chose B after the first live run. Root cause found while fixing it: the installed `memory/wright/role.md` predates the crew and duty guidance, and the kernel never rewrites it. Fixed on PR https://github.com/vikashruhilgit/loomwright-studio/pull/164.

### The options as written

- **A.** Wright may own review duties. Document that the owner grants `github` in `wright.json`, and update the runbook and guidance to match.
- **B.** Review duties belong to a crew member. Make the guidance and the rule agree: draft the playbook after the charter's approval, or allow a playbook held for a pending charter. Wright then keeps no GitHub grant.

## Scope (after the decision)

- **For B:** fix the order in `kernel/src/brain/templates.ts` or `kernel/src/playbooks/drafts.ts`, and pin it in `kernel/test/phase-6-exit.test.ts`.
- **For either:** update `docs/evidence/phase-6-exit-runbook.md` steps 1 and 2 to the chosen path, and close the open-questions entry.

## Acceptance criteria

- [ ] The decision is recorded in `docs/DECISIONS.md` or in this item.
- [ ] The runbook's sentence leads, in the deterministic test, to the chosen owner agent with a GitHub grant the owner set.
