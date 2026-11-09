/// <reference types="node" />
// @vitest-environment jsdom
// The ticket -> PR card (phase 8 item 14): the ticket read from its ref's prefix, the honest tones (green only for
// what the kernel recorded), the column and the "Waiting on you" link (only with a matching PENDING merge approval),
// the card's accessible name, and the card as drawn (one button, the footer beside it, untrusted text inert).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { Approval, PrCiState, PrOwnerKind, PrTrackState, TaskBoardItem, TaskTicketPr } from "../../api/contract";
import { buildBoard, cardKey, cardLabel } from "./model";
import type { BoardCard } from "./model";
import {
  TicketPrCard,
  approvalsView,
  ciView,
  ownerWord,
  pendingMergeApproval,
  stateToneOf,
  ticketColumnOf,
  ticketFacts,
  ticketLabel,
  ticketRef,
  ticketText,
  waitingApprovalOf,
} from "./TicketPrCard";

const ESC = String.fromCharCode(0x1b);
const REPO = "vikashruhilgit/studio-sandbox";
const STATES: readonly PrTrackState[] = ["open", "draft", "ready", "parked", "merged", "closed"];

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

function pr(overrides: Partial<TaskTicketPr> = {}): TaskTicketPr {
  return {
    ticket: `github:${REPO}#14`,
    repo: REPO,
    number: 21,
    url: `https://github.com/${REPO}/pull/21`,
    state: "parked",
    head_sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    approvals: "studio_approval",
    ci: "green",
    owner_kind: "automate_parked",
    merged_by_gate: false,
    updated: "2026-11-09T09:00:00.000Z",
    ...overrides,
  };
}

function ticketCard(overrides: Partial<TaskTicketPr> = {}, row: Partial<TaskBoardItem> = {}): TaskBoardItem {
  const ticket = pr(overrides);
  return {
    kind: "task",
    id: 61,
    title: "Add retry reset to the queue loop",
    state: ticket.state,
    agent: "ada",
    playbook: null,
    item_ref: null,
    session: null,
    tokens: null,
    started: "2026-11-09T08:00:00.000Z",
    ended: null,
    updated: "2026-11-09T09:00:00.000Z",
    creator_agent: null,
    creator_session: null,
    ticket_pr: ticket,
    ...row,
  };
}

