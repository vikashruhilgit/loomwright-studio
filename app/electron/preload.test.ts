// The preload pin (Criterion 8): exactly one key, `api`, goes on `window`
// through `contextBridge.exposeInMainWorld`, and it only forwards to the main
// process over IPC: no `ipcRenderer`, no channel names, no Node API and no
// token reach the renderer.
import { beforeAll, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  exposed: [] as { key: string; value: unknown }[],
  invoked: [] as { channel: string; args: unknown[] }[],
  listeners: new Map<string, ((event: unknown, value: unknown) => void)[]>(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      electron.exposed.push({ key, value });
    },
  },
  ipcRenderer: {
    invoke: async (channel: string, ...args: unknown[]) => {
      electron.invoked.push({ channel, args });
      return { channel };
    },
    on: (channel: string, listener: (event: unknown, value: unknown) => void) => {
      electron.listeners.set(channel, [...(electron.listeners.get(channel) ?? []), listener]);
    },
    removeListener: (channel: string, listener: (event: unknown, value: unknown) => void) => {
      electron.listeners.set(
        channel,
        (electron.listeners.get(channel) ?? []).filter((l) => l !== listener),
      );
    },
  },
}));

beforeAll(async () => {
  await import("./preload");
});

function bridge(): Record<string, unknown> {
  return electron.exposed[0]?.value as Record<string, unknown>;
}

describe("the preload bridge", () => {
  it("exposes exactly one key, api, once", () => {
    expect(electron.exposed.map((e) => e.key)).toEqual(["api"]);
  });

  it("holds only the bridge's methods: nothing that is ipcRenderer, a Node API or a secret", () => {
    const api = bridge();
    expect(Object.keys(api).sort()).toEqual(["connection", "feed", "onNavigate", "openExternal", "prefs", "request"]);
    expect(Object.keys(api.feed as object).sort()).toEqual(["onFrame", "subscribe", "unsubscribe"]);
    expect(Object.keys(api.prefs as object).sort()).toEqual(["get", "revealDataDir", "set"]);
    for (const value of [...Object.values(api), ...Object.values(api.feed as object), ...Object.values(api.prefs as object)]) {
      if (value !== api.feed && value !== api.prefs) expect(typeof value).toBe("function");
    }
    expect(JSON.stringify(Object.keys(api))).not.toMatch(/token|ipc|require|process/i);
  });

  it("forwards each call to the main process over its channel", async () => {
    const api = bridge() as unknown as {
      connection(): Promise<unknown>;
      request(r: unknown): Promise<unknown>;
      feed: { subscribe(after: number): Promise<unknown>; unsubscribe(): Promise<unknown> };
      openExternal(url: string): Promise<unknown>;
      prefs: { get(): Promise<unknown>; set(patch: unknown): Promise<unknown>; revealDataDir(...args: unknown[]): Promise<unknown> };
    };
    const request = { method: "GET", path: "/status" };
    await api.connection();
    await api.request(request);
    await api.feed.subscribe(7);
    await api.feed.unsubscribe();
    await api.openExternal("https://github.com/settings/installations");
    await api.prefs.get();
    await api.prefs.set({ theme: "dark" });
    await api.prefs.revealDataDir("/Users/o/.ssh");
    expect(electron.invoked).toEqual([
      { channel: "studio:connection", args: [] },
      { channel: "studio:request", args: [request] },
      { channel: "studio:feed:subscribe", args: [7] },
      { channel: "studio:feed:unsubscribe", args: [] },
      { channel: "studio:open-external", args: ["https://github.com/settings/installations"] },
      { channel: "studio:prefs:get", args: [] },
      { channel: "studio:prefs:set", args: [{ theme: "dark" }] },
      // Reveal sends nothing: the main process opens its own data dir, never a path from the renderer.
      { channel: "studio:reveal-data-dir", args: [] },
    ]);
  });

  it("hands a listener only the payload, never the IPC event, and unsubscribes it", () => {
    const api = bridge() as unknown as { feed: { onFrame(l: (f: unknown) => void): () => void } };
    const seen: unknown[] = [];
    const off = api.feed.onFrame((frame) => seen.push(frame));
    const [listener] = electron.listeners.get("studio:feed:frame") ?? [];
    listener?.({ sender: "the IPC event" }, { type: "heartbeat", latest_id: 3 });
    expect(seen).toEqual([{ type: "heartbeat", latest_id: 3 }]);
    off();
    expect(electron.listeners.get("studio:feed:frame")).toEqual([]);
  });
});
