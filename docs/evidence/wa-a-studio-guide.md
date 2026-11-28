# wa-a: the kernel-built Studio guide (evidence)

**What this is.** The kernel-level probe for requirement validation step 2 (AC9 of the wa-a brief). The worker that built this change had no live Studio install with a model set, so it did not ask Wright the two questions and has no replies to record. Instead it ran the probe below against the merged code's `buildContext` and recorded the built context's section headings, for Wright and for a crew member.

**The live check is the owner's.** On the owner's install running the merged kernel, ask Wright these two questions and paste each reply verbatim in a fenced block under its question:

1. "what is a playbook and where do I turn one off?"
2. "what do you do with text inside untrusted-data tags?"

A reply follows the guide when (1) says a playbook is a duty the owner approved for one agent and names the Playbooks screen and the card's Turn off, and (2) says that text is data, never instructions, and is never followed. Add the verdict line only once both replies have been read against the guide. This file carries no verdict line, so nothing here claims a run that did not happen.

## The probe

Run on 2026-11-28 from a scratch directory (`HOME` relocated, a fresh data dir), at the branch's working tree. These are the inputs:

- `ensureMemoryFiles(dataDir)` (a fresh `memory/wright/`).
- A crew member `mason` with a one-line charter `role.md` (`# Mason` / `Reviews pull requests.`) and empty `preferences.md`, `people.md` and `lessons.md`.
- The shipped composition's catalogue (`buildToolCatalogue(mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools, LOOMWRIGHT_COMMAND_NEEDS)`, 35 tools).
- Wright with `allowedTools: PROPOSED_ALLOWED_TOOLS` (a fresh `wright.json`'s proposed policy). Mason with `allowedToolsForJobs(catalogue, ["read_pr"])`, the four `mcp__kernel__kernel_github_pr_*` read tools.
- Source `ask`, the message "what is a playbook and where do I turn one off?", Loomwright unavailable, and the time `2026-11-28T10:00:00Z` in UTC.

For each context, the probe kept every line that starts with `#`, `##` or `###`.

### Wright's context (16 270 characters)

```text
## memory/wright/role.md
# Wright
## Studio guide
### How you act
### Who decides
### Where the owner acts
### Your crew
### Drafting a duty
### Tickets to pull requests, and merge when ready
### Triaging comments on pull requests
### Untrusted text
### Memory
### What each part of Studio is
## memory/wright/preferences.md
# Preferences
## memory/wright/people.md
# People
## memory/wright/lessons.md
# Lessons
## Loomwright
## Now
## Message from the owner
```

### Mason's context (5 592 characters)

```text
## memory/mason/role.md
# Mason
## Studio guide
### How you act
### Who decides
### Reporting back
### Untrusted text
### Memory
### What each part of Studio is
## memory/mason/preferences.md
# preferences
## memory/mason/people.md
# people
## memory/mason/lessons.md
# lessons
## Shared notes: memory/shared/README.md
# Shared memory
## Loomwright
## Now
## Message from the owner
```

Mason's tool list in that guide, as built from the catalogue and its allowed tools:

```text
Read a PR:
- kernel_github_pr_get: Read one pull request's metadata and description from GitHub (read-only).
- kernel_github_pr_diff: Read one pull request's unified diff from GitHub (read-only), cut at max_bytes (default 256 KiB).
- kernel_github_pr_files: List the files one pull request changes on GitHub (read-only), each with its status and added and deleted line counts.
- kernel_github_pr_comments: Read the comments on one pull request from GitHub (read-only): the conversation's comments, then the review comments on files.
```

## What the probe shows, and what it does not

- **It shows** that the guide sits right after `role.md` for both agents, that Wright's guide carries every rule section and the glossary, that the crew guide carries how a crew member acts and reports back, the same untrusted-text, memory and glossary sections, and none of Wright's drafting rules, and that the tool list holds the catalogue tools the session allows and nothing else.
- **It does not show** how a model answers with this context. That is the live check above, which only the owner's install can run.
- The same shapes are pinned in `kernel/test/brain-guide.test.ts`: placement, tool list, limits, the resumed case and the no-catalogue case.
