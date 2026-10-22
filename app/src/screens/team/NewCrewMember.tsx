// New crew member (AC6, AC7): a crew member exists only through a charter the
// owner saw (D22, invariant 9). The form starts empty, with no presets: every
// identity, persona, duty, boundary, model, mode, tool, limit and workspace is
// what the owner types or picks, and the kernel picks none either.
//
// - Create builds the charter (`charterOf`) and calls `POST /agents` once. The
//   kernel's `validateCharter` is the one validator: a `400 charter_invalid` /
//   `agent_id_invalid` (or `409 id_taken`) refusal is shown with its `field`
//   and `message`. On `201` the form closes; the new card arrives from the
//   feed (`agent_created` refetches `agents`), never from a local insert.
// - The tool picker (allowed tools, Bash prefixes and the `never` list) and the
//   shape picker are Team's own `Dialog`s. Dialogs never stack, and this form
//   is not one, so each picker opens over the form.
// - Limits are tokens and sessions, never dollars (D24).
//
// Every value the owner types is sent as text and shown as React text only.
import { type ChangeEvent, type FormEvent, type KeyboardEvent, type TextareaHTMLAttributes, useEffect, useId, useRef, useState } from "react";
import type { StudioBridge } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import { Button } from "../../components/Button/Button";
import { Dialog } from "../../components/Dialog/Dialog";
import { SelectField, TextField } from "../../components/Input/Input";
import { askWright, createAgent } from "./actions";
import { AVATAR_HUES, AVATAR_SHAPES, type CharterForm, EMPTY_FORM, NEVER_CATEGORIES, PERMISSION_MODES, charterOf, linesOf, toolsOf } from "./model";

export interface NewCrewMemberProps {
  readonly api: StudioBridge;
  readonly onCancel: () => void;
  /** Called after `201`; the card itself arrives from the feed. */
  readonly onCreated: (displayName: string) => void;
}

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  readonly label: string;
  readonly hint?: string;
}

