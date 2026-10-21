// The feed seam's failure path (phase 5): when `handleEventFeed` throws or
// rejects, the API server terminates that one socket and keeps answering.
// Its own file because it mocks `../src/api/feed.js`, which would replace the
// stub the feed tests in api.test.ts pin.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { Store } from "../src/store/index.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const TOKEN = "0123456789abcdef".repeat(4);
const NOW = new Date("2026-10-02T10:00:00.000Z");

// What the mocked handler does on the next socket; reset before every test.
const handler = vi.hoisted(() => ({ mode: "throw" as "throw" | "reject", calls: 0 }));
vi.mock("../src/api/feed.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/feed.js")>();
  return {
    ...actual,
    handleEventFeed: (): void | Promise<void> => {
      handler.calls += 1;
      if (handler.mode === "throw") throw new Error("feed handler threw");
      return Promise.reject(new Error("feed handler rejected"));
    },
  };
});

let tmp: string;
let store: Store;
let server: ApiServer | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-api-feed-"));
  store = new Store({ dataDir: join(tmp, "data") });
  handler.calls = 0;
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function serve(): Promise<ApiServer> {
  server = await startApiServer(
    {
      store,
      sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
      loop: { start: () => undefined, stop: async () => undefined },
      authProviders: [stubProvider()],
      token: TOKEN,
      port: 0,
    },
    { now: () => NOW, startedAt: NOW, pid: 4242, dayOf: (d) => d.toISOString().slice(0, 10) },
  );
  return server;
}

/** Open the feed with the token; resolves with the close the client saw, or rejects after 5 s. */
function openAndAwaitClose(port: number): Promise<{ opened: boolean; code: number }> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/events/stream`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    let opened = false;
    const timer = setTimeout(() => {
      client.terminate();
      reject(new Error("the server never closed the feed socket"));
    }, 5_000);
    client.on("open", () => {
      opened = true;
    });
    client.on("error", () => {});
    client.on("close", (code: number) => {
      clearTimeout(timer);
      resolve({ opened, code });
    });
  });
}

describe("a feed handler that fails: the socket is terminated, the daemon keeps answering", () => {
  for (const mode of ["throw", "reject"] as const) {
    it(`a handler that ${mode}s: that socket is terminated (1006, no close frame) and GET /status still answers 200`, async () => {
      handler.mode = mode;
      const api = await serve();
      const closed = await openAndAwaitClose(api.port);
      expect(handler.calls).toBe(1);
      expect(closed).toEqual({ opened: true, code: 1006 });
      const status = await fetch(`http://127.0.0.1:${api.port}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      await status.text();
      expect(status.status).toBe(200);
    });
  }
});
