// Phase 8 item 23j: the owner's Resume for a paused Loomwright run.
//
// - `GET /automate/paused-runs` lists every paused run file in a crew member's
//   workspaces, a run paused before it picked an item included (the live case:
//   `automate-2026-11-17-001`, `trail_pr_open`), with why it can't be resumed now.
// - `POST /automate/paused-runs/:run_id/resume` queues the kernel's `resume` run,
//   attributed to the kernel run that last drained that checkout.
// - `handleAutomateRun` starts `/loomwright:automate --resume <run_id> --inline-phases`
//   under the backlog run's policy, and only while that run is still paused.
// - 23l: a run whose file still reads `running` while its lock has no live holder
//   (the live case: session 214 ended mid-item, lock pid 32853 dead) is listed as
//   stranded and resumable the same way; a live holder or session keeps it live.
import { runContinuationPrompt } from "../src/automate/run-sessions.js";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentSettingsPath } from "../src/agents/index.js";
import { AUTOMATE_RUN_KEY, AUTOMATE_RUN_POLICY, handleAutomateRun, resumeRunPrompt } from "../src/automate/launch.js";
import { listPausedRuns, resumeRoutes } from "../src/gui/paused-runs.js";
import { LOOMWRIGHT_LOCK_TTL_SECONDS, deadLockOf, holderAlive } from "../src/loomwright/run-lock.js";
import { decideApproval, holdOrUseGrant } from "../src/approvals/store.js";
import type { ContributedRouteRequest, ContributedRouteResponse } from "../src/features/contribution.js";
import { EventLoop, enqueueEvent, getQueueRow, getWorkStep } from "../src/loop/index.js";
import type { EventSessions } from "../src/loop/types.js";
import { SessionError } from "../src/sessions/index.js";
import type { ResumeSessionParams, SessionHandle, SessionRow, StartSessionParams } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { appendEvent } from "../src/loop/internal.js";
import { enablePlaybook, setPlaybookPolicy } from "../src/playbooks/store.js";
import { makeCheckout, writeRunLock } from "./fixtures/loomwright-run-files/harness.js";

const RUN_ID = "automate-2026-11-17-001";
/** The live run file, verbatim up to its Progress: paused at its first step, before it picked an item. */
const PAUSED_EARLY = [
  "# Automate Run: Studio tickets — cheer.sh",
  "## Status: paused",
  "## Source",
  "- backlog .supervisor/requirements/studio/_BACKLOG.md",
  "## Queue",
  "- [ ] .supervisor/requirements/studio/ticket-clickup-86bd3z76t-dd54c20e.md",
  "## Current",
  "- item: null | status: null | pr: null | branch: null",
  "- pause_reason: trail_pr_open",
  "## Progress",
  "- trail-gate: PARK — gh unavailable",
  "",
].join("\n");

const CALLER = { id: 210, agent: "mason", playbook: 5, playbook_version: 2, task_id: null, model: "claude-sonnet-5-5", status: "completed" } as const;

let tmp: string;
let store: Store;
let checkout: string;

function writeCrewSettings(dataDir: string, id: string, workspaces: readonly string[]): void {
  const file = agentSettingsPath(dataDir, id);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ model: "claude-sonnet-5-5", permission_mode: "default", tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] }, connectors: { github: "write" }, workspaces }),
  );
}