/** A merge approval as the rail files it (`{tool, input, cwd}`), so `mergeApprovalOf` reads it. */
function mergeApproval(id: number, fields: Record<string, unknown> = {}, overrides: Partial<Approval> = {}): Approval {
  return {
    id,
    requesting_agent: "ada",
    requesting_session: 54,
    action: "kernel_merge_approval_request",
    payload: { tool: "mcp__kernel__kernel_merge_approval_request", input: { repo: REPO, pr: 21, head_sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", ...fields }, cwd: "/work" },
    requested_at: "2026-11-09T09:00:00.000Z",
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
    ...overrides,
  };
}

describe("the ticket, read from the ref's prefix", () => {
  it("reads each source the kernel's poll sources write", () => {
    expect(ticketRef(`github:${REPO}#14`)).toMatchObject({ source: { label: "GitHub Issue", short: "Issue", mark: "github" }, id: "#14" });
    expect(ticketRef("clickup:CU-8a41")).toMatchObject({ source: { label: "ClickUp", short: "ClickUp" }, id: "CU-8a41" });
    expect(ticketRef("jira:acme.atlassian.net/PROJ-12")).toMatchObject({ source: { label: "Jira", short: "Jira" }, id: "PROJ-12" });
  });

  it("says the source and the id: Issue #14 on a card, GitHub Issue #14 in full", () => {
    const github = ticketRef(`github:${REPO}#14`);
    const clickup = ticketRef("clickup:CU-8a41");
    const jira = ticketRef("jira:acme.atlassian.net/PROJ-12");
    expect(github && ticketText(github)).toBe("Issue #14");
    expect(github && ticketText(github, true)).toBe("GitHub Issue #14");
    expect(clickup && ticketText(clickup)).toBe("ClickUp CU-8a41");
    expect(clickup && ticketText(clickup, true)).toBe("ClickUp CU-8a41");
    expect(jira && ticketText(jira, true)).toBe("Jira PROJ-12");
  });

  it("shows any other ref escaped and raw, with no source", () => {
    for (const ref of ["linear:ENG-4", "gitlab:group/project#9", "plain text", "github:no-number", "clickup:two words", "jira:no-slash"]) {
      expect(ticketRef(ref), ref).toEqual({ source: null, id: ref });
    }
    const hostile = ticketRef(`github:x/y#${ESC}1`);
    expect(hostile).toEqual({ source: null, id: "github:x/y#\\x1b1" });
    const shown = ticketRef(`weird${ESC}[31m:ref`);
    expect(shown && ticketText(shown)).toBe("weird\\x1b[31m:ref");
  });

  it("shows no ticket line when the PR has no ticket", () => {
    expect(ticketRef(null)).toBeUndefined();
  });

  it("reads the source from the prefix only: a github-looking id after another prefix is not a GitHub issue", () => {
    expect(ticketRef(`clickup:${REPO}#14`)).toEqual({ source: null, id: `clickup:${REPO}#14` });
  });
});

describe("the state badge: green only for merged", () => {
  it("is ok for merged and for no other state", () => {
    for (const state of STATES) expect(stateToneOf(state) === "ok", state).toBe(state === "merged");
    expect(stateToneOf("whatever")).toBe("neutral");
    expect(stateToneOf("constructor")).toBe("neutral");
    expect(stateToneOf("__proto__")).toBe("neutral");
  });

  it("reads open, draft and closed as neutral and parked as parked", () => {
    expect(stateToneOf("open")).toBe("neutral");
    expect(stateToneOf("draft")).toBe("neutral");
    expect(stateToneOf("closed")).toBe("neutral");
    expect(stateToneOf("parked")).toBe("parked");
  });
});

describe("CI: green only when the kernel recorded green", () => {
  it("reads green as ok, failing as danger, and pending, none and null as neutral with the hollow dot", () => {
    expect(ciView("green")).toEqual({ text: "CI green", tone: "ok", dot: "ok" });
    expect(ciView("failing")).toEqual({ text: "CI failing", tone: "danger", dot: "danger" });
    expect(ciView("pending")).toEqual({ text: "CI pending", tone: "neutral", dot: "idle" });
    expect(ciView("none")).toMatchObject({ tone: "neutral", dot: "idle" });
    expect(ciView(null)).toMatchObject({ tone: "neutral", dot: "idle" });
  });

  it("never reads an out-of-set word as green", () => {
    for (const word of ["Green", "GREEN", "passing", "success", "constructor", "__proto__", ""]) expect(ciView(word).tone, word).toBe("neutral");
  });
});

describe("the approvals word", () => {
  it("reads solo as Solo (neutral) and no_policy as No policy in the parked tone", () => {
    expect(approvalsView("solo", false)).toEqual({ text: "Solo", tone: "neutral" });
    expect(approvalsView("no_policy", false)).toEqual({ text: "No policy", tone: "parked" });
  });

  it("reads studio_approval as Approve in Studio: attention only while an approval waits on the owner", () => {
    expect(approvalsView("studio_approval", true)).toEqual({ text: "Approve in Studio", tone: "attention" });
    expect(approvalsView("studio_approval", false)).toEqual({ text: "Approve in Studio", tone: "neutral" });
  });

  it("reads n/N as 'n/N approvals', ok only when n reached N", () => {
    expect(approvalsView("1/2", false)).toEqual({ text: "1/2 approvals", tone: "neutral" });
    expect(approvalsView("0/2", false).tone).toBe("neutral");
    expect(approvalsView("2/2", false)).toEqual({ text: "2/2 approvals", tone: "ok" });
    expect(approvalsView("3/2", false).tone).toBe("ok");
    expect(approvalsView("1/1", false).tone).toBe("ok");
  });

  it("shows any other word escaped and neutral, and never reads 0/0 or a malformed fraction as met", () => {
    expect(approvalsView("0/0", false)).toEqual({ text: "0/0", tone: "neutral" });
    for (const word of ["2", "n/N", "1/2/3", "-1/2", "1 / 2", "constructor", "__proto__", ""]) expect(approvalsView(word, false).tone, word).toBe("neutral");
    expect(approvalsView(`ok${ESC}`, false)).toEqual({ text: "ok\\x1b", tone: "neutral" });
  });
});

describe("the owner kind's words", () => {
  it("reads each kind as the mockup's OWN short words", () => {
    expect(ownerWord("automate_live")).toBe("live /automate run");
    expect(ownerWord("automate_parked")).toBe("parked /automate item");
    expect(ownerWord("owner")).toBe("you or the App");
    expect(ownerWord("other")).toBe("someone else");
  });

  it("has no word for null or a kind it does not list", () => {
    expect(ownerWord(null)).toBeUndefined();
    expect(ownerWord("constructor")).toBeUndefined();
    expect(ownerWord("somebody")).toBeUndefined();
  });
});

describe("waiting on you: only with a matching pending merge approval", () => {
  const ticket = pr();

  it("matches a pending approval for the PR, comparing the repo case-insensitively", () => {
    expect(pendingMergeApproval(ticket, [mergeApproval(7)])).toBe(7);
    expect(pendingMergeApproval(ticket, [mergeApproval(7, { repo: "VikashRuhilGit/Studio-Sandbox" })])).toBe(7);
    expect(pendingMergeApproval({ repo: "VIKASHRUHILGIT/STUDIO-SANDBOX", number: 21 }, [mergeApproval(7)])).toBe(7);
  });

  it("never matches a decided approval", () => {
    for (const status of ["approved", "denied"] as const) expect(pendingMergeApproval(ticket, [mergeApproval(7, {}, { status })]), status).toBeUndefined();
  });

  it("never matches another PR, another repo, another action or a payload the kernel would not read", () => {
    expect(pendingMergeApproval(ticket, [mergeApproval(7, { pr: 22 })])).toBeUndefined();
    expect(pendingMergeApproval(ticket, [mergeApproval(7, { repo: "vikashruhilgit/ntfs-tool" })])).toBeUndefined();
    expect(pendingMergeApproval(ticket, [mergeApproval(7, {}, { action: "Bash" })])).toBeUndefined();
    expect(pendingMergeApproval(ticket, [mergeApproval(7, { head_sha: "not a sha" })])).toBeUndefined();
    // A payload whose fields are at the top level is not the rail's `{tool, input}`: `mergeApprovalOf` does not read it.
    expect(pendingMergeApproval(ticket, [mergeApproval(7, {}, { payload: { repo: REPO, pr: 21, head_sha: "a1b2c3d" } })])).toBeUndefined();
  });

  it("is the newest request when more than one pending approval names the PR, and none when nothing loaded", () => {
    expect(pendingMergeApproval(ticket, [mergeApproval(7), mergeApproval(9), mergeApproval(8)])).toBe(9);
    expect(pendingMergeApproval(ticket, [])).toBeUndefined();
    expect(pendingMergeApproval(ticket, undefined)).toBeUndefined();
  });

  it("makes only a PARKED PR wait: any other state with the same approval does not", () => {
    for (const state of STATES) expect(waitingApprovalOf(pr({ state }), [mergeApproval(7)]) !== undefined, state).toBe(state === "parked");
    // The state word alone never says it: no approval, no waiting.
    expect(waitingApprovalOf(pr({ state: "parked" }), [])).toBeUndefined();
  });
});

describe("the column", () => {
  const none: readonly Approval[] = [];
  const approvals = [mergeApproval(7)];

  it("places open, draft and ready in Working, parked in Parked, merged and closed in Done today", () => {
    const column = (state: PrTrackState): string | undefined => ticketColumnOf(ticketCard({ state }), none);
    expect(["open", "draft", "ready"].map((s) => column(s as PrTrackState))).toEqual(["work", "work", "work"]);
    expect(column("parked")).toBe("park");
    expect(["merged", "closed"].map((s) => column(s as PrTrackState))).toEqual(["done", "done"]);
  });

  it("places a parked PR in Waiting on you only when a matching pending approval names it", () => {
    expect(ticketColumnOf(ticketCard({ state: "parked" }), approvals)).toBe("wait");
    expect(ticketColumnOf(ticketCard({ state: "parked" }), undefined)).toBe("park");
    expect(ticketColumnOf(ticketCard({ state: "parked", number: 22 }), approvals)).toBe("park");
    expect(ticketColumnOf(ticketCard({ state: "open" }), approvals)).toBe("work");
  });

  it("puts a state it has not heard of in Other, never guessed", () => {
    expect(ticketColumnOf(ticketCard({ state: "awaiting_merge" as PrTrackState }), none)).toBe("other");
    expect(ticketColumnOf(ticketCard({ state: "constructor" as PrTrackState }), none)).toBe("other");
  });

  it("leaves a plain card to the board's own mapping", () => {
    expect(ticketColumnOf(ticketCard({}, { ticket_pr: null }), approvals)).toBeUndefined();
  });

  it("is what buildBoard uses for a ticket card, while every plain card keeps its column", () => {
    const plain = (id: number, state: string): TaskBoardItem => ticketCard({}, { id, state, ticket_pr: null, title: `Plain ${id}` });
    const items = [ticketCard({ state: "parked" }, { id: 61 }), ticketCard({ state: "merged" }, { id: 62 }), plain(7, "parked"), plain(8, "done"), plain(9, "parked-ish")];
    const board = buildBoard([{ state: "x", items }], Date.parse("2026-11-09T12:00:00.000Z"), (item) => ticketColumnOf(item, approvals));
    const place = new Map(board.columns.flatMap((c) => c.cards.map((card) => [card.key, c.column.id] as const)));
    expect(place.get("task:61")).toBe("wait");
    expect(place.get("task:62")).toBe("done");
    expect(place.get("task:7")).toBe("park");
    expect(place.get("task:8")).toBe("done");
    expect(place.get("task:9")).toBe("other");
    expect(board.waiting).toBe(1);
    // Without the override the plain tables put a ticket's `parked` task state in Parked, as before.
    const plainBoard = buildBoard([{ state: "x", items }], Date.parse("2026-11-09T12:00:00.000Z"));
    expect(plainBoard.columns.find((c) => c.column.id === "wait")?.cards).toEqual([]);
  });
});

describe("the accessible name", () => {
  it("starts with the board's `Task <id>: <title>, <state>` and appends the ticket, PR, approvals, CI, owner and waiting words", () => {
    const item = ticketCard();
    const label = ticketLabel(item, pr(), 7, false);
    expect(label.startsWith(cardLabel(item))).toBe(true);
    expect(label).toMatch(/^(Task|Playbook run|Session) \d+: .+, .+$/);
    expect(label).toBe("Task 61: Add retry reset to the queue loop, parked. GitHub Issue #14. PR 21 parked. Approve in Studio. CI green. parked /automate item. Waiting on you.");
  });

  it("says nothing about waiting with no approval, and marks a last-known card", () => {
    const label = ticketLabel(ticketCard({ ticket: null, approvals: "1/2", ci: "pending", state: "open", owner_kind: null }), pr({ ticket: null, approvals: "1/2", ci: "pending", state: "open", owner_kind: null }), undefined, true);
    expect(label).toBe("Task 61: Add retry reset to the queue loop, open. PR 21 open. 1/2 approvals. CI pending. Last known.");
    expect(label).not.toContain("Waiting on you");
  });

  it("names a merge the gate did as text", () => {
    expect(ticketLabel(ticketCard(), pr({ state: "merged", merged_by_gate: true }), undefined, false)).toContain("merged by Loomwright's gate");
  });
});

describe("the open card's facts", () => {
  it("lists the ticket, PR, state, head commit, approvals, CI and owner in the mockup's order, with honest tones", () => {
    const facts = ticketFacts(pr(), 7);
    expect(facts.map((f) => f.label)).toEqual(["Ticket", "Pull request", "State", "Head commit", "Approvals", "CI", "Owner"]);
    const by = (label: string) => facts.find((f) => f.label === label);
    expect(by("Ticket")?.text).toBe("GitHub Issue #14");
    expect(by("Pull request")?.text).toBe(`#21 · ${REPO}`);
    expect(by("State")).toEqual({ label: "State", text: "parked", tone: "parked" });
    expect(by("Head commit")?.text).toBe("a1b2c3d");
    expect(by("Approvals")).toEqual({ label: "Approvals", text: "Approve in Studio", tone: "attention" });
    expect(by("CI")).toEqual({ label: "CI", text: "CI green", tone: "ok" });
    expect(by("Owner")?.text).toBe("parked /automate item");
  });

  it("leaves out what the kernel has no value for, and shows a gate merge as text", () => {
    const facts = ticketFacts(pr({ ticket: null, head_sha: null, owner_kind: null, state: "merged", merged_by_gate: true }), undefined);
    expect(facts.map((f) => f.label)).toEqual(["Pull request", "State", "Approvals", "CI", "Merged"]);
    expect(facts.find((f) => f.label === "Merged")?.text).toBe("by Loomwright's gate");
  });
});

// ---- as drawn -----------------------------------------------------------------------------------------

interface Handlers {
  readonly onOpen: Mock<(card: BoardCard) => void>;
  readonly onFocused: Mock<(key: string) => void>;
}

function draw(item: TaskBoardItem, options: { readonly approvalId?: number; readonly offline?: boolean; readonly column?: BoardCard["column"] } = {}): Handlers & { readonly card: BoardCard } {
  const column = options.column ?? "park";
  const card: BoardCard = { key: cardKey(item), item, column };
  const handlers: Handlers = { onOpen: vi.fn<(card: BoardCard) => void>(), onFocused: vi.fn<(key: string) => void>() };
  render(
    <ul>
      <TicketPrCard
        card={card}
        ticket={item.ticket_pr as TaskTicketPr}
        agent={{ id: "ada", name: "ada" }}
        avatarState="parked"
        approvalId={options.approvalId}
        offline={options.offline ?? false}
        tabbable
        buttonRef={null}
        onOpen={handlers.onOpen}
        onFocused={handlers.onFocused}
      />
    </ul>,
  );
  return { ...handlers, card };
}

describe("the card as drawn", () => {
  it("draws the ticket, PR, title, state, approvals, CI, owner and time as the mockup's prCard does, with no tally", () => {
    draw(ticketCard(), { approvalId: 7 });
    const button = screen.getByTestId("task-card-task:61");
    expect(button.getAttribute("data-card-key")).toBe("task:61");
    expect(button.getAttribute("data-column")).toBe("park");
    expect(button.textContent).toContain("Issue #14");
    expect(button.textContent).toContain("PR #21");
    expect(button.textContent).toContain("Add retry reset to the queue loop");
    expect(screen.getByTestId("task-card-state").textContent).toBe("parked");
    expect(screen.getByTestId("ticket-approvals").textContent).toBe("Approve in Studio");
    expect(screen.getByTestId("ticket-ci").textContent).toBe("CI green");
    expect(screen.getByTestId("ticket-owner").textContent).toBe("ada · parked /automate item");
    // No number the kernel did not serve: no comment tally.
    expect(button.textContent).not.toMatch(/\b\d+ (fix|reply|answer)\b|comment/i);
  });

  it("has exactly one button inside the card button's list item for the card, and the footer link beside it, never inside", () => {
    draw(ticketCard(), { approvalId: 7 });
    const button = screen.getByTestId("task-card-task:61");
    expect(button.querySelector("button")).toBeNull();
    const link = screen.getByRole("button", { name: "Open approval #7" });
    expect(button.contains(link)).toBe(false);
    expect(link.closest("li")).toBe(button.closest("li"));
    expect(screen.getByTestId("ticket-waiting").textContent).toContain("Waiting on you");
  });

  it("shows no waiting row and no link without an approval, even for a parked PR", () => {
    draw(ticketCard({ state: "parked", approvals: "studio_approval" }));
    expect(screen.queryByTestId("ticket-waiting")).toBeNull();
    expect(screen.queryByRole("button", { name: /Open approval/ })).toBeNull();
    expect(screen.getByTestId("ticket-approvals").querySelector(".badge")?.getAttribute("data-tone")).toBe("neutral");
    expect(screen.getByTestId("task-card-task:61").getAttribute("aria-label")).not.toContain("Waiting on you");
  });

  it("navigates to #/approvals/<id> from the link, and sends nothing", () => {
    draw(ticketCard(), { approvalId: 7 });
    fireEvent.click(screen.getByRole("button", { name: "Open approval #7" }));
    expect(window.location.hash).toBe("#/approvals/7");
  });

  it("opens the card from the card button and reports its focus", () => {
    const { onOpen, onFocused, card } = draw(ticketCard());
    const button = screen.getByTestId("task-card-task:61");
    fireEvent.focus(button);
    fireEvent.click(button);
    expect(onFocused).toHaveBeenCalledWith("task:61");
    expect(onOpen).toHaveBeenCalledWith(card);
  });

  it("is last known and off while the kernel is away: the card does not open and the link does not navigate", () => {
    const { onOpen } = draw(ticketCard(), { approvalId: 7, offline: true });
    const button = screen.getByTestId("task-card-task:61");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("ticket-last-known").textContent).toBe("Last known");
    expect(button.getAttribute("aria-label")).toContain("Last known.");
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
    const link = screen.getByRole("button", { name: "Open approval #7" });
    expect(link.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(link);
    expect(window.location.hash).toBe("");
    // The words stay: approvals, CI and owner are the last known ones.
    expect(screen.getByTestId("ticket-approvals").textContent).toBe("Approve in Studio");
    expect(screen.getByTestId("ticket-ci").textContent).toBe("CI green");
    expect(screen.getByTestId("ticket-owner").textContent).toContain("parked /automate item");
  });

  it("draws nothing green for CI pending with 0/2 approvals on an open PR; failing is danger; null is never green", () => {
    draw(ticketCard({ state: "open", approvals: "0/2", ci: "pending", owner_kind: "automate_live" }), { column: "work" });
    const badges = [...screen.getByTestId("task-card-task:61").querySelectorAll(".badge")].map((b) => [b.textContent, b.getAttribute("data-tone")]);
    expect(badges).toEqual([["open", "neutral"], ["0/2 approvals", "neutral"], ["CI pending", "neutral"]]);
    cleanup();
    draw(ticketCard({ state: "open", approvals: "1/2", ci: "failing" }), { column: "work" });
    expect(screen.getByTestId("ticket-ci").querySelector(".badge")?.getAttribute("data-tone")).toBe("danger");
    cleanup();
    draw(ticketCard({ state: "open", ci: null }), { column: "work" });
    expect(screen.getByTestId("ticket-ci").querySelector(".badge")?.getAttribute("data-tone")).toBe("neutral");
    cleanup();
    draw(ticketCard({ state: "merged", approvals: "2/2", ci: "green" }), { column: "done" });
    expect([...screen.getByTestId("task-card-task:61").querySelectorAll(".badge")].map((b) => b.getAttribute("data-tone"))).toEqual(["ok", "ok", "ok"]);
  });

  it("shows a parked No policy PR the note and a link to Integrations, and nothing that writes", () => {
    draw(ticketCard({ state: "parked", approvals: "no_policy" }));
    expect(screen.getByTestId("ticket-approvals").querySelector(".badge")?.getAttribute("data-tone")).toBe("parked");
    const note = screen.getByTestId("ticket-policy-note");
    expect(note.textContent).toContain("Set this repo's merge policy to move it on.");
    fireEvent.click(within(note).getByRole("button", { name: "Open repo policy" }));
    expect(window.location.hash).toBe("#/integrations");
  });

  it("shows a gate merge as text, never an action", () => {
    draw(ticketCard({ state: "merged", merged_by_gate: true, approvals: "solo" }), { column: "done" });
    expect(screen.getByTestId("ticket-meta").textContent).toContain("by Loomwright's gate");
    expect(screen.queryAllByRole("button")).toHaveLength(1);
  });

  it("shows no ticket line when the PR has no ticket, and a raw ref escaped", () => {
    draw(ticketCard({ ticket: null }));
    expect(screen.getByTestId("task-card-task:61").textContent).not.toMatch(/Issue|ClickUp|Jira/);
    cleanup();
    draw(ticketCard({ ticket: `linear:ENG${ESC}-4` }));
    expect(screen.getByTestId("task-card-task:61").textContent).toContain("linear:ENG\\x1b-4");
    expect(screen.getByTestId("task-card-task:61").querySelector(".ticket-src svg")).toBeNull();
  });

  it("renders every untrusted string as inert text: no element comes from a title, a ref, a repo or an approvals word", () => {
    const attack = '<img src=x onerror="alert(1)"><b>x</b>';
    draw(ticketCard({ ticket: attack, repo: attack, approvals: attack, ci: attack as PrCiState, owner_kind: attack as PrOwnerKind, state: attack as PrTrackState }, { title: attack }));
    const button = screen.getByTestId("task-card-task:61");
    expect(button.querySelector("img")).toBeNull();
    expect(button.querySelector("b")).toBeNull();
    expect(button.textContent).toContain(attack);
  });

  it("draws the GitHub mark for a GitHub issue and the shared ticket icon for another source", () => {
    draw(ticketCard());
    expect(screen.getByTestId("task-card-task:61").querySelector(".ticket-src svg")?.getAttribute("viewBox")).toBe("0 0 16 16");
    cleanup();
    draw(ticketCard({ ticket: "clickup:CU-8a41" }));
    expect(screen.getByTestId("task-card-task:61").querySelector(".ticket-src svg")?.getAttribute("viewBox")).toBe("0 0 24 24");
  });
});

describe("ticket-pr.css", () => {
  it("holds no hex, rgb( or hsl( colour: tokens only", () => {
    // The file name goes through a variable: Vite rewrites `new URL("<literal>", import.meta.url)` into an asset URL.
    const file = "./ticket-pr.css";
    const css = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    expect(css.length).toBeGreaterThan(500);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });
});
