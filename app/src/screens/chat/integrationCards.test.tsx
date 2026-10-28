// @vitest-environment jsdom
// The phase 6 thread cards: a draft card that reads its body on demand as inert
// text, poll queued/skipped lines (consecutive skips collapse into one card),
// the connector line, and J/K + Enter over all of them. The real keys run in
// Electron in `app/e2e/chat-integrations.spec.ts`.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { groupThreadRows, prUrlOf } from "./integrationCards";
import { draft, eventFrame, eventItem, kit, playbook, renderChat, resetChat, thread } from "./testkit";
import type { Kit } from "./testkit";

afterEach(resetChat);

const DRAFT_TITLE = "Draft review for acme/widgets#42 (not sent)";
const NOTHING_POSTED = "Draft mode: nothing was posted";

const draftEvent = (id: number, draftId: number) => eventItem(id, "draft_output_recorded", `gh_pr_review ${draftId}`, { session_id: 5, draft_output_id: draftId });
const skipEvent = (id: number, playbookId = 1) => eventItem(id, "poll_item_skipped", `Playbook pb-${playbookId} skipped item ${id}`, { playbook_id: playbookId });
const queuedEvent = (id: number, playbookId = 1) => eventItem(id, "poll_item_queued", `Playbook pb-${playbookId} queued item ${id}`, { playbook_id: playbookId });

const skipFrame = (id: number, ref: string, playbookId = 1) =>
  eventFrame(id, "poll_item_skipped", { playbook_id: playbookId, item_ref: ref, item_revision: `rev${id}aaaaaaaa`, dedupe_key: `pr:${id}:rev${id}` });
const queuedFrame = (id: number, ref: string, revision: string) =>
  eventFrame(id, "poll_item_queued", { trigger_id: 1, playbook_id: 1, item_ref: ref, revision, queue_id: 3 });

const detailCalls = (k: Kit) => k.fake.requestsTo("GET /drafts/:id");

async function press(el: Element, key: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(el, { key, ...init });
  });
}

async function expand(name: string | RegExp): Promise<HTMLElement> {
  const toggle = screen.getByRole("button", { name });
  await act(async () => {
    fireEvent.click(toggle);
  });
  return toggle;
}

describe("prUrlOf", () => {
  it("builds the URL only from the exact github:<owner>/<repo>#<n> shape", () => {
    expect(prUrlOf("github:acme/widgets#42")).toBe("https://github.com/acme/widgets/pull/42");
    expect(prUrlOf("github:a-b/c.d_e#1")).toBe("https://github.com/a-b/c.d_e/pull/1");
    for (const bad of ["github:a/b#1 https://evil.example", "github:a/b#0", "github:a/b#01", "github:a/b#", "gitlab:a/b#1", "github:a b/c#1", "github:a/b#1\n", "", null, undefined]) {
      expect(prUrlOf(bad)).toBeUndefined();
    }
  });
});

describe("groupThreadRows", () => {
  it("folds consecutive skips of one playbook and passes everything else through", () => {
    const rows = groupThreadRows([skipEvent(1), skipEvent(2), eventItem(3, "session_status", "x"), skipEvent(4), skipEvent(5, 2), skipEvent(6, 2), queuedEvent(7), skipEvent(8)]);
    expect(rows.map((r) => (r.type === "skips" ? `skips:${r.items.map((i) => i.id).join("+")}` : `${r.type}:${r.id}`))).toEqual(["skips:1+2", "event:3", "skips:4", "skips:5+6", "event:7", "skips:8"]);
  });
});

