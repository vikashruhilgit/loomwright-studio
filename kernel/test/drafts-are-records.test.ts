// Drafts are records (phase 8 item 17, Part 4, AC13): when the owner asks for
// something that ends in an approval, the agent drafts it straight into the
// held approval and refines it with an update, never leaving the proposal only
// in chat text. The sentence lives in three surfaces the model reads: Wright's
// first-run role template (`ROLE_TEMPLATE`, mirrored verbatim in
// `docs/architecture/brain.md`, which `brain.test.ts` pins) and the
// `kernel_agent_create` and `kernel_playbook_create` tool descriptions. This
// file pins it in all three. Text checks only: no kernel, no session.

import { describe, expect, it } from "vitest";
import { AGENT_CREATE_TOOL_NAME, AGENT_UPDATE_TOOL_NAME, charterToolsPart } from "../src/agents/charter-tools.js";
import { ROLE_TEMPLATE } from "../src/brain/templates.js";
import { PLAYBOOK_TOOL_NAMES, playbookTools } from "../src/playbooks/drafts.js";

const PHRASE = "draft it straight into the held approval";

/** A tool's description by name, whitespace collapsed so the pins do not depend on string concatenation. */
function description(tools: readonly { readonly name: string; readonly description: string }[], name: string): string {
  const tool = tools.find((t) => t.name === name);
  expect(tool, name).toBeDefined();
  return (tool?.description ?? "").replace(/\s+/g, " ");
}

describe("drafts are records (AC13)", () => {
  it("Wright's role template says to draft into the held approval, refine with an update, and never leave a proposal only in chat text", () => {
    // Whitespace collapsed, so the pin does not depend on the line wrap.
    const flat = ROLE_TEMPLATE.replace(/\s+/g, " ");
    expect(flat).toContain("When the owner asks for something that ends in an approval");
    expect(flat).toContain(PHRASE);
    expect(flat).toContain("refine it with an update");
    expect(flat).toContain("Never leave a proposal only in chat text.");
    // It names the tools it means, and they are the shipped names.
    expect(flat).toContain(`(${AGENT_CREATE_TOOL_NAME}, ${PLAYBOOK_TOOL_NAMES[0]})`);
    expect(flat).toContain(`(${AGENT_UPDATE_TOOL_NAME}, ${PLAYBOOK_TOOL_NAMES[1]})`);
    // It sits under "Who decides", before "Where the owner acts".
    const at = flat.indexOf(PHRASE);
    expect(at).toBeGreaterThan(flat.indexOf("## Who decides"));
    expect(at).toBeLessThan(flat.indexOf("## Where the owner acts"));
  });

  it("kernel_agent_create's description carries the sentence", () => {
    const d = description(charterToolsPart.tools, AGENT_CREATE_TOOL_NAME);
    expect(d).toContain(PHRASE);
    expect(d).toContain("refine it with an update");
    expect(d).toContain(AGENT_UPDATE_TOOL_NAME);
    expect(d).toContain("never leave a proposal only in chat text");
  });

  it("kernel_playbook_create's description carries the sentence", () => {
    expect(PLAYBOOK_TOOL_NAMES[0]).toBe("kernel_playbook_create");
    const d = description(playbookTools, "kernel_playbook_create");
    expect(d).toContain(PHRASE);
    expect(d).toContain("refine it with an update");
    expect(d).toContain("kernel_playbook_update");
    expect(d).toContain("never leave a proposal only in chat text");
  });

  it("the update tools do not carry it: the sentence is about drafting, which only the create tools do", () => {
    expect(description(charterToolsPart.tools, AGENT_UPDATE_TOOL_NAME)).not.toContain(PHRASE);
    expect(description(playbookTools, "kernel_playbook_update")).not.toContain(PHRASE);
  });
});