function writeRun(runId: string, text: string, at = checkout): void {
  const dir = join(at, ".supervisor", "automate");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${runId}.md`), text);
}

/** The kernel run event `kernel_automate_prepare` queued earlier for this checkout: what a resume is attributed to. */
function queueSourceLaunch(over: Record<string, unknown> = {}): number {
  const run = { repo: "o/r", backlog: join(checkout, ".supervisor", "requirements", "studio", "_BACKLOG.md"), checkout, playbook: 5, playbook_version: 2, task: null, source_session: CALLER.id, ...over };
  const id = enqueueEvent(store, { kind: "message", payload: { agent: "mason", [AUTOMATE_RUN_KEY]: run } }).id;
  store.prepare("UPDATE event_queue SET status = 'done' WHERE id = ?").run(id);
  return id;
}

function req(method: "GET" | "POST", params: Record<string, string> = {}, body?: unknown): ContributedRouteRequest {
  return { params, query: {}, body, store, now: () => new Date("2026-11-17T09:00:00.000Z") } as ContributedRouteRequest;
}

async function call(method: "GET" | "POST", params: Record<string, string> = {}, body?: unknown): Promise<ContributedRouteResponse> {
  const route = resumeRoutes.find((r) => r.method === method);
  if (route === undefined) throw new Error(`no ${method} route`);
  return route.handler(req(method, params, body));
}

const resume = (body: unknown = { agent: "mason", checkout }, runId = RUN_ID) => call("POST", { run_id: runId }, body);

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-resume-"));
  const dataDir = join(tmp, "data");
  store = new Store({ dataDir });
  checkout = makeCheckout(tmp, "studio-sandbox");
  writeCrewSettings(dataDir, "mason", [checkout]);
  store.prepare("INSERT INTO agents (id, display_name, avatar_shape, avatar_hue, status, created_by, charter_json) VALUES ('mason', 'Mason', 'crab', 'crew-teal', 'active', 'owner', '{}')").run();
  store.prepare("INSERT INTO playbooks (id, slug, name, owning_agent, intent, version, mode, merge_requirement, status) VALUES (5, 'pb5', 'pb5', 'mason', 'Hand tickets over', 2, 'live', 'none', 'enabled')").run();
  writeRun(RUN_ID, PAUSED_EARLY);
});

afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("GET /automate/paused-runs (23j)", () => {
  it("lists a run paused before it picked an item, with its reason, attributed to the kernel run that last drained the checkout", async () => {
    queueSourceLaunch();
    const res = await call("GET");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      runs: [{ agent: "mason", checkout, repo: "o/r", run_id: RUN_ID, title: "Studio tickets — cheer.sh", pause_reason: "trail_pr_open", item: null, pr: null, stranded: false, blocked: null, resume_at: null, last_session: null }],
      unreadable: [],
    });
  });

  it("lists only paused runs: a done or unknown-status run file is not one, nor a running one whose lock holder is alive", async () => {
    queueSourceLaunch();
    writeRun("r-done", "# Automate Run: d\n## Status: done\n");
    writeRun("r-odd", "# Automate Run: o\n## Status: sleeping\n");
    writeRun("r-live", "# Automate Run: l\n## Status: running\n");
    writeRunLock(checkout, process.pid);
    expect(listPausedRuns(store).runs.map((r) => r.run_id)).toEqual([RUN_ID]);
  });

  it("names why it can't be resumed now: no kernel run, a live run, a playbook not live, a crew member off, the kill switch", async () => {
    expect(listPausedRuns(store).runs[0]?.blocked).toBe("no_kernel_run");
    queueSourceLaunch();
    writeRunLock(checkout, process.pid);
    expect(listPausedRuns(store).runs[0]?.blocked).toBe("run_live");
    rmSync(join(checkout, ".supervisor", "run.lock"), { recursive: true });
    store.prepare("UPDATE playbooks SET mode = 'draft' WHERE id = 5").run();
    expect(listPausedRuns(store).runs[0]?.blocked).toBe("playbook_not_live");
    store.prepare("UPDATE playbooks SET mode = 'live' WHERE id = 5").run();
    store.prepare("UPDATE agents SET status = 'off' WHERE id = 'mason'").run();
    expect(listPausedRuns(store).runs[0]?.blocked).toBe("agent_not_active");
    store.prepare("UPDATE agents SET status = 'active' WHERE id = 'mason'").run();
    expect(listPausedRuns(store).runs[0]?.blocked).toBeNull();
  });

  it("attributes to the newest kernel run for that checkout, never another checkout's", async () => {
    const other = makeCheckout(tmp, "other");
    queueSourceLaunch({ playbook: 5, source_session: 1 });
    queueSourceLaunch({ checkout: other, source_session: 999, repo: "o/other" });
    expect(listPausedRuns(store).runs[0]?.repo).toBe("o/r");
  });

  it("a checkout several crew members list is listed once, under the one whose kernel run last drained it", async () => {
    store.prepare("INSERT INTO agents (id, display_name, avatar_shape, avatar_hue, status, created_by, charter_json) VALUES (?, ?, 'crab', 'crew-teal', 'active', 'owner', '{}')").run("aardvark", "Aardvark");
    writeCrewSettings(store.dataDir, "aardvark", [checkout]);
    expect(listPausedRuns(store).runs.map((r) => [r.agent, r.blocked])).toHaveLength(1);
    queueSourceLaunch();
    expect(listPausedRuns(store).runs.map((r) => [r.agent, r.blocked])).toEqual([["mason", null]]);
    // Resume for the member that did not drain it is not found: the run is listed under mason.
    expect(await resume({ agent: "aardvark", checkout })).toMatchObject({ status: 404 });
  });

  it("an unreadable run state is listed as unreadable, never as no runs", async () => {
    writeRun("my run", "# Automate Run: spaced\n## Status: paused\n");
    expect(listPausedRuns(store)).toEqual({ runs: [], unreadable: [{ agent: "mason", checkout, reason: "run_file_name_unusable" }] });
  });
});

describe("POST /automate/paused-runs/:run_id/resume (23j)", () => {
  it("queues the kernel's resume run with the source launch's attribution, once", async () => {
    queueSourceLaunch();
    const res = await resume();
    expect(res.status).toBe(200);
    const { queue_id } = res.body as { queue_id: number };
    expect(JSON.parse(getQueueRow(store, queue_id)?.payload_json ?? "{}")).toEqual({
      agent: "mason",
      [AUTOMATE_RUN_KEY]: { kind: "resume", run_id: RUN_ID, repo: "o/r", checkout, playbook: 5, playbook_version: 2, task: null, source_session: CALLER.id },
    });
    // A second click while it waits is refused, and the list says so.
    expect(await resume()).toMatchObject({ status: 409, body: { error: "resume_queued" } });
    expect(listPausedRuns(store).runs[0]?.blocked).toBe("resume_queued");
  });

  // PR #291 review: run ids are a date and a sequence per checkout, so another checkout's run can share this one's id.
  it("a resume queued for the same run id in another checkout does not block this one", async () => {
    queueSourceLaunch();
    enqueueEvent(store, { kind: "message", payload: { agent: "mason", [AUTOMATE_RUN_KEY]: { kind: "resume", run_id: RUN_ID, checkout: "/elsewhere/repo" } } }, new Date());
    expect(listPausedRuns(store).runs[0]?.blocked).toBeNull();
    expect((await resume()).status).toBe(200);
    expect(listPausedRuns(store).runs[0]?.blocked).toBe("resume_queued");
  });

  it("refuses what the list would not offer: a blocked run 409, another run, agent or checkout 404, a bad id or body 400", async () => {
    expect(await resume()).toMatchObject({ status: 409, body: { error: "no_kernel_run" } });
    queueSourceLaunch();
    expect(await resume({ agent: "mason", checkout }, "automate-2026-11-17-002")).toMatchObject({ status: 404 });
    expect(await resume({ agent: "ghost", checkout })).toMatchObject({ status: 404 });
    expect(await resume({ agent: "mason", checkout: join(tmp, "elsewhere") })).toMatchObject({ status: 404 });
    expect(await resume({ agent: "mason", checkout }, "../etc")).toMatchObject({ status: 400, body: { error: "invalid_run_id" } });
    for (const body of [undefined, null, [], { agent: "mason" }, { agent: "mason", checkout, extra: 1 }, { agent: 1, checkout }]) {
      expect(await call("POST", { run_id: RUN_ID }, body), JSON.stringify(body)).toMatchObject({ status: 400, body: { error: "invalid_body" } });
    }
    const count = store.prepare("SELECT COUNT(*) FROM event_queue WHERE json_extract(payload_json, '$.automate_run.kind') = 'resume'").pluck().get();
    expect(count).toBe(0);
  });
});

describe("handleAutomateRun starts a resume run (23j)", () => {
  function loopWith(starts: StartSessionParams[]): EventLoop {
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, 'mason', 'completed', ?)").run(CALLER.id, checkout);
    const sessions: EventSessions = {
      async startSession(params) {
        starts.push(params);
        return { id: 300 + starts.length } as unknown as SessionHandle;
      },
      resumeSession: () => Promise.reject(new Error("unexpected resume")),
      getSession: (id) => (id === CALLER.id ? ({ ...CALLER } as unknown as SessionRow) : undefined),
    };
    return new EventLoop({ store, handlers: { message: handleAutomateRun }, sessions });
  }

  it("starts /loomwright:automate --resume <run_id> --inline-phases under the backlog run's policy, as the crew member, with the source session's model", async () => {
    queueSourceLaunch();
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const { queue_id } = (await resume()).body as { queue_id: number };
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(resumeRunPrompt(RUN_ID)).toBe(`/loomwright:automate --resume ${RUN_ID} --inline-phases`);
    expect(starts).toEqual([
      {
        agent: "mason",
        prompt: `/loomwright:automate --resume ${RUN_ID} --inline-phases`,
        model: CALLER.model,
        permissionMode: "default",
        cwd: checkout,
        policy: {
          allowedTools: [...AUTOMATE_RUN_POLICY.allowedTools],
          allowedBashPrefixes: [...AUTOMATE_RUN_POLICY.allowedBashPrefixes],
          loomwrightScripts: [...(AUTOMATE_RUN_POLICY.loomwrightScripts ?? [])],
          loomwrightDriverProfile: "automate_run",
        },
        playbook: 5,
        playbookVersion: 2,
      },
    ]);
    expect(getWorkStep(store, `event:${queue_id}:automate-run`)?.result).toEqual({ session_id: 301 });
  });

  it("while the resumed run's session is live the list offers no second Resume (the run file still reads paused), and offers it again once that session ends", async () => {
    queueSourceLaunch();
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    await resume();
    await loop.tick();
    // The started session (301) as the sessions table holds it: running, in the checkout.
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (301, 'mason', 'running', ?)").run(checkout);
    expect(listPausedRuns(store).runs[0]?.blocked).toBe("run_live");
    expect(await resume()).toMatchObject({ status: 409, body: { error: "run_live" } });
    store.prepare("UPDATE sessions SET status = 'completed' WHERE id = 301").run();
    expect(listPausedRuns(store).runs[0]?.blocked).toBeNull();
  });

  it("starts nothing when the run is no longer paused by the time the event runs", async () => {
    queueSourceLaunch();
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const { queue_id } = (await resume()).body as { queue_id: number };
    writeRun(RUN_ID, "# Automate Run: Studio tickets — cheer.sh\n## Status: done\n");
    await loop.tick();
    expect(starts).toEqual([]);
    expect(getWorkStep(store, `event:${queue_id}:automate-run`)?.result).toEqual({ session_id: null, skipped: `run_not_paused: ${RUN_ID}` });
  });

  it("a resume payload without a usable run id fails the event and starts nothing", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const run = { kind: "resume", run_id: "a;b", repo: "o/r", checkout, playbook: 5, playbook_version: 2, task: null, source_session: CALLER.id };
    const id = enqueueEvent(store, { kind: "message", payload: { agent: "mason", [AUTOMATE_RUN_KEY]: run } }).id;
    expect(await loop.tick()).toMatchObject({ failed: 1 });
    expect(getQueueRow(store, id)?.last_error).toMatch(/run_id, a Loomwright run id/);
    expect(starts).toEqual([]);
  });
});

/** The live stranded run file (after session 214): `running`, its item `running`, no live lock holder. */
const STRANDED = [
  "# Automate Run: Studio tickets — cheer.sh",
  "## Status: running",
  "## Queue",
  "- [ ] .supervisor/requirements/studio/ticket-clickup-86bd3z76t-dd54c20e.md",
  "## Current",
  "- item: .supervisor/requirements/studio/ticket-clickup-86bd3z76t-dd54c20e.md | status: running | pr: null | branch: null",
  "- pause_reason: null",
  "",
].join("\n");

/** A pid no process holds: past the highest pid macOS and Linux hand out by default. */
const DEAD_PID = 4_000_000;

describe("a stranded run is visible and resumable (23l)", () => {
  function loopWith(starts: StartSessionParams[]): EventLoop {
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, 'mason', 'completed', ?)").run(CALLER.id, checkout);
    const sessions: EventSessions = {
      async startSession(params) {
        starts.push(params);
        return { id: 300 + starts.length } as unknown as SessionHandle;
      },
      resumeSession: () => Promise.reject(new Error("unexpected resume")),
      getSession: (id) => (id === CALLER.id ? ({ ...CALLER } as unknown as SessionRow) : undefined),
    };
    return new EventLoop({ store, handlers: { message: handleAutomateRun }, sessions });
  }

  beforeEach(() => {
    writeRun(RUN_ID, STRANDED);
    writeRunLock(checkout, DEAD_PID);
    queueSourceLaunch();
  });

  it("lists a running run whose lock holder is dead as stranded, with its item, and offers Resume", () => {
    expect(listPausedRuns(store).runs).toEqual([
      {
        agent: "mason",
        checkout,
        repo: "o/r",
        run_id: RUN_ID,
        title: "Studio tickets — cheer.sh",
        pause_reason: null,
        item: ".supervisor/requirements/studio/ticket-clickup-86bd3z76t-dd54c20e.md",
        pr: null,
        stranded: true,
        blocked: null,
        resume_at: null,
        last_session: null,
      },
    ]);
  });

  it("a running run with no lock at all is stranded too", () => {
    rmSync(join(checkout, ".supervisor", "run.lock"), { recursive: true });
    expect(listPausedRuns(store).runs[0]).toMatchObject({ run_id: RUN_ID, stranded: true, blocked: null });
  });

  it("a live lock holder means the run is running: it is not listed and no resume starts", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const { queue_id } = (await resume()).body as { queue_id: number };
    writeRunLock(checkout, process.pid);
    expect(listPausedRuns(store).runs).toEqual([]);
    await loop.tick();
    expect(starts).toEqual([]);
    expect(getWorkStep(store, `event:${queue_id}:automate-run`)?.result).toEqual({ session_id: null, skipped: `run_not_paused: ${RUN_ID}` });
  });

  it("resumes it: /loomwright:automate --resume <run_id> --inline-phases starts, and the list offers no second Resume while that session is live", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const { queue_id } = (await resume()).body as { queue_id: number };
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(starts.map((s) => s.prompt)).toEqual([`/loomwright:automate --resume ${RUN_ID} --inline-phases`]);
    expect(getWorkStep(store, `event:${queue_id}:automate-run`)?.result).toEqual({ session_id: 301 });
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (301, 'mason', 'running', ?)").run(checkout);
    expect(listPausedRuns(store).runs[0]?.blocked).toBe("run_live");
    expect(await resume()).toMatchObject({ status: 409, body: { error: "run_live" } });
  });

  it("another running run file blocks the resume as a second drain, in the list and at launch", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const { queue_id } = (await resume()).body as { queue_id: number };
    writeRun("automate-2026-11-17-002", "# Automate Run: other\n## Status: running\n");
    expect(listPausedRuns(store).runs.find((r) => r.run_id === RUN_ID)?.blocked).toBe("run_live");
    await loop.tick();
    expect(starts).toEqual([]);
    expect(getWorkStep(store, `event:${queue_id}:automate-run`)?.result).toEqual({ session_id: null, skipped: "run_live: automate-2026-11-17-002" });
  });

  it("a backlog launch still reads a stranded run as live (single drain): only the owner's Resume continues it", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const id = queueSourceLaunch();
    store.prepare("UPDATE event_queue SET status = 'pending' WHERE id = ?").run(id);
    await loop.tick();
    expect(starts).toEqual([]);
    expect(getWorkStep(store, `event:${id}:automate-run`)?.result).toMatchObject({ session_id: null, skipped: `run_live: ${RUN_ID}` });
  });
});

// ---- D46 (23n): a run lock left by a dead holder --------------------------------------------------------
//
// The live case (2026-11-17): session 215 (pgid 30666) ended mid-item at 20:48 and left Loomwright's run lock
// (`session_id auto-2026-11-17-resume`); in host mode Loomwright's SessionEnd close-out does not release it, and
// its acquire reclaims a dead holder's lock only at 1800 s. The owner's Resume at 21:06 started session 216, which
// parked the run `run_lock_held`. Now the launch releases a lock the kernel's own ended session left, with
// Loomwright's `run-lock.sh`, and Resume waits out Loomwright's reclaim age for any other dead holder's lock.

describe("a dead holder's run lock (D46)", () => {
  const LOCK_SID = "auto-2026-11-17-resume";
  let lw: string;
  const nowSec = (): number => Math.floor(Date.now() / 1000);
  const lockDir = (): string => join(checkout, ".supervisor", "run.lock");
  const calls = (): string[] => (existsSync(join(lw, "calls.log")) ? readFileSync(join(lw, "calls.log"), "utf8").trim().split("\n") : []);

  function loopWith(starts: StartSessionParams[]): EventLoop {
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, 'mason', 'completed', ?)").run(CALLER.id, checkout);
    const sessions: EventSessions = {
      async startSession(params) {
        starts.push(params);
        return { id: 300 + starts.length } as unknown as SessionHandle;
      },
      resumeSession: () => Promise.reject(new Error("unexpected resume")),
      getSession: (id) => (id === CALLER.id ? ({ ...CALLER } as unknown as SessionRow) : undefined),
    };
    return new EventLoop({ store, handlers: { message: handleAutomateRun }, sessions });
  }

  /** The kernel's session that ran the stranded run and has ended: its process group is the lock's pid. */
  function endedRunSession(status = "completed", cwd = checkout): void {
    store.prepare("INSERT INTO sessions (id, agent, status, cwd, pgid, loomwright_path) VALUES (215, 'mason', ?, ?, ?, ?)").run(status, cwd, DEAD_PID, lw);
  }

  beforeEach(() => {
    // A stand-in for Loomwright's `scripts/run-lock.sh`: `liveness` answers what `liveness.txt` holds, `release
    // --session-id <id>` removes the lock only when its meta names that session (17.38.0's contract); every call is logged.
    lw = join(tmp, "loomwright");
    mkdirSync(join(lw, "scripts"), { recursive: true });
    writeFileSync(join(lw, "liveness.txt"), "dead\n");
    const script = join(lw, "scripts", "run-lock.sh");
    writeFileSync(
      script,
      [
        "#!/usr/bin/env bash",
        `LW=${JSON.stringify(lw)}`,
        'echo "$*" >> "$LW/calls.log"',
        'cmd=$1; shift; root=""; sid=""',
        'while [ $# -gt 0 ]; do case $1 in --root) root=$2; shift 2;; --session-id) sid=$2; shift 2;; *) shift;; esac; done',
        'case $cmd in',
        '  liveness) cat "$LW/liveness.txt" ;;',
        '  release) cur=$(awk -F"\t" \'$1=="session_id"{print $2}\' "$root/.supervisor/run.lock/meta"); [ "$cur" = "$sid" ] && rm -rf "$root/.supervisor/run.lock" ;;',
        "esac",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(script, 0o755);
    writeRun(RUN_ID, STRANDED);
    queueSourceLaunch();
  });

  it("the kernel's own ended session's lock: Resume is offered at once, and the launch releases it with run-lock.sh, then starts", async () => {
    endedRunSession();
    writeRunLock(checkout, DEAD_PID, nowSec() - 60, LOCK_SID);
    expect(deadLockOf(store, checkout)).toEqual({ kind: "kernel", session: 215, pid: DEAD_PID, lockSessionId: LOCK_SID, loomwrightPath: lw });
    expect(listPausedRuns(store).runs[0]).toMatchObject({ run_id: RUN_ID, stranded: true, blocked: null, resume_at: null });
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const { queue_id } = (await resume()).body as { queue_id: number };
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(calls()).toEqual([`liveness --pid ${DEAD_PID} --root ${checkout}`, `release --session-id ${LOCK_SID} --root ${checkout}`]);
    expect(existsSync(lockDir())).toBe(false);
    expect(starts.map((p) => p.prompt)).toEqual([`/loomwright:automate --resume ${RUN_ID} --inline-phases`]);
    expect(getWorkStep(store, `event:${queue_id}:automate-run`)?.result).toEqual({ session_id: 301, released_lock_of: 215 });
  });

  it("a session ended by a kernel shutdown (interrupted) counts as ended too", () => {
    endedRunSession("interrupted");
    writeRunLock(checkout, DEAD_PID, nowSec() - 60, LOCK_SID);
    expect(deadLockOf(store, checkout)).toMatchObject({ kind: "kernel", session: 215 });
  });

  it("releases nothing when Loomwright's own liveness does not say dead: the launch starts nothing and keeps the lock", async () => {
    endedRunSession();
    writeRunLock(checkout, DEAD_PID, nowSec() - 60, LOCK_SID);
    writeFileSync(join(lw, "liveness.txt"), "alive\n");
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const { queue_id } = (await resume()).body as { queue_id: number };
    await loop.tick();
    expect(calls()).toEqual([`liveness --pid ${DEAD_PID} --root ${checkout}`]);
    expect(existsSync(lockDir())).toBe(true);
    expect(starts).toEqual([]);
    expect(getWorkStep(store, `event:${queue_id}:automate-run`)?.result).toEqual({ session_id: null, skipped: "lock_release_failed: session 215's run lock" });
  });

  it("another dead holder's young lock: Resume is off until Loomwright's reclaim time, refused 409, and a queued launch starts nothing", async () => {
    const ts = nowSec() - 60;
    writeRunLock(checkout, DEAD_PID, ts, LOCK_SID);
    const at = new Date((ts + LOOMWRIGHT_LOCK_TTL_SECONDS) * 1000).toISOString();
    expect(deadLockOf(store, checkout)).toEqual({ kind: "foreign", reclaimAt: ts + LOOMWRIGHT_LOCK_TTL_SECONDS });
    expect(listPausedRuns(store).runs[0]).toMatchObject({ run_id: RUN_ID, blocked: "lock_settling", resume_at: at });
    expect(await resume()).toMatchObject({ status: 409, body: { error: "lock_settling" } });
    // Queued while the lock read old, launched after a young one appeared: the launch checks again.
    writeRunLock(checkout, DEAD_PID);
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const { queue_id } = (await resume()).body as { queue_id: number };
    writeRunLock(checkout, DEAD_PID, ts, LOCK_SID);
    await loop.tick();
    expect(starts).toEqual([]);
    expect(calls()).toEqual([]);
    expect(getWorkStep(store, `event:${queue_id}:automate-run`)?.result).toEqual({ session_id: null, skipped: `lock_settling: Loomwright reclaims it at ${at}` });
  });

  it("is not the kernel's when the session still runs, ran in another checkout, or the lock names no session: those wait out the reclaim age", () => {
    writeRunLock(checkout, DEAD_PID, nowSec() - 60, LOCK_SID);
    endedRunSession("running");
    expect(deadLockOf(store, checkout).kind).toBe("foreign");
    store.prepare("DELETE FROM sessions WHERE id = 215").run();
    endedRunSession("completed", join(tmp, "elsewhere"));
    expect(deadLockOf(store, checkout).kind).toBe("foreign");
    store.prepare("DELETE FROM sessions WHERE id = 215").run();
    endedRunSession();
    writeRunLock(checkout, DEAD_PID, nowSec() - 60, "bad id; rm");
    expect(deadLockOf(store, checkout).kind).toBe("foreign");
  });

  it("a lock whose age cannot be read is never reclaimed by Loomwright: Resume stays off with no time", () => {
    mkdirSync(lockDir(), { recursive: true });
    writeFileSync(join(lockDir(), "meta"), `pid\t${DEAD_PID}\nsession_id\t${LOCK_SID}\nts\tsoon\n`);
    expect(listPausedRuns(store).runs[0]).toMatchObject({ blocked: "lock_settling", resume_at: null });
  });

  it("an old lock of another dead holder is Loomwright's to reclaim: Resume is offered, and the kernel releases nothing", () => {
    writeRunLock(checkout, DEAD_PID, nowSec() - LOOMWRIGHT_LOCK_TTL_SECONDS - 1, LOCK_SID);
    expect(listPausedRuns(store).runs[0]).toMatchObject({ blocked: null, resume_at: null });
  });

  it("reads a holder as Loomwright does: alive needs kill -0 and, with a recorded pid_start, the same start time", () => {
    expect(holderAlive(process.pid, null)).toBe(true);
    expect(holderAlive(process.pid, "Thu Jan  1 00:00:00 1970")).toBe(false);
    expect(holderAlive(DEAD_PID, null)).toBe(false);
  });
});

