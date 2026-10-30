// @vitest-environment jsdom
// The Playbooks screen over a scriptable bridge (`../../store/fake-bridge`): the
// bridge guard, every designed list state, the values each row shows and who set
// them, the per-field edit (one `/set` per Set, no optimistic update, the kernel's
// refusal under its field), the On switch (it never turns a playbook on), Run now's
// guard, Edit in English's handoff, the kernel going away, the keyboard and the
// registered ⌘K commands, the live feed, the version history and hostile text.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiRequest, ApiResult, Approval, EventFrame, PlaybookListing, PlaybookRun, PlaybookVersion, StudioBridge, Trigger } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { takeComposerHandoff } from "../chat/handoff";
import { approval, playbook, trigger } from "../chat/testkit";
import { PLAYBOOKS_COMMANDS, PLAYBOOKS_OWNER } from "./commands";
import { PlaybooksScreen } from "./PlaybooksScreen";
import { screen as playbooksScreen } from "./index";
import { PLAYBOOKS_TEST_IDS as IDS } from "./model";

const ENABLE_TOOL = "mcp__kernel__kernel_playbook_enable";
const AT = "2026-10-29T10:00:00.000Z";

interface Kernel {
  playbooks: PlaybookListing[];
  triggers: Trigger[];
  approvals: Approval[];
  runs: Record<number, PlaybookRun[]>;
  versions: Record<number, PlaybookVersion[]>;
  /** `GET /playbooks` answers this instead of the list (a refusal). */
  playbooksAnswer?: () => ApiResult<unknown>;
  /** POST answers by `"POST <path>"`; the default for `/set` applies the change to `playbooks`. */
  posts: Record<string, (req: ApiRequest) => ApiResult<unknown> | Promise<ApiResult<unknown>>>;
}

function run(id: number, playbookId: number, overrides: Partial<PlaybookRun> = {}): PlaybookRun {
  return { id, playbook: playbookId, version: 1, kind: "fire", status: "done", item_ref: null, item_revision: null, tokens: 1000, session: null, started: AT, ended: AT, ...overrides };
}

function version(n: number, snapshot: PlaybookVersion["snapshot"]): PlaybookVersion {
  return { playbook: 1, version: n, snapshot, created_at: `2026-10-2${n}T10:00:00.000Z` };
}

/** The two playbooks the screen tests read: an enabled poll playbook with every field set, and a draft with almost none. */
function standard(): Partial<Kernel> {
  const review = playbook(1, {
    slug: "review-prs",
    name: "Review PRs",
    intent: "When a PR opens or gets a new commit, read it and save a draft review for me.",
    status: "enabled",
    version: 3,
    dedupe_key_spec: '["item.id","item.revision"]',
    dedupe_key_set_by: "owner",
    priority: "high",
    priority_set_by: "owner",
    model: "sonnet",
    model_set_by: "wright",
    effort: "medium",
    effort_set_by: "wright",
    token_limit_per_day: 200000,
    token_limit_set_by: "owner",
    mode: "draft",
    mode_set_by: "wright",
    trigger_id: 5,
  });
  const weekly = playbook(2, {
    slug: "weekly-changelog",
    name: "Weekly changelog",
    intent: "Draft the changelog every Friday.",
    status: "draft",
    version: 1,
    dedupe_key_spec: null,
    dedupe_key_set_by: null,
    priority: "low",
    priority_set_by: null,
    model: null,
    model_set_by: null,
    token_limit_per_day: null,
    token_limit_set_by: null,
    mode: "draft",
    mode_set_by: null,
  });
  return {
    playbooks: [review, weekly],
    triggers: [
      trigger(5, {
        kind: "poll",
        playbook: "review-prs",
        spec: { source: "github.pulls", repos: ["acme/widgets", "acme/gadgets"], filters: { state: "open" }, interval_seconds: 600 },
        last_result: "fired",
      }),
    ],
    runs: {
      1: [run(11, 1, { tokens: 31870, status: "done", kind: "fire", item_ref: "github:acme/widgets#42", item_revision: "9f3c2a1e7b04" }), run(10, 1, { tokens: 2104, status: "failed" })],
      2: [run(12, 2, { kind: "dry_run", status: "running", tokens: null })],
    },
  };
}

const SET_FIELDS: Record<string, keyof PlaybookListing> = { priority: "priority", model: "model", mode: "mode" };

/** The kernel's `/set` as the tests' default: one field changed, a version written, an enabled playbook a draft again. */
function applySet(kernel: Kernel, req: ApiRequest): ApiResult<unknown> {
  const body = req.body as { field: string; value: string };
  const index = kernel.playbooks.findIndex((p) => p.id === Number(req.params?.id));
  const before = kernel.playbooks[index] as PlaybookListing;
  let next: PlaybookListing = before;
  if (body.field === "token_limit") next = { ...before, token_limit_per_day: Number(body.value), token_limit_set_by: "owner" };
  else if (body.field === "dedupe_key") next = { ...before, dedupe_key_spec: JSON.stringify(body.value.split(",").map((f) => f.trim())), dedupe_key_set_by: "owner" };
  else next = { ...before, [SET_FIELDS[body.field] as string]: body.value, [`${body.field}_set_by`]: "owner" };
  const changed = JSON.stringify(next) !== JSON.stringify(before);
  if (changed) next = { ...next, version: before.version + 1, status: before.status === "enabled" ? "draft" : before.status };
  kernel.playbooks[index] = next;
  return ok({ playbook: next, changed });
}

interface Mounted {
  readonly fake: FakeBridge;
  readonly kernel: Kernel;
  readonly registry: CommandRegistry;
  readonly unmount: () => void;
}