/** A multi-line field in the Input primitives' look (`field-group`, `field-label`, `field`). */
function TextArea({ label, hint, className, ...rest }: TextAreaProps) {
  const id = useId();
  return (
    <div className="field-group team-textarea">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field">
        <textarea {...rest} id={id} className={className ? `field-control ${className}` : "field-control"} aria-describedby={hint ? `${id}-hint` : undefined} />
      </div>
      {hint ? (
        <div className="field-hint" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/** The tool picker's draft: edited inside the dialog, kept only on "Use these". */
interface ToolDraft {
  readonly allowedTools: string;
  readonly allowedBashPrefixes: string;
  readonly never: readonly string[];
}

/** A hue as the owner reads it: the kernel's `crew-teal` is "teal". */
function hueWord(hue: string): string {
  return hue.startsWith("crew-") ? hue.slice("crew-".length) : hue;
}

type Picker = "none" | "tools" | "shape";

export function NewCrewMember({ api, onCancel, onCreated }: NewCrewMemberProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [form, setForm] = useState<CharterForm>(EMPTY_FORM);
  const [description, setDescription] = useState("");
  const [picker, setPicker] = useState<Picker>("none");
  const [tools, setTools] = useState<ToolDraft>({ allowedTools: "", allowedBashPrefixes: "", never: [] });
  const [shape, setShape] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ readonly message: string; readonly field?: string } | undefined>(undefined);
  const [askError, setAskError] = useState<string | undefined>(undefined);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const set =
    (key: keyof Omit<CharterForm, "never">) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>): void => {
      const value = event.target.value;
      setForm((f) => ({ ...f, [key]: value }));
    };

  // Escape cancels the form, but never while a picker dialog is open: the
  // dialog's own Escape closes the dialog (its events bubble here through the portal).
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented || picker !== "none") return;
    event.preventDefault();
    onCancel();
  };

  const create = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusal(undefined);
    try {
      const outcome = await createAgent(api, charterOf(form));
      if (outcome.ok) onCreated(form.displayName.trim());
      else setRefusal(outcome.field === undefined ? { message: outcome.message } : { message: outcome.message, field: outcome.field });
    } finally {
      setBusy(false);
    }
  };

  // AC7, the chosen path: "Ask Wright to draft it" sends the owner's words to
  // Wright through `POST /ask` and then opens Chat (`#/chat`), where Wright's
  // reply and its draft arrive. Why this path and not a pre-filled composer:
  // `POST /ask` is a contract route that needs nothing from Chat (item 13, a
  // sibling lane), whereas a pre-fill would need Chat to read a request from
  // the hash, which the shell does not pass on (`screenForHash` takes only the
  // first segment). It creates nothing: Wright can only propose the charter
  // through `kernel_agent_create`, which the kernel always holds for the
  // owner's approval, and the owner presses this button with the text in view.
  const askWrightToDraft = async () => {
    const words = description.trim();
    if (words === "") {
      setAskError("Describe what it should do first; Wright drafts the charter from your words.");
      return;
    }
    setBusy(true);
    setAskError(undefined);
    try {
      const outcome = await askWright(api, `Draft a charter for a new crew member, for me to review before anything is created. What it should do, in my words: ${words}`);
      if (outcome.ok) window.location.hash = "#/chat";
      else setAskError(outcome.message);
    } finally {
      setBusy(false);
    }
  };

  const chosenTools = toolsOf(form.allowedTools);
  const chosenPrefixes = linesOf(form.allowedBashPrefixes);
  const toolSummary =
    chosenTools.length + chosenPrefixes.length + form.never.length === 0
      ? "None chosen: it may use no tool and no Bash command."
      : [
          chosenTools.length === 0 ? "no tools" : `tools: ${chosenTools.join(", ")}`,
          chosenPrefixes.length === 0 ? "no Bash" : `Bash: ${chosenPrefixes.join(", ")}`,
          form.never.length === 0 ? "no extra never list" : `never: ${form.never.join(", ")}`,
        ].join(" · ");

  const openTools = () => {
    setTools({ allowedTools: form.allowedTools, allowedBashPrefixes: form.allowedBashPrefixes, never: form.never });
    setPicker("tools");
  };
  const openShape = () => {
    setShape(form.shape);
    setPicker("shape");
  };

  return (
    <section className="team-new" aria-labelledby={headingId} data-testid="team-new" onKeyDown={onKeyDown}>
      <h2 className="team-new-title" id={headingId} ref={headingRef} tabIndex={-1}>
        New crew member
      </h2>
      <p className="team-new-note">
        Describe it in your own words and Wright drafts the charter. Or fill the charter in yourself. Nothing is predefined.
      </p>
      <TextArea label="What should it do?" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="team-new-ask">
        <Button variant="secondary" loading={busy} onClick={() => void askWrightToDraft()}>
          Ask Wright to draft it
        </Button>
        <span className="team-new-or">or fill it in below</span>
      </div>
      {askError === undefined ? null : (
        <p className="team-insp-error" role="alert" data-testid="team-ask-error">
          {askError}
        </p>
      )}

      <form className="team-new-form" aria-label="Charter" onSubmit={(e) => void create(e)}>
        <fieldset className="team-new-group">
          <legend className="team-new-legend">Identity</legend>
          <div className="team-new-row">
            <TextField label="Id" value={form.id} onChange={set("id")} hint="A lowercase letter, then lowercase letters, digits or hyphens" autoComplete="off" />
            <TextField label="Name" value={form.displayName} onChange={set("displayName")} autoComplete="off" />
          </div>
          <div className="team-new-row">
            <div className="field-group">
              <span className="field-label">Shape</span>
              <div className="team-new-shape">
                {form.shape === "" ? null : (
                  <Avatar agent={{ id: form.id || "new", name: form.displayName || form.shape, shape: form.shape, hue: form.hue }} state="idle" size={24} />
                )}
                <Button size="row" aria-haspopup="dialog" onClick={openShape} data-testid="team-pick-shape">
                  {form.shape === "" ? "Pick a shape…" : `Shape: ${form.shape}`}
                </Button>
              </div>
            </div>
            <SelectField label="Hue" value={form.hue} onChange={set("hue")} data-testid="team-hue">
              <option value="">Pick a hue</option>
              {AVATAR_HUES.map((hue) => (
                <option key={hue} value={hue}>
                  {hueWord(hue)}
                </option>
              ))}
            </SelectField>
          </div>
        </fieldset>

        <TextArea label="Persona" rows={2} value={form.persona} onChange={set("persona")} hint="How it talks and decides, in one or two lines" />
        <TextArea label="Duties" rows={3} value={form.duties} onChange={set("duties")} hint="One duty per line" />
        <TextArea label="Boundaries" rows={2} value={form.boundaries} onChange={set("boundaries")} hint="One per line. Guidance for it; the kernel enforces only the tool policy, never list and limits" />

        <fieldset className="team-new-group">
          <legend className="team-new-legend">Model</legend>
          <div className="team-new-row team-new-row-3">
            <TextField label="Model" value={form.model} onChange={set("model")} autoComplete="off" />
            <TextField label="Effort" value={form.effort} onChange={set("effort")} hint="Optional" autoComplete="off" />
            <SelectField label="Permission mode" value={form.permissionMode} onChange={set("permissionMode")} data-testid="team-permission-mode">
              <option value="">Pick a mode</option>
              {PERMISSION_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </SelectField>
          </div>
        </fieldset>

        <fieldset className="team-new-group">
          <legend className="team-new-legend">Tool policy · enforced</legend>
          <p className="team-new-summary" data-testid="team-tool-summary">
            {toolSummary}
          </p>
          <Button size="row" aria-haspopup="dialog" onClick={openTools} data-testid="team-choose-tools">
            Choose tools…
          </Button>
        </fieldset>

        <fieldset className="team-new-group">
          <legend className="team-new-legend">Limits</legend>
          <div className="team-new-row team-new-row-3">
            <TextField label="Tokens per day" inputMode="numeric" value={form.tokensPerDay} onChange={set("tokensPerDay")} hint="Blank: no limit" />
            <TextField label="Sessions at once" inputMode="numeric" value={form.sessionsAtOnce} onChange={set("sessionsAtOnce")} hint="Blank: no limit" />
            <TextField label="Delegation depth" inputMode="numeric" value={form.delegationDepth} onChange={set("delegationDepth")} hint="Blank: no limit" />
          </div>
          <p className="team-new-hint">Limits are tokens and sessions, not dollars. The kernel parks this crew member at its daily limit.</p>
        </fieldset>

        <TextArea label="Workspaces" rows={2} value={form.workspaces} onChange={set("workspaces")} hint="One absolute folder per line" />

        {refusal === undefined ? null : (
          <p className="team-insp-error" role="alert" data-testid="team-create-error">
            {refusal.field === undefined ? null : <span className="team-new-field">{refusal.field}</span>}
            {refusal.field === undefined ? null : " · "}
            {refusal.message}
          </p>
        )}

        <div className="team-new-actions">
          <Button onClick={onCancel} kbd="Esc">
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Create
          </Button>
        </div>
      </form>

      {picker === "tools" ? (
        <Dialog
          kind="decision"
          wide
          title={`Tools ${form.displayName.trim() || "this crew member"} may use`}
          description="The kernel enforces these: each tool by its exact name, Bash only by these prefixes, and the never list on top of the fixed rails."
          action={{
            label: "Use these",
            onAction: () => {
              setForm((f) => ({ ...f, allowedTools: tools.allowedTools, allowedBashPrefixes: tools.allowedBashPrefixes, never: tools.never }));
              setPicker("none");
            },
          }}
          onCancel={() => setPicker("none")}
        >
          <div className="team-picker" data-testid="team-tool-picker">
            <TextArea
              label="Allowed tools"
              rows={2}
              value={tools.allowedTools}
              onChange={(e) => setTools((t) => ({ ...t, allowedTools: e.target.value }))}
              hint="Exact tool names, separated by commas or spaces"
            />
            <TextArea
              label="Bash prefixes"
              rows={2}
              value={tools.allowedBashPrefixes}
              onChange={(e) => setTools((t) => ({ ...t, allowedBashPrefixes: e.target.value }))}
              hint="One command prefix per line"
            />
            <fieldset className="team-new-group">
              <legend className="team-new-legend">Never</legend>
              <div className="team-checks">
                {NEVER_CATEGORIES.map((category) => (
                  <label key={category} className="team-check">
                    <input
                      type="checkbox"
                      name="never"
                      value={category}
                      checked={tools.never.includes(category)}
                      onChange={(e) =>
                        setTools((t) => ({
                          ...t,
                          never: e.target.checked ? NEVER_CATEGORIES.filter((c) => c === category || t.never.includes(c)) : t.never.filter((c) => c !== category),
                        }))
                      }
                    />
                    <code className="team-code">{category}</code>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </Dialog>
      ) : null}

      {picker === "shape" ? (
        <Dialog
          kind="decision"
          title="Shape"
          description="The creature this crew member wears. The whale is Wright's alone."
          action={{
            label: "Use shape",
            onAction: () => {
              setForm((f) => ({ ...f, shape }));
              setPicker("none");
            },
          }}
          onCancel={() => setPicker("none")}
        >
          <fieldset className="team-new-group" data-testid="team-shape-picker">
            <legend className="team-new-legend">Shape</legend>
            <div className="team-shapes">
              {AVATAR_SHAPES.map((s) => (
                <label key={s} className="team-shape">
                  <input type="radio" name="shape" value={s} checked={shape === s} onChange={() => setShape(s)} />
                  <span aria-hidden="true" className="team-shape-avatar">
                    <Avatar agent={{ id: `shape-${s}`, name: s, shape: s, hue: form.hue }} state="idle" size={24} />
                  </span>
                  <span>{s}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Dialog>
      ) : null}
    </section>
  );
}
