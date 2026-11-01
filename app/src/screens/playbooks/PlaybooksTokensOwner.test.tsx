// @vitest-environment jsdom
// Phase 7 item 15 on the Playbooks screen: the list's Tokens today cell (against the
// playbook's own daily limit, "unknown" when the usage answer does not list it), the
// last-known hold that survives a remount while the kernel is away, the screen's reads
// repeating when the kernel returns, the title-bar subtitle, the owner by avatar and
// name, and the short model with the full id in the cell's title.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiResult, BudgetLimitUsage, PlaybookListing, PlaybookRun, RosterEntry, StudioBridge } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { takeComposerHandoff } from "../chat/handoff";
import { agent, playbook } from "../chat/testkit";
import { PLAYBOOKS_TEST_IDS as IDS } from "./model";
import { PlaybooksScreen } from "./PlaybooksScreen";
import { PlaybooksSubtitle } from "./subtitle";

const AT = "2026-10-29T10:00:00.000Z";

const AWAY: ApiResult<never> = { ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } };

function limit(slug: string, tokens_today: number, tokens_per_day: number | null): BudgetLimitUsage {
  return { scope: "playbook", id: slug, tokens_today, tokens_per_day, sessions_running: 0, sessions_at_once: null };
}

function run(id: number, playbookId: number, overrides: Partial<PlaybookRun> = {}): PlaybookRun {
  return { id, playbook: playbookId, version: 1, kind: "fire", status: "done", item_ref: null, item_revision: null, tokens: 1000, session: null, started: AT, ended: AT, ...overrides };
}

interface Kernel {
  playbooks: PlaybookListing[];
  limits: BudgetLimitUsage[];
  agents: RosterEntry[] | undefined;
  /** When set, every GET answers this (the kernel is away). */
  away: boolean;
}

/** Three playbooks: one with a daily limit, one with none, one with a limit and nothing used. */
function standard(): Kernel {
  return {
    playbooks: [
      playbook(1, { slug: "review-prs", name: "Review PRs", status: "enabled", model: "claude-sonnet-5-5", token_limit_per_day: 200000, owning_agent: "mason" }),
      playbook(2, { slug: "weekly-changelog", name: "Weekly changelog", status: "draft", model: "sonnet", token_limit_per_day: null, owning_agent: "wright" }),
      playbook(3, { slug: "morning-digest", name: "Morning digest", status: "disabled", model: null, token_limit_per_day: 50000, owning_agent: "ada" }),
    ],
    limits: [limit("review-prs", 38200, 200000), limit("weekly-changelog", 0, null), limit("morning-digest", 0, 50000)],
    agents: [agent("wright"), agent("mason", { display_name: "Mason" })],
    away: false,
  };
}

function wire(fake: FakeBridge, kernel: Kernel): void {
  const answer = <T,>(body: () => ApiResult<T>) => () => (kernel.away ? AWAY : body());
  fake.route("GET /status", answer(() => ok({ kernel: { version: "0", uptime_s: 1, pid: 1 } })));
  fake.route("GET /playbooks", answer(() => ok({ playbooks: [...kernel.playbooks] })));
  fake.route("GET /triggers", answer(() => ok({ triggers: [] })));
  fake.route("GET /approvals", answer(() => ok({ approvals: [] })));
  fake.route("GET /agents", answer(() => (kernel.agents === undefined ? { ok: false, status: 500, body: { error: "internal" } } : ok({ agents: kernel.agents }))));
  // The morning digest has never run.
  fake.route("GET /playbooks/:id/runs", (req) => answer(() => ok({ runs: req.params?.id === 3 ? [] : [run(11, 1)], next_before: null }))());
  fake.route("GET /playbooks/:id/versions", answer(() => ok({ versions: [] })));
  fake.route("GET /budget/usage", answer(() => ok({ rows: [], limits: [...kernel.limits], cap_state: [] })));
}

/** The screen with the title bar's subtitle beside it, as the shell mounts them, over `fake`'s bridge. */
function show(fake: FakeBridge) {
  (window as unknown as { api?: StudioBridge }).api = fake.bridge;
  return render(
    <>
      <PlaybooksSubtitle />
      <PlaybooksScreen api={fake.bridge} registry={createCommandRegistry()} />
    </>,
  );
}

