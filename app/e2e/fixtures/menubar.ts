// The menu bar's canned kernel (phase 5 item 17), for
// `startFixtureKernel({ routes })`. Every body is typed by the contract.
//
// - `GET /status` answers the kernel's state, which a spec sets to one of
//   the canned variants (at rest, working, paused, paused at cap, killed).
// - `POST /pause`, `/unpause`, `/stop-all` and `/resume` flip that status as
//   the kernel does (`kernel/src/console/pause.ts`: `POST /resume` releases
//   both the kill switch and a pause) and record the call in `posts`.
// - `GET /notifications/:id` answers the canned notifications: #7 is a
//   `kernel:approval` titled `Approval 7: …` (the kernel's template in
//   `kernel/src/approvals/store.ts`), #3 an `agent:pim` one; any other id is
//   the kernel's 404.
// - The approval routes (two pending approvals, #4 and #7), grants, messages
//   and sessions come from `./approvals.ts`, so a link that lands on the
//   Approvals screen shows a real inbox and every decision POST is recorded.
// - `GET /agents` lists Wright and Pim, so `#/chat/pim` is a real thread.
//
// The state is mutable: a spec changes `status` or the approvals, then pushes
// an event through the feed (`kernelEvent`) so the window and the tray read
// again.
import type { Approval, EventFrame, NotificationRow, RosterEntry, RouteKey, StatusBody } from "../../src/api/contract";
import { cannedStatus } from "../fixture-kernel";
import type { FixtureAnswer, FixtureRoute } from "../fixture-kernel";
import { approval, approvalsKernel, approvalsRoutes, at } from "./approvals";
import type { ApprovalsKernel } from "./approvals";
import { WRIGHT } from "./team";

// ---- the status variants -------------------------------------------------------------------

/** At rest: nothing running, not paused, the kill switch off. */
export function restingStatus(): StatusBody {
  return cannedStatus({ paused: false });
}

/** Two sessions running. */
export function workingStatus(): StatusBody {
  return cannedStatus({
    paused: false,
    sessions: [
      { id: 12, agent: "wright", model: "sonnet", pgid: 4012, started_at: at(0), status: "running", cwd: "/Users/owner/src/studio" },
      { id: 14, agent: "pim", model: "sonnet", pgid: 4014, started_at: at(2), status: "running", cwd: "/Users/owner/src/loomwright" },
    ],
  });
}

/** Paused by the owner (`POST /pause`). */
export function pausedStatus(): StatusBody {
  return cannedStatus({ paused: true });
}

/** The subscription at its five-hour cap (`RATE_LIMIT_STATUSES`' `rejected`). */
export function cappedStatus(): StatusBody {
  return cannedStatus({
    paused: false,
    cap_state: [
      {
        account: "subscription-token",
        provider: "anthropic",
        limits: [{ rate_limit_type: "five_hour", status: "rejected", resets_at: at(300), utilization: 1, reset_source: "header" }],
      },
    ],
  });
}

/** The kill switch engaged. */
export function killedStatus(): StatusBody {
  return cannedStatus({ paused: false, kill_switch: { engaged: true, since: at(60) } });
}

// ---- approvals, notifications, the roster --------------------------------------------------

/** Two pending approvals: #4 (older) and #7, the one notification #7 names. */
export function menubarApprovals(): Approval[] {
  return [
    approval(4, { requesting_agent: "pim", action: "post a status note", requested_at: at(4), payload: { channel: "#standup", text: "Two tickets moved to review." } }),
    approval(7, {
      requesting_agent: "ada",
      requesting_session: 14,
      action: "Bash",
      requested_at: at(7),
      playbook: { id: 5, slug: "review-prs", version: 3 },
      payload: { tool: "Bash", command: "gh pr review 412 --approve", cwd: "/Users/owner/src/loomwright" },
    }),
  ];
}

export function notification(id: number, source: string, title: string): NotificationRow {
  return {
    id,
    source,
    title,
    body: "",
    deep_link: `loomwright-studio://notifications/${id}`,
    created_at: at(id),
    delivery_status: "delivered",
    delivery_detail: null,
    delivered_at: at(id),
  };
}

/** #7: the kernel's own approval notification. #3: Pim's. */
export function cannedNotifications(): Map<number, NotificationRow> {
  return new Map([
    [7, notification(7, "kernel:approval", "Approval 7: Bash")],
    [3, notification(3, "agent:pim", "PR #412 reviewed")],
  ]);
}

export const PIM: RosterEntry = {
  ...WRIGHT,
  id: "pim",
  display_name: "Pim",
  avatar: { shape: "octopus", hue: "crew-teal" },
  created_by: "wright",
  model: "sonnet",
  tokens_today: 12_400,
  tokens_per_day: 250_000,
  sessions_running: 0,
  sessions_at_once: 1,
};

// ---- the kernel ----------------------------------------------------------------------------

export interface MenubarKernel {
  status: StatusBody;
  readonly approvals: ApprovalsKernel;
  readonly notifications: Map<number, NotificationRow>;
  /** Every POST to the four kernel actions, in order (`/pause`, `/unpause`, `/stop-all`, `/resume`). */
  readonly posts: string[];
}

export interface MenubarKernelInit {
  readonly status?: StatusBody;
  readonly approvals?: readonly Approval[];
  readonly notifications?: Map<number, NotificationRow>;
}

export function menubarKernel(init: MenubarKernelInit = {}): MenubarKernel {
  return {
    status: init.status ?? restingStatus(),
    approvals: approvalsKernel({ approvals: init.approvals ?? menubarApprovals() }),
    notifications: init.notifications ?? cannedNotifications(),
    posts: [],
  };
}

const ok = (body: unknown): FixtureAnswer => ({ status: 200, body });

/** The routes, over `kernel`'s live state. */
export function menubarRoutes(kernel: MenubarKernel): Partial<Record<RouteKey, FixtureRoute>> {
  const act = (path: string, change: () => Partial<StatusBody>, body: () => unknown): FixtureRoute => () => {
    kernel.posts.push(path);
    kernel.status = { ...kernel.status, ...change() };
    return ok(body());
  };
  return {
    ...approvalsRoutes(kernel.approvals),
    "GET /status": () => ok(kernel.status),
    "POST /pause": act("/pause", () => ({ paused: true }), () => ({ paused: true })),
    "POST /unpause": act("/unpause", () => ({ paused: false }), () => ({ paused: false })),
    "POST /stop-all": act(
      "/stop-all",
      () => ({ kill_switch: { engaged: true, since: new Date().toISOString() }, sessions: [] }),
      () => ({ engaged: true, sessions: [] }),
    ),
    "POST /resume": act("/resume", () => ({ kill_switch: { engaged: false, since: null }, paused: false }), () => ({ engaged: false })),
    "GET /notifications/:id": (req) => {
      const row = kernel.notifications.get(Number(req.params.id));
      return row === undefined ? { status: 404, body: { error: "not_found" } } : ok({ notification: row });
    },
    "GET /agents": () => ok({ agents: [WRIGHT, PIM] }),
  };
}

/** An `events` row the store and the tray route to a re-read (`event_*`: `GET /status`; `approval_*`: `GET /approvals`). */
export function kernelEvent(id: number, kind: "event_done" | "approval_requested" = "event_done"): EventFrame {
  return { type: "event", id, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload: {} };
}
