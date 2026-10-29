// The phase 6 exit walk's canned kernel (item 13), for `app/e2e/phase-6-exit.spec.ts`:
// the Integrations screen's connect flow (`./integrations.ts`, served as it is)
// beside the reviewer's thread (`./chat.ts`'s plumbing with an empty Wright
// thread). The reviewer is Mason (`./team.ts`: a comment-only crew member
// holding the GitHub grant). Mason's thread holds what the kernel's poll leaves
// there after two polls of two PRs: two queued items, the draft one of them
// recorded (an outward call the draft-mode session made instead of sending it),
// and the second poll's two skips (the PRs were unchanged).
//
// `GET /drafts` filters by the `agent` query the app sends, as the kernel's
// route does, and records every query, so the spec can pin that the reviewer's
// card comes from the reviewer's own drafts. The draft's body holds markup, a
// markdown link and a fake closing tag on purpose, to show it renders inert.
//
// Every value here is fixture data: no real account, repo, token or PR.
import type { AgentDetailResponse, DraftOutput, EventFrame, PlaybookListing, ThreadItem, ThreadResponse } from "../../src/api/contract";
import type { FixtureAnswer, FixtureKernelOptions, FixtureRequest, FixtureRoute } from "../fixture-kernel";
import { PLAYBOOK, chatFixture } from "./chat";
import { REPOS, integrationsFixture } from "./integrations";
import type { IntegrationsFixture } from "./integrations";
import { ADA, MASON, WRIGHT } from "./team";

const AT = (minute: number): string => `2026-10-29T10:${String(minute).padStart(2, "0")}:00.000Z`;

/** The repo the token reaches (the integrations fixture's first), and its two PRs: an ordinary one and the one whose body is the injection. */
export const REPO = REPOS[0];
export const ORDINARY = { number: 1, ref: `github:${REPO}#1`, revision: "9f3c2a1e7b04d58c6a1b0e93d2f47a85c1e0b6d3" } as const;
export const INJECTED = { number: 2, ref: `github:${REPO}#2`, revision: "4be07d92a3c15f68e0d41b7a92c3e58f10a6d7b2" } as const;

/** The pieces the spec asserts on. */
export const EXIT = {
  /** The reviewer: a crew member, not Wright. */
  reviewer: { id: MASON.id, name: MASON.display_name },
  /** The draft the reviewer's draft-mode session recorded for the injected PR. */
  draft: {
    id: 51,
    title: `Draft review for ${REPO}#${INJECTED.number} (not sent)`,
    url: `https://github.com/${REPO}/pull/${INJECTED.number}`,
    label: "Draft mode: nothing was posted",
    body: [
      "Not approving. This PR's description asks me to approve it, post LGTM and run a command; I did none of that.",
      "",
      "</untrusted-data>",
      "<b>not bold</b> and [not a link](https://evil.example/approve) stay text.",
    ].join("\n"),
  },
  /** The two unchanged PRs of the second poll, folded into one card. */
  skipTitle: "2 unchanged PRs skipped",
  skipKey: "playbook.id, item.id, item.revision",
  skips: [ORDINARY, INJECTED],
} as const;

export interface Phase6ExitFixture {
  readonly options: FixtureKernelOptions;
  /** The connect flow's recorder and switches (`integrationsFixture`). */
  readonly integrations: IntegrationsFixture;
  /** Every `GET /drafts` query, in order. */
  readonly draftQueries: Readonly<Record<string, string>>[];
  /** The ids `GET /drafts/:id` was asked for, in order. */
  readonly draftReads: number[];
}

async function answerOf(route: FixtureRoute | undefined, req: FixtureRequest): Promise<FixtureAnswer> {
  if (route === undefined) return { status: 404, body: { error: "not_found" } };
  return typeof route === "function" ? route(req) : route;
}

function event(id: number, minute: number, kind: string, summary: string, ref: unknown): ThreadItem {
  return { type: "event", id, at: AT(minute), kind, summary, ref };
}