// ---- 23o: the owner's decision continues the run session that asked ------------------------------------
//
// The live case (2026-11-17): run session 217 was held at `git push -u origin feature/add-cheer-sh` (approval 53)
// and ended its turn. The approval woke the crew member's own thread (session 218), which tried the push itself and
// was refused; a Resume then restarted the item in a new session, whose Supervisor started again at ACQUIRE. Now the
// decision continues session 217's own conversation, under its launch's policy, with the decision as its prompt.

describe("an approval held by a run session continues that session (23o)", () => {
  const PUSH = { tool: "Bash", command: "git push -u origin feature/add-cheer-sh", cwd: "" };
  const NOW = new Date("2026-11-17T16:00:28.000Z");

  function loopWith(starts: StartSessionParams[], resumes?: { id: number; params: ResumeSessionParams }[]): EventLoop {
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, 'mason', 'completed', ?)").run(CALLER.id, checkout);
    const sessions: EventSessions = {
      async startSession(params) {
        starts.push(params);
        return { id: 300 + starts.length } as unknown as SessionHandle;
      },
      async resumeSession(id, params) {
        if (resumes === undefined) throw new Error("unexpected resume");
        resumes.push({ id, params });
        return { id } as unknown as SessionHandle;
      },
      getSession: (id) => (id === CALLER.id ? ({ ...CALLER } as unknown as SessionRow) : (store.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined)),
    };
    return new EventLoop({ store, handlers: { message: handleAutomateRun }, sessions });
  }

  /** Session 301, the resume run, started by the loop and then held at the push; returns the held approval's id. */
  async function heldRunSession(loop: EventLoop, status = "completed"): Promise<number> {
    queueSourceLaunch();
    await resume();
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (301, 'mason', ?, ?)").run(status, checkout);
    const payload = { ...PUSH, cwd: checkout };
    const held = holdOrUseGrant(store, { agent: "mason", sessionId: 301, action: "git push", payload, tool: "Bash" }, NOW);
    expect(held.kind).toBe("held");
    return held.id;
  }

  const queued = (approval: number) =>
    store.prepare<[string], { payload_json: string }>("SELECT payload_json FROM event_queue WHERE source_ref = ?").get(`approval:${approval}`);

  it("a once decision queues the run's continuation, not a crew message, and the loop continues session 301 under its launch's policy", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const id = await heldRunSession(loop);
    decideApproval(store, { id, decision: "once", by: "owner" }, NOW);
    const payload = JSON.parse(queued(id)?.payload_json ?? "{}") as Record<string, Record<string, unknown>>;
    expect(payload.text).toBeUndefined();
    expect(payload[AUTOMATE_RUN_KEY]).toMatchObject({ kind: "continue", of: "resume", session: 301, run_id: RUN_ID, checkout });
    expect(payload[AUTOMATE_RUN_KEY]?.prompt).toMatch(new RegExp(`^approved approval ${id}: git push\\. Repeat exactly this call once, unchanged: tool Bash`));
    // The run goes on past the one call (live: session 233 stopped at the next phase when told only to repeat it).
    expect(payload[AUTOMATE_RUN_KEY]?.prompt).toMatch(/Then carry on with this run from where it stopped\. Keep going .* until the run ends or another call is held for the owner; do not end your turn between steps\.$/);
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(starts).toHaveLength(2);
    expect(starts[1]).toMatchObject({ agent: "mason", cwd: checkout, continueFrom: 301, prompt: payload[AUTOMATE_RUN_KEY]?.prompt, policy: starts[0]?.policy });
  });

  it("a denial continues it too, so the run hears no and parks itself", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const id = await heldRunSession(loop);
    decideApproval(store, { id, decision: "deny", by: "owner" }, NOW);
    await loop.tick();
    expect(starts[1]).toMatchObject({ continueFrom: 301, prompt: runContinuationPrompt(`denied approval ${id}: git push. Nothing was done; do not repeat the call.`, true) });
    expect(starts[1]?.prompt).toContain("without that call");
  });

  it("the continuation is itself a run session: its own held call continues it in turn, with the first launch's kind", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const id = await heldRunSession(loop);
    decideApproval(store, { id, decision: "once", by: "owner" }, NOW);
    await loop.tick();
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (302, 'mason', 'completed', ?)").run(checkout);
    const pr = { tool: "Bash", command: "gh pr create --base main --body-file .supervisor/pr-body.md", cwd: checkout };
    const second = holdOrUseGrant(store, { agent: "mason", sessionId: 302, action: "gh pr create", payload: pr, tool: "Bash" }, NOW);
    decideApproval(store, { id: second.id, decision: "once", by: "owner" }, NOW);
    expect(JSON.parse(queued(second.id)?.payload_json ?? "{}")[AUTOMATE_RUN_KEY]).toMatchObject({ kind: "continue", of: "resume", session: 302 });
    await loop.tick();
    expect(starts[2]).toMatchObject({ continueFrom: 302, policy: starts[0]?.policy });
  });

  it("a run session still live is not continued (it can repeat the call: the once grant matches it), and nothing else starts", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const id = await heldRunSession(loop, "running");
    decideApproval(store, { id, decision: "once", by: "owner" }, NOW);
    const event = store.prepare<[string], { id: number }>("SELECT id FROM event_queue WHERE source_ref = ?").get(`approval:${id}`);
    await loop.tick();
    expect(starts).toHaveLength(1);
    expect(getWorkStep(store, `event:${event?.id}:automate-run`)?.result).toEqual({ session_id: null, skipped: "continue_session_live: session 301 can repeat the call itself" });
  });

  // PR #291 review: a run session the kernel's own restart ended is `interrupted` (its group confirmed dead). It cannot
  // repeat the held call and `continueFrom` does not take it, so the decision resumes it in place (`resumeSession`).
  it("a run session a kernel restart interrupted is resumed with the decision, under its launch's policy", async () => {
    const starts: StartSessionParams[] = [];
    const resumes: { id: number; params: ResumeSessionParams }[] = [];
    const loop = loopWith(starts, resumes);
    const id = await heldRunSession(loop, "interrupted");
    decideApproval(store, { id, decision: "once", by: "owner" }, NOW);
    const event = store.prepare<[string], { id: number }>("SELECT id FROM event_queue WHERE source_ref = ?").get(`approval:${id}`);
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(starts).toHaveLength(1);
    expect(resumes).toHaveLength(1);
    const prompt = JSON.parse(queued(id)?.payload_json ?? "{}")[AUTOMATE_RUN_KEY]?.prompt;
    expect(resumes[0]).toMatchObject({ id: 301, params: { cwd: checkout, prompt, policy: starts[0]?.policy, playbook: starts[0]?.playbook } });
    expect(getWorkStep(store, `event:${event?.id}:automate-run`)?.result).toEqual({ session_id: 301 });
  });

  // 23u (review of PR #294): a resume in place keeps the resumed session's model, so the version it records is paired
  // with that session, not with the run's source session (which never changes along a continuation chain). Live chain:
  // asked under v1/M1, a continuation started on v2/M2, the owner enabled v3/M3, a restart interrupted the continuation,
  // and the decision resumed it in place: it recorded v1, a version whose model did not run.
  describe("a resume in place records the resumed session's own version and model pair", () => {
    function playbookVersionSnapshot(version: number, model: string): void {
      store
        .prepare("INSERT INTO playbook_versions (playbook, version, snapshot_json, created_at) VALUES (5, ?, ?, '2026-11-18T00:00:00.000Z')")
        .run(version, JSON.stringify({ slug: "pb5", intent: "Hand tickets over", model }));
    }

    /** Session 301 interrupted at v3 on opus (the source session is v2 on sonnet); the playbook then moves to `enabled`. */
    async function resumedAt(enabled: number, snapshotModel?: string): Promise<{ id: number; params: ResumeSessionParams }[]> {
      const starts: StartSessionParams[] = [];
      const resumes: { id: number; params: ResumeSessionParams }[] = [];
      const loop = loopWith(starts, resumes);
      const id = await heldRunSession(loop, "interrupted");
      store.prepare("UPDATE sessions SET playbook = 5, playbook_version = 3, model = 'claude-opus-5-5' WHERE id = 301").run();
      store.prepare("UPDATE playbooks SET version = ? WHERE id = 5").run(enabled);
      if (snapshotModel !== undefined) playbookVersionSnapshot(enabled, snapshotModel);
      decideApproval(store, { id, decision: "once", by: "owner" }, NOW);
      expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
      expect(resumes).toHaveLength(1);
      return resumes;
    }

    it("a newer enabled version on another model: keeps the resumed session's version, not the source session's", async () => {
      const resumes = await resumedAt(4, "claude-haiku-5-5");
      expect(resumes[0]?.params.playbookVersion).toBe(3);
    });

    it("a newer enabled version whose snapshot model is the resumed session's: records the enabled version", async () => {
      const resumes = await resumedAt(4, "claude-opus-5-5");
      expect(resumes[0]?.params.playbookVersion).toBe(4);
    });

    it("the enabled version is the resumed session's own: records it, even with no readable snapshot", async () => {
      const resumes = await resumedAt(3);
      expect(resumes[0]?.params.playbookVersion).toBe(3);
    });
  });

  // PR #291 review: these are the checks that keep a decision on one session from continuing a different one.
  for (const c of [
    { name: "is gone", change: "UPDATE event_queue SET payload_json = json_set(payload_json, '$.automate_run.session', 999) WHERE source_ref LIKE 'approval:%'", skipped: "continue_session_gone: session 999" },
    { name: "is another crew member's", change: "UPDATE sessions SET agent = 'ada' WHERE id = 301", skipped: "continue_session_mismatch: session 301" },
    { name: "ran in another checkout", change: "UPDATE sessions SET cwd = '/elsewhere/repo' WHERE id = 301", skipped: "continue_session_mismatch: session 301" },
    { name: "has no recorded checkout", change: "UPDATE sessions SET cwd = NULL WHERE id = 301", skipped: "continue_session_mismatch: session 301" },
  ]) {
    it(`a decision whose session ${c.name} continues nothing`, async () => {
      const starts: StartSessionParams[] = [];
      const resumes: { id: number; params: ResumeSessionParams }[] = [];
      const loop = loopWith(starts, resumes);
      const id = await heldRunSession(loop);
      decideApproval(store, { id, decision: "once", by: "owner" }, NOW);
      store.prepare(c.change).run();
      const event = store.prepare<[string], { id: number }>("SELECT id FROM event_queue WHERE source_ref = ?").get(`approval:${id}`);
      expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
      expect([starts.length, resumes.length]).toEqual([1, 0]);
      expect(getWorkStep(store, `event:${event?.id}:automate-run`)?.result).toEqual({ session_id: null, skipped: c.skipped });
    });
  }

  it("the manager's own refusal of a continuation (a stopped row whose kill was never confirmed) is a stored skip, not a failed event", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const id = await heldRunSession(loop);
    decideApproval(store, { id, decision: "once", by: "owner" }, NOW);
    const event = store.prepare<[string], { id: number }>("SELECT id FROM event_queue WHERE source_ref = ?").get(`approval:${id}`);
    const refusing = new EventLoop({
      store,
      handlers: { message: handleAutomateRun },
      sessions: {
        startSession: () => Promise.reject(new SessionError("not_resumable", "session 301 is stopped but its kill was never confirmed")),
        resumeSession: () => Promise.reject(new Error("unexpected resume")),
        getSession: (sid) => (sid === CALLER.id ? ({ ...CALLER } as unknown as SessionRow) : (store.prepare("SELECT * FROM sessions WHERE id = ?").get(sid) as SessionRow | undefined)),
      },
    });
    expect(await refusing.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(getWorkStep(store, `event:${event?.id}:automate-run`)?.result).toEqual({
      session_id: null,
      skipped: "continue_session_refused: session 301 is stopped but its kill was never confirmed",
    });
  });

  // `orphaned`: the reaper could not confirm its group dead. `abandoned`: the owner released an orphaned row the kernel
  // could not verify (second PR #291 review), so its group may be alive too, and the manager refuses to continue it.
  for (const status of ["orphaned", "abandoned"]) {
    it(`an ${status} run session (its group may still be alive) is neither continued nor reported as able to repeat the call`, async () => {
      const starts: StartSessionParams[] = [];
      const resumes: { id: number; params: ResumeSessionParams }[] = [];
      const loop = loopWith(starts, resumes);
      const id = await heldRunSession(loop, status);
      decideApproval(store, { id, decision: "once", by: "owner" }, NOW);
      const event = store.prepare<[string], { id: number }>("SELECT id FROM event_queue WHERE source_ref = ?").get(`approval:${id}`);
      expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
      expect([starts.length, resumes.length]).toEqual([1, 0]);
      expect(getWorkStep(store, `event:${event?.id}:automate-run`)?.result).toEqual({
        session_id: null,
        skipped: `continue_session_${status}: session 301 may still be running; the kernel settles it before anything continues it`,
      });
    });
  }

  // 23s gap 3 (live 2026-11-18): approval 56 was held by run session 226, then the owner's next Resume ran the
  // run again in session 227. Deciding 56 after that should continue nothing: 226 is superseded, its call stale.
  // The launch skips it `continue_session_superseded`.
  it("a decision on a superseded run session's request continues nothing once a later Resume ran the run", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const stale = await heldRunSession(loop);
    await resume();
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(starts).toHaveLength(2);
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (302, 'mason', 'completed', ?)").run(checkout);
    decideApproval(store, { id: stale, decision: "deny", by: "owner" }, NOW);
    await loop.tick();
    expect(starts).toHaveLength(2);
    const event = store.prepare<[string], { id: number }>("SELECT id FROM event_queue WHERE source_ref = ?").get(`approval:${stale}`);
    expect(getWorkStep(store, `event:${event?.id}:automate-run`)?.result).toEqual({ session_id: null, skipped: "continue_session_superseded: session 301's run went on in session 302" });
  });

  it("a session no kernel run started (a crew session) still gets the decision as a message", () => {
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (400, 'mason', 'completed', ?)").run(checkout);
    const held = holdOrUseGrant(store, { agent: "mason", sessionId: 400, action: "git push", payload: { ...PUSH, cwd: checkout }, tool: "Bash" }, NOW);
    decideApproval(store, { id: held.id, decision: "once", by: "owner" }, NOW);
    const payload = JSON.parse(queued(held.id)?.payload_json ?? "{}") as Record<string, unknown>;
    expect(payload[AUTOMATE_RUN_KEY]).toBeUndefined();
    expect(payload).toMatchObject({ agent: "mason", approval_id: held.id });
    expect(String(payload.text)).toMatch(/^approved approval/);
  });
});

