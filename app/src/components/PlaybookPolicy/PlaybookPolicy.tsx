// The shared playbook policy editor: the rows a playbook's owner-settable policy
// is shown as, and the one inline editor both Chat's playbook card and the
// Playbooks screen set a field through. It takes everything it needs as props
// (the row, `busy`, `held`, `onConfirm`, `onCancel`) and never reaches into a
// caller's state or the kernel: the caller owns the write, and a pending write
// is `held`, which freezes the editor until the kernel answers. Every kernel
// string is a React text child only.
import { useId, useState } from "react";
import type { PlaybookListing } from "../../api/contract";
import { Button } from "../Button/Button";
import { SelectField, TextField } from "../Input/Input";
import "./PlaybookPolicy.css";

/** "proposed" when Wright set a value, "set by owner" when the owner did, nothing otherwise. */
export function provenance(setBy: string | null): string {
  if (setBy === "wright") return "proposed";
  if (setBy === "owner") return "set by owner";
  return "";
}

/**
 * The owner-settable policy fields the Chat card edits, by the kernel's own names. With
 * `READ_ONLY_POLICY_FIELDS` they are exactly the kernel's `PLAYBOOK_POLICY_FIELDS`
 * (kernel/src/playbooks/store.ts), in its order; kernel/test/console-contract.test.ts
 * reads this file as text and pins that.
 */
export const POLICY_FIELDS = ["dedupe_key", "priority", "model", "token_limit"] as const;
/**
 * Kernel policy fields the Chat card shows but does not edit. `mode`: phase 6 accepts only
 * `draft` (the kernel refuses `live` with `live_mode_not_in_phase_6`), so there is
 * nothing to choose yet. The Playbooks screen edits it through `modePolicyRow`.
 */
export const READ_ONLY_POLICY_FIELDS = ["mode"] as const;
export type PolicyField = (typeof POLICY_FIELDS)[number];
/** Every field the kernel's `POST /playbooks/:id/set` takes: what a row can be for. */
export type KernelPolicyField = PolicyField | (typeof READ_ONLY_POLICY_FIELDS)[number];

/** What the Model row reads with no model: the kernel refuses a dry run without one. */
export const MODEL_NOT_SET = "not set: needed before a dry run";

/** One choice of a select row. A disabled one is shown, never selectable. */
export interface PolicyOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

/** One settable row (of `F`, every kernel policy field by default): its label, the value as shown, and what its editor starts with. */
export interface PolicyRow<F extends KernelPolicyField = KernelPolicyField> {
  readonly field: F;
  readonly label: string;
  /** The row's name in its controls' accessible names ("Edit model", "Set model"). */
  readonly name: string;
  readonly shown: string;
  /** No value is set: the row shows its not-set words and no provenance, whatever `shown` reads. */
  readonly unset: boolean;
  readonly setBy: string | null;
  readonly mono: boolean;
  /** The editor's first value. */
  readonly draft: string;
  /** Text rows only: the line under the controls. */
  readonly hint: string | null;
  /** A select row's choices; `null` is a text row. */
  readonly options: readonly PolicyOption[] | null;
}

/** Priority's three values (the kernel's `PLAYBOOK_PRIORITIES`); the row names no default. */
const PRIORITY_OPTIONS: readonly PolicyOption[] = [
  { value: "low", label: "low" },
  { value: "normal", label: "normal" },
  { value: "high", label: "high" },
];

/**
 * The kernel stores a dedupe key as a JSON list of field names; its editor
 * takes them comma-separated (`parseOwnerPolicyValue`). The spec is untrusted
 * and read by type only: anything but a list of strings is offered as-is.
 */
function dedupeDraft(spec: string | null): string {
  if (spec === null) return "";
  try {
    const parsed: unknown = JSON.parse(spec);
    if (Array.isArray(parsed) && parsed.every((f) => typeof f === "string")) return parsed.join(", ");
  } catch {
    // Not JSON: offer the text as the kernel sent it.
  }
  return spec;
}

