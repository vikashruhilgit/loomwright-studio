// The Playbooks screen's canned kernel (phase 7 item 04), for
// `startFixtureKernel({ routes })`, merged over `fixture-kernel.ts`'s defaults. It
// is a small stateful kernel: the data is the three playbooks of the GUI v2 mockup,
// and every write changes it the way the kernel does where the screen can tell
// (`kernel/src/playbooks/store.ts`, `drafts.ts`):
//
// - `GET /playbooks` lists them (`all=1` is the app's read), `GET /triggers` their
//   triggers, `GET /approvals` the pending approvals.
// - `GET /playbooks/:id/runs` is newest first (`limit` honoured) and
//   `GET /playbooks/:id/versions` newest first, with snapshots that predate `mode`.
// - `POST /playbooks/:id/set` takes ONE `{field, value}` (the five owner-settable
//   fields, `parseOwnerPolicyValue`'s rules) and writes one version; an unchanged value
//   answers `changed: false`, an enabled playbook becomes a draft again, a refused value
//   answers 400 `invalid_input` with the kernel's own message.
// - `POST /playbooks/:id/off` disables; `POST /playbooks/:id/run` answers 409
//   `not_enabled` for a playbook that is not on, and whatever `runRefusal` holds.
//
// There is no enable route, as in the kernel: a playbook turns on only through an
// approval, so a spec that wants one on edits `kernel.playbooks` itself.
//
// Every POST is recorded with its params and body, and `onChange` is called after each
// write with the event kind the kernel appends, so a spec can push it through the feed.
// Every string stands in for untrusted kernel or model text.
import type {
  Approval,
  EventFrame,
  PlaybookChangeResponse,
  PlaybookListing,
  PlaybookRun,
  PlaybookRunResponse,
  PlaybookRunsResponse,
  PlaybookVersion,
  PlaybookVersionsResponse,
  RosterEntry,
  RouteKey,
  ThreadResponse,
  Trigger,
} from "../../src/api/contract";
import type { FixtureAnswer, FixtureKernelOptions, FixtureRequest, FixtureRoute } from "../fixture-kernel";

/** The dedupe key's closed set (`DEDUPE_KEY_FIELDS` in kernel/src/playbooks/types.ts). */
export const DEDUPE_KEY_FIELDS = ["playbook.id", "playbook.version", "trigger.id", "trigger.scheduled_at", "date", "item.id", "item.revision"] as const;

/** The pieces the spec asserts on. */
export const PLAYBOOKS = {
  review: { id: 1, slug: "review-prs-studio-sandbox", name: "Review PRs on studio-sandbox" },
  weekly: { id: 2, slug: "weekly-changelog-draft", name: "Weekly changelog draft" },
  morning: { id: 3, slug: "morning-digest", name: "Morning digest" },
  /** The pending approval that holds the weekly playbook's enable. */
  enableApproval: { id: 9, display: "Enable playbook weekly-changelog-draft (v1)" },
} as const;

