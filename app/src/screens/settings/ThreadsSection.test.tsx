// @vitest-environment jsdom
// Settings → Threads (phase 8 item 17c, AC7 Settings): each agent's size hint, read-only, against a scripted bridge
// (`fake-bridge.ts`). The pure reader `hintOf` and the row's words `hintWords`; the section's rows (Wright first, from
// `GET /threads/wright`'s body; a crew member from `GET /agents/:id`'s `settings.content`), "set by you" and "not set",
// a file the kernel refuses, a failed or unreachable read, the roster's own states, no Save / field / proposal /
// reference limit / dollar sign anywhere, kernel text shown literally, and no read while offline. The built app is
// covered by `e2e/settings-threads.spec.ts`.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiRequest, ApiResult, RosterEntry } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { agent } from "../integrations/test-support";
import { HINT_NOT_SET, SETTINGS_TEST_IDS as IDS, hintFile, hintOf, hintWords } from "./model";
import { SettingsScreen } from "./SettingsScreen";
import { STATUS, UNREACHABLE, settingsBody } from "./test-support";
import { ThreadsSection } from "./ThreadsSection";

afterEach(() => {
  cleanup();
});

// ---- The pure reader and the words ----------------------------------------------------------------------------------

describe("hintOf", () => {
  it("accepts only a positive safe integer under thread_summarize_hint_tokens", () => {
    expect(hintOf({ thread_summarize_hint_tokens: 40_000 })).toBe(40_000);
    expect(hintOf({ thread_summarize_hint_tokens: 1 })).toBe(1);
    expect(hintOf({ thread_summarize_hint_tokens: Number.MAX_SAFE_INTEGER })).toBe(Number.MAX_SAFE_INTEGER);
    // Wright's `GET /threads/wright` body carries the kernel's reading under the same name.
    expect(hintOf({ items: [], next_before: null, pending_approvals: [], thread_summarize_hint_tokens: 9_000 })).toBe(9_000);
  });

  it.each([
    ["absent", {}],
    ["null", { thread_summarize_hint_tokens: null }],
    ["zero", { thread_summarize_hint_tokens: 0 }],
    ["negative", { thread_summarize_hint_tokens: -5 }],
    ["fractional", { thread_summarize_hint_tokens: 1.5 }],
    ["a numeric string", { thread_summarize_hint_tokens: "40000" }],
    ["NaN", { thread_summarize_hint_tokens: Number.NaN }],
    ["Infinity", { thread_summarize_hint_tokens: Number.POSITIVE_INFINITY }],
    ["past the safe integers", { thread_summarize_hint_tokens: Number.MAX_SAFE_INTEGER + 2 }],
    ["an object", { thread_summarize_hint_tokens: { v: 40_000 } }],
    ["a null content", null],
    ["an undefined content", undefined],
    ["an array content", [{ thread_summarize_hint_tokens: 40_000 }]],
    ["a string content", "thread_summarize_hint_tokens: 40000"],
    ["a number content", 40_000],
  ] as const)("is not set for %s, and never throws", (_name, content) => {
    expect(() => hintOf(content)).not.toThrow();
    expect(hintOf(content)).toBeUndefined();
  });

  it("is not set, and does not throw, for a record whose field throws on read", () => {
    const hostile = Object.defineProperty({}, "thread_summarize_hint_tokens", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(hintOf(hostile)).toBeUndefined();
    expect(hintOf(new Proxy({}, { get: () => { throw new Error("boom"); } }))).toBeUndefined();
  });
});

describe("hintWords", () => {
  it("says a set hint as 'N tokens · set by you' and an unset one as never highlighted", () => {
    expect(hintWords(40_000)).toEqual({ value: "40,000 tokens · set by you", tokens: "40,000 tokens", set: true, note: undefined });
    expect(hintWords(undefined)).toEqual({ value: HINT_NOT_SET, tokens: undefined, set: false, note: undefined });
    expect(HINT_NOT_SET).toBe("Not set: Summarize is never highlighted.");
  });

  it("a set hint in a file the kernel refuses is said not to apply; model_unset still applies it (the kernel reads it)", () => {
    const refused = hintWords(40_000, { error: "settings_invalid", message: "permission_mode must be one of …" });
    expect(refused.value).toBe("40,000 tokens · set by you");
    expect(refused.note).toBe("Not applied: the kernel refuses this file (permission_mode must be one of …), so Summarize is never highlighted.");
    expect(hintWords(40_000, { error: "model_unset", message: "model is not set" }).note).toBeUndefined();
    expect(hintWords(undefined, { error: "settings_invalid", message: "x" }).note).toBeUndefined();
  });

  it("names the file relative to the data folder, the id made inert", () => {
    expect(hintFile("mason")).toBe("config/agents/mason.json");
    expect(hintFile("a\nb")).not.toContain("\n");
  });
});

// ---- The section over a scripted kernel -----------------------------------------------------------------------------

type Answer = ApiResult<unknown> | Promise<ApiResult<unknown>>;

interface Kernel {
  readonly fake: FakeBridge;
  roster: () => Answer;
  wright: () => Answer;
  detail: (id: string) => Answer;
}

const thread = (hint: number | null): ApiResult<unknown> => ok({ items: [], next_before: null, pending_approvals: [], thread_summarize_hint_tokens: hint, threads: [] });
const detail = (id: string, content: unknown, error: unknown = null): ApiResult<unknown> =>
  ok({ agent: agent(id, id, []), settings: { file: `/data/config/agents/${id}.json`, content, error }, never: [], workspaces: [], memory: { dir: "/m", files: [] }, charter: null });
const refused = (status: number, body: { readonly error: string } & Record<string, unknown>): ApiResult<unknown> => ({ ok: false, status, body });

const WRIGHT = agent("wright", "Wright", []);
const MASON = agent("mason", "Mason", []);
const ADA = agent("ada", "Ada", []);

function createKernel(roster: readonly RosterEntry[] = [MASON, WRIGHT, ADA]): Kernel {
  const fake = fakeBridge();
  const kernel: Kernel = {
    fake,
    roster: () => ok({ agents: roster }),
    wright: () => thread(40_000),
    detail: (id) => detail(id, id === "mason" ? { model: "claude-sonnet", thread_summarize_hint_tokens: 120_000 } : { model: "claude-sonnet" }),
  };
  fake.route("GET /status", () => ok(STATUS));
  fake.route("GET /agents", () => kernel.roster());
  fake.route("GET /threads/:agent", () => kernel.wright());
  fake.route("GET /agents/:id", (req: ApiRequest) => kernel.detail(String(req.params?.id)));
  return kernel;
}

const rows = (): HTMLElement[] => screen.queryAllByTestId(IDS.threadsRow);
const row = (id: string): HTMLElement => {
  const found = rows().find((r) => r.dataset.agent === id);
  if (found === undefined) throw new Error(`no row for ${id}`);
  return found;
};
const hintText = (id: string): string => within(row(id)).getByTestId(IDS.threadsHint).textContent ?? "";

async function mount(kernel: Kernel, offline = false) {
  const view = render(<ThreadsSection api={kernel.fake.bridge} offline={offline} />);
  return view;
}

/** Wait until no row is still reading. */
async function settled(): Promise<void> {
  await waitFor(() => {
    expect(rows().length).toBeGreaterThan(0);
    for (const r of rows()) expect(within(r).getByTestId(IDS.threadsHint).textContent).not.toBe("Reading…");
  });
}

describe("the rows", () => {
  it("lists Wright first, then the crew in the kernel's order, each with its hint and its file", async () => {
    const kernel = createKernel();
    await mount(kernel);
    await settled();
    expect(rows().map((r) => r.dataset.agent)).toEqual(["wright", "mason", "ada"]);
    expect(hintText("wright")).toBe("40,000 tokens · set by you");
    expect(hintText("mason")).toBe("120,000 tokens · set by you");
    expect(hintText("ada")).toBe("Not set: Summarize is never highlighted.");
    expect(within(row("mason")).getByTestId(IDS.threadsFile).textContent).toBe("in config/agents/mason.json");
    expect(within(row("ada")).getByTestId(IDS.threadsFile).textContent).toBe("Set one in config/agents/ada.json");
    expect(within(row("wright")).getByRole("term").textContent).toBe("Wright");
  });

  it("reads Wright from GET /threads/wright?limit=1 (its detail route is 409 reserved) and each crew member from GET /agents/:id", async () => {
    const kernel = createKernel();
    await mount(kernel);
    await settled();
    expect(kernel.fake.requestsTo("GET /threads/:agent").map((r) => r.req)).toEqual([{ method: "GET", path: "/threads/:agent", params: { agent: "wright" }, query: { limit: "1" } }]);
    expect(kernel.fake.requestsTo("GET /agents/:id").map((r) => r.req.params?.id).sort()).toEqual(["ada", "mason"]);
  });

  it("is read-only: no field, no Save, no Wright proposal, no reference limit, no button or link at all, and no dollar sign", async () => {
    const kernel = createKernel();
    const { container } = await mount(kernel);
    await settled();
    const section = screen.getByTestId(IDS.threads);
    expect(section.querySelectorAll("input, textarea, select, [contenteditable]:not([contenteditable='false'])")).toHaveLength(0);
    expect(within(section).queryAllByRole("button")).toEqual([]);
    expect(within(section).queryAllByRole("link")).toEqual([]);
    expect(section.textContent).not.toMatch(/\bSave\b|proposed by Wright|Wright's proposal|Reference limit/i);
    expect(container.textContent).not.toContain("$");
    expect(within(section).getByRole("heading", { name: "Threads" })).toBeTruthy();
  });

  it("a set hint in a file the kernel refuses says it does not apply", async () => {
    const kernel = createKernel([WRIGHT, MASON]);
    kernel.detail = (id) => detail(id, { thread_summarize_hint_tokens: 30_000 }, { error: "settings_invalid", field: "permission_mode", message: "permission_mode is missing" });
    await mount(kernel);
    await settled();
    expect(hintText("mason")).toBe("30,000 tokens · set by you");
    expect(within(row("mason")).getByTestId(IDS.threadsNote).textContent).toBe("Not applied: the kernel refuses this file (permission_mode is missing), so Summarize is never highlighted.");
    expect(within(row("wright")).queryByTestId(IDS.threadsNote)).toBeNull();
  });

  it("a hint that is not a positive integer, or a file the kernel could not read (content null), reads not set", async () => {
    const kernel = createKernel([WRIGHT, MASON, ADA]);
    kernel.wright = () => thread(null);
    kernel.detail = (id) => detail(id, id === "mason" ? { thread_summarize_hint_tokens: "40k" } : null);
    await mount(kernel);
    await settled();
    for (const id of ["wright", "mason", "ada"]) expect(hintText(id), id).toBe(HINT_NOT_SET);
  });

  it("a failed read names the request; an unreachable one is unknown; the other rows still show", async () => {
    const kernel = createKernel();
    kernel.wright = () => UNREACHABLE;
    kernel.detail = (id) => (id === "mason" ? refused(500, { error: "store_unreadable", message: "the store could not be read" }) : detail(id, { thread_summarize_hint_tokens: 5_000 }));
    await mount(kernel);
    await settled();
    expect(hintText("wright")).toBe("Unknown until the kernel answers.");
    expect(hintText("mason")).toBe("Couldn't read it: GET /agents/mason · 500 · the store could not be read");
    expect(hintText("ada")).toBe("5,000 tokens · set by you");
  });

  it("a refused Wright read names its thread route", async () => {
    const kernel = createKernel([WRIGHT]);
    kernel.wright = () => refused(500, { error: "store_unreadable" });
    await mount(kernel);
    await settled();
    expect(hintText("wright")).toBe("Couldn't read it: GET /threads/wright · 500 · store_unreadable");
  });

  it("shows a kernel name, id and refusal literally, never as markup", async () => {
    const markup = "<img src=x onerror=alert(1)>";
    const kernel = createKernel([agent("odd", markup, [])]);
    kernel.detail = (id) => detail(id, { thread_summarize_hint_tokens: 7 }, { error: "settings_invalid", message: markup });
    const { container } = await mount(kernel);
    await settled();
    expect(within(row("odd")).getByRole("term").textContent).toBe(markup);
    expect(within(row("odd")).getByTestId(IDS.threadsNote).textContent).toContain(markup);
    expect(container.querySelector("img")).toBeNull();
  });

  it("the sample shows what a thread past its hint looks like: highlighted, and marked in words", async () => {
    await mount(createKernel());
    await settled();
    const sample = screen.getByTestId(IDS.threadsSample);
    expect(sample.textContent).toContain("past your size hint");
    expect(within(sample).queryAllByRole("button")).toEqual([]);
  });
});

describe("the roster's states", () => {
  it("loading: a skeleton until the roster answers", async () => {
    const kernel = createKernel();
    kernel.roster = () => new Promise<ApiResult<unknown>>(() => undefined);
    await mount(kernel);
    expect(screen.getByTestId(IDS.threadsLoading)).toBeTruthy();
    expect(rows()).toEqual([]);
  });

  it("empty: the kernel lists no agents", async () => {
    const kernel = createKernel([]);
    await mount(kernel);
    expect((await screen.findByTestId(IDS.threadsEmpty)).textContent).toBe("The kernel lists no agents.");
  });

  it("refused: names the request and the kernel's words", async () => {
    const kernel = createKernel();
    kernel.roster = () => refused(500, { error: "store_unreadable" });
    await mount(kernel);
    expect((await screen.findByTestId(IDS.threadsError)).textContent).toBe("Couldn't read the agents: GET /agents · 500 · store_unreadable.");
  });
});

describe("offline", () => {
  it("sends no hint read while the kernel is unreachable, and reads once it answers again", async () => {
    const kernel = createKernel();
    const view = await mount(kernel, true);
    await waitFor(() => expect(rows().length).toBe(3));
    expect(hintText("mason")).toBe("Unknown until the kernel answers.");
    expect(kernel.fake.requestsTo("GET /agents/:id")).toEqual([]);
    expect(kernel.fake.requestsTo("GET /threads/:agent")).toEqual([]);
    view.rerender(<ThreadsSection api={kernel.fake.bridge} offline={false} />);
    await settled();
    expect(hintText("mason")).toBe("120,000 tokens · set by you");
  });

  it("keeps a value already read when a later read finds the kernel unreachable", async () => {
    const kernel = createKernel();
    const view = await mount(kernel);
    await settled();
    kernel.wright = () => UNREACHABLE;
    view.rerender(<ThreadsSection api={kernel.fake.bridge} offline={true} />);
    view.rerender(<ThreadsSection api={kernel.fake.bridge} offline={false} />);
    await waitFor(() => expect(kernel.fake.requestsTo("GET /threads/:agent").length).toBe(2));
    await settled();
    expect(hintText("wright")).toBe("40,000 tokens · set by you");
  });
});

describe("on the Settings screen", () => {
  it("is mounted as the Threads region after This app", async () => {
    const kernel = createKernel();
    kernel.fake.route("GET /settings", () => ok(settingsBody()));
    render(<SettingsScreen api={kernel.fake.bridge} registry={createCommandRegistry()} />);
    const region = await screen.findByRole("region", { name: "Threads" });
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-labelledby"));
    expect(regions.at(-1)).toBe("settings-h-threads");
    expect(region.getAttribute("data-testid")).toBe(IDS.threads);
    await settled();
    expect(hintText("wright")).toBe("40,000 tokens · set by you");
  });
});
