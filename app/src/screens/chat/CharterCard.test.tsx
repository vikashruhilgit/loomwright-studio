// @vitest-environment jsdom
// Chat's charter card (phase 8 item 18d): the compact plain view first, the
// complete details on request with copy, Ask or change posting a Reply into the
// drafting thread, older versions collapsed as "Replaced by v<n>", the
// workspace question, and the Create / Deny writes (moved from cards.test.tsx).
// Every kernel string is fake data; the clipboard and folder picker are stubs.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, Approval, SavedWorkspace, ThreadFigures } from "../../api/contract";
import { ok } from "../../store/fake-bridge";
import { COPY_ALL, COPY_FAILED, SHOW_DETAILS, copiedLine, totalLine } from "../approvals/CharterDisplay";
import { printable } from "../approvals/printable";
import { ASK_LABEL, CLONE_NOT_BUILT, NOT_LOADED, READ_FAILED, WORKSPACE_SENT, WorkspaceQuestion, askText, cloneText, folderText } from "./CharterAsk";
import { CHOOSE_WORKSPACE, REPLACED_BY, VERSIONS_FAILED, olderVersions } from "./CharterCard";
import { rememberSummarized } from "./continuity";
import { T0, approval, eventFrame, kit, message, renderChat, resetChat, thread } from "./testkit";
import type { Kit } from "./testkit";

const K = "mcp__kernel__";
const CREATE = `${K}kernel_agent_create`;
const UPDATE = `${K}kernel_agent_update`;
const SESSION = 31;
const XSS_IMG = '<img src=x onerror="window.__pwned=1">';

/** A `role.md` long enough that the whole display is past the old 4,000-character cut. */
const ROLE_LINES = ["# Mason", "", "You are Mason (id `mason`), a crew member in Loomwright Studio.", "", ...Array.from({ length: 60 }, (_, i) => `- Duty note ${i + 1}: hand acme/widgets tickets to /automate and report what changed, in plain words.`), "The last line of role.md, which the old cut hid."];

function settingsLines(workspaces: readonly string[]): string[] {
  return ["{", '  "model": "claude-sonnet-5",', '  "never": [', '    "git_push"', "  ],", `  "workspaces": ${JSON.stringify(workspaces)}`, "}"];
}

/** A create display in the kernel's format (`createDisplay`), with a flagged workspace line when `workspaces` is empty. */
function createDisplay(opts: { readonly jobs?: readonly string[]; readonly workspaces?: readonly string[]; readonly head?: string; readonly never?: string } = {}): string {
  const workspaces = opts.workspaces ?? [];
  const jobs = opts.jobs ?? ["Hand tickets to /automate"];
  return [
    opts.head ?? 'Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
    "readiness: checked by the kernel before you see it",
    "  covered: duty 1 by Hand tickets to /automate: Turn acme/widgets tickets into PRs",
    workspaces.length === 0 ? "  flagged: the code jobs: it has no copy of a repo to work in (no workspace is listed)" : `  ready: the code jobs: works in acme/widgets at ${workspaces[0]}`,
    ...jobs.flatMap((j) => [`job: ${j}`, `  - Used for ${j.toLowerCase()}.`]),
    `enforced: never: ${opts.never ?? "git_push, gh_pr_create"}; tools: Read, Bash, ${K}kernel_automate_prepare; bash prefixes: "gh pr"; connectors: github`,
    "limits: tokens_per_day 200000 (proposed); sessions_at_once 1 (proposed); delegation_depth not set (no limit)",
    `workspaces: ${workspaces.length === 0 ? "none" : workspaces.join(", ")}`,
    "config/agents/mason.json:",
    ...settingsLines(workspaces),
    "memory/mason/role.md:",
    ...ROLE_LINES,
  ].join("\n");
}

const V1 = createDisplay();
const V2 = createDisplay({ jobs: ["Hand tickets to /automate", "Triage PR comments"], workspaces: ["/Users/me/code/widgets"] });

function charter(id: number, display: string, overrides: Partial<Approval> = {}): Approval {
  return approval(id, { action: "kernel_agent_create", payload: { tool: CREATE, input: { charter: { id: "mason" } } }, requesting_session: SESSION, display, ...overrides });
}