// ---- an enable wakes the work this playbook's daily limit held (2026-11-17) ----------------------------------
//
// The live case: the owner's Resume (queue 601) was parked `playbook_daily_limit` until the next budget day; the
// owner raised the limit, which made the playbook a draft at a new version, and only its enable puts it back.

describe("enabling a playbook wakes what its daily limit held", () => {
  const LATER = "2026-11-17T18:30:00.000Z";
  const AT = new Date("2026-11-17T16:40:00.000Z");

  /** A pending event parked for `reason` until LATER. */
  function parked(payload: Record<string, unknown>, reason: string): number {
    const id = enqueueEvent(store, { kind: "message", payload }).id;
    store.prepare("UPDATE event_queue SET not_before = ? WHERE id = ?").run(LATER, id);
    appendEvent(store, "event_parked", { sessionId: null, taskId: null }, { queue_id: id, kind: "message", reason, retry_at: LATER, not_before: LATER }, "2026-11-17T16:27:31.000Z");
    return id;
  }
  const notBefore = (id: number): string | null => getQueueRow(store, id)?.not_before ?? null;

  it("wakes this playbook's limit-held resume and playbook runs; never another playbook's, or work held for another reason", () => {
    store.prepare("UPDATE playbooks SET status = 'draft' WHERE id = 5").run();
    const resumeHeld = parked({ agent: "mason", [AUTOMATE_RUN_KEY]: { kind: "resume", run_id: RUN_ID, playbook: 5 } }, "playbook_daily_limit");
    const runHeld = parked({ agent: "mason", playbook: 5, version: 2 }, "playbook_daily_limit");
    const otherPlaybook = parked({ agent: "mason", playbook: 6, version: 1 }, "playbook_daily_limit");
    const otherReason = parked({ agent: "mason", playbook: 5, version: 2 }, "daily_budget");
    enablePlaybook(store, { id: 5, version: 2, sessionId: null, approvalId: 1 }, AT);
    expect(notBefore(resumeHeld)).toBe(AT.toISOString());
    expect(notBefore(runHeld)).toBe(AT.toISOString());
    expect(notBefore(otherPlaybook)).toBe(LATER);
    expect(notBefore(otherReason)).toBe(LATER);
    const enabled = store.prepare<[], { payload_json: string }>("SELECT payload_json FROM events WHERE kind = 'playbook_enabled' ORDER BY id DESC LIMIT 1").get();
    expect(JSON.parse(enabled?.payload_json ?? "{}")).toMatchObject({ playbook_id: 5, woke_limit_held: 2 });
  });

  it("the owner raising the limit wakes it at once (the live case: queue 601 waited for midnight); the same value wakes nothing", () => {
    const resumeHeld = parked({ agent: "mason", [AUTOMATE_RUN_KEY]: { kind: "resume", run_id: RUN_ID, playbook: 5 } }, "playbook_daily_limit");
    setPlaybookPolicy(store, { id: 5, field: "token_limit", value: 3_000_000 }, AT);
    expect(notBefore(resumeHeld)).toBe(AT.toISOString());
    const again = parked({ agent: "mason", playbook: 5, version: 3 }, "playbook_daily_limit");
    setPlaybookPolicy(store, { id: 5, field: "token_limit", value: 3_000_000 }, AT);
    expect(notBefore(again)).toBe(LATER);
    setPlaybookPolicy(store, { id: 5, field: "priority", value: "high" }, AT);
    expect(notBefore(again)).toBe(LATER);
  });
});

