// @vitest-environment jsdom
// The Parked run card (phase 8 item 23j): its fields, Resume enabled only when nothing blocks it (and the plain words
// when something does), off while the kernel is away, the POST's exact path and body, the 409 / 404 / connection
// errors in the card, and run-file text rendered inert. 27b: Retire, after one confirm, off while offline or while the
// run is live or a launch of it is queued, its POST's exact body, and a refusal in the card.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, PausedRunBlock, PausedRunView } from "../../api/contract";
import { fakeBridge, ok } from "../../store/fake-bridge";
import { ParkedRunCard, blockText, readPausedRuns, replyToRun, resumeErrorText, resumePausedRun, retireErrorText, retirePausedRun } from "./ParkedRunCard";

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

describe("reply to the run's last message", () => {
  type OnReply = (run: PausedRunView, text: string) => Promise<ApiResult<unknown>>;
  const ASKED = { id: 235, status: "completed", message: "PR #19 was closed.\nRedo it, reopen it, or drop the item?" };

  function drawWithReply(view: PausedRunView, onReply = vi.fn<OnReply>(async () => ok({ queue_id: 9, session: 235 })), offline = false) {
    render(
      <ul>
        <ParkedRunCard run={view} agent={AGENT} offline={offline} onResume={vi.fn<OnResume>(async () => ok({ queue_id: 1 }))} onReply={onReply} />
      </ul>,
    );
    return onReply;
  }

  it("shows the run's last message with its line breaks, as inert text", () => {
    drawWithReply(run({ stranded: true, last_session: { ...ASKED, message: `<b>x</b>${ESC}\nline two` } }));
    const text = screen.getByTestId("parked-run-last-text");
    expect(text.textContent).toBe("<b>x</b>\\x1b\nline two");
    expect(text.querySelector("b")).toBeNull();
    expect(screen.getByTestId("parked-run-last").textContent).toContain("session #235");
  });

  it("sends the trimmed reply once, clears the box, and says the run carries on", async () => {
    const onReply = drawWithReply(run({ stranded: true, last_session: ASKED }));
    const box = screen.getByTestId("parked-run-reply-text") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "  Redo it.  " } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("parked-run-reply-send"));
    });
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply.mock.calls[0]?.[1]).toBe("Redo it.");
    expect(box.value).toBe("");
    expect(screen.getByTestId("parked-run-reply-note").textContent).toContain("carries on");
  });

  it("offers no reply box without a kernel session, while one is live, or when a block other than a settling lock applies", () => {
    for (const view of [run({ last_session: null }), run({ last_session: { ...ASKED, status: "running" } }), run({ last_session: ASKED, blocked: "run_live" }), run({ last_session: ASKED, blocked: "continuation_queued" }), run()]) {
      drawWithReply(view);
      expect(screen.queryByTestId("parked-run-reply")).toBeNull();
      cleanup();
    }
    drawWithReply(run({ last_session: ASKED, blocked: "lock_settling" }));
    expect(screen.getByTestId("parked-run-reply")).toBeTruthy();
  });

  it("shows a refusal in plain words and keeps the draft", async () => {
    const onReply = vi.fn<OnReply>(async () => ({ ok: false, status: 409, body: { error: "no_run_session" } }));
    drawWithReply(run({ last_session: ASKED }), onReply);
    const box = screen.getByTestId("parked-run-reply-text") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Redo it." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("parked-run-reply-send"));
    });
    expect(screen.getByTestId("parked-run-reply-note").textContent).toContain("no session for this run");
    expect(box.value).toBe("Redo it.");
  });

  it("POSTs to the run's reply path with the body exactly {agent, checkout, text}", async () => {
    const fake = fakeBridge();
    fake.route("POST /automate/paused-runs/:run_id/reply", () => ok({ queue_id: 9, session: 235, run_id: "2026-11-16-tickets", agent: "mason", checkout: "/x" }));
    expect((await replyToRun(fake.bridge, run(), "Redo it.")).ok).toBe(true);
    const sent = fake.requestsTo("POST /automate/paused-runs/:run_id/reply").map((r) => r.req);
    expect(sent).toEqual([
      { method: "POST", path: "/automate/paused-runs/:run_id/reply", params: { run_id: "2026-11-16-tickets" }, body: { agent: "mason", checkout: "/Users/owner/code/sandbox", text: "Redo it." } },
    ]);
  });
});

