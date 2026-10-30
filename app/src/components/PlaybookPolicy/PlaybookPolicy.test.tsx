// @vitest-environment jsdom
// The shared playbook policy editor: the rows (an unset value reads "not set",
// never a default), the `mode` row (draft offered, live present but disabled),
// and the inline editor (Set sends the typed text, Enter submits, Escape and
// Cancel leave only when nothing is pending, and a held editor keeps its text).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaybookListing } from "../../api/contract";
import { MODEL_NOT_SET, POLICY_FIELDS, PolicyEditor, READ_ONLY_POLICY_FIELDS, modePolicyRow, policyRows, provenance } from "./PlaybookPolicy";
import type { PolicyEditorProps, PolicyRow } from "./PlaybookPolicy";

afterEach(cleanup);

const T0 = "2026-10-22T08:00:00.000Z";

function playbook(overrides: Partial<PlaybookListing> = {}): PlaybookListing {
  return {
    id: 1,
    slug: "pb-1",
    name: "Playbook 1",
    owning_agent: "wright",
    intent: "Review PRs where I am requested",
    status: "enabled",
    version: 1,
    dedupe_key_spec: '["number","head_sha"]',
    dedupe_key_set_by: "wright",
    priority: "normal",
    priority_set_by: "wright",
    model: "haiku",
    model_set_by: "owner",
    effort: null,
    effort_set_by: null,
    token_limit_per_day: 100000,
    token_limit_set_by: "wright",
    api_key_fallback_json: null,
    api_key_fallback_set_by: null,
    mode: "draft",
    mode_set_by: null,
    created_at: T0,
    updated_at: T0,
    trigger_id: null,
    next_fire_at: null,
    ...overrides,
  };
}

function row(field: string): PolicyRow {
  const found = policyRows(playbook()).find((r) => r.field === field);
  if (found === undefined) throw new Error(`no ${field} row`);
  return found;
}

function renderEditor(over: Partial<PolicyEditorProps> & { readonly row: PolicyRow }) {
  const props: PolicyEditorProps = { busy: false, held: false, onConfirm: vi.fn(), onCancel: vi.fn(), ...over };
  const view = render(<PolicyEditor {...props} />);
  return { ...view, props };
}

describe("provenance", () => {
  it("names who set a value, and nothing for an unset one", () => {
    expect(provenance("wright")).toBe("proposed");
    expect(provenance("owner")).toBe("set by owner");
    expect(provenance(null)).toBe("");
    expect(provenance("somebody-else")).toBe("");
  });
});

describe("policyRows", () => {
  it("are the four owner-settable fields in POLICY_FIELDS order, with the card's labels and names", () => {
    const rows = policyRows(playbook());
    expect(rows.map((r) => r.field)).toEqual([...POLICY_FIELDS]);
    expect(rows.map((r) => r.label)).toEqual(["Dedupe key", "Priority", "Model", "Token limit per day"]);
    expect(rows.map((r) => r.name)).toEqual(["dedupe key", "priority", "model", "token limit per day"]);
    expect(READ_ONLY_POLICY_FIELDS).toEqual(["mode"]);
  });

  it("show each value with who set it, and offer the dedupe key comma-separated", () => {
    const rows = policyRows(playbook());
    expect(rows.map((r) => [r.shown, r.setBy])).toEqual([
      ['["number","head_sha"]', "wright"],
      ["normal", "wright"],
      ["haiku", "owner"],
      ["100000", "wright"],
    ]);
    expect(rows[0]?.draft).toBe("number, head_sha");
  });

  it("read an unset value as not set, never a filled-in default, and start its editor empty", () => {
    const rows = policyRows(playbook({ dedupe_key_spec: null, dedupe_key_set_by: null, model: null, model_set_by: null, token_limit_per_day: null, token_limit_set_by: null }));
    expect(rows.map((r) => r.shown)).toEqual(["not set", "normal", MODEL_NOT_SET, "not set"]);
    expect(rows.map((r) => r.draft)).toEqual(["", "normal", "", ""]);
    expect(rows.map((r) => r.setBy)).toEqual([null, "wright", null, null]);
    expect(rows.map((r) => r.unset)).toEqual([true, false, true, true]);
  });

  it("mark a value the owner cleared as unset, whatever its not-set words read, so no provenance shows beside it", () => {
    const rows = policyRows(playbook({ model: null, model_set_by: "owner", token_limit_per_day: null, token_limit_set_by: "owner" }));
    const model = rows.find((r) => r.field === "model");
    expect(model?.shown).toBe(MODEL_NOT_SET);
    expect(model?.unset).toBe(true);
    expect(rows.find((r) => r.field === "token_limit")?.unset).toBe(true);
    expect(modePolicyRow(playbook({ mode_set_by: null })).unset).toBe(true);
    expect(modePolicyRow(playbook({ mode_set_by: "owner" })).unset).toBe(false);
  });

  it("offer a dedupe spec that is not a JSON list of names as the kernel sent it", () => {
    for (const spec of ["pr:{number}", '{"a":1}', "[1,2]", "null"]) {
      expect(policyRows(playbook({ dedupe_key_spec: spec }))[0]?.draft).toBe(spec);
    }
  });

  it("make priority the only select among them", () => {
    expect(policyRows(playbook()).map((r) => r.options?.map((o) => o.value) ?? null)).toEqual([null, ["low", "normal", "high"], null, null]);
  });
});