function mount(initial: Partial<Kernel> = standard(), registry: CommandRegistry = createCommandRegistry()): Mounted {
  const kernel: Kernel = { playbooks: [], triggers: [], approvals: [], runs: {}, versions: {}, posts: {}, ...initial };
  const fake = fakeBridge();
  fake.route("GET /status", () => ok({ kernel: { version: "0", uptime_s: 1, pid: 1 } }));
  fake.route("GET /playbooks", () => kernel.playbooksAnswer?.() ?? ok({ playbooks: [...kernel.playbooks] }));
  fake.route("GET /triggers", () => ok({ triggers: [...kernel.triggers] }));
  fake.route("GET /approvals", () => ok({ approvals: [...kernel.approvals] }));
  fake.route("GET /playbooks/:id/runs", (req) => {
    const all = kernel.runs[Number(req.params?.id)] ?? [];
    return ok({ runs: all.slice(0, Number(req.query?.limit ?? 50)), next_before: null });
  });
  fake.route("GET /playbooks/:id/versions", (req) => ok({ versions: kernel.versions[Number(req.params?.id)] ?? [] }));
  for (const path of ["/playbooks/:id/set", "/playbooks/:id/off", "/playbooks/:id/run", "/ask"]) {
    const key = `POST ${path}`;
    fake.route(key, (req) => kernel.posts[key]?.(req) ?? (path === "/playbooks/:id/set" ? applySet(kernel, req) : ok({})));
  }
  const view = render(<PlaybooksScreen api={fake.bridge as StudioBridge} registry={registry} />);
  return { fake, kernel, registry, unmount: view.unmount };
}

async function loaded(): Promise<HTMLElement> {
  const root = screen.getByTestId(IDS.screen);
  await waitFor(() => expect(["loading"]).not.toContain(root.dataset.state));
  return root;
}

async function mountLoaded(initial?: Partial<Kernel>, registry?: CommandRegistry): Promise<Mounted & { readonly root: HTMLElement }> {
  const mounted = mount(initial, registry);
  const root = await loaded();
  // Each row's last run has answered.
  await waitFor(() => expect(root.textContent).not.toContain("reading…"));
  return { ...mounted, root };
}

function posts(fake: FakeBridge, key: string): ApiRequest[] {
  return fake.requestsTo(key).map((r) => r.req);
}

function allPosts(fake: FakeBridge): ApiRequest[] {
  return fake.requests.map((r) => r.req).filter((r) => r.method === "POST");
}

function rowOf(name: string): HTMLElement {
  const row = screen.getAllByTestId(IDS.row).find((r) => within(r).queryByText(name) !== null);
  if (row === undefined) throw new Error(`no row for ${name}`);
  return row;
}

async function openDetail(name: string): Promise<void> {
  fireEvent.click(within(rowOf(name)).getByTestId(IDS.open));
  await screen.findByTestId(IDS.detail);
}

async function openEdit(name: string): Promise<void> {
  await openDetail(name);
  fireEvent.click(screen.getByTestId(IDS.editFields));
  await screen.findByTestId(IDS.edit);
}

function field(key: string): HTMLElement {
  const el = screen.getAllByTestId(IDS.field).find((f) => f.dataset.field === key);
  if (el === undefined) throw new Error(`no field ${key}`);
  return el;
}

function press(key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
}

let eventId = 0;
function feedEvent(kind: string): EventFrame {
  eventId += 1;
  return { type: "event", id: eventId, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload: {} };
}

/** A promise a route can hold open until the test lets it go. */
function hold<T>(): { readonly promise: Promise<T>; readonly release: (value: T) => void } {
  let release: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    release = done;
  });
  return { promise, release };
}

beforeEach(() => {
  takeComposerHandoff("wright");
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
  takeComposerHandoff("wright");
});

describe("the bridge guard and the screen definition", () => {
  it("with no bridge, renders its root without throwing", () => {
    delete (window as unknown as { api?: StudioBridge }).api;
    expect(() => render(<PlaybooksScreen registry={createCommandRegistry()} />)).not.toThrow();
    expect(screen.getByTestId(IDS.screen).dataset.state).toBe("no-bridge");
  });

  it("keeps the shell's id, title and ⌘7 entry", () => {
    expect(playbooksScreen.id).toBe("playbooks");
    expect(playbooksScreen.title).toBe("Playbooks");
    expect(playbooksScreen.nav).toEqual({ label: "Playbooks", order: 7, shortcut: "⌘7" });
  });
});