// ---- a run launches only while its playbook is enabled ---------------------------------------------------
//
// Live, 2026-11-17: the owner raised playbook 18's daily limit, which made version 3 a draft (a changed playbook waits
// for the owner's review), while a Resume of its run was queued. A playbook's own runs skip anything not `enabled`
// (`playbooks/runs.ts`, `triggers/poll.ts`); the kernel's run launch read only `mode`, so it would have started the
// draft's run. Now a turned-off playbook, or a draft at a newer version than the launch's own (a change waiting for
// the owner's review), launches nothing and offers no Resume.

describe("a run launches only while its playbook is not turned off or waiting for review", () => {
  function loopWith(starts: StartSessionParams[]): EventLoop {
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, 'mason', 'completed', ?)").run(CALLER.id, checkout);
    const sessions: EventSessions = {
      async startSession(params) {
        starts.push(params);
        return { id: 300 + starts.length } as unknown as SessionHandle;
      },
      resumeSession: () => Promise.reject(new Error("unexpected resume")),
      getSession: (id) => (id === CALLER.id ? ({ ...CALLER } as unknown as SessionRow) : undefined),
    };
    return new EventLoop({ store, handlers: { message: handleAutomateRun }, sessions });
  }

  it("a draft (mode live, status draft) is not resumable, and a queued launch starts nothing", async () => {
    queueSourceLaunch();
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    const { queue_id } = (await resume()).body as { queue_id: number };
    store.prepare("UPDATE playbooks SET status = 'draft', version = 3 WHERE id = 5").run();
    expect(listPausedRuns(store).runs[0]?.blocked).toBe("playbook_not_live");
    await loop.tick();
    expect(starts).toEqual([]);
    expect(getWorkStep(store, `event:${queue_id}:automate-run`)?.result).toEqual({ session_id: null, skipped: "playbook_not_enabled: playbook 5 is a draft at version 3 waiting for review" });
  });

  it("a draft at the launch's own version still launches (a playbook the owner's ask starts, the phase 8 exit flow)", async () => {
    queueSourceLaunch();
    store.prepare("UPDATE playbooks SET status = 'draft' WHERE id = 5").run();
    expect(listPausedRuns(store).runs[0]?.blocked).toBeNull();
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    await resume();
    await loop.tick();
    expect(starts).toHaveLength(1);
  });

  it("once the owner enables the new version, Resume is offered again", () => {
    queueSourceLaunch();
    store.prepare("UPDATE playbooks SET status = 'enabled', version = 3 WHERE id = 5").run();
    expect(listPausedRuns(store).runs[0]?.blocked).toBeNull();
  });

  it("a turned-off playbook (disabled) is not resumable either", () => {
    queueSourceLaunch();
    store.prepare("UPDATE playbooks SET status = 'disabled' WHERE id = 5").run();
    expect(listPausedRuns(store).runs[0]?.blocked).toBe("playbook_not_live");
  });
});

