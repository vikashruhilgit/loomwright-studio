# Vision

## The one-line version

Grok Bot built on Claude and Loomwright, for developers first: a named AI partner that owns your work queue, remembers, runs on schedules and events, and directs a crew of specialists you define yourself, from a code reviewer to a personal assistant (D22). Unlike Grok Bot, its memory is inspectable, every agent is its own security boundary, and it runs locally next to your code.

## What the owner asked for (2026-09-26 → 28)

- A partner agent with **memory** and **task tables**.
- It **starts and stops itself**, handles its own sessions, and knows how to look after assigned tasks.
- It can be **killed** when needed and **started** on request.
- It is aware of its **role and responsibilities**.
- It can set up **schedules, hooks, triggers**, and more.
- **Any number of tasks**, for example:
  - "Find PRs where I'm the requested reviewer, run a review agent, and post the review."
  - "Work these tickets: open PRs, track each one (2 approvals to merge), and when a person or CI bot reviews, check whether the feedback is valid, fix what's needed, and ask for re-review."
- **Nothing predefined.** Wright builds every behaviour from the user's requirements.
- **A GUI app with no compromise on UI quality.**
- **Deep Loomwright integration:** it knows how to use Loomwright and stays aware of new Loomwright features and updates.
- **Multiple agents with identities**, the way Grok Bot gives each bot one.
- **Possible commercialisation** once it's proven through the owner's own daily use.

## Who it's for

First, the owner: dogfooding. Later, developers who want an always-on partner for PR review, ticket-to-PR delivery, and repo chores, with control and transparency.

## What makes it different

Compared with Grok Bot (see `research/GROK_BOT.md`) and the crowded agent-tool space found during naming research:

1. **Built on a real workflow engine.** Loomwright's review, heal, and merge gates are hardened by incident history, not a thin prompt.
2. **Inspectable memory.** Plain files the user can read, edit, and version. Grok Bot's memory can't be inspected, corrected, exported, or deleted.
3. **Each agent is a real security boundary.** Grok's bots share one VM and one set of credentials. Here a comment-only reviewer can't push code, even if a PR it reads contains planted instructions.
4. **Local-first.** Code, memory, and tasks stay on the user's machine. Internal tools and private MCP servers work; Grok requires custom MCP servers to be publicly reachable.
5. **User-defined everything.** Behaviour is authored from plain English and approved after a dry run. No fixed product workflows.

## What it is not

- Not a chatbot. A partner that owns work.
- Not a replacement for Loomwright. Studio *uses* Loomwright as its engine and crew.
- Not autonomous without consent. Outward or persistent actions go through approvals until the user loosens them, per playbook, never globally.
