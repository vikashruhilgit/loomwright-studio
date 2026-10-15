// The handler-sessions seam (AC8): an `EventLoop` built with `sessions` passes
// that object as `ctx.sessions` to every handler; without it handlers see
// `undefined`. A handler can start a session through the seam (here the real
// `SessionManager` over the fake spawner/query) without awaiting it. Never the
// real SDK, a model or a real process.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventLoop, enqueueEvent, enqueueMessage, getQueueRow } from "../src/loop/index.js";
import type { EventContext } from "../src/loop/index.js";
import type { EventSessions } from "../src/loop/types.js";
import { SessionManager } from "../src/sessions/index.js";
import type { SessionHandle } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { count, events } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

let tmp: string;
let store: Store;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-loop-sessions-"));
  store = new Store({ dataDir: join(tmp, "data") });
});

afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** An `EventSessions` that records nothing and is never called: identity is what is checked. */
function stubSessions(): EventSessions {
  const never = (): never => {
    throw new Error("unexpected call");
  };
  return { startSession: never, resumeSession: never, getSession: never };
}

describe("EventLoop: ctx.sessions", () => {
  it("passes the `sessions` it was built with to every handler, for every kind", async () => {
    const sessions = stubSessions();
    const seen: (EventSessions | undefined)[] = [];
    const record = (ctx: EventContext): void => void seen.push(ctx.sessions);
    const loop = new EventLoop({ store, handlers: { message: record, wakeup: record }, sessions });
    enqueueMessage(store, { text: "hello" });
    enqueueEvent(store, { kind: "wakeup", payload: { reason: "r" } });
    enqueueMessage(store, { text: "again", agent: "wright" });

    expect(await loop.tick()).toMatchObject({ done: 3, unhandled: 0, failed: 0 });
    expect(seen).toHaveLength(3);
    for (const s of seen) expect(s).toBe(sessions);
  });

  it("without `sessions`, ctx.sessions is undefined and the event is still handled", async () => {
    const seen: (EventSessions | undefined | "unset")[] = ["unset"];
    const loop = new EventLoop({ store, handlers: { message: (ctx) => void (seen[0] = ctx.sessions) } });
    const { id } = enqueueMessage(store, { text: "hello" });

    expect(await loop.tick()).toMatchObject({ done: 1 });
    expect(seen[0]).toBeUndefined();
    expect(getQueueRow(store, id)?.status).toBe("done");
  });

  it("an unhandled kind is still event_unhandled with `sessions` given: the seam adds no behaviour", async () => {
    const loop = new EventLoop({ store, handlers: {}, sessions: stubSessions() });
    enqueueMessage(store, { text: "hello" });

    expect(await loop.tick()).toMatchObject({ done: 0, unhandled: 1 });
    expect(events(store, "event_unhandled")).toHaveLength(1);
  });

  it("a handler starts a session through ctx.sessions (a real SessionManager), records its id in a step, and does not await it", async () => {
    const fakes = fakeSessions({ exitOnInputEnd: true });
    const manager = new SessionManager(
      { store, authProvider: stubProvider(), loomwrightPath: makePluginDir(tmp), stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" } },
      fakes.deps,
    );
    let handle: SessionHandle | undefined;
    const loop = new EventLoop({
      store,
      sessions: manager,
      handlers: {
        message: async (ctx) => {
          const sessions = ctx.sessions;
          if (sessions === undefined) throw new Error("no sessions");
          const started = await ctx.runStepAsync("start-session", async () => {
            handle = await sessions.startSession(startParams(tmp, { prompt: String(ctx.event.payload.text) }));
            return handle.id;
          });
          expect(sessions.getSession(started)?.agent).toBe("wright");
        },
      },
    });
    const { id } = enqueueMessage(store, { text: "hi", agent: "wright" });

    expect(await loop.tick()).toMatchObject({ done: 1, failed: 0 });
    expect(getQueueRow(store, id)?.status).toBe("done");
    expect(fakes.calls).toHaveLength(1);
    const h = handle as SessionHandle;
    // The event is done while the session is still running: the loop never waited for it.
    expect(manager.getSession(h.id)?.status).toMatch(/^(starting|running)$/);

    fakes.calls[0]?.stream.push({ type: "result", subtype: "success", is_error: false, result: "hi back", modelUsage: {} } as unknown as SDKMessage);
    expect(await h.done).toBe("completed");
    expect(await h.result).toBe("hi back");
    await vi.waitFor(() => expect(fakes.allGroupsGone()).toBe(true));
    expect(count(store, "SELECT count(*) FROM sessions")).toBe(1);
  });
});