const FIGURES: ThreadFigures = { id: 4, agent: "wright", title: "Mason's charter", renamed: false, messages: 1, latest_reply_tokens: null, summary_estimated_tokens: null };

/** Wright's thread: the drafting message (session 31, thread 4) and the held charter. */
function charterKit(pending: Approval[] = [charter(9, V1)], opts: { readonly drafted?: boolean } = {}): Kit {
  const items = opts.drafted === false ? [message(2)] : [{ ...message(4, { session_id: SESSION, text: "Draft me a crew member for acme/widgets.", reply_text: "Here's Mason's charter." }), thread_id: 4 }];
  const k = kit({ threads: { wright: thread(items, { pending_approvals: pending, threads: [FIGURES] }) }, approvals: [...pending] });
  k.fake.route("GET /workspaces", () => ok({ workspaces: [] }));
  k.fake.route("POST /workspaces", () => ok({ workspace: savedRow(1, "/Users/me/code/widgets"), note: null }));
  return k;
}

function savedRow(id: number, path: string, state: SavedWorkspace["state"] = "ready"): SavedWorkspace {
  return { id, path, repo: "acme/widgets", added_at: T0, last_used_at: T0, state };
}

async function card(id = 9): Promise<HTMLElement> {
  return screen.findByRole("region", { name: `Drafted crew member, approval ${id}` });
}

async function press(scope: HTMLElement, name: string | RegExp): Promise<void> {
  await act(async () => {
    fireEvent.click(within(scope).getByRole("button", { name }));
  });
}

let written: string[] = [];

beforeEach(() => {
  written = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        written.push(text);
      },
    },
  });
});