/** The four rows Chat's card edits, in `POLICY_FIELDS` order. An unset value reads "not set", never a default. */
export function policyRows(playbook: PlaybookListing): readonly PolicyRow<PolicyField>[] {
  return [
    {
      field: "dedupe_key",
      label: "Dedupe key",
      name: "dedupe key",
      shown: playbook.dedupe_key_spec ?? "not set",
      unset: playbook.dedupe_key_spec === null,
      setBy: playbook.dedupe_key_set_by,
      mono: true,
      draft: dedupeDraft(playbook.dedupe_key_spec),
      hint: "comma-separated fields; none clears it",
      options: null,
    },
    {
      field: "priority",
      label: "Priority",
      name: "priority",
      shown: playbook.priority_set_by === null ? "not set" : playbook.priority,
      unset: playbook.priority_set_by === null,
      setBy: playbook.priority_set_by,
      mono: false,
      draft: playbook.priority,
      hint: null,
      options: PRIORITY_OPTIONS,
    },
    {
      field: "model",
      label: "Model",
      name: "model",
      shown: playbook.model ?? MODEL_NOT_SET,
      unset: playbook.model === null,
      setBy: playbook.model_set_by,
      mono: false,
      draft: playbook.model ?? "",
      hint: "none clears it",
      options: null,
    },
    {
      field: "token_limit",
      label: "Token limit per day",
      name: "token limit per day",
      shown: playbook.token_limit_per_day === null ? "not set" : String(playbook.token_limit_per_day),
      unset: playbook.token_limit_per_day === null,
      setBy: playbook.token_limit_set_by,
      mono: false,
      draft: playbook.token_limit_per_day === null ? "" : String(playbook.token_limit_per_day),
      hint: "none clears it",
      options: null,
    },
  ];
}

/**
 * The `mode` row, which only the Playbooks screen edits (Chat's card shows it
 * read-only). It offers `draft`, with `live` present but disabled: phase 6's
 * kernel refuses `live`, so the owner sees it exists and is not available yet.
 */
export function modePolicyRow(playbook: PlaybookListing): PolicyRow<"mode"> {
  return {
    field: "mode",
    label: "Mode",
    name: "mode",
    shown: playbook.mode_set_by === null ? "not set" : playbook.mode,
    unset: playbook.mode_set_by === null,
    setBy: playbook.mode_set_by,
    mono: false,
    draft: playbook.mode,
    hint: null,
    options: [
      { value: "draft", label: "draft" },
      { value: "live", label: "live (not available yet)", disabled: true },
    ],
  };
}

export interface PolicyEditorProps {
  readonly row: PolicyRow;
  /** This editor's Set is pending. */
  readonly busy: boolean;
  /** A write is pending: the editor stays as it is (text, Set, Cancel, Escape) until it answers. */
  readonly held: boolean;
  readonly onConfirm: (value: string) => void;
  readonly onCancel: () => void;
}

/**
 * A row's inline editor: a select row (Priority, Mode) a select, the others a
 * text field, then Set and Cancel on one line, and the hint on its own line
 * under them, so a hint never moves the controls. Enter submits (the form's
 * submit path carries the caller's guard); Escape cancels. While held, nothing
 * in it changes, so a pending Set always answers the editor, and the text, that
 * sent it.
 */
export function PolicyEditor({ row, busy, held, onConfirm, onCancel }: PolicyEditorProps) {
  const [value, setValue] = useState(row.draft);
  const hintId = useId();
  const label = `New ${row.name}`;
  return (
    <form
      className="policy-edit"
      aria-label={`Set ${row.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        // Enter in the field submits too, so the guard sits on this path, not only on the button.
        onConfirm(value);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (!held) onCancel();
      }}
    >
      <div className="policy-edit-controls">
        {row.options !== null ? (
          <SelectField
            label={label}
            aria-label={label}
            aria-disabled={held ? "true" : undefined}
            value={value}
            onChange={(event) => {
              if (!held) setValue(event.target.value);
            }}
            autoFocus
          >
            {row.options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </SelectField>
        ) : (
          <TextField
            label={label}
            aria-label={label}
            aria-describedby={hintId}
            value={value}
            onChange={(event) => {
              if (!held) setValue(event.target.value);
            }}
            readOnly={held}
            autoFocus
          />
        )}
        <Button variant="primary" size="standalone" type="submit" aria-label={`Set ${row.name}`} loading={busy} disabled={held && !busy}>
          Set
        </Button>
        <Button variant="ghost" size="standalone" onClick={onCancel} disabled={held}>
          Cancel
        </Button>
      </div>
      {row.hint === null ? null : (
        <p className="policy-edit-hint" id={hintId}>
          {row.hint}
        </p>
      )}
    </form>
  );
}