describe("draft card", () => {
  async function renderDraft(overrides: Partial<Kit["state"]> = {}) {
    const k = kit({ threads: { wright: thread([draftEvent(5, 9)]) }, drafts: [draft(9)], ...overrides });
    await renderChat(k);
    await screen.findByText(DRAFT_TITLE);
    return k;
  }

  it("collapsed: the PR, its URL as text, and the not-sent label", async () => {
    const k = await renderDraft();
    expect(screen.getByText("https://github.com/acme/widgets/pull/42")).toBeTruthy();
    expect(screen.getByText(NOTHING_POSTED)).toBeTruthy();
    expect(screen.getByRole("button", { name: DRAFT_TITLE }).getAttribute("aria-expanded")).toBe("false");
    // The list was read once for the title; the body waits for an expand.
    expect(k.fake.requestsTo("GET /drafts")).toHaveLength(1);
    expect(k.fake.requestsTo("GET /drafts")[0]?.req.query).toEqual({ agent: "wright", limit: "200" });
    expect(detailCalls(k)).toHaveLength(0);
    expect(document.querySelector("a")).toBeNull();
  });

  it("'Draft mode: nothing was posted' is visible collapsed and expanded", async () => {
    await renderDraft();
    expect(screen.getByText(NOTHING_POSTED)).toBeTruthy();
    await expand(DRAFT_TITLE);
    await screen.findByText("Looks fine");
    expect(screen.getByText(NOTHING_POSTED)).toBeTruthy();
  });

  it("expanding fetches GET /drafts/:id once, and shows the body from that read", async () => {
    // The list row and the detail row differ, so the body can only have come from the detail read.
    const k = await renderDraft();
    k.state.drafts = [draft(9, { payload: { kind: "gh_pr_review", body: "From the detail read" } })];
    const toggle = await expand(DRAFT_TITLE);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await screen.findByText("From the detail read");
    expect(detailCalls(k)).toHaveLength(1);
    expect(detailCalls(k)[0]?.req.params).toEqual({ id: 9 });
    // Collapse and open again: the card keeps what it read.
    await expand(DRAFT_TITLE);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await expand(DRAFT_TITLE);
    expect(screen.getByText("From the detail read")).toBeTruthy();
    expect(detailCalls(k)).toHaveLength(1);
  });

  it("shows payload.body for a comment, payload.command for a command and payload.input_json for an input", async () => {
    const cases: [unknown, string][] = [
      [{ kind: "gh_pr_comment", body: "A comment body", command: "gh pr comment 42" }, "A comment body"],
      [{ kind: "command", tool: "Bash", command: "gh pr merge 42" }, "gh pr merge 42"],
      [{ kind: "input", tool: "mcp__x__send", input_json: '{"to":"#general"}' }, '{"to":"#general"}'],
    ];
    for (const [payload, text] of cases) {
      const k = kit({ threads: { wright: thread([draftEvent(5, 9)]) }, drafts: [draft(9, { payload })] });
      const view = await renderChat(k);
      await screen.findByText(DRAFT_TITLE);
      await expand(DRAFT_TITLE);
      await screen.findByText(text);
      view.unmount();
      resetChat();
    }
  });

  it("a refused detail read shows the kernel's words as text and the card stays", async () => {
    const k = await renderDraft();
    k.fake.route("GET /drafts/:id", () => ({ ok: false, status: 403, body: { error: "refused", message: "<b>not yours</b>" } }));
    await expand(DRAFT_TITLE);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("<b>not yours</b> (refused)");
    expect(alert.querySelector("b")).toBeNull();
    expect(screen.getByRole("button", { name: DRAFT_TITLE })).toBeTruthy();
    expect(screen.getByText(NOTHING_POSTED)).toBeTruthy();
    expect(detailCalls(k)).toHaveLength(1);
  });

  it("a draft missing from the list reads 'Draft review (not sent)' with its id until the detail answers", async () => {
    const k = kit({ threads: { wright: thread([draftEvent(5, 9)]) }, drafts: [] });
    await renderChat(k);
    await screen.findByText("Draft review (not sent)");
    expect(screen.getByText("Draft 9")).toBeTruthy();
    expect(screen.queryByText(/github\.com/)).toBeNull();
    // The detail answers (the row appeared after the list was read): the title names the PR.
    k.state.drafts = [draft(9)];
    await expand("Draft review (not sent)");
    await screen.findByText(DRAFT_TITLE);
    expect(screen.getByText("Draft review for acme/widgets#42 (not sent)")).toBeTruthy();
  });

  it("an item_ref that does not match gets no URL", async () => {
    const trailing = "github:a/b#1 https://evil.example";
    const k = kit({ threads: { wright: thread([draftEvent(5, 9)]) }, drafts: [draft(9, { item_ref: trailing })] });
    await renderChat(k);
    await screen.findByText(`Draft review for ${trailing} (not sent)`);
    expect(screen.queryByText(/github\.com\/a\/b\/pull/)).toBeNull();
    expect(document.querySelector("a")).toBeNull();
    expect(screen.getByText("Draft 9")).toBeTruthy();
  });

  it("a draft event with no usable draft_output_id stays a one-line event and reads no draft", async () => {
    const k = kit({ threads: { wright: thread([eventItem(5, "draft_output_recorded", "Draft output recorded", { session_id: 5 }), eventItem(6, "draft_output_recorded", "Draft output zero", { draft_output_id: "abc" })]) } });
    await renderChat(k);
    expect(await screen.findByRole("button", { name: "Draft output recorded" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft output zero" })).toBeTruthy();
    expect(screen.queryByText(NOTHING_POSTED)).toBeNull();
    expect(k.fake.requestsTo("GET /drafts")).toHaveLength(0);
  });

  it("a detail answer with no draft says so, as text", async () => {
    const k = await renderDraft();
    k.fake.route("GET /drafts/:id", () => ({ ok: true, status: 200, body: {} }));
    await expand(DRAFT_TITLE);
    expect((await screen.findByRole("alert")).textContent).toBe("The kernel's answer had no draft.");
  });

  it("shows 'Reading the draft' while the detail read is pending", async () => {
    const k = await renderDraft();
    k.fake.route("GET /drafts/:id", () => new Promise(() => undefined));
    await expand(DRAFT_TITLE);
    expect((await screen.findByRole("status")).textContent).toBe("Reading the draft");
  });

  it("says when the kernel cut the text, and not otherwise", async () => {
    const k = await renderDraft();
    k.state.drafts = [draft(9, { payload: { kind: "gh_pr_review", body: "Cut body", truncated: true } })];
    await expand(DRAFT_TITLE);
    await screen.findByText("Cut body");
    expect(screen.getByText("The kernel cut this text to fit.")).toBeTruthy();
  });

  it("falls back from an empty body to the command, then to the payload as text", async () => {
    const cases: [unknown, string][] = [
      [{ kind: "gh_pr_review", body: "", command: "gh pr review 42 --comment" }, "gh pr review 42 --comment"],
      [{ kind: "gh_pr_comment", tool: "Bash" }, '"tool": "Bash"'],
      [{ kind: "command", tool: "Bash" }, '"kind": "command"'],
      [{ kind: "input", tool: "x" }, '"kind": "input"'],
      [{ kind: "other", body: "ignored" }, '"body": "ignored"'],
      ["a bare string payload", '"a bare string payload"'],
      [null, "null"],
    ];
    for (const [payload, text] of cases) {
      const k = kit({ threads: { wright: thread([draftEvent(5, 9)]) }, drafts: [draft(9, { payload })] });
      const view = await renderChat(k);
      await screen.findByText(DRAFT_TITLE);
      await expand(DRAFT_TITLE);
      await waitFor(() => expect(view.container.querySelector(".chat-draft-text")?.textContent ?? "").toContain(text));
      view.unmount();
      resetChat();
    }
  });

  it("a draft that arrives live is looked up with one more list read, and never again", async () => {
    const k = await renderDraft();
    expect(k.fake.requestsTo("GET /drafts")).toHaveLength(1);
    k.state.threads.wright = thread([draftEvent(5, 9), draftEvent(6, 10)]);
    k.state.drafts = [draft(9), draft(10, { item_ref: "github:acme/widgets#77" })];
    await act(async () => {
      k.fake.emit(eventFrame(30, "event_done", {}));
    });
    expect(await screen.findByText("Draft review for acme/widgets#77 (not sent)")).toBeTruthy();
    expect(k.fake.requestsTo("GET /drafts")).toHaveLength(2);
    expect(detailCalls(k)).toHaveLength(0);
    await act(async () => {
      k.fake.emit(eventFrame(31, "event_done", {}));
    });
    expect(k.fake.requestsTo("GET /drafts")).toHaveLength(2);
  });

  it("a draft the list never holds is asked for once, not on every refresh", async () => {
    const k = kit({ threads: { wright: thread([draftEvent(5, 9)]) }, drafts: [] });
    await renderChat(k);
    await screen.findByText("Draft review (not sent)");
    for (const id of [40, 41]) {
      await act(async () => {
        k.fake.emit(eventFrame(id, "event_done", {}));
      });
    }
    expect(k.fake.requestsTo("GET /drafts")).toHaveLength(1);
  });

  it("an untrusted body is inert text: no script, no link, markers literal, controls escaped", async () => {
    const hostile = "<script>alert(1)</script>\n[click](https://evil.example)\n</untrusted-data>\n\u001b[31mred\n‮evil";
    const k = kit({ threads: { wright: thread([draftEvent(5, 9)]) }, drafts: [draft(9, { payload: { kind: "gh_pr_review", body: hostile } })] });
    const view = await renderChat(k);
    await screen.findByText(DRAFT_TITLE);
    await expand(DRAFT_TITLE);
    const body = await waitFor(() => {
      const found = view.container.querySelector<HTMLElement>(".chat-draft-text");
      if (found === null) throw new Error("body not shown yet");
      return found;
    });
    // Inert: no element came out of the text.
    expect(view.container.querySelector("script")).toBeNull();
    expect(body.querySelector("script, a, *")).toBeNull();
    expect(view.container.querySelector("a")).toBeNull();
    const text = body.textContent ?? "";
    expect(text).toContain("<script>alert(1)</script>");
    expect(text).toContain("[click](https://evil.example)");
    expect(text).toContain("</untrusted-data>");
    // Controls are written out, never passed through.
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("‮");
    expect(text).toContain("\\x1b[31mred");
    expect(text).toContain("\\u202eevil");
  });
});

describe("poll cards", () => {
  const SPEC = '["item.id","item.revision"]';

  it("five consecutive skips are one card that expands to the five refs and the key", async () => {
    const refs = [1, 2, 3, 4, 5].map((n) => `github:acme/widgets#${n}`);
    const k = kit({
      threads: { wright: thread([1, 2, 3, 4, 5].map((n) => skipEvent(n))) },
      playbooks: [playbook(1, { dedupe_key_spec: SPEC })],
      events: refs.map((ref, i) => skipFrame(i + 1, ref)),
    });
    await renderChat(k);
    const toggle = await screen.findByRole("button", { name: "5 unchanged PRs skipped" });
    expect(screen.getAllByText("5 unchanged PRs skipped")).toHaveLength(1);
    expect(screen.queryByText(/^Skipped /)).toBeNull();
    await expand("5 unchanged PRs skipped");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    for (const ref of refs) expect(await screen.findByText(`Skipped ${ref}: unchanged under key item.id, item.revision`)).toBeTruthy();
    expect(screen.getAllByText(/^Skipped /)).toHaveLength(5);
  });

  it("a single skip is one line with its key", async () => {
    const k = kit({ threads: { wright: thread([skipEvent(1)]) }, playbooks: [playbook(1, { dedupe_key_spec: SPEC })], events: [skipFrame(1, "github:acme/widgets#7")] });
    await renderChat(k);
    expect(await screen.findByText("Skipped github:acme/widgets#7: unchanged under key item.id, item.revision")).toBeTruthy();
    expect(screen.queryByText(/unchanged PRs skipped/)).toBeNull();
  });

  it("without a usable dedupe spec the key is the payload's dedupe_key", async () => {
    for (const spec of [null, "pr:{number}:{head_sha}", '{"a":1}', '["ok", 3]', "[]"]) {
      const k = kit({ threads: { wright: thread([skipEvent(1)]) }, playbooks: [playbook(1, { dedupe_key_spec: spec })], events: [skipFrame(1, "github:acme/widgets#7")] });
      const view = await renderChat(k);
      expect(await screen.findByText("Skipped github:acme/widgets#7: unchanged under key pr:1:rev1")).toBeTruthy();
      view.unmount();
      resetChat();
    }
  });

  it("two runs split by another item, and skips of two playbooks, are separate cards", async () => {
    const items = [skipEvent(1), skipEvent(2), eventItem(3, "session_status", "Session 3 started"), skipEvent(4), skipEvent(5), skipEvent(6, 2), skipEvent(7, 2)];
    const k = kit({ threads: { wright: thread(items) }, playbooks: [playbook(1), playbook(2, { slug: "pb-2" })] });
    await renderChat(k);
    await screen.findByText("Session 3 started");
    expect(screen.getAllByRole("button", { name: "2 unchanged PRs skipped" })).toHaveLength(3);
    expect(screen.queryByText("4 unchanged PRs skipped")).toBeNull();
  });

  it("with no payload the card falls back to the kernel's summary line", async () => {
    // GET /events has no such row (empty): the single line and the opened group both say the summary.
    const k = kit({ threads: { wright: thread([skipEvent(1), skipEvent(2), eventItem(3, "session_status", "Session 3 started"), skipEvent(4)]) }, playbooks: [playbook(1)] });
    await renderChat(k);
    expect(await screen.findByText("Playbook pb-1 skipped item 4")).toBeTruthy();
    await expand("2 unchanged PRs skipped");
    expect(await screen.findByText("Playbook pb-1 skipped item 1")).toBeTruthy();
    expect(screen.getByText("Playbook pb-1 skipped item 2")).toBeTruthy();
    expect(screen.queryByText(/^Skipped\s*:/)).toBeNull();
    // A read that fails outright reads the same.
    expect(k.fake.requestsTo("GET /events").length).toBeGreaterThan(0);
  });

  it("a failed payload read falls back to the summary too", async () => {
    const k = kit({ threads: { wright: thread([queuedEvent(1)]) } });
    k.fake.route("GET /events", () => ({ ok: false, status: 500, body: { error: "boom" } }));
    await renderChat(k);
    expect(await screen.findByText("Playbook pb-1 queued item 1")).toBeTruthy();
  });

  it("a queued item reads 'Reviewing <ref> @ <first 7 chars of the revision>'", async () => {
    const k = kit({ threads: { wright: thread([queuedEvent(1)]) }, events: [queuedFrame(1, "github:acme/widgets#5", "abcdef1234567890")] });
    await renderChat(k);
    expect(await screen.findByText("Reviewing github:acme/widgets#5 @ abcdef1")).toBeTruthy();
    expect(screen.queryByText(/abcdef12/)).toBeNull();
  });

  it("reads a payload from the live store's event log when it holds the frame (no GET /events)", async () => {
    const k = kit({ threads: { wright: thread([]) } });
    await renderChat(k);
    await act(async () => {
      k.fake.emit(queuedFrame(20, "github:acme/widgets#9", "0123456789abcdef"));
    });
    k.state.threads.wright = thread([queuedEvent(20)]);
    await act(async () => {
      k.fake.emit(eventFrame(21, "event_done", {}));
    });
    expect(await screen.findByText("Reviewing github:acme/widgets#9 @ 0123456")).toBeTruthy();
    expect(k.fake.requestsTo("GET /events")).toHaveLength(0);
  });
});

describe("poll payload reads", () => {
  it("a queued ref with no revision reads 'Reviewing <ref>'", async () => {
    const k = kit({ threads: { wright: thread([queuedEvent(1)]) }, events: [eventFrame(1, "poll_item_queued", { item_ref: "github:acme/widgets#5" })] });
    await renderChat(k);
    expect(await screen.findByText("Reviewing github:acme/widgets#5")).toBeTruthy();
  });

  it("a skip with no key anywhere reads 'Skipped <ref>: unchanged'", async () => {
    const k = kit({ threads: { wright: thread([skipEvent(1)]) }, playbooks: [playbook(1)], events: [eventFrame(1, "poll_item_skipped", { playbook_id: 1, item_ref: "github:acme/widgets#5" })] });
    await renderChat(k);
    expect(await screen.findByText("Skipped github:acme/widgets#5: unchanged")).toBeTruthy();
  });

  it("a payload with no item_ref, or that is not an object, falls back to the summary", async () => {
    const k = kit({
      threads: { wright: thread([queuedEvent(1), skipEvent(2), eventItem(3, "session_status", "x"), queuedEvent(4)]) },
      playbooks: [playbook(1)],
      events: [eventFrame(1, "poll_item_queued", { revision: "abc" }), eventFrame(2, "poll_item_skipped", {}), eventFrame(4, "poll_item_queued", "not an object")],
    });
    await renderChat(k);
    expect(await screen.findByText("Playbook pb-1 queued item 1")).toBeTruthy();
    expect(await screen.findByText("Playbook pb-1 skipped item 2")).toBeTruthy();
    expect(await screen.findByText("Playbook pb-1 queued item 4")).toBeTruthy();
  });

  it("an ok read with no row is cached: the summary shows and the id is not asked for again", async () => {
    const k = kit({ threads: { wright: thread([queuedEvent(1)]) }, events: [] });
    await renderChat(k);
    expect(await screen.findByText("Playbook pb-1 queued item 1")).toBeTruthy();
    expect(k.fake.requestsTo("GET /events")).toHaveLength(1);
    await act(async () => {
      k.fake.emit(eventFrame(50, "event_done", {}));
    });
    expect(k.fake.requestsTo("GET /events")).toHaveLength(1);
  });

  it("several lines on mount are read in one request covering their id span", async () => {
    const k = kit({
      threads: { wright: thread([queuedEvent(3), queuedEvent(5), queuedEvent(9)]) },
      events: [queuedFrame(3, "github:acme/widgets#3", "aaaaaaaa"), queuedFrame(5, "github:acme/widgets#5", "bbbbbbbb"), queuedFrame(9, "github:acme/widgets#9", "cccccccc")],
    });
    await renderChat(k);
    expect(await screen.findByText("Reviewing github:acme/widgets#9 @ ccccccc")).toBeTruthy();
    expect(screen.getByText("Reviewing github:acme/widgets#3 @ aaaaaaa")).toBeTruthy();
    expect(screen.getByText("Reviewing github:acme/widgets#5 @ bbbbbbb")).toBeTruthy();
    const reads = k.fake.requestsTo("GET /events");
    expect(reads).toHaveLength(1);
    expect(reads[0]?.req.query).toEqual({ after: "2", limit: "7" });
  });

  it("ids more than 500 apart are read in separate requests, each within the cap", async () => {
    const k = kit({
      threads: { wright: thread([queuedEvent(1), queuedEvent(2), queuedEvent(700)]) },
      events: [queuedFrame(1, "github:acme/widgets#1", "aaaaaaaa"), queuedFrame(700, "github:acme/widgets#7", "bbbbbbbb")],
    });
    await renderChat(k);
    expect(await screen.findByText("Reviewing github:acme/widgets#7 @ bbbbbbb")).toBeTruthy();
    const queries = k.fake.requestsTo("GET /events").map((r) => r.req.query);
    expect(queries).toEqual([
      { after: "0", limit: "2" },
      { after: "699", limit: "1" },
    ]);
  });
});

describe("connector line", () => {
  it("is one line from the kernel's summary, its subject linking to the Integrations screen", async () => {
    const k = kit({ threads: { wright: thread([eventItem(1, "connector_status", "Connector github: connected", { connector: "github" })]) } });
    await renderChat(k);
    const subject = await screen.findByRole("button", { name: "Connector github: connected" });
    await act(async () => {
      fireEvent.click(subject);
    });
    expect(window.location.hash).toBe("#/integrations");
  });
});

describe("J/K and Enter", () => {
  /** A phase 5 line, a draft, a skip group, a queued line and a connector line, in that order. */
  function mixed(): Kit {
    return kit({
      threads: {
        wright: thread([
          eventItem(1, "session_status", "Session 3 started", { session_id: 3 }),
          draftEvent(2, 9),
          skipEvent(3),
          skipEvent(4),
          queuedEvent(5),
          eventItem(6, "connector_status", "Connector github: connected", { connector: "github" }),
        ]),
      },
      drafts: [draft(9)],
      playbooks: [playbook(1)],
    });
  }
  const STOPS = ["Session 3 started", DRAFT_TITLE, "2 unchanged PRs skipped", "Playbook pb-1 queued item 5", "Connector github: connected"];

  function focusedName(): string {
    return document.activeElement?.textContent?.replace(/[▸▾]/g, "").trim() ?? "";
  }

  it("J moves focus to the next card and K to the previous, in display order", async () => {
    await renderChat(mixed());
    const first = await screen.findByRole("button", { name: STOPS[0] as string });
    await screen.findByText(DRAFT_TITLE);
    act(() => first.focus());
    for (const name of STOPS.slice(1)) {
      await press(document.activeElement as Element, "j");
      expect(focusedName()).toBe(name);
    }
    // At the end, J stays put.
    await press(document.activeElement as Element, "j");
    expect(focusedName()).toBe(STOPS[4]);
    for (const name of STOPS.slice(0, 4).reverse()) {
      await press(document.activeElement as Element, "k");
      expect(focusedName()).toBe(name);
    }
    await press(document.activeElement as Element, "k");
    expect(focusedName()).toBe(STOPS[0]);
  });

  it("J works with a capital letter from Caps Lock but not with Shift or a command key", async () => {
    await renderChat(mixed());
    const first = await screen.findByRole("button", { name: STOPS[0] as string });
    await screen.findByText(DRAFT_TITLE);
    act(() => first.focus());
    await press(first, "J", { shiftKey: true });
    await press(first, "j", { metaKey: true });
    expect(document.activeElement).toBe(first);
    await press(first, "J");
    expect(focusedName()).toBe(DRAFT_TITLE);
  });

  it("up and down arrows never move between cards", async () => {
    await renderChat(mixed());
    const first = await screen.findByRole("button", { name: STOPS[0] as string });
    await screen.findByText(DRAFT_TITLE);
    act(() => first.focus());
    let notPrevented = false;
    await act(async () => {
      notPrevented = fireEvent.keyDown(first, { key: "ArrowDown" });
    });
    expect(document.activeElement).toBe(first);
    // Not taken either: the thread keeps its native scroll.
    expect(notPrevented).toBe(true);
    await press(first, "ArrowUp");
    expect(document.activeElement).toBe(first);
    const second = screen.getByRole("button", { name: DRAFT_TITLE });
    act(() => second.focus());
    await press(second, "ArrowUp");
    await press(second, "ArrowDown");
    expect(document.activeElement).toBe(second);
  });

  it("Enter on a draft card's and a skip group's toggle expands it, and again collapses it", async () => {
    await renderChat(mixed());
    for (const name of [DRAFT_TITLE, "2 unchanged PRs skipped"]) {
      const toggle = await screen.findByRole("button", { name });
      act(() => toggle.focus());
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      await press(toggle, "Enter");
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")?.hidden).toBe(false);
      await press(toggle, "Enter");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")?.hidden).toBe(true);
    }
  });

  it("a held Enter is swallowed once: the repeat keydown is prevented and toggles nothing", async () => {
    await renderChat(mixed());
    const toggle = await screen.findByRole("button", { name: DRAFT_TITLE });
    act(() => toggle.focus());
    let first = true;
    await act(async () => {
      first = fireEvent.keyDown(toggle, { key: "Enter" });
    });
    expect(first).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    let repeated = true;
    await act(async () => {
      repeated = fireEvent.keyDown(toggle, { key: "Enter", repeat: true });
    });
    expect(repeated).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // A modified Enter is not the toggle's: it is left alone.
    let modified = false;
    await act(async () => {
      modified = fireEvent.keyDown(toggle, { key: "Enter", repeat: true, shiftKey: true });
    });
    expect(modified).toBe(true);
  });

  /** A playbook card with its Edit model editor open, then a draft card after it. */
  async function openEditor() {
    const k = kit({ threads: { wright: thread([eventItem(1, "playbook_created", "Playbook pb-3 created", { playbook_id: 3 }), draftEvent(2, 9)]) }, playbooks: [playbook(3)], drafts: [draft(9)] });
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Playbook pb-3" });
    await screen.findByText(DRAFT_TITLE);
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Edit model" }));
    });
    return within(card).getByRole("textbox", { name: "New model" }) as HTMLInputElement;
  }

  it("J and K typed in a field stay text", async () => {
    const input = await openEditor();
    expect(document.activeElement).toBe(input);
    await press(input, "j");
    await press(input, "k");
    expect(document.activeElement).toBe(input);
  });

  it("a key a nested handler already took is left alone", async () => {
    await renderChat(mixed());
    const first = await screen.findByRole("button", { name: STOPS[0] as string });
    await screen.findByText(DRAFT_TITLE);
    act(() => first.focus());
    first.addEventListener("keydown", (event) => event.preventDefault());
    await press(first, "j");
    expect(document.activeElement).toBe(first);
  });

  it("adds no tab stop: every card toggle is a plain button", async () => {
    await renderChat(mixed());
    await screen.findByText(DRAFT_TITLE);
    for (const toggle of document.querySelectorAll("[data-thread-card]")) expect(toggle.hasAttribute("tabindex")).toBe(false);
    expect(document.querySelectorAll("[data-thread-card]")).toHaveLength(2);
  });
});
