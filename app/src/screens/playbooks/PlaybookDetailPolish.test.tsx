// @vitest-environment jsdom
// Phase 7 item 24 on the Playbooks detail: the short model name (full id in its title), the
// Schedules & triggers link, the provenance chip in the row's right column, the icons on the
// four buttons, and the shell's shared crumb (accessible name, focus round trip, `data-pb-back`).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventFrame, PlaybookListing, StudioBridge } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { takeComposerHandoff } from "../chat/handoff";
import { playbook } from "../chat/testkit";
import { PLAYBOOKS_TEST_IDS as IDS, SCHEDULES_HASH } from "./model";
import { PlaybooksScreen } from "./PlaybooksScreen";

interface Kernel {
  playbooks: PlaybookListing[];
}

function standard(): Kernel {
  return {
    playbooks: [
      playbook(1, { slug: "review-prs", name: "Review PRs", status: "enabled", model: "claude-sonnet-5-5", model_set_by: "owner" }),
      playbook(2, { slug: "weekly-changelog", name: "Weekly changelog", status: "draft", model: "gpt-x", model_set_by: "wright" }),
      playbook(3, { slug: "morning-digest", name: "Morning digest", status: "disabled", model: null, model_set_by: "owner" }),
    ],
  };
}

function wire(fake: FakeBridge, kernel: Kernel): void {
  fake.route("GET /status", () => ok({ kernel: { version: "0", uptime_s: 1, pid: 1 } }));
  fake.route("GET /playbooks", () => ok({ playbooks: [...kernel.playbooks] }));
  fake.route("GET /triggers", () => ok({ triggers: [] }));
  fake.route("GET /approvals", () => ok({ approvals: [] }));
  fake.route("GET /agents", () => ok({ agents: [] }));
  fake.route("GET /playbooks/:id/runs", () => ok({ runs: [], next_before: null }));
  fake.route("GET /playbooks/:id/versions", () => ok({ versions: [] }));
  fake.route("GET /budget/usage", () => ok({ rows: [], limits: [], cap_state: [] }));
}

async function mountLoaded(kernel: Kernel = standard()) {
  const fake = fakeBridge();
  wire(fake, kernel);
  (window as unknown as { api?: StudioBridge }).api = fake.bridge;
  render(<PlaybooksScreen api={fake.bridge} registry={createCommandRegistry()} />);
  const root = screen.getByTestId(IDS.screen);
  await waitFor(() => expect(root.dataset.state).not.toBe("loading"));
  await waitFor(() => expect(root.textContent).not.toContain("reading…"));
  return { fake, kernel, root };
}

/** Opens the named playbook's detail from the table. */
async function openDetail(name: string): Promise<HTMLElement> {
  const row = screen.getAllByTestId(IDS.row).find((r) => within(r).queryByText(name) !== null);
  if (row === undefined) throw new Error(`no row for ${name}`);
  fireEvent.click(within(row).getByTestId(IDS.open));
  return screen.findByTestId(IDS.detail);
}

function fieldRow(label: string): HTMLElement {
  const row = screen.getAllByTestId(IDS.field).find((f) => f.dataset.field === label);
  if (row === undefined) throw new Error(`no ${label} row`);
  return row;
}

