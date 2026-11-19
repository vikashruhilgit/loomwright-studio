// Which later kernel run session supersedes an earlier one (23s gap 3): only one of the same run, in the same checkout.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTOMATE_RUN_KEY, laterRunSessionOf, runLaunchOf } from "../src/automate/run-sessions.js";
import { Store } from "../src/store/index.js";

let tmp: string;
let store: Store;
let nextEvent = 1;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-run-sessions-"));
  store = new Store({ dataDir: join(tmp, "data") });
  nextEvent = 1;
});
afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** A done `automate-run` step that started `session` from a launch of `run`. */
function launched(session: number, run: Record<string, unknown>): void {
  const id = nextEvent++;
  store.prepare("INSERT INTO event_queue (id, kind, payload_json, status) VALUES (?, 'message', ?, 'done')").run(id, JSON.stringify({ agent: "mason", [AUTOMATE_RUN_KEY]: run }));
  store.prepare("INSERT INTO work_steps (key, status, result_json) VALUES (?, 'done', ?)").run(`event:${id}:automate-run`, JSON.stringify({ session_id: session }));
}

const later = (session: number) => {
  const launch = runLaunchOf(store, session);
  return launch === undefined ? "no launch" : laterRunSessionOf(store, session, launch);
};

describe("laterRunSessionOf", () => {
  const RESUME = { kind: "resume", run_id: "automate-2026-11-17-001", repo: "o/r", checkout: "/w/sandbox" };

  it("the live case: a later Resume of the same run supersedes the earlier session", () => {
    launched(226, RESUME);
    launched(227, RESUME);
    expect(later(226)).toBe(227);
    expect(later(227)).toBeUndefined();
  });

  it("a continuation carrying the run (same run_id) supersedes too; the newest session is never superseded", () => {
    launched(227, RESUME);
    launched(228, { ...RESUME, kind: "continue", of: "resume", session: 227, prompt: "approved" });
    expect(later(227)).toBe(228);
    expect(later(228)).toBeUndefined();
  });

  // 23u (review of PR #292): the checkout is compared resolved, as `latestRunSessionOf` compares it; a Resume queued from
  // the paused-runs list carries the workspace as the crew member's settings spell it.
  it("the same checkout spelled differently (a trailing slash, a dot segment) is the same run", () => {
    launched(226, RESUME);
    launched(227, { ...RESUME, checkout: "/w/sandbox/" });
    launched(228, { ...RESUME, checkout: "/w/./sandbox" });
    expect(later(226)).toBe(227);
    expect(later(227)).toBe(228);
  });

  it("another run, another checkout, or another PR drain in the same checkout does not supersede", () => {
    launched(226, RESUME);
    launched(230, { ...RESUME, run_id: "automate-2026-11-18-001" });
    launched(231, { ...RESUME, checkout: "/w/other" });
    launched(232, { kind: "review_pr", repo: "o/r", pr: 18, checkout: "/w/sandbox" });
    expect(later(226)).toBeUndefined();
  });

  it("backlog launches match by backlog; a review drain by repo and PR", () => {
    launched(240, { kind: "backlog", backlog: ".supervisor/b.md", repo: "o/r", checkout: "/w/sandbox" });
    launched(241, { kind: "review_pr", repo: "o/r", pr: 18, checkout: "/w/sandbox" });
    launched(242, { kind: "backlog", backlog: ".supervisor/b.md", repo: "o/r", checkout: "/w/sandbox" });
    launched(243, { kind: "review_pr", repo: "o/r", pr: 18, checkout: "/w/sandbox" });
    expect(later(240)).toBe(242);
    expect(later(241)).toBe(243);
  });
});