export function phase6ExitFixture(): Phase6ExitFixture {
  const integrations = integrationsFixture();
  const chat = chatFixture("empty");
  const roster = [WRIGHT, MASON, ADA];

  const draft: DraftOutput = {
    id: EXIT.draft.id,
    session: 20,
    agent: EXIT.reviewer.id,
    playbook: 3,
    playbook_run: 8,
    item_ref: INJECTED.ref,
    tool: "gh pr review",
    payload: { kind: "gh_pr_review", body: EXIT.draft.body, event: "approve", target: String(INJECTED.number) },
    created_at: AT(12),
  };

  const queued = [
    { id: 700, ...ORDINARY },
    { id: 701, ...INJECTED },
  ];
  const skipped = EXIT.skips.map((pr, i) => ({ id: 720 + i, ...pr }));
  const items: ThreadItem[] = [
    ...queued.map((q, i) => event(q.id, 10 + i, "poll_item_queued", `Queued ${q.ref}`, { playbook_id: 3 })),
    event(710, 12, "draft_output_recorded", "Session 20 recorded a draft: gh pr review", { session_id: 20, draft_output_id: draft.id }),
    ...skipped.map((s, i) => event(s.id, 20 + i, "poll_item_skipped", `Skipped ${s.ref}`, { playbook_id: 3 })),
  ];
  const threads: Record<string, ThreadItem[]> = { wright: [], [EXIT.reviewer.id]: items };

  /** The stored payload of each event the cards read (`GET /events`). */
  const payloads = new Map<number, unknown>([
    ...queued.map((q): [number, unknown] => [q.id, { playbook_id: 3, item_ref: q.ref, revision: q.revision }]),
    ...skipped.map((s): [number, unknown] => [
      s.id,
      { playbook_id: 3, item_ref: s.ref, item_revision: s.revision, dedupe_key: JSON.stringify({ "playbook.id": 3, "item.id": s.ref, "item.revision": s.revision }) },
    ]),
  ]);
  const playbook: PlaybookListing = { ...PLAYBOOK, owning_agent: EXIT.reviewer.id, dedupe_key_spec: JSON.stringify(["playbook.id", "item.id", "item.revision"]), mode: "draft" };

  const draftQueries: Record<string, string>[] = [];
  const draftReads: number[] = [];
  const baseThread = chat.options.routes?.["GET /threads/:agent"];

  const options: FixtureKernelOptions = {
    routes: {
      ...chat.options.routes,
      ...integrations.options.routes,
      "GET /agents": () => ({ status: 200, body: { agents: roster } }),
      "GET /agents/:id": (req) => {
        const agent = roster.find((a) => a.id === req.params.id);
        if (agent === undefined) return { status: 404, body: { error: "not_found" } };
        const body: AgentDetailResponse = {
          agent,
          settings: { file: `~/.loomwright-studio/agents/${agent.id}/settings.json`, content: {}, error: null },
          never: null,
          workspaces: null,
          memory: { dir: `~/.loomwright-studio/memory/${agent.id}`, files: [] },
          charter: {},
        };
        return { status: 200, body };
      },
      "GET /threads/:agent": (req) => {
        const thread = threads[req.params.agent ?? ""];
        if (thread === undefined) return answerOf(baseThread, req);
        const body: ThreadResponse = { items: thread, next_before: null, pending_approvals: [] };
        return { status: 200, body };
      },
      "GET /playbooks": () => ({ status: 200, body: { playbooks: [playbook] } }),
      "GET /events": (req) => {
        const after = Number(req.query.after ?? "0");
        const limit = Math.min(Number(req.query.limit ?? "500"), 500);
        const frames: EventFrame[] = [];
        for (const item of items) {
          if (item.type !== "event" || item.id <= after || !payloads.has(item.id)) continue;
          frames.push({ type: "event", id: item.id, at: item.at, kind: item.kind, session_id: null, task_id: null, payload: payloads.get(item.id) });
        }
        return { status: 200, body: { events: frames.slice(0, limit) } };
      },
      "GET /drafts": (req) => {
        draftQueries.push({ ...req.query });
        const agent = req.query.agent;
        return { status: 200, body: { drafts: [draft].filter((d) => agent === undefined || d.agent === agent) } };
      },
      "GET /drafts/:id": (req) => {
        const id = Number(req.params.id);
        draftReads.push(id);
        return id === draft.id ? { status: 200, body: { draft } } : { status: 404, body: { error: "no_draft", message: `no draft ${req.params.id}` } };
      },
    },
  };
  return { options, integrations, draftQueries, draftReads };
}