let eventId = 0;
function feedEvent(kind: string): EventFrame {
  eventId += 1;
  return { type: "event", id: eventId, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload: {} };
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

describe("AC1: the Model row", () => {
  it("reads the short name with the full id in its title, through the same shortModel the table uses", async () => {
    await mountLoaded();
    await openDetail("Review PRs");
    const row = fieldRow("Model");
    expect(within(row).getByText("sonnet").getAttribute("title")).toBe("claude-sonnet-5-5");
    expect(row.textContent).not.toContain("claude-sonnet-5-5");
  });

  it("an id with no known family shows as stored, never blank", async () => {
    await mountLoaded();
    await openDetail("Weekly changelog");
    const row = fieldRow("Model");
    expect(within(row).getByText("gpt-x").getAttribute("title")).toBe("gpt-x");
  });

  it("no model reads 'not set' with no chip and no title, even when a set-by is recorded", async () => {
    await mountLoaded();
    await openDetail("Morning digest");
    const row = fieldRow("Model");
    expect(row.textContent).toContain("not set");
    expect(row.querySelector(".pb-setby")).toBeNull();
    expect(row.querySelector("[title]")).toBeNull();
  });
});

describe("AC2: Schedules & triggers", () => {
  it("is a ghost button with the clock icon in the Trigger heading's row, and it shows the Schedules & triggers screen", async () => {
    await mountLoaded();
    await openDetail("Review PRs");
    const link = screen.getByTestId(IDS.schedulesLink);
    expect(link.textContent).toBe("Schedules & triggers");
    expect(link.closest(".pb-sech")?.querySelector("#pb-h-trigger")).not.toBeNull();
    expect(link.querySelectorAll(".btn-icon svg")).toHaveLength(1);
    expect(SCHEDULES_HASH).toBe("#/schedules");
    fireEvent.click(link);
    expect(window.location.hash).toBe("#/schedules");
  });
});

describe("AC3: the provenance chip", () => {
  it("sits in the row's last cell, after the value and its caption", async () => {
    await mountLoaded();
    await openDetail("Review PRs");
    const row = fieldRow("Model");
    const chip = row.querySelector(".pb-setby");
    expect(chip).not.toBeNull();
    expect(row.lastElementChild?.contains(chip)).toBe(true);
    expect(row.lastElementChild?.classList.contains("pb-chipcell")).toBe(true);
    expect(row.querySelectorAll("dd")[0]?.contains(chip)).toBe(false);
    expect(fieldRow("Effort").textContent).toContain("recorded only");
    expect(fieldRow("Effort").querySelector(".pb-chipcell .pb-cap")).toBeNull();
  });

  it("the Policy list carries the detail-only modifier, so the edit view's rows keep their layout", async () => {
    await mountLoaded();
    await openDetail("Review PRs");
    expect(fieldRow("Model").closest("dl")?.classList.contains("pb-rows-policy")).toBe(true);
    fireEvent.click(screen.getByTestId(IDS.editFields));
    await screen.findByTestId(IDS.edit);
    expect(document.querySelector(".pb-rows-policy")).toBeNull();
  });
});

describe("AC4: the icons", () => {
  it("the toolbar's Ask Wright shows chat; Edit in English chat, Edit fields pencil, Version history history", async () => {
    await mountLoaded();
    expect(screen.getByTestId(IDS.askWright).querySelectorAll(".btn-icon svg")).toHaveLength(1);
    await openDetail("Review PRs");
    for (const id of [IDS.editEnglish, IDS.editFields, IDS.history]) {
      const button = screen.getByTestId(id);
      expect(button.querySelectorAll(".btn-icon svg"), id).toHaveLength(1);
      expect(button.querySelector("svg")?.getAttribute("class"), id).toContain("pb-glyph");
    }
  });
});

describe("AC5: the shared crumb", () => {
  it("reads '‹ Playbooks / <name>' with one button named 'Back to Playbooks', marked data-pb-back", async () => {
    await mountLoaded();
    await openDetail("Review PRs");
    const detail = screen.getByTestId(IDS.detail);
    const crumb = detail.querySelector(".pb-crumb");
    expect(crumb?.textContent).toBe("Playbooks/Review PRs");
    expect(within(crumb as HTMLElement).getAllByRole("button")).toHaveLength(1);
    const back = screen.getByRole("button", { name: "Back to Playbooks" });
    expect(back.hasAttribute("data-pb-back")).toBe(true);
    expect(detail.querySelectorAll("[data-pb-back]")).toHaveLength(1);
  });

  it("opening a playbook focuses the back button, and Back returns focus to that playbook's row", async () => {
    await mountLoaded();
    await openDetail("Weekly changelog");
    const back = screen.getByRole("button", { name: "Back to Playbooks" });
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    await screen.findByTestId(IDS.list);
    expect(document.activeElement).toBe(document.querySelector('[data-pb-open="2"]'));
  });

  it("the edit and history views read '‹ Playbook / <name>' with the same single marked button", async () => {
    await mountLoaded();
    await openDetail("Review PRs");
    fireEvent.click(screen.getByTestId(IDS.editFields));
    const edit = await screen.findByTestId(IDS.edit);
    expect(edit.querySelector(".pb-crumb")?.textContent).toBe("Playbook/Review PRs");
    expect(edit.querySelectorAll("[data-pb-back]")).toHaveLength(1);
    expect(within(edit).getByRole("button", { name: "Back to Playbook" })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole("button", { name: "Back to Playbook" }));
    await screen.findByTestId(IDS.detail);
    fireEvent.click(screen.getByTestId(IDS.history));
    const history = await screen.findByTestId(IDS.historyView);
    expect(history.querySelector(".pb-crumb")?.textContent).toBe("Playbook/Review PRs");
    expect(history.querySelectorAll("[data-pb-back]")).toHaveLength(1);
  });

  it("the fallback for a playbook the kernel no longer lists reads '‹ Playbooks / playbook #<id>'", async () => {
    const { fake, kernel } = await mountLoaded();
    await openDetail("Review PRs");
    kernel.playbooks = kernel.playbooks.filter((p) => p.id !== 1);
    await act(async () => fake.emit(feedEvent("playbook_updated")));
    await waitFor(() => expect(screen.queryByTestId(IDS.detail)).toBeNull());
    const crumb = document.querySelector(".pb-crumb");
    expect(crumb?.textContent).toBe("Playbooks/playbook #1");
    expect(screen.getByRole("button", { name: "Back to Playbooks" }).hasAttribute("data-pb-back")).toBe(true);
  });
});