// ---- Reply to a run: the owner answers the question a run session ended its turn on -------------------------
//
// The live case (2026-11-18): run session 235 saw the item's PR closed by the owner and ended its turn asking
// "redo, reopen or drop?". A Resume starts a new session that sees the same facts and asks again, so nothing in
// Studio could answer it. The list now carries the run's newest session and its last message, and a reply
// continues THAT session (the same `continue` event an approval decision queues).

describe("the owner replies to a run's last message", () => {
  function loopWith(starts: StartSessionParams[]): EventLoop {
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, 'mason', 'completed', ?)").run(CALLER.id, checkout);
    const sessions: EventSessions = {
      async startSession(params) {
        starts.push(params);
        return { id: 300 + starts.length } as unknown as SessionHandle;
      },
      resumeSession: () => Promise.reject(new Error("unexpected resume")),
      getSession: (id) => (id === CALLER.id ? ({ ...CALLER } as unknown as SessionRow) : (store.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined)),
    };
    return new EventLoop({ store, handlers: { message: handleAutomateRun }, sessions });
  }

  const reply = (body: unknown, runId = RUN_ID) => {
    const route = resumeRoutes.find((r) => r.path.endsWith("/reply"));
    if (route === undefined) throw new Error("no reply route");
    return route.handler(req("POST", { run_id: runId }, body));
  };

  /** Session 301, a resume run that ended its turn on a question. */
  async function askingRunSession(loop: EventLoop): Promise<void> {
    writeRun(RUN_ID, STRANDED);
    writeRunLock(checkout, DEAD_PID);
    queueSourceLaunch();
    await resume();
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (301, 'mason', 'completed', ?)").run(checkout);
    store.prepare("INSERT INTO session_output (session_id, seq, kind, payload_json) VALUES (301, 1, 'assistant_text', ?)").run(JSON.stringify({ text: "PR #19 was closed. Redo it, reopen it, or drop the item?" }));
  }

  it("lists the run's newest session and its last message, and a reply continues that session under its launch's policy", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    await askingRunSession(loop);
    expect(listPausedRuns(store).runs[0]?.last_session).toEqual({ id: 301, status: "completed", message: "PR #19 was closed. Redo it, reopen it, or drop the item?" });
    const res = await reply({ agent: "mason", checkout, text: "  Redo it.  " });
    expect(res).toMatchObject({ status: 200, body: { session: 301, run_id: RUN_ID } });
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(starts).toHaveLength(2);
    expect(starts[1]).toMatchObject({ agent: "mason", cwd: checkout, continueFrom: 301, policy: starts[0]?.policy });
    expect(starts[1]?.prompt).toMatch(/^The owner replied to your last message: "Redo it\.". Act on that reply only through this run's own steps: ask the run's driver for its next step/);
    // Live: "Act on that reply" alone let session 236 build, commit and push the item with no driver call.
    expect(starts[1]?.prompt).toContain("never done directly in this session");
    expect(starts[1]?.prompt).toMatch(/do not end your turn between steps\.$/);
    const recorded = store.prepare<[], string>("SELECT payload_json FROM events WHERE kind = 'run_reply_sent'").pluck().all();
    expect(recorded.map((p) => JSON.parse(p))).toEqual([{ run_id: RUN_ID, checkout, queue_id: (res.body as { queue_id: number }).queue_id, chars: 8 }]);
  });

  it("refuses an empty or too long reply, a run with no kernel session, and a run whose session is live", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    writeRun(RUN_ID, STRANDED);
    writeRunLock(checkout, DEAD_PID);
    queueSourceLaunch();
    expect(listPausedRuns(store).runs[0]?.last_session).toBeNull();
    expect(await reply({ agent: "mason", checkout, text: "Redo" })).toMatchObject({ status: 409, body: { error: "no_run_session" } });
    await askingRunSession(loop);
    expect(await reply({ agent: "mason", checkout, text: "   " })).toMatchObject({ status: 400, body: { error: "invalid_body" } });
    expect(await reply({ agent: "mason", checkout, text: "x".repeat(4001) })).toMatchObject({ status: 400, body: { error: "invalid_body" } });
    expect(await reply({ agent: "mason", checkout })).toMatchObject({ status: 400, body: { error: "invalid_body" } });
    store.prepare("UPDATE sessions SET status = 'running' WHERE id = 301").run();
    expect(await reply({ agent: "mason", checkout, text: "Redo" })).toMatchObject({ status: 409, body: { error: "run_live" } });
  });

  // 23u (review of PR #292): a queued reply (a pending `continue`) was not counted, so a second reply or a Resume could
  // run first and the first reply was then skipped as superseded, its words lost after the card said "Sent".
  it("a reply still queued blocks a second reply and a Resume, so neither can make the first one superseded", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    await askingRunSession(loop);
    expect(await reply({ agent: "mason", checkout, text: "Redo it." })).toMatchObject({ status: 200 });
    expect(listPausedRuns(store).runs[0]?.blocked).toBe("continuation_queued");
    expect(await reply({ agent: "mason", checkout, text: "Actually, drop it." })).toMatchObject({ status: 409, body: { error: "continuation_queued" } });
    expect(await resume()).toMatchObject({ status: 409, body: { error: "continuation_queued" } });
    // Once handled, the run is open to the next reply again.
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(starts).toHaveLength(2);
    expect(listPausedRuns(store).runs[0]?.blocked).not.toBe("continuation_queued");
  });

  it("after a later Resume the list points the next reply at the newer session (the launch refuses a superseded one, 23s gap 3)", async () => {
    const starts: StartSessionParams[] = [];
    const loop = loopWith(starts);
    await askingRunSession(loop);
    const res = await reply({ agent: "mason", checkout, text: "Redo" });
    // A later Resume ran the run before the reply's event was handled.
    store.prepare("UPDATE event_queue SET status = 'done' WHERE id = ?").run((res.body as { queue_id: number }).queue_id);
    await resume();
    expect(await loop.tick()).toMatchObject({ done: 1 });
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (302, 'mason', 'completed', ?)").run(checkout);
    // The list now points the next reply at the newer session.
    expect(listPausedRuns(store).runs[0]?.last_session?.id).toBe(302);
  });
});

