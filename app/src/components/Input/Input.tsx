// Input (docs/design/design-system/components/Input). Fields rest on
// `surface-sunken` with no border and lift to `surface` with an `accent` edge
// on focus, so a focused field is the brightest thing in its row.
//
// - `TextField`: `variant="text"` or `"search"` (leading search icon, trailing
//   kbd hint). `SelectField`: a native select with a trailing chevron.
//   Both render the visible `label` above the field (wired with htmlFor/id), an
//   optional `hint` under it, and for `error` a `danger` edge plus the message,
//   with `aria-invalid="true"` and `aria-describedby` pointing at it.
// - `Composer`: the chat field, on `surface` with Send inside it. It has no
//   visible label, so `aria-label` is required. Enter sends, Shift+Enter
//   inserts a newline, it grows to six lines then scrolls (CSS
//   `field-sizing: content` with a six-line max-height), and while Wright is
//   `streaming` Send becomes Stop.
// Glyphs (search, chevron) are inline `currentColor` SVGs: no icon library ships here.
import { type ComponentPropsWithRef, type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { Button } from "../Button/Button";
import "./Input.css";

interface FieldTextProps {
  /** Defaults to a generated id. */
  readonly id?: string;
  /** Shown above the field in the label style; never replaced by the placeholder. */
  readonly label: string;
  readonly hint?: string;
  /** The message under the field; sets `aria-invalid` and `aria-describedby`. Not an apology. */
  readonly error?: string;
}

function useFieldIds(props: FieldTextProps, extraDescribedBy: string | undefined) {
  const generated = useId();
  const id = props.id ?? generated;
  const hintId = props.hint ? `${id}-hint` : undefined;
  const errorId = props.error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId, extraDescribedBy].filter(Boolean).join(" ") || undefined;
  return { id, hintId, errorId, describedBy };
}

function FieldFrame({
  id,
  label,
  hint,
  error,
  hintId,
  errorId,
  variant,
  children,
}: FieldTextProps & {
  readonly id: string;
  readonly hintId: string | undefined;
  readonly errorId: string | undefined;
  readonly variant: "text" | "search" | "select";
  readonly children: ReactNode;
}) {
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field" data-variant={variant} data-invalid={error ? "true" : undefined}>
        {children}
      </div>
      {hint ? (
        <div className="field-hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      {error ? (
        <div className="field-hint field-error" id={errorId}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export interface TextFieldProps extends FieldTextProps, Omit<ComponentPropsWithRef<"input">, "id" | "type" | "children"> {
  readonly variant?: "text" | "search";
  /** The text variant's input type; the search variant is always `type="search"`. */
  readonly type?: "text" | "email" | "url" | "password" | "number";
  /** Search only: replaces the built-in leading search glyph. */
  readonly icon?: ReactNode;
  /** Search only: the trailing shortcut hint, for example "/". */
  readonly kbd?: string;
}

export function TextField({
  id: idProp,
  label,
  hint,
  error,
  variant = "text",
  type = "text",
  icon,
  kbd,
  className,
  "aria-describedby": ariaDescribedBy,
  ...rest
}: TextFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds({ id: idProp, label, hint, error }, ariaDescribedBy);
  const search = variant === "search";
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} hintId={hintId} errorId={errorId} variant={variant}>
      {search ? (
        <span className="field-icon" aria-hidden="true">
          {icon ?? <SearchGlyph />}
        </span>
      ) : null}
      <input
        {...rest}
        id={id}
        type={search ? "search" : type}
        className={className ? `field-control ${className}` : "field-control"}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
      />
      {search && kbd ? (
        <kbd className="field-kbd" aria-hidden="true">
          {kbd}
        </kbd>
      ) : null}
    </FieldFrame>
  );
}

export interface SelectFieldProps extends FieldTextProps, Omit<ComponentPropsWithRef<"select">, "id"> {}

export function SelectField({
  id: idProp,
  label,
  hint,
  error,
  className,
  children,
  "aria-describedby": ariaDescribedBy,
  ...rest
}: SelectFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds({ id: idProp, label, hint, error }, ariaDescribedBy);
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} hintId={hintId} errorId={errorId} variant="select">
      <select
        {...rest}
        id={id}
        className={className ? `field-control ${className}` : "field-control"}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
      >
        {children}
      </select>
      <span className="field-icon field-chevron" aria-hidden="true">
        <ChevronGlyph />
      </span>
    </FieldFrame>
  );
}

export interface ComposerProps
  extends Omit<ComponentPropsWithRef<"textarea">, "value" | "defaultValue" | "onChange" | "aria-label" | "children"> {
  /** Required: the composer has no visible label. */
  readonly "aria-label": string;
  /** Controlled text; omit it (and pass `defaultValue`) to let the composer own its text. */
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  /** Called with the text on Enter or Send. An uncontrolled composer then clears itself. */
  readonly onSend: (text: string) => void;
  /** While Wright is streaming, Send becomes Stop and Enter does not send. */
  readonly streaming?: boolean;
  readonly onStop?: () => void;
}

export function Composer({
  value,
  defaultValue = "",
  onValueChange,
  onSend,
  streaming = false,
  onStop,
  onKeyDown,
  className,
  disabled,
  ...rest
}: ComposerProps) {
  const [inner, setInner] = useState(defaultValue);
  const controlled = value !== undefined;
  const text = controlled ? value : inner;

  const update = (next: string) => {
    if (!controlled) setInner(next);
    onValueChange?.(next);
  };

  const send = () => {
    if (streaming || disabled || text.trim() === "") return;
    onSend(text);
    if (!controlled) setInner("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    // Enter sends; Shift+Enter falls through to the platform's newline. Never
    // send mid-IME composition (Enter there commits the composed text).
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="composer" data-streaming={streaming ? "true" : undefined}>
      <textarea
        {...rest}
        rows={1}
        disabled={disabled}
        className={className ? `composer-input ${className}` : "composer-input"}
        value={text}
        onChange={(event) => update(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {streaming ? (
        <Button variant="secondary" size="row" onClick={() => onStop?.()} disabled={disabled}>
          Stop
        </Button>
      ) : (
        <Button variant="primary" size="row" kbd="⏎" onClick={send} disabled={disabled}>
          Send
        </Button>
      )}
    </div>
  );
}