afterEach(() => {
  resetChat();
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

describe("Chat's charter card", () => {
  it("AC1: the compact plain view first (who, Can do with Used for, Never does, Limits, then readiness); no kernel tool name, JSON or file path until Show full details", async () => {
    await renderChat(charterKit());
    const c = await card();
    const text = c.textContent ?? "";
    expect(within(c).getByTestId("charter-head").textContent).toBe('Create crew member mason ("Mason", crab crew-teal), proposed by Wright');
    expect(within(c).getAllByTestId("charter-job").map((j) => j.querySelector(".approvals-charter-job-label")?.textContent)).toEqual(["Hand tickets to /automate"]);
    expect(text).toContain("Used for:");
    expect(within(c).getByTestId("charter-never").textContent).toBe("Push to a git remote; Open pull requests");
    expect(within(c).getByTestId("charter-limits").textContent).toBe("200,000 tokens a day · 1 session at once · no delegation depth limit");
    expect(within(c).getByTestId("charter-others").textContent).toBe("Also uses Read, Bash; runs commands that start with “gh pr”.");
    const order = ["charter-head", "charter-jobs", "charter-never", "charter-limits", "charter-readiness"].map((id) => within(c).getByTestId(id));
    for (let i = 1; i < order.length; i += 1) expect((order[i - 1] as HTMLElement).compareDocumentPosition(order[i] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const hidden of [K, "config/agents/", "role.md", '"model"', "{"]) expect(text).not.toContain(hidden);
    expect(within(c).queryByTestId("charter-block-text")).toBeNull();
    // The card replaces the plain approval card.
    expect(document.querySelector(".eventcard-approval")).toBeNull();
  });

  it("AC14: a pending kernel_agent_update renders as the charter card with item 16's Adds / Keeps marks", async () => {
    const display = [
      'Update crew member mason ("Mason"), settings sha256 3f9a1c07b2e4, proposed by Wright',
      "job: Ask for a merge (added)",
      "  - Whether Loomwright may merge one parked pull request now (read only).",
      "job: Read a PR",
      "  - Read one pull request from GitHub (read-only).",
      `enforced: never: git_push; tools: Read, ${K}kernel_github_pr_get; bash prefixes: none`,
    ].join("\n");
    const update = approval(9, { action: "kernel_agent_update", payload: { tool: UPDATE, input: { id: "mason" } }, requesting_session: SESSION, display });
    await renderChat(charterKit([update]));
    const c = await card();
    expect(within(c).getAllByTestId("charter-job").map((j) => j.querySelector(".badge")?.textContent)).toEqual(["Adds", "Keeps"]);
    expect(within(c).getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(document.querySelector(".eventcard-approval")).toBeNull();
  });

  it("AC2: a display past 4,000 characters is shown whole in its four blocks, each its own scrolling region, under a line saying nothing is cut", async () => {
    expect(V1.length).toBeGreaterThan(4000);
    await renderChat(charterKit());
    const c = await card();
    await press(c, SHOW_DETAILS);
    expect(within(c).getByTestId("charter-total").textContent).toBe(totalLine(V1.length));
    const regions = within(c).getAllByTestId("charter-block-text");
    expect(regions.map((r) => r.getAttribute("role"))).toEqual(["region", "region", "region", "region"]);
    expect(regions.every((r) => r.tabIndex === 0 && (r.getAttribute("aria-label") ?? "") !== "")).toBe(true);
    // Every line after the head and the readiness block, in order: nothing is cut.
    const shown = [
      within(c).getByTestId("charter-block-jobs"),
      within(c).getByTestId("charter-block-enforced"),
      within(c).getByTestId("charter-block-settings"),
      within(c).getByTestId("charter-block-role"),
    ].map((b) => {
      const path = b.querySelector(".approvals-charter-block-path")?.textContent;
      const body = b.querySelector('[data-testid="charter-block-text"]')?.textContent ?? "";
      return path === null || path === undefined ? body : `${path}:\n${body}`;
    });
    expect(shown.join("\n")).toBe(V1.split("\n").slice(4).join("\n"));
    expect(within(c).getByTestId("charter-block-role").textContent).toContain("The last line of role.md, which the old cut hid.");
    await press(c, /^Show more of role\.md/);
    expect(within(c).getByTestId("charter-block-role").classList.contains("open")).toBe(true);
  });

  it("AC3: Copy all text writes approval.display exactly; a block's Copy writes that block in full; each says how many characters it copied", async () => {
    const display = `${V1}\n${XSS_IMG}‮ trailing`;
    await renderChat(charterKit([charter(9, display)]));
    const c = await card();
    await press(c, COPY_ALL);
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toBe(display);
    expect(within(c).getByTestId("charter-copied").textContent).toBe(copiedLine(display.length));
    await press(c, SHOW_DETAILS);
    await press(c, /^Copy role\.md/);
    await waitFor(() => expect(written).toHaveLength(2));
    expect(written[1]).toBe([...ROLE_LINES, `${XSS_IMG}‮ trailing`].join("\n"));
  });

  it("AC9: a refused clipboard write shows an alert, never a silent success", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => Promise.reject(new Error("denied")) } });
    document.execCommand = () => false;
    await renderChat(charterKit());
    const c = await card();
    await press(c, COPY_ALL);
    await waitFor(() => expect(within(c).getByRole("alert").textContent).toBe(COPY_FAILED));
    expect(within(c).queryByTestId("charter-copied")).toBeNull();
  });

  it("AC4: Ask or change posts POST /ask continuing the drafting message, marked as from the card, and names the thread by its title", async () => {
    const k = charterKit();
    await renderChat(k);
    const c = await card();
    expect(within(c).getByTestId("charter-ask-where").textContent).toContain("“Mason's charter”");
    const field = within(c).getByRole("textbox", { name: ASK_LABEL });
    await act(async () => {
      fireEvent.change(field, { target: { value: "add comment replies" } });
    });
    await press(c, "Send");
    await waitFor(() => expect(k.posted("POST /ask")).toHaveLength(1));
    expect(k.posted("POST /ask")[0]?.body).toEqual({ text: askText(9, "add comment replies"), agent: "wright", continues: 4 });
    expect(askText(9, "x")).toBe("From the card's Ask or change (approval 9): x");
    expect(within(c).getByTestId("charter-ask-outcome").textContent).toContain("Sent to Wright in “Mason's charter”");
    // Nothing was decided.
    expect(k.posted("POST /approvals/:id/approve")).toHaveLength(0);
  });

  it("AC4: Wright's v2 for the same member shows the withdrawn v1 collapsed as \"Replaced by v2\" with what changed; opening it shows a read-only card", async () => {
    const v1 = charter(8, V1, { status: "denied", decision: "deny", decided_by: "kernel", decided_at: T0, replaced_by: 9 });
    const v2 = charter(9, V2);
    const k = charterKit([v2]);
    k.state.approvals = [v1, v2];
    await renderChat(k);
    const old = await screen.findByTestId("charter-old");
    expect(old.querySelector("summary")?.textContent).toBe(`mason · v1 · ${REPLACED_BY} v2 · adds Triage PR comments; workspace set`);
    expect((old as HTMLDetailsElement).open).toBe(false);
    const live = await card();
    expect(live.querySelector(".chat-card-meta")?.textContent).toContain("mason · v2 · approval 9");
    // The older version comes first, above the live card.
    expect(old.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => {
      fireEvent.click(old.querySelector("summary") as HTMLElement);
    });
    await waitFor(() => expect(within(old).getByTestId("charter-head")).toBeTruthy());
    expect(within(old).queryByRole("button", { name: "Create" })).toBeNull();
    expect(within(old).queryByRole("button", { name: "Deny" })).toBeNull();
    expect(within(old).queryByRole("textbox", { name: ASK_LABEL })).toBeNull();
    expect(olderVersions([v1, v2], v2).map((a) => a.id)).toEqual([8]);
  });

  it("a failed read of the decided approvals says older versions may be missing, never that there are none", async () => {
    const v1 = charter(8, V1, { status: "denied", decision: "deny", decided_by: "kernel", decided_at: T0, replaced_by: 9 });
    const v2 = charter(9, V2);
    const k = charterKit([v2]);
    k.state.approvals = [v1, v2];
    k.fake.route("GET /approvals", (req) => (req.query?.all === "1" ? { ok: false, status: 500, body: { error: "internal", message: "db locked" } } : ok({ approvals: [v2] })));
    await renderChat(k);
    const c = await card();
    await waitFor(() => expect(within(c).getByTestId("charter-versions-failed").textContent).toBe(VERSIONS_FAILED));
    expect(within(c).getByTestId("charter-versions-failed").getAttribute("role")).toBe("alert");
    expect(screen.queryByTestId("charter-old")).toBeNull();
    // The live card still works: Create is offered.
    expect(within(c).getByRole("button", { name: "Create" })).toBeTruthy();
  });

  it("a later good read of the decided approvals clears the failure and shows the older version", async () => {
    const v1 = charter(8, V1, { status: "denied", decision: "deny", decided_by: "kernel", decided_at: T0, replaced_by: 9 });
    const v2 = charter(9, V2);
    const k = charterKit([v2]);
    let failing = true;
    k.fake.route("GET /approvals", (req) => {
      if (req.query?.all !== "1") return ok({ approvals: [v2] });
      return failing ? { ok: false, status: 500, body: { error: "internal", message: "db locked" } } : ok({ approvals: [v1, v2] });
    });
    await renderChat(k);
    const c = await card();
    await waitFor(() => expect(within(c).getByTestId("charter-versions-failed").textContent).toBe(VERSIONS_FAILED));
    failing = false;
    // A decision changes the approvals list, so the decided ones are read again.
    await act(async () => {
      k.fake.emit(eventFrame(40, "approval_decided", {}));
    });
    await screen.findByTestId("charter-old");
    await waitFor(() => expect(within(c).queryByTestId("charter-versions-failed")).toBeNull());
  });

  it("a slow failed read of the decided approvals that answers after a newer good one is dropped: no failure is shown", async () => {
    const v1 = charter(8, V1, { status: "denied", decision: "deny", decided_by: "kernel", decided_at: T0, replaced_by: 9 });
    const v2 = charter(9, V2);
    const k = charterKit([v2]);
    let release: ((answer: ApiResult<unknown>) => void) | undefined;
    let reads = 0;
    k.fake.route("GET /approvals", (req) => {
      if (req.query?.all !== "1") return ok({ approvals: [v2] });
      reads += 1;
      // The first read hangs until the test answers it; every later one answers at once.
      return reads === 1 ? new Promise<ApiResult<unknown>>((resolve) => (release = resolve)) : ok({ approvals: [v1, v2] });
    });
    try {
      await renderChat(k);
      const c = await card();
      await act(async () => {
        k.fake.emit(eventFrame(41, "approval_decided", {}));
      });
      await screen.findByTestId("charter-old");
      expect(reads).toBeGreaterThanOrEqual(2);
      // The stale read now fails: its answer belongs to a superseded read and is dropped.
      await act(async () => {
        release?.({ ok: false, status: 500, body: { error: "internal", message: "db locked" } });
        release = undefined;
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      });
      expect(within(c).queryByTestId("charter-versions-failed")).toBeNull();
      expect(screen.getByTestId("charter-old")).toBeTruthy();
    } finally {
      // Never leave the hung read pending past this test.
      release?.(ok({ approvals: [] }));
    }
  });

  it("AC7: when the drafting message is not among the loaded items, the box says so, Send is disabled and nothing is posted", async () => {
    const k = charterKit(undefined, { drafted: false });
    await renderChat(k);
    const c = await card();
    expect(within(c).getByTestId("charter-ask-where").textContent).toBe(NOT_LOADED);
    expect((within(c).getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.change(within(c).getByRole("textbox", { name: ASK_LABEL }), { target: { value: "anything" } });
      fireEvent.keyDown(within(c).getByRole("textbox", { name: ASK_LABEL }), { key: "Enter" });
    });
    expect(k.posted("POST /ask")).toHaveLength(0);
  });

  it("AC7: after the drafting thread was summarized and started fresh, the Reply still goes to the thread of the latest version's drafting message, and the box says so", async () => {
    const k = charterKit();
    rememberSummarized(k.fake.bridge, "wright", 4, 50);
    await renderChat(k);
    const c = await card();
    expect(within(c).getByTestId("charter-ask-where").textContent).toContain("summarized into thread #50");
    await act(async () => {
      fireEvent.change(within(c).getByRole("textbox", { name: ASK_LABEL }), { target: { value: "why two jobs?" } });
    });
    await act(async () => {
      fireEvent.keyDown(within(c).getByRole("textbox", { name: ASK_LABEL }), { key: "Enter" });
    });
    await waitFor(() => expect(k.posted("POST /ask")).toHaveLength(1));
    expect(k.posted("POST /ask")[0]?.body).toMatchObject({ continues: 4, agent: "wright" });
  });

  it("charter Create approves once, Deny posts deny, and a refusal shows the kernel's words (moved from cards.test.tsx)", async () => {
    const k = charterKit();
    await renderChat(k);
    const c = await card();
    await press(c, "Create");
    await waitFor(() => expect(k.posted("POST /approvals/:id/approve")).toHaveLength(1));
    expect(k.posted("POST /approvals/:id/approve")[0]).toMatchObject({ params: { id: 9 }, body: { decision: "once" } });
    k.state.posts["POST /approvals/:id/deny"] = () => ({ ok: false, status: 409, body: { error: "already_decided", message: "approval 9 was already decided" } });
    await press(c, "Deny");
    await waitFor(() => expect(within(c).getByRole("alert").textContent).toBe("approval 9 was already decided (already_decided)"));
    expect(k.posted("POST /approvals/:id/deny")).toHaveLength(1);
  });
});

