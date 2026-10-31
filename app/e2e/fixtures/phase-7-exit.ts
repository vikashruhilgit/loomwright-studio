// The phase 7 exit walk's canned kernel (item 10), for `app/e2e/phase-7-exit.spec.ts`: ONE fixture kernel
// that serves the seven GUI v2 screens (Integrations, Tasks, Playbooks, Schedules & triggers, Memory,
// Budget & audit, Settings) in one launch, composed from the screens' own fixtures
// (`./tasks.ts`, `./playbooks.ts`, `./schedules.ts`, `./memory.ts`, `./budget.ts`, `./settings.ts`,
// `./integrations.ts`), which are served as they are and never copied.
//
// `PHASE_7_EXIT_ROUTE_KEYS` lists every route the composed kernel answers, and `phase7ExitFixture(...).routes` is
// the FULL table: the spec passes exactly that table to `startFixtureKernel` and fails on any request the table
// does not name. The table re-declares every default it relies on instead of leaning on `fixture-kernel.ts`'s
// private `DEFAULT_ROUTES`: each entry is one named source, so a screen's own fixture stays the owner of its own
// routes. The app opens on Chat (`DEFAULT_SCREEN`), whose thread and Crew section read `GET /threads/:agent`,
// `/agents`, `/approvals`, `/messages`, `/playbooks`, `/triggers` and `/notifications`, so those are in the table too.
//
// The screen fixtures disagree on a few shared keys. The table picks one source for each, with the reason:
//
//   GET /status         budget      its `cap_state` names the account the Budget screen prints ("personal subscription");
//                                   the other fixtures answer the same quiet kernel
//   GET /agents         budget      its roster (Wright, Mason, Ada with limits) is the one Budget & audit names agents from
//   GET /approvals      playbooks   the only fixture with a held approval (the Playbooks `waiting` state)
//   GET /messages       playbooks   the Chat reads the launch makes are the Playbooks fixture's: its "Edit in English"
//   GET /notifications  playbooks   hands off to Wright's thread, so it already serves the thread's empty answers
//   GET /threads/:agent playbooks   (same)
//   GET /playbooks      playbooks   the Playbooks screen owns the list. Its slugs differ from the Schedules and Budget
//                                   fixtures' (`review-prs-studio-sandbox` against `review-prs`), so those two screens
//                                   show a slug where their own specs show a name; their markers here do not read names
//   GET /triggers       schedules   the Schedules screen owns the trigger list and its switches. The Playbooks rows
//                                   then find no trigger for their `trigger_id`, which the Playbooks markers here do not read
//   GET /drafts         (declared)  no fixture serves it for these screens: an empty list, as the kernel with no draft answers
//
// Every other key has exactly one fixture that serves it. The unreachable state is the shell's: `GET /status`
// answers 503, as `tasks.spec.ts` AC7 forces it.
import type { DraftsResponse, RouteKey } from "../../src/api/contract";
import type { FixtureKernel, FixtureRoute } from "../fixture-kernel";
import { budgetFixture } from "./budget";
import type { BudgetFixture, BudgetFixtureOptions } from "./budget";
import { integrationsFixture } from "./integrations";
import type { IntegrationsFixture, IntegrationsFixtureOptions } from "./integrations";
import { memoryFixture } from "./memory";
import type { MemoryFixture, MemoryFixtureOptions } from "./memory";
import { playbooksFixture } from "./playbooks";
import type { PlaybooksFixture, PlaybooksFixtureInit } from "./playbooks";
import { schedulesFixture } from "./schedules";
import type { SchedulesFixture, SchedulesFixtureOptions } from "./schedules";
import { settingsFixture } from "./settings";
import type { SettingsFixture, SettingsFixtureOptions } from "./settings";
import { populatedItems, reviewHistory, reviewLog, runningSessions, tasksKernel, tasksRoutes, waitingItems } from "./tasks";
import type { TasksKernel, TasksKernelInit } from "./tasks";

