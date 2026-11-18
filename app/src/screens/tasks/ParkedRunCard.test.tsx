// @vitest-environment jsdom
// The Parked run card (phase 8 item 23j): its fields, Resume enabled only when nothing blocks it (and the plain words
// when something does), off while the kernel is away, the POST's exact path and body, the 409 / 404 / connection
// errors in the card, and run-file text rendered inert.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, PausedRunBlock, PausedRunView } from "../../api/contract";
import { fakeBridge, ok } from "../../store/fake-bridge";
import { ParkedRunCard, blockText, readPausedRuns, resumeErrorText, resumePausedRun } from "./ParkedRunCard";

const ESC = String.fromCharCode(0x1b);
const RLO = "‮";

afterEach(() => {
  cleanup();
});

function run(overrides: Partial<PausedRunView> = {}): PausedRunView {
  return {
    agent: "mason",
    checkout: "/Users/owner/code/sandbox",
    repo: "vikashruhilgit/studio-sandbox",
    run_id: "2026-11-16-tickets",
    title: "Tickets to PRs",
    pause_reason: "trail_pr_open",
    item: null,
    pr: null,
    stranded: false,
    blocked: null,
    resume_at: null,
    ...overrides,
  };
}

const AGENT = { id: "mason", name: "Mason" };

type OnResume = (run: PausedRunView) => Promise<ApiResult<unknown>>;

function draw(view: PausedRunView, onResume = vi.fn<OnResume>(async () => ok({ queue_id: 1 })), offline = false) {
  render(
    <ul>
      <ParkedRunCard run={view} agent={AGENT} offline={offline} onResume={onResume} />
    </ul>,
  );
  return onResume;
}

function resumeButton(): HTMLButtonElement {
  return screen.getByTestId("parked-run-resume") as HTMLButtonElement;
}

describe("the card's fields", () => {
  it("shows the title, the crew member, the repo and the pause reason; no item or PR line without them", () => {
    draw(run());
    const card = screen.getByTestId("parked-run-2026-11-16-tickets");
    expect(card.textContent).toContain("Parked run");
    expect(screen.getByTestId("parked-run-title").textContent).toBe("Tickets to PRs");
    expect(screen.getByTestId("parked-run-reason").textContent).toBe("Paused: trail_pr_open");
    expect(screen.getByTestId("parked-run-where").textContent).toBe("Mason · vikashruhilgit/studio-sandbox");
    expect(screen.queryByTestId("parked-run-item")).toBeNull();
    expect(screen.queryByTestId("parked-run-pr")).toBeNull();
    expect(screen.queryByTestId("parked-run-blocked")).toBeNull();
  });

  it("names the checkout when the repo is null, and shows the item and the PR (as text, never a link) when present", () => {
    draw(run({ repo: null, item: ".supervisor/requirements/14-retry.md", pr: "https://github.com/o/r/pull/21", pause_reason: null }));
    expect(screen.getByTestId("parked-run-where").textContent).toBe("Mason · /Users/owner/code/sandbox");
    expect(screen.getByTestId("parked-run-item").textContent).toBe("Item: .supervisor/requirements/14-retry.md");
    expect(screen.getByTestId("parked-run-pr").textContent).toBe("PR: https://github.com/o/r/pull/21");
    expect(screen.getByTestId("parked-run-reason").textContent).toBe("Paused");
    expect(document.querySelector("a")).toBeNull();
  });

  it("badges a stranded run (23l) and says its session ended mid-item, with its item and Resume on", () => {
    draw(run({ stranded: true, pause_reason: null, item: ".supervisor/requirements/studio/ticket-a.md" }));
    const card = screen.getByTestId("parked-run-2026-11-16-tickets");
    expect(card.textContent).toContain("stranded");
    expect(card.textContent).not.toContain("paused");
    expect(screen.getByTestId("parked-run-reason").textContent).toBe("Stopped mid-item: its session ended while the run was going");
    expect(screen.getByTestId("parked-run-item").textContent).toBe("Item: .supervisor/requirements/studio/ticket-a.md");
    expect((screen.getByTestId("parked-run-resume") as HTMLButtonElement).disabled).toBe(false);
  });

  it("names the run by its id when its title is empty", () => {
    draw(run({ title: "  " }));
    expect(screen.getByTestId("parked-run-title").textContent).toBe("Run 2026-11-16-tickets");
  });

  it("renders untrusted run-file text as inert text: no markup, controls and bidi escaped", () => {
    const html = '<img src=x onerror="alert(1)"><b>bold</b>';
    draw(run({ title: `${html}${ESC}[31m`, pause_reason: `<script>x()</script>${RLO}`, item: "<i>item</i>", pr: '"><a href="javascript:x">pr</a>', repo: null, checkout: "<u>/tmp</u>" }));
    const card = screen.getByTestId("parked-run-2026-11-16-tickets");
    expect(card.querySelector("img, b, script, i, a, u")).toBeNull();
    expect(screen.getByTestId("parked-run-title").textContent).toBe(`${html}\\x1b[31m`);
    expect(screen.getByTestId("parked-run-reason").textContent).toBe("Paused: <script>x()</script>\\u202e");
    expect(screen.getByTestId("parked-run-item").textContent).toBe("Item: <i>item</i>");
    expect(screen.getByTestId("parked-run-pr").textContent).toBe('PR: "><a href="javascript:x">pr</a>');
    expect(screen.getByTestId("parked-run-where").textContent).toBe("Mason · <u>/tmp</u>");
  });
});