describe("the workspace question", () => {
  async function openQuestion(k: Kit): Promise<HTMLElement> {
    await renderChat(k);
    const c = await card();
    await press(c, CHOOSE_WORKSPACE);
    return within(c).findByTestId("charter-workspace-question");
  }

  it("a failed saved-workspaces lookup says so, never \"no saved folder\"", async () => {
    const k = charterKit();
    k.fake.route("GET /workspaces", () => ({ ok: false, status: 500, body: { error: "internal", message: "db locked" } }));
    const q = await openQuestion(k);
    await waitFor(() => expect(within(q).getByRole("alert").textContent).toBe("The saved workspaces couldn't be read, so none can be offered. Choose a folder instead, or try again later."));
    expect(q.textContent).not.toContain("No saved folder");
    expect(within(q).queryByRole("button", { name: /^Use this folder/ })).toBeNull();
  });

  it("without loaded items, a failed read of the drafting thread says the read failed (not NOT_LOADED) and nothing can be sent", async () => {
    const k = charterKit();
    k.fake.route("GET /threads/:agent", () => ({ ok: false, status: 500, body: { error: "internal", message: "db locked" } }));
    render(<WorkspaceQuestion api={k.fake.bridge} approval={charter(9, V1)} member="mason" repos={["acme/widgets"]} onClose={() => undefined} />);
    const q = await screen.findByTestId("charter-workspace-question");
    await waitFor(() => expect(within(q).getByTestId("charter-wsq-read-failed").textContent).toContain(READ_FAILED));
    expect(within(q).getByTestId("charter-wsq-read-failed").textContent).toContain("db locked");
    expect(q.textContent).not.toContain(NOT_LOADED);
    await press(q, "Clone it for me");
    expect(k.posted("POST /ask")).toHaveLength(0);
  });

  it("is offered only on a flagged workspace line of a live card", async () => {
    await renderChat(charterKit([charter(9, V2)]));
    const c = await card();
    expect(within(c).queryByRole("button", { name: CHOOSE_WORKSPACE })).toBeNull();
  });

  it("AC5: a saved workspace matching the charter's repo is offered; Use this folder posts a Reply naming it into the drafting thread, and says nothing changes until approved", async () => {
    const k = charterKit();
    k.fake.route("GET /workspaces", (req) => ok({ workspaces: req.query?.repo === "acme/widgets" ? [savedRow(3, "/Users/me/code/widgets"), savedRow(4, "/Users/me/old", "missing")] : [] }));
    const q = await openQuestion(k);
    expect(within(q).getByRole("heading").textContent).toBe("Where's your copy of acme/widgets?");
    const use = await within(q).findByRole("button", { name: /^Use this folder/ });
    expect(within(q).getAllByRole("button", { name: /^Use this folder/ })).toHaveLength(1);
    await act(async () => {
      fireEvent.click(use);
    });
    await waitFor(() => expect(k.posted("POST /ask")).toHaveLength(1));
    expect(k.posted("POST /ask")[0]?.body).toEqual({ text: folderText("/Users/me/code/widgets", "mason"), agent: "wright", continues: 4 });
    expect(within(q).getByTestId("charter-wsq-sent").textContent).toBe(WORKSPACE_SENT);
    expect(k.fake.requests.filter((r) => r.req.method === "POST").map((r) => r.req.path)).toEqual(["/ask"]);
  });

  it("AC8: with no saved workspace matching, it offers Choose folder… and Clone it for me only", async () => {
    const k = charterKit();
    k.fake.bridge.chooseFolder = async () => null;
    const q = await openQuestion(k);
    await waitFor(() => expect(within(q).queryByRole("status")).toBeNull());
    expect(within(q).queryByRole("button", { name: /^Use this folder/ })).toBeNull();
    expect(within(within(q).getByTestId("charter-wsq-offers")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Choose folder…", "Clone it for me"]);
  });

  it("AC10: a protected folder chosen shows the kernel's refusal in plain words, and no Reply is posted", async () => {
    const k = charterKit();
    k.fake.bridge.chooseFolder = async () => "/Users/me/Documents/widgets";
    k.fake.route("POST /workspaces", () => ({ ok: false, status: 400, body: { error: "protected_folder", message: "~/Documents is a protected folder, so Studio won't work inside it (D31)" } }));
    const q = await openQuestion(k);
    await press(q, "Choose folder…");
    await waitFor(() => expect(within(q).getByTestId("charter-wsq-refusal").textContent).toBe("Not used: ~/Documents is a protected folder, so Studio won't work inside it (D31). Nothing was sent to Wright; choose another folder."));
    expect(k.posted("POST /workspaces")[0]?.body).toEqual({ path: "/Users/me/Documents/widgets" });
    expect(k.posted("POST /ask")).toHaveLength(0);
  });

  it("AC5: a chosen folder the kernel saves is posted as a Reply naming it", async () => {
    const k = charterKit();
    k.fake.bridge.chooseFolder = async () => "/Users/me/code/widgets";
    const q = await openQuestion(k);
    await press(q, "Choose folder…");
    await waitFor(() => expect(k.posted("POST /ask")).toHaveLength(1));
    expect(k.posted("POST /ask")[0]?.body).toMatchObject({ text: folderText("/Users/me/code/widgets", "mason"), continues: 4 });
  });

  it("AC13: Clone it for me posts the request into the drafting thread and says cloning isn't built yet; nothing else is written", async () => {
    const k = charterKit();
    const q = await openQuestion(k);
    await press(q, "Clone it for me");
    await waitFor(() => expect(k.posted("POST /ask")).toHaveLength(1));
    expect(k.posted("POST /ask")[0]?.body).toEqual({ text: cloneText("acme/widgets", "mason"), agent: "wright", continues: 4 });
    expect(within(q).getByTestId("charter-wsq-sent").textContent).toBe(CLONE_NOT_BUILT);
    expect(k.fake.requests.filter((r) => r.req.method === "POST").map((r) => r.req.path)).toEqual(["/ask"]);
  });

  it("Not now, or Esc, closes it and returns focus to Choose workspace", async () => {
    const k = charterKit();
    const q = await openQuestion(k);
    await act(async () => {
      fireEvent.keyDown(within(q).getByRole("button", { name: "Clone it for me" }), { key: "Escape" });
    });
    const c = await card();
    expect(within(c).queryByTestId("charter-workspace-question")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(c).getByRole("button", { name: CHOOSE_WORKSPACE })));
  });
});

// ---- Phase 8 item 19a: a shortened readiness block ----------------------------------------

/** A long charter's duties (each past the kernel's 72-character excerpt; the repo is named only past it). */
const LONG_DUTIES = [
  "Pick up each ticket the owner assigns, read its description and comments, and hand it to /automate for acme/widgets with a short summary of what done looks like.",
  "Notify the owner when a pull request is opened for a ticket, naming the ticket, the branch and the one-line summary, so the owner can review it from the phone.",
  "Keep each pull request small and focused on one ticket; if a ticket turns out to need more than one change, say so in the thread before writing any code.",
];

/** A create display in the kernel's 19a format: each duty line quotes its excerpt (`dutyExcerpt`), and role.md has every duty's full text. */
const SHORT = [
  'Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
  "readiness: checked by the kernel before you see it",
  "  covered: duty 1 by Hand tickets to /automate: Pick up each ticket the owner assigns, read its description and…",
  "  covered: duty 2 by Notify the owner: Notify the owner when a pull request is opened for a ticket, naming the…",
  "  covered: duty 3 with no tool (it needs no kernel tool): Keep each pull request small and focused on one ticket; if a ticket…",
  "  flagged: copy of a repo for Hand tickets to /automate: it has no copy of a repo to work in (no workspace is listed)",
  "  flagged: GitHub write access for Hand tickets to /automate: only you can grant it (Team, in the member's inspector)",
  "job: Hand tickets to /automate",
  "  - Hand tickets to Loomwright's /automate.",
  "job: Notify the owner",
  "  - Send the owner a notification: a native macOS notification plus an entry in studio notifications.",
  `enforced: never: git_push, gh_pr_create; tools: Read, Bash, ${K}kernel_automate_prepare, ${K}kernel_notify; bash prefixes: "gh pr"; connectors: github`,
  "limits: tokens_per_day 2000000 (proposed); sessions_at_once 1 (proposed); delegation_depth 1 (proposed)",
  "workspaces: none",
  "config/agents/mason.json:",
  ...settingsLines([]),
  "memory/mason/role.md:",
  "# Mason",
  "",
  "## Duties",
  "",
  ...LONG_DUTIES.map((d) => `- ${d}`),
].join("\n");

describe("19a: a shortened readiness block on the charter card", () => {
  it("AC7: every readiness line shows with its Covered / Flagged badge and its duty number, and the workspace line still offers Choose workspace for the repo role.md names", async () => {
    const k = charterKit([charter(9, SHORT)]);
    k.fake.route("GET /workspaces", (req) => ok({ workspaces: req.query?.repo === "acme/widgets" ? [savedRow(3, "/Users/me/code/widgets")] : [] }));
    await renderChat(k);
    const c = await card();
    const lines = within(c).getAllByTestId("charter-readiness-line");
    expect(lines.map((l) => [l.querySelector(".badge")?.textContent, l.querySelector(".approvals-charter-readiness-text")?.textContent])).toEqual([
      ["Covered", "duty 1 by Hand tickets to /automate: Pick up each ticket the owner assigns, read its description and…"],
      ["Covered", "duty 2 by Notify the owner: Notify the owner when a pull request is opened for a ticket, naming the…"],
      ["Covered", "duty 3 with no tool (it needs no kernel tool): Keep each pull request small and focused on one ticket; if a ticket…"],
      ["Flagged", "copy of a repo for Hand tickets to /automate: it has no copy of a repo to work in (no workspace is listed)"],
      ["Flagged", "GitHub write access for Hand tickets to /automate: only you can grant it (Team, in the member's inspector)"],
    ]);
    // Choose workspace is on the flagged workspace line only.
    expect(lines.map((l) => within(l).queryByRole("button", { name: CHOOSE_WORKSPACE }) !== null)).toEqual([false, false, false, true, false]);
    // The excerpts name no repo; the question asks for the one role.md names in full.
    await press(c, CHOOSE_WORKSPACE);
    const q = await within(c).findByTestId("charter-workspace-question");
    expect(within(q).getByRole("heading").textContent).toBe("Where's your copy of acme/widgets?");
    expect(await within(q).findByRole("button", { name: /^Use this folder/ })).toBeTruthy();
  });

  it("AC6: Show full details counts the stored display's own length (nothing cut), and role.md carries every duty's full text", async () => {
    await renderChat(charterKit([charter(9, SHORT)]));
    const c = await card();
    await press(c, SHOW_DETAILS);
    expect(within(c).getByTestId("charter-total").textContent).toBe(`${SHORT.length.toLocaleString("en-US")} characters, nothing cut`);
    const role = within(c).getByTestId("charter-block-role").querySelector('[data-testid="charter-block-text"]')?.textContent ?? "";
    for (const duty of LONG_DUTIES) expect(role).toContain(`- ${duty}`);
    // The readiness block quotes only the excerpts: no duty's full text is shown above the details.
    const readiness = within(c).getByTestId("charter-readiness").textContent ?? "";
    for (const duty of LONG_DUTIES) expect(readiness).not.toContain(duty);
  });
});

describe("AC11: every part is untrusted text", () => {
  it("head, jobs, never, limits, readiness, each details block and the what-changed line render as text, never markup", async () => {
    const hostile = createDisplay({ head: `Create crew member mason ("${XSS_IMG}", crab crew-teal), proposed by Wright`, jobs: [`<b>Bold</b> job`], never: `git_push, <script>x</script>` });
    const v1 = charter(8, `${V1}\n<b>v1</b>`, { status: "denied", decision: "deny", decided_by: "kernel", replaced_by: 9 });
    const k = charterKit([charter(9, hostile)]);
    k.state.approvals = [v1, charter(9, hostile)];
    const view = await renderChat(k);
    const c = await card();
    await press(c, SHOW_DETAILS);
    const old = await screen.findByTestId("charter-old");
    await act(async () => {
      fireEvent.click(old.querySelector("summary") as HTMLElement);
    });
    expect(view.container.querySelector("img, script, b")).toBeNull();
    expect(within(c).getByTestId("charter-head").textContent).toContain(XSS_IMG);
    expect(within(c).getByTestId("charter-never").textContent).toBe("Push to a git remote; <script>x</script>");
    expect(within(c).getByTestId("charter-block-jobs").textContent).toContain("job: <b>Bold</b> job");
    expect(old.querySelector("summary")?.textContent).toContain(printable("adds <b>Bold</b> job"));
  });
});