// ---- The run's playbook version: the one the owner enabled -------------------------------------------------
//
// Live 2026-11-18: the run was first prepared under playbook 18 v2; the owner re-enabled the playbook at v3, and every
// later resume, reply and continuation still launched as v2 (copied from the source session), so "always" on its
// held push (approval 62) was refused as not the playbook's current version.

describe("a resumed run launches under the playbook version the owner enabled", () => {
  it("the playbook is enabled at v3 while the run was prepared under v2: the session starts as v3", async () => {
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, 'mason', 'completed', ?)").run(CALLER.id, checkout);
    store.prepare("UPDATE playbooks SET version = 3 WHERE id = 5").run();
    snapshot(3, "claude-sonnet-5-5");
    const starts: StartSessionParams[] = [];
    const sessions: EventSessions = {
      async startSession(params) {
        starts.push(params);
        return { id: 300 + starts.length } as unknown as SessionHandle;
      },
      resumeSession: () => Promise.reject(new Error("unexpected resume")),
      getSession: (id) => (id === CALLER.id ? ({ ...CALLER } as unknown as SessionRow) : undefined),
    };
    const loop = new EventLoop({ store, handlers: { message: handleAutomateRun }, sessions });
    queueSourceLaunch();
    await resume();
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(CALLER.playbook_version).toBe(2);
    expect(starts[0]).toMatchObject({ playbook: 5, playbookVersion: 3 });
  });

  // 23u (review of PR #292): the version and its model are one pair. The run took v3 but kept v2's model (the source
  // session's), so the session row and audit named a version whose model did not run.
  it("runs on the enabled version's own model, not the source session's", async () => {
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, 'mason', 'completed', ?)").run(CALLER.id, checkout);
    store.prepare("UPDATE playbooks SET version = 3 WHERE id = 5").run();
    snapshot(3, "claude-opus-5-5");
    const starts: StartSessionParams[] = [];
    const loop = versionLoop(starts);
    queueSourceLaunch();
    await resume();
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(starts[0]).toMatchObject({ playbookVersion: 3, model: "claude-opus-5-5" });
  });

  it("with no readable snapshot of the enabled version, keeps the source session's version and model together", async () => {
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, 'mason', 'completed', ?)").run(CALLER.id, checkout);
    store.prepare("UPDATE playbooks SET version = 3 WHERE id = 5").run();
    const starts: StartSessionParams[] = [];
    const loop = versionLoop(starts);
    queueSourceLaunch();
    await resume();
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(starts[0]).toMatchObject({ playbookVersion: 2, model: CALLER.model });
  });

  function versionLoop(starts: StartSessionParams[]): EventLoop {
    const sessions: EventSessions = {
      async startSession(params) {
        starts.push(params);
        return { id: 300 + starts.length } as unknown as SessionHandle;
      },
      resumeSession: () => Promise.reject(new Error("unexpected resume")),
      getSession: (id) => (id === CALLER.id ? ({ ...CALLER } as unknown as SessionRow) : undefined),
    };
    return new EventLoop({ store, handlers: { message: handleAutomateRun }, sessions });
  }

  function snapshot(version: number, model: string): void {
    store
      .prepare("INSERT INTO playbook_versions (playbook, version, snapshot_json, created_at) VALUES (5, ?, ?, '2026-11-18T00:00:00.000Z')")
      .run(version, JSON.stringify({ slug: "pb5", intent: "Hand tickets over", model }));
  }
});

