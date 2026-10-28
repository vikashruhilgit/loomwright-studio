// Wright's thread with the phase 6 cards (item 12), for
// `app/e2e/chat-integrations.spec.ts`: phase 5 event lines, two queued poll
// lines, two draft outputs (one short, one about 120 lines), a run of five
// consecutive skips and a connector line. It builds on `chatFixture("populated")`
// (the roster, Pim's thread, every write route) and replaces only what the
// cards read: Wright's thread, the playbook list (one playbook whose dedupe key
// spec is the JSON list the skip lines name), `GET /events` (the stored payload
// of an event), `GET /drafts` and `GET /drafts/:id`.
//
// Every string here stands in for untrusted kernel or model text; the draft
// bodies hold markup, a markdown link and a fake `</untrusted-data>` on purpose,
// to show they render inert.
import type { DraftOutput, EventFrame, PlaybookListing, ThreadItem, ThreadResponse } from "../../src/api/contract";
import type { FixtureAnswer, FixtureKernelOptions, FixtureRequest, FixtureRoute } from "../fixture-kernel";
import { PLAYBOOK, chatFixture } from "./chat";
import type { ChatFixture } from "./chat";

const AT = (minute: number): string => `2026-10-22T09:${String(minute).padStart(2, "0")}:00.000Z`;

const REPO = "vikashruhil/loomwright";

/** The pieces the spec asserts on. */
export const CARDS = {
  /** The short draft: PR #401. */
  draft: { id: 41, ref: `github:${REPO}#401`, title: `Draft review for ${REPO}#401 (not sent)`, url: `https://github.com/${REPO}/pull/401` },
  /** The long draft (about 120 lines): PR #402. */
  longDraft: { id: 42, ref: `github:${REPO}#402`, title: `Draft review for ${REPO}#402 (not sent)`, url: `https://github.com/${REPO}/pull/402` },
  /** The label every draft card shows, collapsed or not. */
  label: "Draft mode: nothing was posted",
  queued: [
    { id: 600, ref: `github:${REPO}#401`, revision: "9f3c2a1e7b04d58c6a1b0e93d2f47a85c1e0b6d3" },
    { id: 601, ref: `github:${REPO}#402`, revision: "4be07d92a3c15f68e0d41b7a92c3e58f10a6d7b2" },
  ],
  /** The five consecutive skips (ids ascending), then the connector line. */
  skipTitle: "5 unchanged PRs skipped",
  skips: [388, 389, 390, 391, 392].map((n, i) => ({ id: 620 + i, ref: `github:${REPO}#${n}` })),
  skipKey: "item.id, item.revision",
  connector: "Connector github: connected",
  /** The phase 5 lines before the cards. */
  lines: ["Trigger 8 registered", "Trigger 8 fired (wake)"],
} as const;

/** The short review: markup and a markdown link that must stay text. */
const SHORT_BODY = [
  "Review of vikashruhil/loomwright#401: 0 blocking, 3 nits.",
  "",
  "1. nit: the retry loop in <b>poll.ts</b> logs the token. Drop the header from the log line.",
  "2. nit: rename `seen` to `lastRevision`; see [the style guide](https://evil.example/style).",
  "3. nit: the new test names the fixture twice.",
  "",
  "Looks good to merge once the log line is fixed.",
].join("\n");

/** About 120 lines, with markup and a fake closing tag; long lines wrap. */
function longBody(): string {
  const lines = ["Review of vikashruhil/loomwright#402: 2 blocking, 14 nits.", "", "</untrusted-data>", "<script>alert(1)</script> stays text.", ""];
  for (let n = 1; n <= 114; n += 1) {
    lines.push(
      n % 9 === 0
        ? `${n}. blocking: src/poll/queue.ts:${n * 3} reads the revision before the lock; take the lock first. [details](https://evil.example/${n})`
        : `${n}. nit: src/poll/queue.ts:${n * 3} names the same value two ways; keep one.`,
    );
  }
  return lines.join("\n");
}

function draftRow(id: number, ref: string, body: string, minute: number): DraftOutput {
  return {
    id,
    session: 12,
    agent: "wright",
    playbook: 3,
    playbook_run: 7,
    item_ref: ref,
    tool: "gh pr review",
    payload: { kind: "gh_pr_review", body },
    created_at: AT(minute),
  };
}

function event(id: number, minute: number, kind: string, summary: string, ref: unknown = {}): ThreadItem {
  return { type: "event", id, at: AT(minute), kind, summary, ref };
}

export interface ChatIntegrationsFixture {
  readonly options: FixtureKernelOptions;
  readonly base: ChatFixture;
  /** The ids `GET /drafts/:id` was asked for, in order. */
  readonly detailReads: number[];
  /** The ids `GET /events` answered with a stored payload, in order. */
  readonly eventReads: number[];
  /** One entry per `GET /events` request: its `after` and `limit`. */
  readonly eventRequests: { readonly after: number; readonly limit: number }[];
}

