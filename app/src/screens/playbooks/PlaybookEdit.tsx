// The field-level edit (phase 7 item 04). The mockup's batched "Save as vN+1" does
// not match the kernel: the owner's only write, `POST /playbooks/:id/set`, takes ONE
// field per call and writes one version per call. So each field has its own Set, and
// a Set sends exactly one `{field, value}`. Name, intent and effort have no owner
// write route (DESIGN.md open point 6), so they are shown read-only with a pointer
// to Edit in English.
//
// Nothing shown changes until the kernel answers: the values are the live store's, a
// Set's answer refetches them, and there is no optimistic update. While a Set is
// pending the editor keeps its text (the shared `PolicyEditor`'s `held`). A refusal
// shows under that field in the kernel's own words and code. The version named is
// always the one the kernel answered with, never a predicted "vN+1".
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { PlaybookChangeResponse, PlaybookListing } from "../../api/contract";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { type KernelPolicyField, type PolicyRow, PolicyEditor, modePolicyRow, policyRows } from "../../components/PlaybookPolicy/PlaybookPolicy";
import { focusLost } from "../chat/model";
import type { WriteOutcome } from "../chat/model";
import { Crumb } from "./PlaybookDetail";
import { type PlaybookActions, SetBy } from "./parts";
import { PLAYBOOKS_TEST_IDS as IDS, NOT_SET, dedupeText, isOn, limitText, safe, safeBlock, valueOrNotSet } from "./model";

/** What a read-only field says about changing it. */
export const READ_ONLY_HINT = "Change this with Edit in English";

export interface PlaybookEditProps {
  readonly playbook: PlaybookListing;
  readonly actions: PlaybookActions;
  /** One field's Set, through the screen's guard; `undefined` when the guard dropped it. */
  readonly onSet: (playbook: PlaybookListing, field: KernelPolicyField, value: string) => Promise<WriteOutcome<PlaybookChangeResponse> | undefined>;
  readonly onBack: () => void;
}

type ReadOnlyKey = "name" | "intent" | "effort";

type EditRow =
  | { readonly kind: "settable"; readonly row: PolicyRow }
  | { readonly kind: "readonly"; readonly key: ReadOnlyKey; readonly label: string; readonly shown: string; readonly setBy: string | null; readonly block: boolean };

/** The eight fields of the mockup, in its order. Five are settable; name, intent and effort are not. */
function rowsOf(playbook: PlaybookListing): readonly EditRow[] {
  const byField = new Map(policyRows(playbook).map((row) => [row.field, row] as const));
  const settable = (field: "dedupe_key" | "priority" | "model" | "token_limit"): EditRow => {
    const row = byField.get(field) as PolicyRow;
    // The shared editor's rows show the stored values as the kernel keeps them (a dedupe key as a JSON list, a limit unseparated); this view shows them as the rest of the screen does.
    if (field === "dedupe_key") return { kind: "settable", row: { ...row, shown: dedupeText(playbook.dedupe_key_spec) } };
    if (field === "token_limit") return { kind: "settable", row: { ...row, shown: limitText(playbook.token_limit_per_day) } };
    return { kind: "settable", row };
  };
  return [
    { kind: "readonly", key: "name", label: "Name", shown: safe(playbook.name), setBy: null, block: false },
    { kind: "readonly", key: "intent", label: "Intent", shown: safeBlock(playbook.intent), setBy: null, block: true },
    settable("dedupe_key"),
    settable("priority"),
    settable("model"),
    { kind: "readonly", key: "effort", label: "Effort", shown: valueOrNotSet(playbook.effort), setBy: playbook.effort_set_by, block: false },
    settable("token_limit"),
    { kind: "settable", row: modePolicyRow(playbook) },
  ];
}

interface FieldNote {
  readonly field: KernelPolicyField;
  readonly tone: "danger" | "ok";
  readonly text: string;
}

/** The kernel's answer to a changed Set, in words: the version it answered with, and a draft again when it says so. */
function savedText(label: string, answer: PlaybookChangeResponse, wasOn: boolean): string {
  if (!answer.changed) return `No change: ${label} already reads that, so the kernel wrote no version (still v${answer.playbook.version}).`;
  const draftAgain = wasOn && answer.playbook.status === "draft" ? " The playbook is a draft again until you turn it on." : "";
  const mirror = answer.mirror_error === undefined ? "" : ` The playbook's mirror file could not be written: ${safe(answer.mirror_error)}`;
  return `${label}: saved as v${answer.playbook.version}.${draftAgain}${mirror}`;
}