describe("modePolicyRow", () => {
  it("is the mode row: its value, who set it, and a draft starting at the current mode", () => {
    const mode = modePolicyRow(playbook({ mode_set_by: "owner" }));
    expect(mode).toMatchObject({ field: "mode", label: "Mode", name: "mode", shown: "draft", setBy: "owner", draft: "draft" });
    expect(modePolicyRow(playbook({ mode_set_by: null })).setBy).toBeNull();
  });

  it("offers draft only: live is present but disabled, and says it is not available yet", () => {
    renderEditor({ row: modePolicyRow(playbook()) });
    const select = screen.getByRole("combobox", { name: "New mode" }) as HTMLSelectElement;
    const options = [...select.options].map((o) => ({ value: o.value, disabled: o.disabled, text: o.textContent }));
    expect(options).toEqual([
      { value: "draft", disabled: false, text: "draft" },
      { value: "live", disabled: true, text: "live (not available yet)" },
    ]);
    expect(select.value).toBe("draft");
  });

  it("sets draft, the one value on offer", () => {
    const { props } = renderEditor({ row: modePolicyRow(playbook()) });
    fireEvent.click(screen.getByRole("button", { name: "Set mode" }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).toHaveBeenCalledWith("draft");
  });
});

describe("PolicyEditor", () => {
  it("is a form named for its row, with a text field, Set and Cancel, and the hint under them", () => {
    renderEditor({ row: row("model") });
    const form = screen.getByRole("form", { name: "Set model" });
    expect((within(form).getByRole("textbox", { name: "New model" }) as HTMLInputElement).value).toBe("haiku");
    expect(within(form).getByRole("button", { name: "Set model" })).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Cancel" })).toBeTruthy();
    const input = within(form).getByRole("textbox", { name: "New model" });
    expect(input.getAttribute("aria-describedby")).toBe(within(form).getByText("none clears it").id);
  });

  it("Set sends the typed text, once", () => {
    const { props } = renderEditor({ row: row("model") });
    fireEvent.change(screen.getByRole("textbox", { name: "New model" }), { target: { value: "sonnet" } });
    fireEvent.click(screen.getByRole("button", { name: "Set model" }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).toHaveBeenCalledWith("sonnet");
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("Enter in the field submits through the same path", () => {
    const { props } = renderEditor({ row: row("token_limit") });
    const input = screen.getByRole("textbox", { name: "New token limit per day" });
    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.submit(input);
    expect(props.onConfirm).toHaveBeenCalledWith("5000");
  });

  it("priority is a select of low, normal and high, starting at the current priority", () => {
    const { props } = renderEditor({ row: row("priority") });
    const select = screen.getByRole("combobox", { name: "New priority" }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["low", "normal", "high"]);
    expect(select.value).toBe("normal");
    fireEvent.change(select, { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "Set priority" }));
    expect(props.onConfirm).toHaveBeenCalledWith("high");
  });

  it("Cancel and Escape leave when nothing is pending, and send nothing", () => {
    const { props } = renderEditor({ row: row("model") });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "New model" }), { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledTimes(2);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it("Escape does not reach a parent's own Escape handler", () => {
    const parent = vi.fn();
    render(
      <div onKeyDown={parent}>
        <PolicyEditor row={row("model")} busy={false} held={false} onConfirm={vi.fn()} onCancel={vi.fn()} />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "New model" }), { key: "Escape" });
    expect(parent).not.toHaveBeenCalled();
  });

  it("while held it keeps its text: typing, Escape and Cancel change nothing, and Set is the busy one", () => {
    const { props } = renderEditor({ row: row("model"), held: true, busy: true });
    const input = screen.getByRole("textbox", { name: "New model" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "typed-while-held" } });
    expect(input.value).toBe("haiku");
    expect(input.readOnly).toBe(true);
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Set model" }).getAttribute("aria-busy")).toBe("true");
  });

  it("while another write is held, its Set is disabled and a select keeps its choice", () => {
    const { rerender, props } = renderEditor({ row: row("priority"), held: true, busy: false });
    expect((screen.getByRole("button", { name: "Set priority" }) as HTMLButtonElement).disabled).toBe(true);
    const select = screen.getByRole("combobox", { name: "New priority" }) as HTMLSelectElement;
    expect(select.getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(select, { target: { value: "low" } });
    expect(select.value).toBe("normal");
    // Released, the same editor takes the change again.
    rerender(<PolicyEditor {...props} held={false} />);
    fireEvent.change(screen.getByRole("combobox", { name: "New priority" }), { target: { value: "low" } });
    expect((screen.getByRole("combobox", { name: "New priority" }) as HTMLSelectElement).value).toBe("low");
  });

  it("shows hostile kernel text as a value only, never as markup", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const view = renderEditor({ row: { ...row("model"), draft: hostile, hint: hostile } });
    expect(view.container.querySelector("img")).toBeNull();
    expect((screen.getByRole("textbox", { name: "New model" }) as HTMLInputElement).value).toBe(hostile);
    expect(screen.getByText(hostile)).toBeTruthy();
  });
});