describe("the designed states", () => {
  it("loading: skeleton rows and a status, not a spinner, while the first read is held", async () => {
    const gate = hold<ApiResult<unknown>>();
    const registry = createCommandRegistry();
    const fake = fakeBridge();
    fake.route("GET /playbooks", () => gate.promise);
    render(<PlaybooksScreen api={fake.bridge} registry={registry} />);
    const root = screen.getByTestId(IDS.screen);
    await waitFor(() => expect(fake.requestsTo("GET /playbooks")).toHaveLength(1));
    expect(root.dataset.state).toBe("loading");
    expect(root.querySelector(".pb-skeleton")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Loading playbooks");
    expect(screen.queryByTestId("btn-spinner")).toBeNull();
    await act(async () => gate.release(ok({ playbooks: [] })));
    await waitFor(() => expect(root.dataset.state).toBe("empty"));
  });

  it("empty: 'No playbooks yet.' with one action that opens Wright's thread and sends nothing", async () => {
    const { fake } = await mountLoaded({ playbooks: [] });
    expect(screen.getByTestId(IDS.screen).dataset.state).toBe("empty");
    expect(screen.getByRole("heading", { name: "No playbooks yet." })).toBeTruthy();
    expect(screen.getByText(/Studio ships none\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask Wright for the first one" }));
    expect(window.location.hash).toBe("#/chat");
    expect(posts(fake, "POST /ask")).toHaveLength(0);
  });

  it("error: the kernel's refusal in the card, and Try again reads it again", async () => {
    const mounted = mount({ ...standard(), playbooksAnswer: () => ({ ok: false, status: 500, body: { error: "store_locked", message: "the store is locked" } }) });
    await waitFor(() => expect(screen.getByTestId(IDS.screen).dataset.state).toBe("error"));
    const card = screen.getByTestId(IDS.error);
    expect(card.textContent).toContain("GET /playbooks · 500 · store_locked · the store is locked");
    delete mounted.kernel.playbooksAnswer;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId(IDS.screen).dataset.state).toBe("waiting"));
  });

  it("waiting: a draft is marked, and a band names it and opens it with Review", async () => {
    await mountLoaded();
    const band = screen.getByTestId(IDS.band);
    expect(band.textContent).toContain("1 playbook waits on you: Weekly changelog is a draft");
    expect(within(rowOf("Weekly changelog")).getByText("draft · waiting on you")).toBeTruthy();
    fireEvent.click(screen.getByTestId(IDS.bandReview));
    const detail = await screen.findByTestId(IDS.detail);
    expect(detail.dataset.playbook).toBe("2");
  });

  it("populated: no band without a draft", async () => {
    const base = standard();
    await mountLoaded({ ...base, playbooks: [(base.playbooks as PlaybookListing[])[0] as PlaybookListing] });
    expect(screen.getByTestId(IDS.screen).dataset.state).toBe("populated");
    expect(screen.queryByTestId(IDS.band)).toBeNull();
  });
});

describe("AC4: every field, who set it, and 'not set'", () => {
  it("shows the row's name, intent, trigger in full, dedupe key, priority, model, mode, last run, tokens and switch", async () => {
    const { root } = await mountLoaded();
    expect(screen.getByTestId(IDS.count).textContent).toBe("2 playbooks · 1 on");
    const row = rowOf("Review PRs");
    const text = row.textContent ?? "";
    expect(text).toContain("When a PR opens or gets a new commit, read it and save a draft review for me.");
    // The poll spec is shown whole: interval, both repos and the filter.
    expect(text).toContain("poll every 600s · acme/widgets, acme/gadgets · state=open");
    expect(text).toContain("item.id, item.revision");
    expect(text).toContain("high");
    expect(text).toContain("sonnet");
    expect(text).toContain("draft");
    expect(text).toContain("31,870 tokens");
    expect(text).toContain("fire");
    expect(within(row).getByRole("switch", { name: "Review PRs is on" }).getAttribute("aria-checked")).toBe("true");
    expect(within(rowOf("Weekly changelog")).getByRole("switch", { name: "Weekly changelog is off" }).getAttribute("aria-checked")).toBe("false");
    // Tokens are counted figures; there is no dollar figure anywhere.
    expect(root.textContent).not.toContain("$");
    expect(root.textContent).not.toContain("≈");
  });

  it("tags each policy value 'set by you' or 'proposed by Wright', and tags nothing nobody set", async () => {
    await mountLoaded();
    const row = within(rowOf("Review PRs"));
    expect(row.getAllByText("set by you").length).toBeGreaterThanOrEqual(2); // dedupe key and priority
    expect(row.getAllByText("proposed by Wright").length).toBeGreaterThanOrEqual(2); // model and mode
    const weekly = within(rowOf("Weekly changelog"));
    expect(weekly.queryByText("set by you")).toBeNull();
    expect(weekly.queryByText("proposed by Wright")).toBeNull();
  });

  it("reads 'not set' for an unset dedupe key and model, never a filled-in default", async () => {
    await mountLoaded();
    const weekly = rowOf("Weekly changelog").textContent ?? "";
    expect(weekly.match(/not set/g)?.length).toBe(2);
  });

  it("a run still running has no tokens yet and says so; a playbook with no run says so", async () => {
    const base = standard();
    await mountLoaded({ ...base, runs: { 1: [], 2: [run(12, 2, { kind: "dry_run", status: "running", tokens: null })] } });
    expect(rowOf("Weekly changelog").textContent).toContain("not counted yet");
    expect(rowOf("Weekly changelog").textContent).toContain("dry run");
    expect(rowOf("Review PRs").textContent).toContain("no runs yet");
  });

  it("the detail shows the same fields, the trigger and the tokens counted, with the run status in words beside each dot", async () => {
    await mountLoaded();
    await openDetail("Review PRs");
    const detail = screen.getByTestId(IDS.detail);
    const text = detail.textContent ?? "";
    expect(text).toContain("item.id, item.revision");
    expect(text).toContain("200,000");
    expect(text).toContain("poll every 600s · acme/widgets, acme/gadgets · state=open");
    expect(text).toContain("fired");
    expect(within(screen.getByTestId(IDS.tokens)).getByText("33,974")).toBeTruthy();
    const runs = within(screen.getByTestId(IDS.runs)).getAllByTestId(IDS.run);
    expect(runs).toHaveLength(2);
    expect(within(runs[0] as HTMLElement).getByText("done")).toBeTruthy();
    expect(within(runs[1] as HTMLElement).getByText("failed")).toBeTruthy();
    expect(runs[0]?.textContent).toContain("github:acme/widgets#42 @ 9f3c2a1");
    expect(within(detail).getByRole("switch", { name: "Review PRs is on" })).toBeTruthy();
    // A policy value nobody set reads "not set" in the detail too.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Playbooks" })));
    await openDetail("Weekly changelog");
    expect(within(screen.getByTestId(IDS.detail)).getAllByText("not set").length).toBeGreaterThanOrEqual(3);
  });
});

describe("AC5: a field edit is one /set, and nothing changes until the kernel answers", () => {
  it("sends one {field, value}, holds the editor's text while it is pending, and shows only what the kernel answered", async () => {
    const gate = hold<ApiResult<unknown>>();
    const { fake, kernel } = await mountLoaded();
    kernel.posts["POST /playbooks/:id/set"] = (req) => {
      const answer = applySet(kernel, req);
      return gate.promise.then(() => answer);
    };
    await openEdit("Review PRs");
    expect(screen.getByText("v3 now")).toBeTruthy();
    fireEvent.click(within(field("priority")).getByRole("button", { name: "Edit priority" }));
    const select = screen.getByLabelText("New priority") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "low" } });
    const readsBefore = fake.requestsTo("GET /playbooks").length;
    fireEvent.click(screen.getByRole("button", { name: "Set priority" }));
    // Pressing Set again while it is pending sends nothing more.
    fireEvent.click(screen.getByRole("button", { name: "Set priority" }));
    await waitFor(() => expect(posts(fake, "POST /playbooks/:id/set")).toHaveLength(1));
    expect(posts(fake, "POST /playbooks/:id/set")[0]).toMatchObject({ params: { id: 1 }, body: { field: "priority", value: "low" } });
    // Held: the editor keeps its text, Cancel and Escape do nothing, typing changes nothing.
    fireEvent.change(select, { target: { value: "normal" } });
    expect(select.value).toBe("low");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(select, { key: "Escape" });
    expect(screen.getByLabelText("New priority")).toBe(select);
    // No optimistic update: the version and the value are still the kernel's old ones, and nothing was re-read.
    expect(screen.getByText("v3 now")).toBeTruthy();
    expect(within(field("priority")).queryByText("set by you")).toBeNull();
    expect(fake.requestsTo("GET /playbooks")).toHaveLength(readsBefore);
    await act(async () => gate.release(ok({})));
    // Only now: the version the kernel answered with, and the new value from the re-read.
    await waitFor(() => expect(within(field("priority")).getByTestId(IDS.fieldStatus).textContent).toContain("Priority: saved as v4."));
    await waitFor(() => expect(screen.getByText("v4 now")).toBeTruthy());
    expect(screen.queryByLabelText("New priority")).toBeNull();
    expect(within(field("priority")).getByText("low")).toBeTruthy();
    // The enabled playbook is a draft again, as the kernel answered; the screen says so after the fact.
    expect(within(field("priority")).getByTestId(IDS.fieldStatus).textContent).toContain("a draft again");
    expect(posts(fake, "POST /playbooks/:id/set")).toHaveLength(1);
  });

  it("says before any Set that a change makes an enabled playbook a draft again, and never names a predicted version", async () => {
    await mountLoaded();
    await openEdit("Review PRs");
    expect(screen.getByText(/Any change makes this playbook a draft again, as the kernel does\./)).toBeTruthy();
    expect(screen.queryByText(/v4/)).toBeNull();
    expect(screen.queryByText(/Save as/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Playbook" }));
    await screen.findByTestId(IDS.detail);
    fireEvent.click(screen.getByRole("button", { name: "Playbooks" }));
    await openEdit("Weekly changelog");
    expect(screen.queryByText(/Any change makes this playbook a draft again/)).toBeNull();
  });

  it("a value the kernel finds unchanged says no version was written, and still names the version it answered with", async () => {
    const { kernel, fake } = await mountLoaded();
    kernel.posts["POST /playbooks/:id/set"] = () => ok({ playbook: (kernel.playbooks[0] as PlaybookListing), changed: false });
    await openEdit("Review PRs");
    fireEvent.click(within(field("model")).getByRole("button", { name: "Edit model" }));
    fireEvent.change(screen.getByLabelText("New model"), { target: { value: "sonnet" } });
    fireEvent.click(screen.getByRole("button", { name: "Set model" }));
    await waitFor(() => expect(within(field("model")).getByTestId(IDS.fieldStatus).textContent).toContain("No change"));
    expect(within(field("model")).getByTestId(IDS.fieldStatus).textContent).toContain("still v3");
    expect(posts(fake, "POST /playbooks/:id/set")).toHaveLength(1);
  });

  it("a refusal shows under that field with the kernel's message and code, the editor keeps its text, and nothing changed", async () => {
    const { kernel, fake } = await mountLoaded();
    kernel.posts["POST /playbooks/:id/set"] = () => ({ ok: false, status: 400, body: { error: "invalid_token_limit", message: "token_limit must be a whole number above 0" } });
    await openEdit("Review PRs");
    fireEvent.click(within(field("token_limit")).getByRole("button", { name: "Edit token limit per day" }));
    const input = screen.getByLabelText("New token limit per day") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Set token limit per day" }));
    const refusal = await within(field("token_limit")).findByTestId(IDS.fieldRefusal);
    expect(refusal.textContent).toBe("token_limit must be a whole number above 0 (invalid_token_limit)");
    expect(refusal.getAttribute("role")).toBe("alert");
    // The editor is still open with the owner's text; no other field shows it; the version and value are unchanged.
    expect((screen.getByLabelText("New token limit per day") as HTMLInputElement).value).toBe("-5");
    expect(screen.queryByTestId(IDS.fieldRefusal)).toBe(refusal);
    expect(screen.getByText("v3 now")).toBeTruthy();
    expect(within(field("priority")).queryByTestId(IDS.fieldRefusal)).toBeNull();
    expect(posts(fake, "POST /playbooks/:id/set")).toHaveLength(1);
    // Cancel leaves with nothing sent and the refusal gone.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("New token limit per day")).toBeNull();
    expect(screen.queryByTestId(IDS.fieldRefusal)).toBeNull();
    expect(posts(fake, "POST /playbooks/:id/set")).toHaveLength(1);
  });

  it("offers each of the five settable fields its own Edit, mode offers draft with live disabled, and name, intent and effort are read-only", async () => {
    await mountLoaded();
    await openEdit("Review PRs");
    for (const [key, name] of [["dedupe_key", "dedupe key"], ["priority", "priority"], ["model", "model"], ["token_limit", "token limit per day"], ["mode", "mode"]] as const) {
      expect(within(field(key)).getByRole("button", { name: `Edit ${name}` })).toBeTruthy();
    }
    for (const key of ["name", "intent", "effort"]) {
      const row = field(key);
      expect(within(row).queryByRole("button")).toBeNull();
      expect(row.textContent).toContain("Change this with Edit in English");
    }
    fireEvent.click(within(field("mode")).getByRole("button", { name: "Edit mode" }));
    const live = screen.getByRole("option", { name: "live (not available yet)" }) as HTMLOptionElement;
    expect(live.disabled).toBe(true);
    expect((screen.getByRole("option", { name: "draft" }) as HTMLOptionElement).disabled).toBe(false);
  });

  it("Escape cancels an open editor, and with none open leaves the edit view", async () => {
    await mountLoaded();
    await openEdit("Review PRs");
    fireEvent.click(within(field("model")).getByRole("button", { name: "Edit model" }));
    const input = screen.getByLabelText("New model");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("New model")).toBeNull();
    expect(screen.getByTestId(IDS.edit)).toBeTruthy();
    // Focus came back to the field's Edit.
    expect(document.activeElement).toBe(within(field("model")).getByRole("button", { name: "Edit model" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    await screen.findByTestId(IDS.detail);
  });
});

describe("AC6: the switch never turns a playbook on", () => {
  it("off with an approval held: shows it and links to Approvals; sends nothing", async () => {
    const base = standard();
    const held = approval(9, { action: "kernel_playbook_enable", payload: { tool: ENABLE_TOOL, input: { id: 2, idempotency_key: "k" }, cwd: "/" }, display: "Enable playbook weekly-changelog (v1)" });
    const { fake } = await mountLoaded({ ...base, approvals: [held] });
    fireEvent.click(within(rowOf("Weekly changelog")).getByRole("switch", { name: "Weekly changelog is off" }));
    const note = await screen.findByTestId(IDS.turnOn);
    expect(note.textContent).toContain("Weekly changelog is a draft");
    expect(within(note).getByTestId(IDS.turnOnApproval).textContent).toContain("Enable playbook weekly-changelog (v1)");
    const link = within(note).getByTestId(IDS.turnOnLink);
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("#/approvals");
    expect(allPosts(fake)).toHaveLength(0);
    // The switch is still off: the screen turned nothing on.
    expect(within(rowOf("Weekly changelog")).getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("off with none held: says Wright asks and the owner approves, offers Edit in English, and sends nothing", async () => {
    const { fake } = await mountLoaded();
    fireEvent.click(within(rowOf("Weekly changelog")).getByRole("switch"));
    const note = await screen.findByTestId(IDS.turnOn);
    expect(note.textContent).toContain("No approval is waiting.");
    expect(note.textContent).toContain("turns on when Wright asks and you approve it");
    expect(within(note).queryByTestId(IDS.turnOnLink)).toBeNull();
    expect(allPosts(fake)).toHaveLength(0);
    fireEvent.click(within(note).getByRole("button", { name: "Edit in English" }));
    expect(takeComposerHandoff("wright")).toBe("About playbook 2 (weekly-changelog): ");
    expect(allPosts(fake)).toHaveLength(0);
  });

  it("an approval for another playbook, a decided one, or one for another tool does not count as held", async () => {
    const base = standard();
    const other = approval(9, { action: "kernel_playbook_enable", payload: { tool: ENABLE_TOOL, input: { id: 7 } } });
    const decided = approval(10, { status: "approved", action: "kernel_playbook_enable", payload: { tool: ENABLE_TOOL, input: { id: 2 } } });
    await mountLoaded({ ...base, approvals: [other, decided] });
    fireEvent.click(within(rowOf("Weekly changelog")).getByRole("switch"));
    const note = await screen.findByTestId(IDS.turnOn);
    expect(within(note).queryByTestId(IDS.turnOnLink)).toBeNull();
  });

  it("on: Turn off sends POST /playbooks/:id/off once, and a refusal shows in the kernel's words", async () => {
    const gate = hold<ApiResult<unknown>>();
    const { fake, kernel } = await mountLoaded();
    kernel.posts["POST /playbooks/:id/off"] = () => gate.promise as never;
    const sw = within(rowOf("Review PRs")).getByRole("switch", { name: "Review PRs is on" });
    fireEvent.click(sw);
    fireEvent.click(sw);
    await waitFor(() => expect(posts(fake, "POST /playbooks/:id/off")).toHaveLength(1));
    expect(posts(fake, "POST /playbooks/:id/off")[0]?.params).toEqual({ id: 1 });
    await act(async () => gate.release({ ok: false, status: 409, body: { error: "kill_switch_engaged", message: "The kill switch is engaged" } }));
    const notice = await screen.findByTestId(IDS.notice);
    expect(notice.textContent).toBe("Turn off: The kill switch is engaged (kill_switch_engaged)");
    expect(allPosts(fake).map((r) => r.path)).toEqual(["/playbooks/:id/off"]);
  });

  it("Turn off that the kernel accepts turns the switch off only after the playbooks are read again", async () => {
    const { kernel } = await mountLoaded();
    kernel.posts["POST /playbooks/:id/off"] = () => {
      kernel.playbooks[0] = { ...(kernel.playbooks[0] as PlaybookListing), status: "disabled" };
      return ok({ playbook: kernel.playbooks[0], changed: true });
    };
    fireEvent.click(within(rowOf("Review PRs")).getByRole("switch"));
    await waitFor(() => expect(within(rowOf("Review PRs")).getByRole("switch", { name: "Review PRs is off" })).toBeTruthy());
  });
});

describe("AC7: Edit in English opens Wright's thread with a line, and sends nothing", () => {
  it("hands the playbook's id and slug to Wright's composer and goes to #/chat", async () => {
    const { fake } = await mountLoaded();
    await openDetail("Review PRs");
    fireEvent.click(screen.getByTestId(IDS.editEnglish));
    expect(window.location.hash).toBe("#/chat");
    expect(takeComposerHandoff("wright")).toBe("About playbook 1 (review-prs): ");
    expect(posts(fake, "POST /ask")).toHaveLength(0);
    expect(allPosts(fake)).toHaveLength(0);
  });
});

describe("AC8: Run now", () => {
  it("sends POST /playbooks/:id/run once while one is pending, then shows the queue", async () => {
    const gate = hold<ApiResult<unknown>>();
    const { fake, kernel } = await mountLoaded();
    kernel.posts["POST /playbooks/:id/run"] = () => gate.promise as never;
    await openDetail("Review PRs");
    const button = screen.getByTestId(IDS.runNow);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(posts(fake, "POST /playbooks/:id/run")).toHaveLength(1));
    expect(posts(fake, "POST /playbooks/:id/run")[0]?.params).toEqual({ id: 1 });
    await act(async () => gate.release(ok({ queue_id: 77, created: true, playbook: 1, version: 3, scheduled_at: AT })));
    await waitFor(() => expect(screen.getByTestId(IDS.runNowStatus).textContent).toBe("Run queued (#77)."));
    // The guard is released: the next press sends again.
    kernel.posts["POST /playbooks/:id/run"] = () => ok({ queue_id: 78, created: true, playbook: 1, version: 3, scheduled_at: AT });
    fireEvent.click(screen.getByTestId(IDS.runNow));
    await waitFor(() => expect(posts(fake, "POST /playbooks/:id/run")).toHaveLength(2));
  });

  it.each([
    ["not_enabled", "The playbook is not enabled"],
    ["kill_switch_engaged", "The kill switch is engaged"],
  ])("shows the kernel's %s refusal in its words", async (code, message) => {
    const { kernel } = await mountLoaded();
    kernel.posts["POST /playbooks/:id/run"] = () => ({ ok: false, status: 409, body: { error: code, message } });
    await openDetail("Review PRs");
    fireEvent.click(screen.getByTestId(IDS.runNow));
    await waitFor(() => expect(screen.getByTestId(IDS.runNowStatus).textContent).toBe(`Run now: ${message} (${code})`));
    expect(screen.getByTestId(IDS.runNowStatus).getAttribute("data-tone")).toBe("danger");
  });

  it("is not offered on a playbook that is off", async () => {
    await mountLoaded();
    await openDetail("Weekly changelog");
    expect((screen.getByTestId(IDS.runNow) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId(IDS.runNowStatus).textContent).toBe("Run now needs the playbook on.");
  });
});

describe("AC9: the kernel unreachable", () => {
  it("keeps the last data, marked last known, disables the writes, and never throws", async () => {
    const { fake, root } = await mountLoaded();
    await act(async () => fake.emit({ type: "heartbeat", latest_id: 0 }));
    fake.connectionAnswer = { state: "unreachable", reason: "connection_failed" };
    await act(async () => fake.emit({ type: "closed", code: 1006, reason: "" }));
    await waitFor(() => expect(root.dataset.offline).toBe("true"));
    expect(root.dataset.state).toBe("unreachable");
    expect(screen.getByTestId(IDS.count).textContent).toBe("2 playbooks · 1 on · last known");
    expect(screen.getAllByTestId(IDS.row)).toHaveLength(2);
    for (const sw of screen.getAllByRole("switch")) expect((sw as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Ask Wright for a playbook" }) as HTMLButtonElement).disabled).toBe(true);
    // The rows can still be opened for reading; the writes stay off there too.
    await openDetail("Review PRs");
    expect((screen.getByTestId(IDS.runNow) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(IDS.editEnglish) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId(IDS.editFields));
    await screen.findByTestId(IDS.edit);
    expect((within(field("priority")).getByRole("button", { name: "Edit priority" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AC10: the keyboard and the palette", () => {
  it("registers its commands (owner playbooks) on mount and unregisters them on unmount", async () => {
    const registry = createCommandRegistry();
    const { unmount } = await mountLoaded(undefined, registry);
    const ids = registry.list().filter((c) => c.owner === PLAYBOOKS_OWNER).map((c) => c.id);
    expect(ids).toEqual([PLAYBOOKS_COMMANDS.askWright, PLAYBOOKS_COMMANDS.open(1), PLAYBOOKS_COMMANDS.open(2)]);
    expect(ids.every((id) => id.startsWith("playbooks."))).toBe(true);
    expect(registry.get(PLAYBOOKS_COMMANDS.open(1))?.title).toBe("Open Review PRs");
    unmount();
    expect(registry.list().filter((c) => c.owner === PLAYBOOKS_OWNER)).toEqual([]);
  });

  it("adds Edit in English, Edit fields and Version history while a playbook is open, each running its button's handler", async () => {
    const registry = createCommandRegistry();
    const { fake } = await mountLoaded(undefined, registry);
    await act(async () => registry.get(PLAYBOOKS_COMMANDS.open(1))?.run());
    await screen.findByTestId(IDS.detail);
    const ids = registry.list().filter((c) => c.owner === PLAYBOOKS_OWNER).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([PLAYBOOKS_COMMANDS.editEnglish, PLAYBOOKS_COMMANDS.editFields, PLAYBOOKS_COMMANDS.history]));
    expect(registry.get(PLAYBOOKS_COMMANDS.history)?.title).toBe("Version history of “Review PRs”");
    await act(async () => registry.get(PLAYBOOKS_COMMANDS.editFields)?.run());
    await screen.findByTestId(IDS.edit);
    await act(async () => registry.get(PLAYBOOKS_COMMANDS.history)?.run());
    await screen.findByTestId(IDS.historyView);
    await act(async () => registry.get(PLAYBOOKS_COMMANDS.editEnglish)?.run());
    expect(takeComposerHandoff("wright")).toBe("About playbook 1 (review-prs): ");
    expect(posts(fake, "POST /ask")).toHaveLength(0);
    // Back on the list the per-playbook commands are gone.
    window.location.hash = "";
  });

  it("disables the commands that need the kernel while it is unreachable", async () => {
    const registry = createCommandRegistry();
    const { fake } = await mountLoaded(undefined, registry);
    expect(registry.get(PLAYBOOKS_COMMANDS.askWright)?.enabled?.()).toBe(true);
    await act(async () => fake.emit({ type: "heartbeat", latest_id: 0 }));
    fake.connectionAnswer = { state: "unreachable", reason: "connection_failed" };
    await act(async () => fake.emit({ type: "closed", code: 1006, reason: "" }));
    await waitFor(() => expect(registry.get(PLAYBOOKS_COMMANDS.askWright)?.enabled?.()).toBe(false));
  });

  it("J and K move focus between the rows, and a J typed in a field stays text", async () => {
    await mountLoaded();
    const opens = screen.getAllByTestId(IDS.open);
    press("j");
    expect(document.activeElement).toBe(opens[0]);
    press("j");
    expect(document.activeElement).toBe(opens[1]);
    press("j");
    expect(document.activeElement).toBe(opens[1]);
    press("k");
    expect(document.activeElement).toBe(opens[0]);
    // From a row's switch, J goes to the next row.
    (within(rowOf("Review PRs")).getByRole("switch") as HTMLElement).focus();
    press("j");
    expect(document.activeElement).toBe(opens[1]);
    // In a text field, nothing moves.
    await act(async () => fireEvent.click(opens[0] as HTMLElement));
    fireEvent.click(screen.getByTestId(IDS.editFields));
    await screen.findByTestId(IDS.edit);
    fireEvent.click(within(field("model")).getByRole("button", { name: "Edit model" }));
    const input = screen.getByLabelText("New model");
    expect(document.activeElement).toBe(input);
    press("j");
    expect(document.activeElement).toBe(input);
  });

  it("reaches every action by keyboard: each control is a real button or link, and focus returns to where the owner came from", async () => {
    await mountLoaded();
    const open = within(rowOf("Review PRs")).getByTestId(IDS.open);
    open.focus();
    fireEvent.click(open);
    await screen.findByTestId(IDS.detail);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Playbooks" }));
    for (const id of [IDS.editEnglish, IDS.editFields, IDS.history, IDS.runNow]) expect(screen.getByTestId(id).tagName).toBe("BUTTON");
    fireEvent.click(screen.getByRole("button", { name: "Playbooks" }));
    await waitFor(() => expect(document.activeElement).toBe(within(rowOf("Review PRs")).getByTestId(IDS.open)));
  });
});

describe("AC11: the live feed updates in place", () => {
  it("a session event refreshes the list's last run and the detail's runs without remounting, a skeleton or a loading line", async () => {
    const { fake, kernel, root } = await mountLoaded();
    const row = rowOf("Review PRs");
    const switchBefore = within(row).getByRole("switch");
    expect(row.textContent).toContain("31,870 tokens");
    kernel.runs[1] = [run(13, 1, { tokens: 5000, status: "done" }), ...(kernel.runs[1] as PlaybookRun[])];
    await act(async () => fake.emit(feedEvent("session_status")));
    await waitFor(() => expect(rowOf("Review PRs").textContent).toContain("5,000 tokens"));
    // The same row and the same switch: nothing was re-created, and no loading line replaced anything.
    expect(rowOf("Review PRs")).toBe(row);
    expect(within(row).getByRole("switch")).toBe(switchBefore);
    expect(root.querySelector(".pb-skeleton")).toBeNull();
    expect(root.textContent).not.toContain("reading…");

    await openDetail("Review PRs");
    const detail = screen.getByTestId(IDS.detail);
    await waitFor(() => expect(within(detail).getAllByTestId(IDS.run)).toHaveLength(3));
    kernel.runs[1] = [run(14, 1, { tokens: null, status: "running" }), ...(kernel.runs[1] as PlaybookRun[])];
    await act(async () => fake.emit(feedEvent("event_done")));
    await waitFor(() => expect(within(detail).getAllByTestId(IDS.run)).toHaveLength(4));
    expect(screen.getByTestId(IDS.detail)).toBe(detail);
    expect(detail.querySelector(".pb-skeleton")).toBeNull();
    expect(within(detail).getAllByText("running").length).toBeGreaterThan(0);
  });

  it("a playbook_updated event refreshes the list in place", async () => {
    const { fake, kernel } = await mountLoaded();
    const row = rowOf("Review PRs");
    kernel.playbooks[0] = { ...(kernel.playbooks[0] as PlaybookListing), model: "opus", model_set_by: "owner" };
    await act(async () => fake.emit(feedEvent("playbook_updated")));
    await waitFor(() => expect(rowOf("Review PRs").textContent).toContain("opus"));
    expect(rowOf("Review PRs")).toBe(row);
  });

  it("a pending enable approval that arrives is shown in the revealed note without a reload", async () => {
    const { fake, kernel } = await mountLoaded();
    fireEvent.click(within(rowOf("Weekly changelog")).getByRole("switch"));
    const note = await screen.findByTestId(IDS.turnOn);
    expect(within(note).queryByTestId(IDS.turnOnLink)).toBeNull();
    kernel.approvals.push(approval(9, { action: "kernel_playbook_enable", payload: { tool: ENABLE_TOOL, input: { id: 2 } }, display: "Enable playbook weekly-changelog (v1)" }));
    await act(async () => fake.emit(feedEvent("approval_requested")));
    await waitFor(() => expect(screen.getByTestId(IDS.turnOnLink)).toBeTruthy());
  });
});

describe("the version history", () => {
  const history = (): PlaybookVersion[] => [
    version(3, { name: "Review PRs", priority: "normal", token_limit_per_day: 200000, priority_set_by: "owner", token_limit_set_by: "owner", model: "sonnet" }),
    version(2, { name: "Review PRs", priority: "low", token_limit_per_day: 150000, model: "sonnet" }),
    version(1, { name: "Review PRs", priority: "low", model: "haiku" }),
  ];

  it("lists the versions newest first with the current one marked, and shows what the picked one changed, read-only", async () => {
    const base = standard();
    await mountLoaded({ ...base, versions: { 1: history() } });
    await openDetail("Review PRs");
    fireEvent.click(screen.getByTestId(IDS.history));
    await screen.findByTestId(IDS.historyView);
    const options = await screen.findAllByTestId(IDS.version);
    expect(options.map((o) => o.dataset.version)).toEqual(["3", "2", "1"]);
    expect(within(options[0] as HTMLElement).getByText("current")).toBeTruthy();
    expect(within(options[1] as HTMLElement).queryByText("current")).toBeNull();
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    const diff = screen.getByTestId(IDS.versionDiff);
    expect(diff.textContent).toContain("Changes in v3");
    expect(diff.textContent).toContain("by you");
    expect(diff.textContent).toContain("priority: low");
    expect(diff.textContent).toContain("priority: normal");
    expect(diff.textContent).toContain("token_limit_per_day: 200,000");
    // A field a snapshot lacks is named as not recorded; no change is claimed for it.
    expect(diff.textContent).toMatch(/Not recorded in this or the version before \(unknown\): .*mode/);
    expect(diff.textContent).not.toContain("mode:");
    expect(screen.getByText(/Older versions are read-only/)).toBeTruthy();
    // Picking the first version shows its own values.
    fireEvent.click(options[2] as HTMLElement);
    const first = screen.getByTestId(IDS.versionDiff);
    expect(first.textContent).toContain("Created as v1");
    expect(first.textContent).toContain("model: haiku");
    expect(options[2]?.getAttribute("aria-selected")).toBe("true");
    // Moving focus to a version picks it.
    act(() => (options[1] as HTMLElement).focus());
    expect(screen.getByTestId(IDS.versionDiff).textContent).toContain("Changes in v2");
  });

  it("J and K move between the versions", async () => {
    const base = standard();
    await mountLoaded({ ...base, versions: { 1: history() } });
    await openDetail("Review PRs");
    fireEvent.click(screen.getByTestId(IDS.history));
    const options = await screen.findAllByTestId(IDS.version);
    options[0]?.focus();
    press("j");
    expect(document.activeElement).toBe(options[1]);
    press("k");
    expect(document.activeElement).toBe(options[0]);
  });

  it("a failed read says so and Try again reads it again", async () => {
    const base = standard();
    const { fake, kernel } = await mountLoaded({ ...base, versions: { 1: history() } });
    let fail = true;
    fake.route("GET /playbooks/:id/versions", () => (fail ? { ok: false, status: 500, body: { error: "internal" } } : ok({ versions: kernel.versions[1] })));
    await openDetail("Review PRs");
    fireEvent.click(screen.getByTestId(IDS.history));
    await screen.findByText("Couldn't load the versions");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByTestId(IDS.version)).toHaveLength(3);
  });
});

describe("hostile text stays text", () => {
  it("a name, intent and slug with markup and control characters render inert and are named as written", async () => {
    const base = standard();
    const hostile = playbook(1, {
      name: "<img src=x onerror=alert(1)>",
      slug: "x<script>",
      intent: "line\u001b[31m one\nline two <b>bold</b>",
      status: "enabled",
    });
    const { root } = await mountLoaded({ ...base, playbooks: [hostile], runs: { 1: [run(1, 1, { item_ref: "github:a/b#1<i>", item_revision: "abcdef123456" })] } });
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("b b, .pb-intent b")).toBeNull();
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(screen.getByRole("switch", { name: "<img src=x onerror=alert(1)> is on" })).toBeTruthy();
    expect(root.textContent).toContain("\\x1b[31m one");
    await openDetail("<img src=x onerror=alert(1)>");
    expect(root.querySelector("img")).toBeNull();
    expect(screen.getByTestId(IDS.runs).textContent).toContain("github:a/b#1<i> @ abcdef1");
  });
});