describe("Retire (27b)", () => {
  type OnRetire = (run: PausedRunView) => Promise<ApiResult<unknown>>;

  function drawWithRetire(view: PausedRunView, onRetire = vi.fn<OnRetire>(async () => ok({ run_id: view.run_id, items: [] })), offline = false) {
    render(
      <ul>
        <ParkedRunCard run={view} agent={AGENT} offline={offline} onResume={vi.fn<OnResume>(async () => ok({ queue_id: 1 }))} onRetire={onRetire} />
      </ul>,
    );
    return onRetire;
  }
  const retireButton = (): HTMLButtonElement => screen.getByTestId("parked-run-retire") as HTMLButtonElement;

  it("is not drawn without onRetire", () => {
    draw(run());
    expect(screen.queryByTestId("parked-run-retire")).toBeNull();
  });

  it("asks once, then sends the run; Keep it sends nothing", async () => {
    const onRetire = drawWithRetire(run());
    expect(retireButton().disabled).toBe(false);
    fireEvent.click(retireButton());
    expect(screen.getByTestId("parked-run-retire-confirm").textContent).toContain("never hands its unfinished items to a later run");
    expect(onRetire).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("parked-run-retire-cancel"));
    expect(screen.queryByTestId("parked-run-retire-confirm")).toBeNull();
    expect(onRetire).not.toHaveBeenCalled();
    fireEvent.click(retireButton());
    await act(async () => {
      fireEvent.click(screen.getByTestId("parked-run-retire-confirm-yes"));
    });
    expect(onRetire).toHaveBeenCalledTimes(1);
    expect(onRetire.mock.calls[0]?.[0]).toMatchObject({ agent: "mason", checkout: "/Users/owner/code/sandbox", run_id: "2026-11-16-tickets" });
    expect(screen.queryByTestId("parked-run-retire-error")).toBeNull();
  });

  it.each(["run_live", "resume_queued", "continuation_queued"] as const)("Retire disabled while the run is %s", (block) => {
    const onRetire = drawWithRetire(run({ blocked: block }));
    expect(retireButton().disabled).toBe(true);
    fireEvent.click(retireButton());
    expect(screen.queryByTestId("parked-run-retire-confirm")).toBeNull();
    expect(onRetire).not.toHaveBeenCalled();
  });

  it("Retire disabled while offline", () => {
    const onRetire = drawWithRetire(run(), undefined, true);
    expect(retireButton().disabled).toBe(true);
    fireEvent.click(retireButton());
    expect(onRetire).not.toHaveBeenCalled();
  });

  it.each(["no_kernel_run", "playbook_not_live", "agent_not_active", "kill_switch_engaged", "lock_settling"] as const)("stays on while only Resume is blocked (%s)", (block) => {
    drawWithRetire(run({ blocked: block }));
    expect(retireButton().disabled).toBe(false);
    expect(resumeButton().disabled).toBe(true);
  });

  it("shows a refusal in the card in plain words, and a connection failure", async () => {
    drawWithRetire(run(), vi.fn<OnRetire>(async () => ({ ok: false, status: 409, body: { error: "run_live" } })));
    fireEvent.click(retireButton());
    await act(async () => {
      fireEvent.click(screen.getByTestId("parked-run-retire-confirm-yes"));
    });
    expect(screen.getByTestId("parked-run-retire-error").textContent).toBe("Couldn't retire: A run is going in this workspace.");
    expect(retireButton()).toBeTruthy();
    cleanup();
    drawWithRetire(run(), vi.fn<OnRetire>(async () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "timeout" } })));
    fireEvent.click(retireButton());
    await act(async () => {
      fireEvent.click(screen.getByTestId("parked-run-retire-confirm-yes"));
    });
    expect(screen.getByTestId("parked-run-retire-error").textContent).toBe("Couldn't reach the kernel; nothing was retired.");
  });

  it("words a 404 and an unknown refusal, escaped", () => {
    expect(retireErrorText({ ok: false, status: 404, body: { error: "not_found" } })).toBe("Couldn't retire: this run is no longer listed here.");
    expect(retireErrorText({ ok: false, status: 409, body: { error: `run_file_unreadable${ESC}` } })).toBe("Couldn't retire: run_file_unreadable\\x1b.");
    expect(retireErrorText({ ok: false, status: 400, body: { error: "invalid_body", message: "the body is {agent, checkout}" } })).toBe("The kernel refused (400 invalid_body): the body is {agent, checkout}.");
  });

  it("Retire posts exactly {agent, checkout} to the run's retire path", async () => {
    const fake = fakeBridge();
    fake.route("POST /automate/paused-runs/:run_id/retire", (req) => ok({ run_id: req.params?.run_id, agent: "mason", checkout: "/x", items: [] }));
    expect((await retirePausedRun(fake.bridge, run())).ok).toBe(true);
    const sent = fake.requestsTo("POST /automate/paused-runs/:run_id/retire").map((r) => r.req);
    expect(sent).toEqual([
      { method: "POST", path: "/automate/paused-runs/:run_id/retire", params: { run_id: "2026-11-16-tickets" }, body: { agent: "mason", checkout: "/Users/owner/code/sandbox" } },
    ]);
    expect(Object.keys(sent[0]?.body as object)).toEqual(["agent", "checkout"]);
  });
});