async function mountLoaded(kernel: Kernel = standard(), fake: FakeBridge = fakeBridge()) {
  wire(fake, kernel);
  const view = show(fake);
  const root = screen.getByTestId(IDS.screen);
  await waitFor(() => expect(root.dataset.state).not.toBe("loading"));
  await waitFor(() => expect(root.textContent).not.toContain("reading…"));
  return { fake, kernel, root, ...view };
}

function rowOf(name: string): HTMLElement {
  const row = screen.getAllByTestId(IDS.row).find((r) => within(r).queryByText(name) !== null);
  if (row === undefined) throw new Error(`no row for ${name}`);
  return row;
}

/** The row's data cells by column: 0 playbook, 1 trigger, 2 dedupe, 3 priority, 4 model, 5 mode, 6 last run, 7 tokens today, 8 switch. */
function cell(name: string, column: number): HTMLElement {
  return rowOf(name).querySelectorAll("td")[column] as HTMLElement;
}

/** The store goes live (a frame proves the feed), then the kernel stops answering. */
async function goAway(fake: FakeBridge, kernel: Kernel, reads: "fail" | "keep" = "fail"): Promise<void> {
  await act(async () => fake.emit({ type: "heartbeat", latest_id: 0 }));
  fake.connectionAnswer = { state: "unreachable", reason: "connection_failed" };
  kernel.away = reads === "fail";
  await act(async () => fake.emit({ type: "closed", code: 1006, reason: "" }));
}

/** The kernel answers again: the store's next attempt reconnects and the feed proves itself. */
async function comeBack(fake: FakeBridge, kernel: Kernel): Promise<void> {
  const before = fake.subscribeCalls.length;
  kernel.away = false;
  fake.connectionAnswer = { state: "connected", port: 1 };
  fake.subscribeAnswer = { state: "connected", port: 1 };
  await waitFor(() => expect(fake.subscribeCalls.length).toBeGreaterThan(before), { timeout: 3000 });
  await act(async () => fake.emit({ type: "heartbeat", latest_id: 0 }));
}

beforeEach(() => {
  takeComposerHandoff("wright");
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { api?: StudioBridge }).api;
  window.location.hash = "";
  takeComposerHandoff("wright");
});