const AT = (day: number, hour: number, minute: number): string => `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

const WRIGHT: RosterEntry = {
  id: "wright",
  display_name: "Wright",
  avatar: { shape: "whale", hue: "crew-teal" },
  status: "on",
  created_by: null,
  approval_id: null,
  model: null,
  settings_error: null,
  tokens_today: 0,
  tokens_per_day: null,
  sessions_running: 0,
  sessions_at_once: null,
};

export interface RecordedPost {
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface PlaybooksKernel {
  playbooks: PlaybookListing[];
  triggers: Trigger[];
  approvals: Approval[];
  /** Every run, by playbook id, newest first. */
  readonly runs: Map<number, PlaybookRun[]>;
  /** Every version, by playbook id, newest first. */
  readonly versions: Map<number, PlaybookVersion[]>;
  /** Every POST, in order. */
  readonly posts: RecordedPost[];
  /** A refusal `POST /playbooks/:id/run` answers instead of queueing (`kill_switch_engaged`), or `undefined`. */
  runRefusal: { readonly error: string; readonly message: string } | undefined;
  /** Called with the event kind after a write. */
  onChange: (kind: string) => void;
}

export type PlaybooksFixtureState = "populated" | "waiting" | "empty";

export interface PlaybooksFixtureInit {
  readonly state?: PlaybooksFixtureState;
  /** `GET /playbooks` never answers: the screen's loading state. */
  readonly holdList?: boolean;
  /** `GET /playbooks` answers 500: the screen's error state. */
  readonly failList?: boolean;
}

export interface PlaybooksFixture {
  readonly options: FixtureKernelOptions;
  readonly kernel: PlaybooksKernel;
}

function playbookRow(overrides: Partial<PlaybookListing> & Pick<PlaybookListing, "id" | "slug" | "name">): PlaybookListing {
  return {
    owning_agent: "wright",
    intent: "",
    status: "enabled",
    version: 1,
    dedupe_key_spec: null,
    dedupe_key_set_by: null,
    priority: "normal",
    priority_set_by: null,
    model: null,
    model_set_by: null,
    effort: null,
    effort_set_by: null,
    token_limit_per_day: null,
    token_limit_set_by: null,
    api_key_fallback_json: null,
    api_key_fallback_set_by: null,
    mode: "draft",
    mode_set_by: null,
    created_at: AT(28, 15, 5),
    updated_at: AT(29, 10, 12),
    trigger_id: null,
    next_fire_at: null,
    ...overrides,
  };
}

function triggerRow(id: number, playbook: string, owner: string, kind: string, spec: unknown, overrides: Partial<Trigger> = {}): Trigger {
  return {
    id,
    owning_agent: owner,
    playbook,
    kind,
    spec,
    action: "playbook",
    text: `Run ${playbook}`,
    enabled: true,
    enabled_changed_by: null,
    enabled_changed_at: null,
    next_fire_at: null,
    last_fired_at: AT(30, 14, 10),
    last_result: "fired",
    created_by: "wright",
    created_at: AT(28, 15, 5),
    ...overrides,
  };
}

function runRow(id: number, playbook: number, version: number, kind: string, status: string, tokens: number | null, started: string, overrides: Partial<PlaybookRun> = {}): PlaybookRun {
  return { id, playbook, version, kind, status, item_ref: null, item_revision: null, tokens, session: null, started, ended: status === "running" ? null : started, ...overrides };
}

/** The mockup's three playbooks, with their triggers, runs and versions. */
function seed(state: PlaybooksFixtureState): Pick<PlaybooksKernel, "playbooks" | "triggers" | "approvals" | "runs" | "versions"> {
  if (state === "empty") return { playbooks: [], triggers: [], approvals: [], runs: new Map(), versions: new Map() };
  const review = playbookRow({
    ...PLAYBOOKS.review,
    owning_agent: "mason",
    intent: "When a PR opens or gets a new commit on studio-sandbox, read it and save a draft review for me. Never post a comment.",
    status: "enabled",
    version: 3,
    dedupe_key_spec: '["item.id","item.revision"]',
    dedupe_key_set_by: "owner",
    priority: "normal",
    priority_set_by: "owner",
    model: "sonnet",
    model_set_by: "wright",
    effort: "medium",
    effort_set_by: "wright",
    token_limit_per_day: 200000,
    token_limit_set_by: "owner",
    mode: "draft",
    mode_set_by: "wright",
    updated_at: AT(29, 10, 12),
    trigger_id: 5,
    next_fire_at: AT(30, 14, 30),
  });
  const weekly = playbookRow({
    ...PLAYBOOKS.weekly,
    owning_agent: "ada",
    intent: "Every Friday morning, read the commits since the last tag and draft the changelog entry as a file in the worktree.",
    // A draft only while its enable is held in Approvals (the `waiting` state); otherwise it is on.
    status: state === "waiting" ? "draft" : "enabled",
    version: 1,
    dedupe_key_spec: '["trigger.id","trigger.scheduled_at"]',
    dedupe_key_set_by: "wright",
    priority: "low",
    priority_set_by: "wright",
    model: "sonnet",
    model_set_by: "wright",
    effort: "medium",
    effort_set_by: "wright",
    token_limit_per_day: 100000,
    token_limit_set_by: "wright",
    mode: "draft",
    mode_set_by: "wright",
    created_at: AT(30, 11, 48),
    updated_at: AT(30, 11, 48),
    trigger_id: 6,
  });
  const morning = playbookRow({
    ...PLAYBOOKS.morning,
    intent: "On weekday mornings, tell me what finished overnight and what waits on me, in five lines or fewer.",
    status: "disabled",
    version: 2,
    dedupe_key_spec: '["playbook.id","date"]',
    dedupe_key_set_by: "wright",
    priority: "normal",
    priority_set_by: "owner",
    model: "haiku",
    model_set_by: "owner",
    effort: "low",
    effort_set_by: "wright",
    token_limit_per_day: 50000,
    token_limit_set_by: "owner",
    mode: "draft",
    mode_set_by: "wright",
    trigger_id: 7,
  });
  const triggers = [
    triggerRow(5, PLAYBOOKS.review.slug, "mason", "poll", { source: "github.pulls", repos: ["vikashruhilgit/studio-sandbox"], filters: { state: "open" }, interval_seconds: 600 }, { next_fire_at: AT(30, 14, 30) }),
    triggerRow(6, PLAYBOOKS.weekly.slug, "ada", "cron", { cron: "0 9 * * 5", tz: "UTC" }, { next_fire_at: "2026-11-06T09:00:00.000Z", last_fired_at: null, last_result: null }),
    triggerRow(7, PLAYBOOKS.morning.slug, "wright", "cron", { cron: "0 8 * * 1-5", tz: "UTC" }, { enabled: false, last_fired_at: AT(29, 8, 0) }),
  ];
  const runs = new Map<number, PlaybookRun[]>([
    [
      1,
      [
        runRow(16, 1, 3, "fire", "running", null, AT(30, 14, 10), { item_ref: "github:vikashruhilgit/studio-sandbox#14", item_revision: "b7e41c09a2f3d815" }),
        runRow(15, 1, 3, "fire", "done", 31870, AT(30, 13, 10), { item_ref: "github:vikashruhilgit/studio-sandbox#13", item_revision: "9f3c2a1e7b04d58c", session: 37 }),
        runRow(14, 1, 3, "fire", "failed", 2104, AT(30, 11, 42), { item_ref: "github:vikashruhilgit/studio-sandbox#12", item_revision: "4be07d92a3c15f68", session: 35 }),
      ],
    ],
    [2, [runRow(17, 2, 1, state === "waiting" ? "dry_run" : "fire", "running", null, AT(30, 14, 16))]],
    [3, [runRow(13, 3, 2, "fire", "done", 3210, AT(29, 8, 0), { session: 31 })]],
  ]);
  const snap = (p: PlaybookListing, extra: Partial<PlaybookListing>): PlaybookVersion["snapshot"] => ({ ...p, ...extra });
  // v1 and v2 predate the `mode` column: their snapshots do not carry it, and the screen reads it as unknown.
  const older = (p: PlaybookListing, extra: Partial<PlaybookListing>): PlaybookVersion["snapshot"] => {
    const { mode: _mode, mode_set_by: _modeBy, ...rest } = snap(p, extra) as PlaybookListing;
    return rest;
  };
  const versions = new Map<number, PlaybookVersion[]>([
    [
      1,
      [
        { playbook: 1, version: 3, snapshot: snap(review, {}), created_at: AT(29, 10, 12) },
        {
          playbook: 1,
          version: 2,
          snapshot: older(review, { priority: "low", priority_set_by: "owner", token_limit_per_day: 150000, token_limit_set_by: "owner" }),
          created_at: AT(28, 16, 40),
        },
        {
          playbook: 1,
          version: 1,
          snapshot: older(review, {
            priority: "low",
            priority_set_by: "owner",
            model: "haiku",
            model_set_by: "wright",
            token_limit_per_day: 150000,
            token_limit_set_by: "owner",
            intent: "When a PR opens or gets a new commit on studio-sandbox, read it and save a draft review for me.",
          }),
          created_at: AT(28, 15, 5),
        },
      ],
    ],
    [2, [{ playbook: 2, version: 1, snapshot: snap(weekly, {}), created_at: AT(30, 11, 48) }]],
    [
      3,
      [
        { playbook: 3, version: 2, snapshot: older(morning, {}), created_at: AT(28, 18, 30) },
        { playbook: 3, version: 1, snapshot: older(morning, { model: "sonnet", model_set_by: "wright", priority_set_by: "wright" }), created_at: AT(27, 9, 0) },
      ],
    ],
  ]);
  const approvals: Approval[] =
    state === "waiting"
      ? [
          {
            id: PLAYBOOKS.enableApproval.id,
            requesting_agent: "wright",
            requesting_session: 40,
            action: "kernel_playbook_enable",
            payload: { tool: "mcp__kernel__kernel_playbook_enable", input: { id: PLAYBOOKS.weekly.id, idempotency_key: "k" }, cwd: "/" },
            requested_at: AT(30, 14, 20),
            status: "pending",
            decision: null,
            decided_by: null,
            decided_at: null,
            playbook: null,
            display: PLAYBOOKS.enableApproval.display,
          },
        ]
      : [];
  return { playbooks: [review, weekly, morning], triggers, approvals, runs, versions };
}

const answer = (status: number, body: unknown): FixtureAnswer => ({ status, body });
const invalid = (message: string): FixtureAnswer => answer(400, { error: "invalid_input", message });
const shown = (value: string): string => JSON.stringify(value);

/**
 * `parseOwnerPolicyValue` and `checkPolicyValue` (kernel/src/playbooks/store.ts) for the text an owner types: the new
 * column value and its `*_set_by` column, or the kernel's refusal.
 */
function parsed(field: string, raw: string): { readonly patch: Partial<PlaybookListing> } | FixtureAnswer {
  if (!["dedupe_key", "priority", "model", "token_limit", "mode"].includes(field)) return invalid(`field must be one of dedupe_key, priority, model, token_limit, mode (got ${shown(field)})`);
  const clear = raw === "none";
  if (field === "priority") {
    if (clear || !["low", "normal", "high"].includes(raw)) return invalid(clear ? "priority cannot be cleared: it is one of low, normal, high" : `priority must be one of low, normal, high (got ${shown(raw)})`);
    return { patch: { priority: raw, priority_set_by: "owner" } };
  }
  if (field === "mode") {
    if (clear) return invalid("mode cannot be cleared: it is one of draft, live");
    if (raw !== "draft") return invalid(`mode ${shown(raw)} is not accepted yet (live_mode_not_in_phase_6)`);
    return { patch: { mode: raw, mode_set_by: "owner" } };
  }
  if (field === "model") return { patch: { model: clear ? null : raw, model_set_by: "owner" } };
  if (field === "token_limit") {
    if (clear) return { patch: { token_limit_per_day: null, token_limit_set_by: "owner" } };
    if (!/^[1-9]\d{0,15}$/.test(raw)) return invalid("token_limit must be a positive whole number of tokens per day");
    return { patch: { token_limit_per_day: Number(raw), token_limit_set_by: "owner" } };
  }
  if (clear) return { patch: { dedupe_key_spec: null, dedupe_key_set_by: "owner" } };
  const fields = raw.split(",").map((f) => f.trim());
  if (fields.length === 0 || fields.some((f) => f === "")) return invalid(`dedupe_key must be a non-empty list of distinct fields from ${DEDUPE_KEY_FIELDS.join(", ")}`);
  const seen = new Set<string>();
  for (const f of fields) {
    if (!(DEDUPE_KEY_FIELDS as readonly string[]).includes(f)) return invalid(`dedupe_key: unknown field ${shown(f)} (the fields are ${DEDUPE_KEY_FIELDS.join(", ")})`);
    if (seen.has(f)) return invalid(`dedupe_key: field ${f} is listed twice`);
    seen.add(f);
  }
  return { patch: { dedupe_key_spec: JSON.stringify(fields), dedupe_key_set_by: "owner" } };
}

const idOf = (req: FixtureRequest): number => Number(req.params.id);

/** The fixture kernel for the Playbooks screen, in `state`. */
export function playbooksFixture(init: PlaybooksFixtureInit = {}): PlaybooksFixture {
  const kernel: PlaybooksKernel = { ...seed(init.state ?? "populated"), posts: [], runRefusal: undefined, onChange: () => undefined };
  let queue = 100;

  const find = (req: FixtureRequest): { readonly index: number; readonly row: PlaybookListing } | undefined => {
    const index = kernel.playbooks.findIndex((p) => p.id === idOf(req));
    const row = kernel.playbooks[index];
    return row === undefined ? undefined : { index, row };
  };
  const record = (req: FixtureRequest, path: string): void => {
    kernel.posts.push({ path, params: req.params, body: req.body });
  };

  const routes: Partial<Record<RouteKey, FixtureRoute>> = {
    "GET /agents": () => answer(200, { agents: [WRIGHT] }),
    "GET /messages": () => answer(200, { messages: [] }),
    "GET /notifications": () => answer(200, { notifications: [] }),
    "GET /threads/:agent": () => answer(200, { items: [], next_before: null, pending_approvals: [] } satisfies ThreadResponse),
    "GET /playbooks": () => {
      if (init.holdList === true) return new Promise<never>(() => undefined);
      if (init.failList === true) return answer(500, { error: "store_unreadable", message: "the kernel could not read its store" });
      return answer(200, { playbooks: kernel.playbooks });
    },
    "GET /triggers": () => answer(200, { triggers: kernel.triggers }),
    "GET /approvals": () => answer(200, { approvals: kernel.approvals.filter((a) => a.status === "pending") }),
    "GET /playbooks/:id/runs": (req) => {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? "50")));
      const all = kernel.runs.get(idOf(req)) ?? [];
      return answer(200, { runs: all.slice(0, limit), next_before: all.length > limit ? String(all[limit - 1]?.id ?? "") : null } satisfies PlaybookRunsResponse);
    },
    "GET /playbooks/:id/versions": (req) => answer(200, { versions: kernel.versions.get(idOf(req)) ?? [] } satisfies PlaybookVersionsResponse),
    "POST /playbooks/:id/set": (req) => {
      record(req, "/playbooks/:id/set");
      const found = find(req);
      if (found === undefined) return answer(404, { error: "not_found" });
      const body = req.body as { field?: unknown; value?: unknown } | undefined;
      if (typeof body?.field !== "string" || typeof body.value !== "string") return answer(400, { error: "invalid_body", message: "the body is {field, value}, both strings (value as typed on the CLI; none clears)" });
      const result = parsed(body.field, body.value);
      if ("status" in result) return result;
      const changed = (Object.keys(result.patch) as (keyof PlaybookListing)[]).some((k) => found.row[k] !== result.patch[k]);
      if (!changed) return answer(200, { playbook: found.row, changed: false } satisfies PlaybookChangeResponse);
      // One version per Set; an enabled playbook is a draft again (the kernel's rule).
      const next: PlaybookListing = { ...found.row, ...result.patch, version: found.row.version + 1, status: found.row.status === "enabled" ? "draft" : found.row.status, updated_at: AT(30, 15, 0) };
      kernel.playbooks[found.index] = next;
      kernel.versions.set(next.id, [{ playbook: next.id, version: next.version, snapshot: next, created_at: next.updated_at }, ...(kernel.versions.get(next.id) ?? [])]);
      kernel.onChange("playbook_updated");
      return answer(200, { playbook: next, changed: true } satisfies PlaybookChangeResponse);
    },
    "POST /playbooks/:id/off": (req) => {
      record(req, "/playbooks/:id/off");
      const found = find(req);
      if (found === undefined) return answer(404, { error: "not_found" });
      const next: PlaybookListing = { ...found.row, status: "disabled" };
      kernel.playbooks[found.index] = next;
      kernel.onChange("playbook_disabled");
      return answer(200, { playbook: next, changed: found.row.status !== "disabled" } satisfies PlaybookChangeResponse);
    },
    "POST /playbooks/:id/run": (req) => {
      record(req, "/playbooks/:id/run");
      const found = find(req);
      if (found === undefined) return answer(404, { error: "not_found" });
      if (kernel.runRefusal !== undefined) return answer(409, kernel.runRefusal);
      if (found.row.status !== "enabled") return answer(409, { error: "not_enabled", message: `playbook ${found.row.id} is ${found.row.status}, not enabled` });
      queue += 1;
      return answer(200, { queue_id: queue, created: true, playbook: found.row.id, version: found.row.version, scheduled_at: AT(30, 15, 0) } satisfies PlaybookRunResponse);
    },
  };
  return { options: { routes }, kernel };
}

/** One stored `events` row as the feed sends it. */
export function playbookEvent(id: number, kind: string, playbook: number): EventFrame {
  return { type: "event", id, at: AT(30, 15, 0), kind, session_id: null, task_id: null, payload: { playbook_id: playbook } };
}
