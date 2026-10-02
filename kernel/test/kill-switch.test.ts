// The kill switch's durable state (item 08): derived from the append-only
// `events` log, so it survives closing and reopening the Store (a restart).
import { afterEach, describe, expect, it } from "vitest";
import {
  KILL_SWITCH_ENGAGED,
  KILL_SWITCH_RELEASED,
  engageKillSwitch,
  isKillSwitchEngaged,
  killSwitchState,
  releaseKillSwitch,
} from "../src/api/index.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

let env: LoopEnv | undefined;

afterEach(() => {
  env?.cleanup();
  env = undefined;
});

function switchEvents(e: LoopEnv): { kind: string; actor: string | null }[] {
  return e.store
    .prepare<[string, string], { kind: string; actor: string | null }>("SELECT kind, actor FROM events WHERE kind IN (?, ?) ORDER BY id")
    .all(KILL_SWITCH_ENGAGED, KILL_SWITCH_RELEASED);
}

describe("kill switch state", () => {
  it("is released on a fresh store", () => {
    env = loopEnv();
    expect(isKillSwitchEngaged(env.store)).toBe(false);
    expect(killSwitchState(env.store)).toEqual({ engaged: false, since: null });
  });

  it("follows the latest engaged/released event, and `since` is the first engage since the last release", () => {
    env = loopEnv();
    const store = env.store;
    engageKillSwitch(store, "2026-10-02T10:00:00.000Z");
    expect(killSwitchState(store)).toEqual({ engaged: true, since: "2026-10-02T10:00:00.000Z" });
    // Engaging again is audited but keeps the original `since`.
    engageKillSwitch(store, "2026-10-02T10:05:00.000Z");
    expect(killSwitchState(store)).toEqual({ engaged: true, since: "2026-10-02T10:00:00.000Z" });
    releaseKillSwitch(store, "2026-10-02T11:00:00.000Z");
    expect(isKillSwitchEngaged(store)).toBe(false);
    // Unrelated events never change it.
    store.prepare("INSERT INTO events (kind, actor) VALUES ('notify', 'kernel')").run();
    expect(isKillSwitchEngaged(store)).toBe(false);
    engageKillSwitch(store, "2026-10-02T12:00:00.000Z");
    expect(killSwitchState(store)).toEqual({ engaged: true, since: "2026-10-02T12:00:00.000Z" });
    expect(switchEvents(env)).toEqual([
      { kind: "kill_switch_engaged", actor: "api" },
      { kind: "kill_switch_engaged", actor: "api" },
      { kind: "kill_switch_released", actor: "api" },
      { kind: "kill_switch_engaged", actor: "api" },
    ]);
  });

  it("survives closing and reopening the Store (a kernel restart cannot release it)", () => {
    env = loopEnv();
    engageKillSwitch(env.store, "2026-10-02T10:00:00.000Z");
    const reopened = env.restart();
    expect(isKillSwitchEngaged(reopened)).toBe(true);
    releaseKillSwitch(reopened, "2026-10-02T10:30:00.000Z");
    expect(isKillSwitchEngaged(env.restart())).toBe(false);
  });
});