/** Every route the composed kernel answers. The table below must hold exactly these keys (the compiler checks it). */
export const PHASE_7_EXIT_ROUTE_KEYS = [
  // The shell and the Chat screen the app opens on.
  "GET /status",
  "GET /agents",
  "GET /approvals",
  "GET /messages",
  "GET /notifications",
  "GET /threads/:agent",
  "GET /playbooks",
  "GET /triggers",
  "GET /drafts",
  // Settings, and the data directory Memory prints.
  "GET /settings",
  // Tasks, and the log of the session behind a card.
  "GET /tasks",
  "GET /tasks/:kind/:id",
  "GET /sessions/:id/output",
  "POST /sessions/:id/stop",
  "POST /sessions/:id/kill",
  // Playbooks.
  "GET /playbooks/:id/runs",
  "GET /playbooks/:id/versions",
  "POST /playbooks/:id/set",
  "POST /playbooks/:id/off",
  "POST /playbooks/:id/run",
  // Schedules & triggers.
  "GET /schedule",
  "GET /triggers/:id/fires",
  "POST /triggers/:id/on",
  "POST /triggers/:id/off",
  // Memory.
  "GET /memory",
  "GET /memory/file",
  "PUT /memory/file",
  // Budget & audit.
  "GET /budget/usage",
  "GET /audit",
  // Integrations.
  "GET /connectors",
  "GET /connectors/github/repos",
  "POST /connectors/github/token",
  "POST /connectors/github/disconnect",
  "POST /connectors/github/app/setup",
  "POST /connectors/github/app/setup/cancel",
] as const satisfies readonly RouteKey[];

export type Phase7ExitKey = (typeof PHASE_7_EXIT_ROUTE_KEYS)[number];

/** The composed kernel's full route table: exactly `PHASE_7_EXIT_ROUTE_KEYS`. */
export type Phase7ExitRoutes = Readonly<Record<Phase7ExitKey, FixtureRoute>>;

/** The mockup's `t9` card and its session's history and log, over the running sessions (as `tasks.spec.ts` seeds them). */
export function reviewInit(items = populatedItems()): TasksKernelInit {
  return { items, sessions: runningSessions(), output: new Map([[41, reviewLog(41)]]), events: new Map([["task:9", reviewHistory()]]) };
}

/** The Tasks boards the exit walk uses: nothing, the populated board, and the board with two cards waiting on the owner. */
export const TASKS_INIT = {
  empty: (): TasksKernelInit => ({}),
  populated: (): TasksKernelInit => reviewInit(),
  waiting: (): TasksKernelInit => reviewInit(waitingItems()),
} as const;

export interface Phase7ExitInit {
  /** Default: the populated board. */
  readonly tasks?: TasksKernelInit;
  readonly playbooks?: PlaybooksFixtureInit;
  readonly schedules?: SchedulesFixtureOptions;
  readonly memory?: MemoryFixtureOptions;
  readonly budget?: BudgetFixtureOptions;
  readonly settings?: SettingsFixtureOptions;
  /** Default: a token connected (the screen's token detail, the mockup's `integrations-token`). */
  readonly integrations?: IntegrationsFixtureOptions;
  /** `GET /status` answers 503: the shell's unreachable state over whatever the screen read. */
  readonly unreachable?: boolean;
  /**
   * A route of the table answered another way: a never-settling promise for a loading state, a 500 for an error
   * state, as the screens' own specs force them. Only keys the table already holds: this adds no route.
   */
  readonly overrides?: Partial<Phase7ExitRoutes>;
}

export interface Phase7ExitFixture {
  /** The full route table: pass exactly this to `startFixtureKernel({ routes })`. */
  readonly routes: Phase7ExitRoutes;
  /** Each screen's own fixture, whose handles (`holdTree`, `failUsage`, `appStored`...) drive its states. */
  readonly tasks: TasksKernel;
  readonly playbooks: PlaybooksFixture;
  readonly schedules: SchedulesFixture;
  readonly memory: MemoryFixture;
  readonly budget: BudgetFixture;
  readonly settings: SettingsFixture;
  readonly integrations: IntegrationsFixture;
  /** Give the fixtures that append feed events the started kernel. */
  attach(kernel: FixtureKernel): void;
}

type Source = Partial<Record<RouteKey, FixtureRoute>>;

/** `key` from `source`; a fixture that does not serve it fails the build of the table rather than answering 404 later. */
function from(name: string, source: Source | undefined, key: RouteKey): FixtureRoute {
  const route = source?.[key];
  if (route === undefined) throw new Error(`the ${name} fixture does not serve ${key}`);
  return route;
}