describe("Resume", () => {
  it("is enabled when nothing blocks it, and sends the run once", async () => {
    const onResume = draw(run());
    expect(resumeButton().disabled).toBe(false);
    expect(resumeButton().textContent).toBe("Resume");
    await act(async () => {
      fireEvent.click(resumeButton());
    });
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume.mock.calls[0]?.[0]).toMatchObject({ agent: "mason", checkout: "/Users/owner/code/sandbox", run_id: "2026-11-16-tickets" });
    expect(screen.queryByTestId("parked-run-error")).toBeNull();
  });

  const BLOCKS: readonly [PausedRunBlock, string][] = [
    ["run_live", "A run is going in this workspace"],
    ["no_kernel_run", "Studio didn't start this run"],
    ["resume_queued", "Resume queued"],
    ["playbook_not_live", "Its playbook isn't live"],
    ["agent_not_active", "Its crew member is off"],
    ["kill_switch_engaged", "Studio is stopped"],
    ["lock_settling", "Waiting for the stopped run's lock to clear"],
  ];

  it("waiting on a stopped holder's run lock (D46), says when Resume opens, in local time", () => {
    const at = new Date(2026, 10, 17, 21, 17, 3);
    draw(run({ stranded: true, blocked: "lock_settling", resume_at: at.toISOString() }));
    expect(resumeButton().disabled).toBe(true);
    expect(screen.getByTestId("parked-run-blocked").textContent).toBe("Can resume at 21:17");
  });

  it.each(BLOCKS)("is disabled when blocked by %s, and says why in plain words", async (block, words) => {
    const onResume = draw(run({ blocked: block }));
    expect(resumeButton().disabled).toBe(true);
    expect(screen.getByTestId("parked-run-blocked").textContent).toBe(words);
    await act(async () => {
      fireEvent.click(resumeButton());
    });
    expect(onResume).not.toHaveBeenCalled();
  });

  it("is off while the kernel is away: marked disabled, and a click sends nothing", async () => {
    const onResume = draw(run(), undefined, true);
    expect(resumeButton().getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.click(resumeButton());
    });
    expect(onResume).not.toHaveBeenCalled();
  });

  it("shows a 409 in the card in plain words", async () => {
    draw(run(), vi.fn<OnResume>(async () => ({ ok: false, status: 409, body: { error: "run_live" } })));
    await act(async () => {
      fireEvent.click(resumeButton());
    });
    expect(screen.getByTestId("parked-run-error").textContent).toBe("Couldn't resume: A run is going in this workspace.");
  });

  it("shows a 404 and a connection failure in the card", async () => {
    draw(run(), vi.fn<OnResume>(async () => ({ ok: false, status: 404, body: { error: "not_found", message: "no paused run" } })));
    await act(async () => {
      fireEvent.click(resumeButton());
    });
    expect(screen.getByTestId("parked-run-error").textContent).toBe("Couldn't resume: this run is no longer paused here.");
    cleanup();
    draw(run(), vi.fn<OnResume>(async () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "timeout" } })));
    await act(async () => {
      fireEvent.click(resumeButton());
    });
    expect(screen.getByTestId("parked-run-error").textContent).toBe("Couldn't reach the kernel; nothing was resumed.");
  });
});

describe("the words", () => {
  it("escapes a block word it does not know, and a refusal's code and message", () => {
    expect(blockText(`new_word${ESC}`)).toBe("new_word\\x1b");
    expect(blockText("constructor")).toBe("constructor");
    expect(resumeErrorText({ ok: false, status: 400, body: { error: "invalid_body", message: `bad${ESC}` } })).toBe("The kernel refused (400 invalid_body): bad\\x1b.");
  });
});

describe("the calls", () => {
  it("POSTs to the run's resume path with the body exactly {agent, checkout}", async () => {
    const fake = fakeBridge();
    fake.route("POST /automate/paused-runs/:run_id/resume", (req) => ok({ queue_id: 7, run_id: req.params?.run_id, agent: "mason", checkout: "/x" }));
    const result = await resumePausedRun(fake.bridge, run());
    expect(result.ok).toBe(true);
    const sent = fake.requestsTo("POST /automate/paused-runs/:run_id/resume").map((r) => r.req);
    expect(sent).toEqual([
      { method: "POST", path: "/automate/paused-runs/:run_id/resume", params: { run_id: "2026-11-16-tickets" }, body: { agent: "mason", checkout: "/Users/owner/code/sandbox" } },
    ]);
    expect(Object.keys(sent[0]?.body as object)).toEqual(["agent", "checkout"]);
  });

  it("reads the paused runs, and treats a body that is not the response (or a throw) as a failed read", async () => {
    const fake = fakeBridge();
    fake.route("GET /automate/paused-runs", () => ok({ runs: [run()], unreadable: [] }));
    const read = await readPausedRuns(fake.bridge);
    expect(read.ok && read.body.runs.length).toBe(1);
    fake.route("GET /automate/paused-runs", () => ok({ nope: true }));
    expect(await readPausedRuns(fake.bridge)).toEqual({ ok: false, status: 200, body: { error: "invalid_response" } });
    fake.route("GET /automate/paused-runs", () => {
      throw new Error("boom");
    });
    expect((await readPausedRuns(fake.bridge)).status).toBe(0);
  });
});