// ---- 23t: the repo's required checks reach the run's drain --------------------------------------------------

describe("a run launch hands the repo's detected required checks to the drain", () => {
  it("fails open: a hand-over it must skip (the config is not git-ignored) still starts the session, and records why", async () => {
    execFileSync("git", ["init", "-q", checkout]);
    store
      .prepare("INSERT INTO repo_policies (repo, policy_kind, detected_json, set_by, set_at) VALUES ('o/r', 'solo', ?, 'owner', '2026-11-12T15:27:31.829Z')")
      .run(JSON.stringify({ repo: "o/r", protection: "protected", required_checks: ["ci"] }));
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, 'mason', 'completed', ?)").run(CALLER.id, checkout);
    const starts: StartSessionParams[] = [];
    const sessions: EventSessions = {
      async startSession(params) {
        starts.push(params);
        return { id: 301 } as unknown as SessionHandle;
      },
      resumeSession: () => Promise.reject(new Error("unexpected resume")),
      getSession: (id) => (id === CALLER.id ? ({ ...CALLER } as unknown as SessionRow) : undefined),
    };
    const loop = new EventLoop({ store, handlers: { message: handleAutomateRun }, sessions });
    queueSourceLaunch();
    await resume();
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(starts).toHaveLength(1);
    expect(existsSync(join(checkout, ".supervisor", "config.json"))).toBe(false);
    const recorded = store.prepare<[], string>("SELECT payload_json FROM events WHERE kind = 'run_required_checks'").pluck().all();
    expect(recorded.map((p) => JSON.parse(p))).toEqual([{ repo: "o/r", checkout, skipped: "not_ignored" }]);
  });

  it("writes required_checks into the checkout's git-ignored Loomwright config before the session starts, and records it", async () => {
    execFileSync("git", ["init", "-q", checkout]);
    writeFileSync(join(checkout, ".git", "info", "exclude"), ".supervisor/\n");
    store
      .prepare("INSERT INTO repo_policies (repo, policy_kind, detected_json, set_by, set_at) VALUES ('o/r', 'solo', ?, 'owner', '2026-11-12T15:27:31.829Z')")
      .run(JSON.stringify({ repo: "o/r", protection: "protected", required_checks: ["ci"], read_at: "2026-11-12T15:27:13.350Z" }));
    store.prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, 'mason', 'completed', ?)").run(CALLER.id, checkout);
    let configAtStart: unknown;
    const sessions: EventSessions = {
      async startSession() {
        configAtStart = JSON.parse(readFileSync(join(checkout, ".supervisor", "config.json"), "utf8"));
        return { id: 301 } as unknown as SessionHandle;
      },
      resumeSession: () => Promise.reject(new Error("unexpected resume")),
      getSession: (id) => (id === CALLER.id ? ({ ...CALLER } as unknown as SessionRow) : undefined),
    };
    const loop = new EventLoop({ store, handlers: { message: handleAutomateRun }, sessions });
    queueSourceLaunch();
    await resume();
    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(configAtStart).toEqual({ required_checks: ["ci"] });
    const recorded = store.prepare<[], string>("SELECT payload_json FROM events WHERE kind = 'run_required_checks'").pluck().all();
    expect(recorded.map((p) => JSON.parse(p))).toEqual([{ repo: "o/r", checkout, written: ["ci"] }]);
  });
});