/** The composed kernel for the seven screens, each in the state its `init` names. */
export function phase7ExitFixture(init: Phase7ExitInit = {}): Phase7ExitFixture {
  const tasks = tasksKernel(init.tasks ?? TASKS_INIT.populated());
  const playbooks = playbooksFixture(init.playbooks);
  const schedules = schedulesFixture(init.schedules);
  const memory = memoryFixture(init.memory);
  const budget = budgetFixture(init.budget);
  const settings = settingsFixture(init.settings);
  const integrations = integrationsFixture(init.integrations ?? { connector: "connected" });

  const fromTasks = tasksRoutes(tasks);
  const t = (key: RouteKey): FixtureRoute => from("tasks", fromTasks, key);
  const p = (key: RouteKey): FixtureRoute => from("playbooks", playbooks.options.routes, key);
  const s = (key: RouteKey): FixtureRoute => from("schedules", schedules.options.routes, key);
  const m = (key: RouteKey): FixtureRoute => from("memory", memory.options.routes, key);
  const b = (key: RouteKey): FixtureRoute => from("budget", budget.options.routes, key);
  const g = (key: RouteKey): FixtureRoute => from("settings", settings.options.routes, key);
  const i = (key: RouteKey): FixtureRoute => from("integrations", integrations.options.routes, key);

  const table: Phase7ExitRoutes = {
    // The shell and Chat: one source per shared key (the reasons are in the header).
    "GET /status": init.unreachable === true ? () => ({ status: 503, body: { error: "unavailable" } }) : b("GET /status"),
    "GET /agents": b("GET /agents"),
    "GET /approvals": p("GET /approvals"),
    "GET /messages": p("GET /messages"),
    "GET /notifications": p("GET /notifications"),
    "GET /threads/:agent": p("GET /threads/:agent"),
    "GET /playbooks": p("GET /playbooks"),
    "GET /triggers": s("GET /triggers"),
    "GET /drafts": () => ({ status: 200, body: { drafts: [] } satisfies DraftsResponse }),
    "GET /settings": g("GET /settings"),
    // Tasks.
    "GET /tasks": t("GET /tasks"),
    "GET /tasks/:kind/:id": t("GET /tasks/:kind/:id"),
    "GET /sessions/:id/output": t("GET /sessions/:id/output"),
    "POST /sessions/:id/stop": t("POST /sessions/:id/stop"),
    "POST /sessions/:id/kill": t("POST /sessions/:id/kill"),
    // Playbooks.
    "GET /playbooks/:id/runs": p("GET /playbooks/:id/runs"),
    "GET /playbooks/:id/versions": p("GET /playbooks/:id/versions"),
    "POST /playbooks/:id/set": p("POST /playbooks/:id/set"),
    "POST /playbooks/:id/off": p("POST /playbooks/:id/off"),
    "POST /playbooks/:id/run": p("POST /playbooks/:id/run"),
    // Schedules & triggers.
    "GET /schedule": s("GET /schedule"),
    "GET /triggers/:id/fires": s("GET /triggers/:id/fires"),
    "POST /triggers/:id/on": s("POST /triggers/:id/on"),
    "POST /triggers/:id/off": s("POST /triggers/:id/off"),
    // Memory.
    "GET /memory": m("GET /memory"),
    "GET /memory/file": m("GET /memory/file"),
    "PUT /memory/file": m("PUT /memory/file"),
    // Budget & audit.
    "GET /budget/usage": b("GET /budget/usage"),
    "GET /audit": b("GET /audit"),
    // Integrations.
    "GET /connectors": i("GET /connectors"),
    "GET /connectors/github/repos": i("GET /connectors/github/repos"),
    "POST /connectors/github/token": i("POST /connectors/github/token"),
    "POST /connectors/github/disconnect": i("POST /connectors/github/disconnect"),
    "POST /connectors/github/app/setup": i("POST /connectors/github/app/setup"),
    "POST /connectors/github/app/setup/cancel": i("POST /connectors/github/app/setup/cancel"),
  };

  const routes: Phase7ExitRoutes = { ...table, ...init.overrides };

  return {
    routes,
    tasks,
    playbooks,
    schedules,
    memory,
    budget,
    settings,
    integrations,
    attach(kernel) {
      schedules.attach(kernel);
      memory.attach(kernel);
      budget.attach(kernel);
      settings.attach(kernel);
      integrations.attach(kernel);
    },
  };
}
