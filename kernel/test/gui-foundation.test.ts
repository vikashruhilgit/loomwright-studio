// Phase 7 foundation (item 01): the `gui` feature's seams. Six empty parts in a
// fixed order, merged by the console's part merge under the name `gui`, and
// registered tenth and last. Each phase 7 screen item (03-08) fills in one part
// and edits this file's pins for it (the empty-part pin, below).
import { describe, expect, it } from "vitest";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { GUI_NAME, GUI_PARTS, guiContribution, guiContributionOf } from "../src/gui/index.js";
import type { GuiPart } from "../src/gui/index.js";

const PART_NAMES = ["tasks", "playbook-history", "schedules", "memory", "budget-audit", "settings"];

describe("the gui feature (phase 7 foundation)", () => {
  it("is tenth and last in the registry, after integrations, and merges with no conflict", () => {
    expect(SHIPPED_CONTRIBUTIONS).toHaveLength(10);
    expect(SHIPPED_CONTRIBUTIONS.map((c) => c.name).slice(8, 10)).toEqual(["integrations", GUI_NAME]);
    expect(SHIPPED_CONTRIBUTIONS[9]).toBe(guiContribution);
    expect(SHIPPED_CONTRIBUTIONS.at(-1)).toBe(guiContribution);
    expect(() => mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED)).not.toThrow();
    expect(mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).contributors.at(-1)).toBe("gui");
  });

  it("names its six parts in a fixed order: tasks, playbook-history, schedules, memory, budget-audit, settings", () => {
    expect(GUI_NAME).toBe("gui");
    expect(GUI_PARTS.map((p) => p.name)).toEqual(PART_NAMES);
    expect(Object.isFrozen(GUI_PARTS)).toBe(true);
    for (const part of GUI_PARTS) expect(Object.isFrozen(part)).toBe(true);
  });

  it("holds every part empty: no tools, routes, subcommands, handlers or due work (until each screen item fills its part)", () => {
    for (const part of GUI_PARTS) {
      expect(part.tools, part.name).toEqual([]);
      expect(part.routes, part.name).toEqual([]);
      expect(part.subcommands ?? [], part.name).toEqual([]);
      expect(part.handlers, part.name).toEqual({});
      expect(part.dueWork ?? [], part.name).toEqual([]);
    }
    // The merged contribution carries only its name while every part is empty.
    expect(Object.keys(guiContribution)).toEqual(["name"]);
    expect(guiContribution.name).toBe("gui");
    expect(Object.isFrozen(guiContribution)).toBe(true);
  });

  it("serves no gui route unauthenticated: every gui route is an owner route that needs the API token", () => {
    const routes = GUI_PARTS.flatMap((p) => p.routes);
    expect(routes.filter((r) => r.unauthenticated === true).map((r) => `${r.method} ${r.path}`)).toEqual([]);
    expect(guiContribution.routes ?? []).toEqual(routes);
  });

  it("builds a contribution from the parts it is given, named gui, with the console's handler-conflict check", () => {
    const part = (name: string): GuiPart => Object.freeze({ name, tools: Object.freeze([]), routes: Object.freeze([]), handlers: Object.freeze({ message: () => undefined }) });
    expect(guiContributionOf([]).name).toBe("gui");
    expect(() => guiContributionOf([part("a"), part("b")])).toThrow(/a.*b|b.*a/);
  });
});