export function PlaybookEdit({ playbook, actions, onSet, onBack }: PlaybookEditProps) {
  const [editing, setEditing] = useState<KernelPolicyField | null>(null);
  const [note, setNote] = useState<FieldNote | null>(null);
  const [busy, setBusy] = useState<KernelPolicyField | null>(null);
  const editRefs = useRef(new Map<KernelPolicyField, HTMLButtonElement>());
  // Opening or closing an editor unmounts the focused control: say where focus goes.
  const focusAfter = useRef<KernelPolicyField | null>(null);
  useLayoutEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    if (!focusLost()) return;
    editRefs.current.get(target)?.focus();
  }, [editing]);
  const on = isOn(playbook);

  const confirm = async (row: PolicyRow, value: string): Promise<void> => {
    setBusy(row.field);
    let outcome: WriteOutcome<PlaybookChangeResponse> | undefined;
    try {
      outcome = await onSet(playbook, row.field, value);
    } finally {
      setBusy(null);
    }
    // Dropped by the guard: an earlier Set is still pending, and its answer is the one to show.
    if (outcome === undefined) return;
    if (!outcome.ok) {
      // The editor stays open with the owner's text, under the kernel's words.
      setNote({ field: row.field, tone: "danger", text: outcome.text });
      return;
    }
    setNote({ field: row.field, tone: "ok", text: savedText(row.label, outcome.body, on) });
    focusAfter.current = row.field;
    setEditing(null);
  };

  const cancel = (field: KernelPolicyField): void => {
    focusAfter.current = field;
    setNote((current) => (current?.field === field ? null : current));
    setEditing(null);
  };

  return (
    <div
      className="pb-main"
      data-testid={IDS.edit}
      data-playbook={playbook.id}
      onKeyDown={(event) => {
        // The editor's own Escape stops here; one that reaches this line has no editor open.
        if (event.key === "Escape" && editing === null && !event.defaultPrevented) onBack();
      }}
    >
      <Crumb label="Playbook" name={safe(playbook.name)} onBack={onBack} />
      <div className="pb-head">
        <h2>Edit fields</h2>
        <Badge>{`v${playbook.version} now`}</Badge>
        <span className="pb-cap pb-mono">{safe(playbook.slug)}</span>
      </div>
      <div className="pb-edit-note">
        <p>Each field is set on its own. Set sends that one field and writes at most one new version; a value that did not change writes none.</p>
        {on ? <p>Any change makes this playbook a draft again, as the kernel does. Turn it on once you have read the new version.</p> : null}
      </div>
      <dl className="pb-rows">
        {rowsOf(playbook).map((entry) => {
          if (entry.kind === "readonly") {
            return (
              <div className="pb-row" key={entry.key} data-testid={IDS.field} data-field={entry.key} data-readonly="true">
                <dt>{entry.label}</dt>
                <dd>
                  <span className="pb-value">
                    <span className={entry.block ? "pb-text" : undefined}>{entry.shown}</span>
                    <SetBy setBy={entry.shown === NOT_SET ? null : entry.setBy} />
                  </span>
                  <span className="pb-hint">{READ_ONLY_HINT}</span>
                </dd>
              </div>
            );
          }
          const { row } = entry;
          const fieldNote = note?.field === row.field ? note : null;
          const heldElsewhere = (actions.pending !== null || busy !== null) && busy !== row.field;
          return (
            <Fragment key={row.field}>
              <div className="pb-row" data-testid={IDS.field} data-field={row.field} data-editing={editing === row.field ? "true" : undefined}>
                <dt>{row.label}</dt>
                <dd>
                  {editing === row.field ? (
                    <PolicyEditor row={row} busy={busy === row.field} held={busy !== null} onConfirm={(value) => void confirm(row, value)} onCancel={() => cancel(row.field)} />
                  ) : (
                    <span className="pb-value">
                      <span className={row.mono ? "pb-mono" : undefined}>{safe(row.shown)}</span>
                      <SetBy setBy={row.shown === NOT_SET ? null : row.setBy} />
                      <Button
                        variant="ghost"
                        size="row"
                        data-testid={IDS.fieldEdit}
                        aria-label={`Edit ${row.name}`}
                        disabled={actions.offline || heldElsewhere}
                        ref={(el) => {
                          if (el === null) editRefs.current.delete(row.field);
                          else editRefs.current.set(row.field, el);
                        }}
                        onClick={() => {
                          setNote((current) => (current?.field === row.field ? null : current));
                          setEditing(row.field);
                        }}
                      >
                        Edit
                      </Button>
                    </span>
                  )}
                  {fieldNote === null ? null : (
                    <p
                      className={fieldNote.tone === "danger" ? "pb-field-refusal" : "pb-hint"}
                      role={fieldNote.tone === "danger" ? "alert" : "status"}
                      data-testid={fieldNote.tone === "danger" ? IDS.fieldRefusal : IDS.fieldStatus}
                    >
                      {fieldNote.text}
                    </p>
                  )}
                </dd>
              </div>
            </Fragment>
          );
        })}
      </dl>
    </div>
  );
}