describe("AC4: the Tokens today cell", () => {
  it("reads '<today> of <limit>' with a daily limit, and the figure with 'no limit set' without one", async () => {
    await mountLoaded();
    expect(screen.getByRole("columnheader", { name: "Tokens today" })).toBeTruthy();
    expect(cell("Review PRs", 7).textContent).toBe("38.2k of 200k");
    expect(cell("Morning digest", 7).textContent).toBe("0 of 50k");
    expect(cell("Weekly changelog", 7).textContent).toBe("0no limit set");
    expect(within(cell("Weekly changelog", 7)).getByText("no limit set")).toBeTruthy();
    // Tokens, never dollars.
    expect(screen.getByTestId(IDS.screen).textContent).not.toContain("$");
  });

  it("asks for today's usage only, and takes each figure by the playbook's slug", async () => {
    const { fake } = await mountLoaded();
    expect(fake.requestsTo("GET /budget/usage")[0]?.req.query).toEqual({ days: "1" });
    // An agent row with the same id as a slug is not a playbook's figure.
    const kernel = standard();
    kernel.limits = [{ ...limit("review-prs", 999, 5), scope: "agent" }, limit("review-prs", 38200, 200000), limit("weekly-changelog", 0, null), limit("morning-digest", 0, 50000)];
    cleanup();
    await mountLoaded(kernel);
    expect(cell("Review PRs", 7).textContent).toBe("38.2k of 200k");
  });

  it("a slug the usage answer does not list reads 'unknown', never 0", async () => {
    const kernel = standard();
    kernel.limits = kernel.limits.filter((l) => l.id !== "morning-digest");
    await mountLoaded(kernel);
    expect(within(cell("Morning digest", 7)).getByText("unknown")).toBeTruthy();
    expect(cell("Morning digest", 7).textContent).not.toMatch(/\b0\b/);
    expect(cell("Review PRs", 7).textContent).toBe("38.2k of 200k");
  });

  it("a read the live kernel refuses reads 'unknown · could not be read'", async () => {
    const fake = fakeBridge();
    const kernel = standard();
    wire(fake, kernel);
    fake.route("GET /budget/usage", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    show(fake);
    await waitFor(() => expect(screen.getAllByTestId(IDS.row)).toHaveLength(3));
    await waitFor(() => expect(cell("Review PRs", 7).textContent).toBe("unknowncould not be read"));
    expect(screen.getByTestId(IDS.screen).textContent).not.toContain("last known");
  });

  it("offline with nothing ever held reads 'unknown' with 'last known: none'", async () => {
    const fake = fakeBridge();
    const kernel = standard();
    wire(fake, kernel);
    // The usage read never reaches the kernel, so nothing is ever held for it.
    fake.route("GET /budget/usage", () => AWAY);
    show(fake);
    await waitFor(() => expect(screen.getAllByTestId(IDS.row)).toHaveLength(3));
    await waitFor(() => expect(cell("Review PRs", 7).textContent).toContain("unknown"));
    await goAway(fake, kernel, "keep");
    await waitFor(() => expect(screen.getByTestId(IDS.screen).dataset.offline).toBe("true"));
    expect(cell("Review PRs", 7).textContent).toBe("unknownlast known: none");
    expect(screen.getByTestId(IDS.screen).textContent).not.toContain("could not be read");
  });

  it("while the kernel is away, a playbook with no run reads 'no runs yet' and one the usage answer does not list reads 'unknown', each marked last known", async () => {
    const kernel = standard();
    kernel.limits = kernel.limits.filter((l) => l.id !== "morning-digest");
    const { fake, root } = await mountLoaded(kernel);
    await goAway(fake, kernel, "keep");
    await waitFor(() => expect(root.dataset.offline).toBe("true"));
    expect(cell("Morning digest", 7).textContent).toBe("unknownlast known");
    expect(cell("Morning digest", 6).textContent).toBe("no runs yetlast known");
    expect(cell("Review PRs", 7).textContent).toBe("38.2k of 200klast known");
  });

  it("keeps its last value, marked 'last known', while the kernel is away, and the writes are off", async () => {
    const { fake, kernel, root } = await mountLoaded();
    await goAway(fake, kernel);
    await waitFor(() => expect(root.dataset.offline).toBe("true"));
    expect(cell("Review PRs", 7).textContent).toBe("38.2k of 200klast known");
    expect(cell("Review PRs", 6).textContent).toContain("last known");
    expect(root.textContent).not.toContain("could not be read");
    expect(root.textContent).not.toContain("unknown");
    for (const sw of screen.getAllByRole("switch")) expect((sw as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AC2: the last answers survive a remount while the kernel is away", () => {
  it("unmounted and mounted again with reads that now fail, the row still shows its last tokens and last run marked last known", async () => {
    const { fake, kernel, unmount } = await mountLoaded();
    expect(cell("Review PRs", 7).textContent).toBe("38.2k of 200k");
    unmount();
    kernel.away = true;
    fake.connectionAnswer = { state: "unreachable", reason: "connection_failed" };
    show(fake);
    // The first paint is already the held answers: nothing reads "reading…" while the reads are in flight.
    expect(screen.getByTestId(IDS.screen).textContent).not.toContain("reading…");
    expect(cell("Review PRs", 7).textContent).toBe("38.2k of 200k");
    expect(cell("Review PRs", 6).textContent).not.toContain("unknown");
    await waitFor(() => expect(screen.getAllByTestId(IDS.row)).toHaveLength(3));
    await waitFor(() => expect(cell("Review PRs", 7).textContent).toBe("38.2k of 200klast known"));
    expect(cell("Review PRs", 6).textContent).toContain("last known");
    expect(screen.getByTestId(IDS.screen).textContent).not.toContain("unknown");
    expect(screen.getByTestId(IDS.screen).textContent).not.toContain("could not be read");
    expect(screen.getByTestId(IDS.count).textContent).toBe("3 playbooks · 1 on · last known");
  });

  it("another bridge's screen never shows the first bridge's held tokens", async () => {
    const first = await mountLoaded();
    expect(cell("Review PRs", 7).textContent).toBe("38.2k of 200k");
    first.unmount();
    const second = fakeBridge();
    const kernel = standard();
    wire(second, kernel);
    second.route("GET /budget/usage", () => AWAY);
    show(second);
    await waitFor(() => expect(screen.getAllByTestId(IDS.row)).toHaveLength(3));
    await waitFor(() => expect(cell("Review PRs", 7).textContent).toContain("unknown"));
    expect(screen.getByTestId(IDS.screen).textContent).not.toContain("38.2k");
  });

  it("a playbook that left the list and came back reads from scratch, never from a stale answer", async () => {
    const { fake, kernel } = await mountLoaded();
    const feed = async (id: number): Promise<void> => act(async () => fake.emit({ type: "event", id, at: AT, kind: "playbook_updated", session_id: null, task_id: null, payload: {} }));
    // Morning digest leaves the list; the next batch of reads prunes its held run.
    kernel.playbooks = kernel.playbooks.filter((p) => p.id !== 3);
    const runsBefore = fake.requestsTo("GET /playbooks/:id/runs").length;
    await feed(1);
    await waitFor(() => expect(screen.getAllByTestId(IDS.row)).toHaveLength(2));
    await waitFor(() => expect(fake.requestsTo("GET /playbooks/:id/runs").length).toBeGreaterThan(runsBefore + 1));
    // It comes back while the runs cannot be read: it has nothing held, and the playbooks that stayed keep their last run.
    fake.route("GET /playbooks/:id/runs", () => AWAY);
    kernel.playbooks = standard().playbooks;
    await feed(2);
    await waitFor(() => expect(screen.getAllByTestId(IDS.row)).toHaveLength(3));
    await waitFor(() => expect(within(cell("Morning digest", 6)).getByText("unknown")).toBeTruthy());
    expect(within(cell("Review PRs", 6)).queryByText("unknown")).toBeNull();
  });
});

describe("AC1: the screen's reads repeat when the kernel returns", () => {
  it("a figure that changed while the kernel was away shows after it returns, with no remount and no failed read", async () => {
    const { fake, kernel, root } = await mountLoaded();
    const usageBefore = fake.requestsTo("GET /budget/usage").length;
    // Away, but no read is attempted or fails: only the connection tells.
    await goAway(fake, kernel, "keep");
    await waitFor(() => expect(root.dataset.offline).toBe("true"));
    expect(cell("Review PRs", 7).textContent).toBe("38.2k of 200klast known");
    kernel.limits = [limit("review-prs", 45000, 200000), limit("weekly-changelog", 0, null), limit("morning-digest", 0, 50000)];
    const row = rowOf("Review PRs");
    await comeBack(fake, kernel);
    await waitFor(() => expect(root.dataset.offline).toBeUndefined());
    await waitFor(() => expect(cell("Review PRs", 7).textContent).toBe("45k of 200k"));
    expect(fake.requestsTo("GET /budget/usage").length).toBeGreaterThan(usageBefore);
    // The same row: nothing was remounted.
    expect(rowOf("Review PRs")).toBe(row);
  });
});

describe("AC3: the title-bar subtitle", () => {
  it("the list shows its count line, and the screen draws none of its own", async () => {
    const { root } = await mountLoaded();
    const counts = screen.getAllByTestId(IDS.count);
    expect(counts).toHaveLength(1);
    expect(counts[0]?.textContent).toBe("3 playbooks · 1 on");
    expect(root.contains(counts[0] as HTMLElement)).toBe(false);
  });

  it("a playbook's detail shows its slug there (monospace, once), not the count line, and the detail head no longer repeats it", async () => {
    const { root } = await mountLoaded();
    fireEvent.click(within(rowOf("Review PRs")).getByTestId(IDS.open));
    const detail = await screen.findByTestId(IDS.detail);
    expect(screen.getByTestId(IDS.slug).textContent).toBe("review-prs");
    expect(screen.getByTestId(IDS.slug).className).toContain("pb-mono");
    expect(screen.queryByTestId(IDS.count)).toBeNull();
    expect(detail.querySelector(".pb-head")?.textContent).not.toContain("review-prs");
    expect(root.textContent).not.toContain("review-prs");
  });

  it("the edit and history views show no subtitle, and back on the list the count line returns", async () => {
    await mountLoaded();
    fireEvent.click(within(rowOf("Review PRs")).getByTestId(IDS.open));
    await screen.findByTestId(IDS.detail);
    fireEvent.click(screen.getByTestId(IDS.editFields));
    await screen.findByTestId(IDS.edit);
    expect(screen.queryByTestId(IDS.slug)).toBeNull();
    expect(screen.queryByTestId(IDS.count)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Playbook" }));
    await screen.findByTestId(IDS.detail);
    fireEvent.click(screen.getByTestId(IDS.history));
    await screen.findByTestId(IDS.historyView);
    expect(screen.queryByTestId(IDS.slug)).toBeNull();
    expect(screen.queryByTestId(IDS.count)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Playbook" }));
    await screen.findByTestId(IDS.detail);
    fireEvent.click(screen.getAllByRole("button", { name: "Playbooks" })[0] as HTMLElement);
    expect((await screen.findByTestId(IDS.count)).textContent).toBe("3 playbooks · 1 on");
  });

  it("shows nothing once the screen unmounts, and nothing with no bridge", async () => {
    const { unmount } = await mountLoaded();
    expect(screen.queryByTestId(IDS.count)).not.toBeNull();
    unmount();
    cleanup();
    const bare = render(<PlaybooksSubtitle />);
    expect(bare.container.textContent).toBe("");
    delete (window as unknown as { api?: StudioBridge }).api;
    const none = render(<PlaybooksSubtitle />);
    expect(none.container.textContent).toBe("");
  });

  it("a hostile slug is inert text", async () => {
    const kernel = standard();
    kernel.playbooks = [playbook(1, { slug: "x<script>\u001b[31m", name: "Hostile", status: "enabled" })];
    kernel.limits = [];
    const { root } = await mountLoaded(kernel);
    fireEvent.click(within(rowOf("Hostile")).getByTestId(IDS.open));
    await screen.findByTestId(IDS.detail);
    expect(screen.getByTestId(IDS.slug).textContent).toBe("x<script>\\x1b[31m");
    expect(document.querySelector("script")).toBeNull();
    expect(root.querySelector("script")).toBeNull();
  });
});

describe("AC6: the owner by avatar and name", () => {
  async function openOwner(kernel: Kernel): Promise<HTMLElement> {
    await mountLoaded(kernel);
    fireEvent.click(within(rowOf("Review PRs")).getByTestId(IDS.open));
    await screen.findByTestId(IDS.detail);
    return screen.getByTestId(IDS.owner);
  }

  it("shows the roster's display_name beside its avatar, not the id", async () => {
    const kernel = standard();
    kernel.agents = [agent("wright"), agent("mason", { display_name: "Mason the builder" })];
    const owner = await openOwner(kernel);
    await waitFor(() => expect(within(owner).getByRole("img", { name: "Mason the builder · idle" })).toBeTruthy());
    expect(owner.textContent).toBe("Mason the builder");
    expect(owner.textContent).not.toContain("mason");
  });

  it("an owner the roster does not list shows the raw id through safe, with no avatar", async () => {
    const kernel = standard();
    kernel.agents = [agent("wright")];
    const owner = await openOwner(kernel);
    expect(owner.textContent).toBe("mason");
    expect(within(owner).queryByRole("img")).toBeNull();
  });

  it("a roster not read yet shows the raw id, with no avatar", async () => {
    const kernel = standard();
    kernel.agents = undefined;
    const owner = await openOwner(kernel);
    expect(owner.textContent).toBe("mason");
    expect(within(owner).queryByRole("img")).toBeNull();
  });

  it("a hostile display_name stays text", async () => {
    const kernel = standard();
    kernel.agents = [agent("mason", { display_name: "<img src=x onerror=alert(1)>" })];
    const owner = await openOwner(kernel);
    await waitFor(() => expect(owner.textContent).toBe("<img src=x onerror=alert(1)>"));
    expect(owner.querySelector("img")).toBeNull();
  });
});

describe("AC5: short model names", () => {
  it("the table's Model cell shows the family word with the full id in its title; the detail shows the id in full", async () => {
    await mountLoaded();
    const model = cell("Review PRs", 4);
    expect(model.textContent).toContain("sonnet");
    expect(model.textContent).not.toContain("claude-sonnet-5-5");
    expect(model.querySelector('[title="claude-sonnet-5-5"]')).not.toBeNull();
    // Any other id is shown as stored (its title is the same id); an unset model reads "not set", with no title.
    expect(cell("Weekly changelog", 4).textContent).toContain("sonnet");
    expect(cell("Weekly changelog", 4).querySelector('[title="sonnet"]')).not.toBeNull();
    expect(cell("Morning digest", 4).querySelector("[title]")).toBeNull();
    expect(cell("Morning digest", 4).textContent).toContain("not set");
    fireEvent.click(within(rowOf("Review PRs")).getByTestId(IDS.open));
    await screen.findByTestId(IDS.detail);
    const modelRow = screen.getAllByTestId(IDS.field).find((f) => f.dataset.field === "Model") as HTMLElement;
    expect(modelRow.textContent).toContain("claude-sonnet-5-5");
  });
});