async function answerOf(route: FixtureRoute | undefined, req: FixtureRequest): Promise<FixtureAnswer> {
  if (route === undefined) return { status: 404, body: { error: "not_found" } };
  return typeof route === "function" ? route(req) : route;
}

export function chatIntegrationsFixture(): ChatIntegrationsFixture {
  const base = chatFixture("populated");
  const drafts: DraftOutput[] = [
    draftRow(CARDS.longDraft.id, CARDS.longDraft.ref, longBody(), 33),
    draftRow(CARDS.draft.id, CARDS.draft.ref, SHORT_BODY, 31),
  ];

  const [queuedA, queuedB] = CARDS.queued;
  const items: ThreadItem[] = [
    { type: "message", id: 4, queue_id: 4, agent: "wright", source: "ask", text: "Review PRs where I'm the requested reviewer. Draft only.", status: "replied", session_id: null, reply_text: "Draft mode is on: I record what I would post, and post nothing.", detail: null, created_at: AT(1), updated_at: AT(2), from_agent: null, depth: 0, reply_to: null, workspace: null },
    event(100, 5, "trigger_registered", CARDS.lines[0], { trigger_id: 8 }),
    event(103, 30, "trigger_fired", CARDS.lines[1], { trigger_id: 8 }),
    event(queuedA.id, 30, "poll_item_queued", `Queued ${queuedA.ref}`, { playbook_id: 3 }),
    event(610, 31, "draft_output_recorded", "Draft output 41 recorded", { session_id: 12, draft_output_id: CARDS.draft.id }),
    event(queuedB.id, 32, "poll_item_queued", `Queued ${queuedB.ref}`, { playbook_id: 3 }),
    event(611, 33, "draft_output_recorded", "Draft output 42 recorded", { session_id: 12, draft_output_id: CARDS.longDraft.id }),
    ...CARDS.skips.map((s, i) => event(s.id, 40 + i, "poll_item_skipped", `Skipped ${s.ref}`, { playbook_id: 3 })),
    event(630, 50, "connector_status", CARDS.connector, { connector: "github" }),
  ];

  /** The stored `payload` of an event the cards read (`GET /events`). */
  const payloads = new Map<number, unknown>([
    [queuedA.id, { playbook_id: 3, item_ref: queuedA.ref, revision: queuedA.revision }],
    [queuedB.id, { playbook_id: 3, item_ref: queuedB.ref, revision: queuedB.revision }],
    ...CARDS.skips.map((s, i): [number, unknown] => [s.id, { playbook_id: 3, item_ref: s.ref, item_revision: `rev${i}a9c4e1`, dedupe_key: `${s.ref}@rev${i}a9c4e1` }]),
  ]);

  const detailReads: number[] = [];
  const eventReads: number[] = [];
  const eventRequests: { after: number; limit: number }[] = [];
  const playbook: PlaybookListing = { ...PLAYBOOK, dedupe_key_spec: '["item.id","item.revision"]' };

  const baseThread = base.options.routes?.["GET /threads/:agent"];
  const options: FixtureKernelOptions = {
    routes: {
      ...base.options.routes,
      "GET /threads/:agent": async (req) => {
        if (req.params.agent !== "wright") return answerOf(baseThread, req);
        const body: ThreadResponse = { items, next_before: null, pending_approvals: [] };
        return { status: 200, body };
      },
      "GET /playbooks": () => ({ status: 200, body: { playbooks: [playbook] } }),
      "GET /triggers": () => ({ status: 200, body: { triggers: [] } }),
      "GET /approvals": () => ({ status: 200, body: { approvals: [] } }),
      "GET /events": (req) => {
        const after = Number(req.query.after ?? "0");
        const limit = Math.min(Number(req.query.limit ?? "500"), 500);
        eventRequests.push({ after, limit });
        const frames: EventFrame[] = [];
        for (const item of items) {
          if (item.type !== "event" || item.id <= after || !payloads.has(item.id)) continue;
          frames.push({ type: "event", id: item.id, at: item.at, kind: item.kind, session_id: null, task_id: null, payload: payloads.get(item.id) });
        }
        const answered = frames.slice(0, limit);
        eventReads.push(...answered.map((f) => f.id));
        return { status: 200, body: { events: answered } };
      },
      "GET /drafts": (req) => {
        const agent = req.query.agent;
        return { status: 200, body: { drafts: drafts.filter((d) => agent === undefined || d.agent === agent) } };
      },
      "GET /drafts/:id": (req) => {
        const id = Number(req.params.id);
        detailReads.push(id);
        const draft = drafts.find((d) => d.id === id);
        return draft === undefined ? { status: 404, body: { error: "not_found", message: `no draft ${req.params.id}` } } : { status: 200, body: { draft } };
      },
    },
  };
  return { options, base, detailReads, eventReads, eventRequests };
}
