// The Connect GitHub sheet (phase 6 item 11): the mockup's `sheetHTML()`, in
// connect mode and in replace mode (a token already exists), over the shared
// Dialog chrome (`dialog-overlay` / `dialog-panel`). It is its own panel, not
// `<Dialog>`, because the primary button must carry `aria-busy` while the
// kernel checks the token and Dialog's action button cannot; the focus trap,
// Escape and focus return are written here to match Dialog's.
//
// The token field is UNCONTROLLED. The pasted value is read from the input's
// ref in the submit handler and nowhere else; it is emptied in the DOM before
// the request is made, and it is never passed to `useState`, a store, a log, an
// error message or the URL. The one piece of state about the field is whether
// it holds anything (a boolean, so Connect can enable). The token leaves this
// module in one call: `connectGithub`, which hands it to the bridge.
//
// Phases (the mockup's `S.sheet`): blank, connecting (field disabled and
// empty, "Checking with GitHub…", button busy), then a refusal shown inline
// (`invalid`, `write`, or the kernel's own message) with the field empty again
// and focused, or the kernel's yes, which closes the sheet.
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StudioBridge } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import "../../components/Dialog/Dialog.css";
import "../../components/Input/Input.css";
import { connectGithub } from "./actions";
import { INTEGRATIONS_TEST_IDS as IDS, type Refusal, refusalOf } from "./model";
import "./integrations.css";

/** Where the owner creates the token. The main process denies every window open, so it is shown as text to copy, not a link. */
export const TOKEN_PAGE = "github.com/settings/personal-access-tokens/new";

export type SheetMode = "connect" | "replace";

export interface ConnectSheetProps {
  readonly api: StudioBridge;
  readonly mode: SheetMode;
  /** The row being replaced is `expired`: the replace sentence says so. */
  readonly expired?: boolean;
  /** Cancel, Escape, or the kernel's yes. */
  readonly onClose: () => void;
  /** The kernel took the token: the screen re-reads the connectors. Called even if the sheet was closed meanwhile. */
  readonly onConnected: () => void;
  /** True from the moment the token is sent until the kernel answers (the list row reads "connecting"). */
  readonly onBusyChange?: (busy: boolean) => void;
}

type SheetPhase = { readonly kind: "blank" } | { readonly kind: "connecting" } | { readonly kind: "refused"; readonly refusal: Refusal };

const FOCUSABLE = "button:not([disabled]), input:not([disabled]):not([type='hidden']), a[href], [tabindex]:not([tabindex='-1'])";

function Refused({ refusal, id }: { readonly refusal: Refusal; readonly id: string }) {
  return (
    <div className="integrations-refusal" id={id} role="alert" data-testid={IDS.sheetError}>
      {refusal.kind === "invalid" ? (
        <p>
          GitHub didn't accept this token. It may be mistyped, expired or revoked. Paste the whole token: it starts with <span className="integrations-mono">github_pat_</span>.
        </p>
      ) : refusal.kind === "write" ? (
        <>
          <p>This token can write, so it wasn't saved. Studio takes only read-only tokens in this phase. On GitHub, edit the token and change:</p>
          {refusal.drops.length === 0 ? null : (
            <ul>
              {refusal.drops.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p>Then paste it here again.</p>
        </>
      ) : (
        <p>{refusal.text}</p>
      )}
    </div>
  );
}

export function ConnectSheet({ api, mode, expired = false, onClose, onConnected, onBusyChange }: ConnectSheetProps) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const descId = `${ids}-desc`;
  const fieldId = `${ids}-token`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const [filled, setFilled] = useState(false);
  const [phase, setPhase] = useState<SheetPhase>({ kind: "blank" });

  // The handlers the document listener and the late answer read: the latest props, never stale ones.
  const latest = useRef({ onClose, onConnected, onBusyChange });
  latest.current = { onClose, onConnected, onBusyChange };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Focus in on open and back out on close (to the opener, if it is still there), a Tab trap, and Escape.
  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        latest.current.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const outside = !panel.contains(active);
      if (event.shiftKey ? outside || active === first || active === panel : outside || active === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    return () => {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus();
      // A sheet closed while the kernel is still checking no longer holds the list row at "connecting".
      latest.current.onBusyChange?.(false);
    };
  }, []);

  // The field takes focus on open and again after a refusal; while the kernel checks, Cancel holds it (a disabled field cannot).
  const phaseKind = phase.kind;
  useEffect(() => {
    if (phaseKind === "connecting") cancelRef.current?.focus();
    else inputRef.current?.focus();
  }, [phaseKind]);

  const submit = async () => {
    const input = inputRef.current;
    if (input === null || inFlight.current) return;
    const token = input.value.trim();
    // Emptied in the DOM first: before the request is made, let alone answered.
    input.value = "";
    setFilled(false);
    if (token === "") return;
    inFlight.current = true;
    setPhase({ kind: "connecting" });
    latest.current.onBusyChange?.(true);
    const reply = await connectGithub(api, token);
    inFlight.current = false;
    if (mounted.current) latest.current.onBusyChange?.(false);
    if (reply.kind === "ok") {
      latest.current.onConnected();
      if (mounted.current) latest.current.onClose();
      return;
    }
    if (mounted.current) setPhase({ kind: "refused", refusal: refusalOf(reply) });
  };

  const onFieldKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const connecting = phase.kind === "connecting";
  const refusal = phase.kind === "refused" ? phase.refusal : undefined;
  const placeholder = connecting ? "Checking with GitHub…" : refusal !== undefined ? "Paste the changed or new token" : "github_pat_…";
  const replaceSentence = mode === "replace" ? (expired ? " The new token replaces the expired one once it passes the check." : " The current token stays in use until the new one passes the check.") : "";

  return createPortal(
    <div className="dialog-overlay" data-state="open">
      <div ref={panelRef} className="dialog-panel integrations-sheet" data-wide="true" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} tabIndex={-1} data-testid={IDS.sheet} data-mode={mode}>
        <h2 className="dialog-title" id={titleId}>
          Connect GitHub
        </h2>
        <div className="dialog-description" id={descId}>
          <p>{`Studio reads your PRs with a token you create for it. In this phase it only reads: it can't comment, push or merge.${replaceSentence}`}</p>
        </div>
        <ol className="integrations-steps">
          <li>
            Create a <b>fine-grained</b> personal access token on GitHub.
          </li>
          <li>
            Repository access: <b>Only select repositories</b>, then pick the personal repos Studio may read.
          </li>
          <li>
            Permissions: <b>Pull requests</b> and <b>Contents</b>, each <b>Read-only</b>. Metadata is read-only already.
          </li>
          <li>Choose an expiry, generate the token and copy it.</li>
        </ol>
        <p className="integrations-token-page" data-testid={IDS.sheetPage}>
          Create it at <span className="integrations-mono">{TOKEN_PAGE}</span>
        </p>
        <form
          className="field-group"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="field-label" htmlFor={fieldId}>
            Token
          </label>
          <div className="field" data-variant="text" data-invalid={refusal === undefined ? undefined : "true"}>
            <input
              ref={inputRef}
              id={fieldId}
              className="field-control"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              disabled={connecting}
              placeholder={placeholder}
              aria-invalid={refusal === undefined ? undefined : "true"}
              aria-describedby={refusal === undefined ? hintId : `${errorId} ${hintId}`}
              data-testid={IDS.sheetToken}
              onChange={(event) => setFilled(event.currentTarget.value.trim() !== "")}
              onKeyDown={onFieldKeyDown}
            />
          </div>
          {refusal === undefined ? null : <Refused refusal={refusal} id={errorId} />}
          <div className="field-hint" id={hintId}>
            {connecting
              ? "Sent to the kernel, and this field is already cleared. The kernel checks the account, the permissions, the expiry and the repos the token reaches."
              : "Kept in the macOS Keychain. Studio never shows it again, and this field clears the moment you press Connect."}
          </div>
          <p className="integrations-sr-only" role="status" data-testid={IDS.sheetStatus}>
            {connecting ? "Checking with GitHub…" : ""}
          </p>
        </form>
        <div className="dialog-actions">
          <Button ref={cancelRef} variant="secondary" kbd="Esc" onClick={onClose} data-testid={IDS.sheetCancel}>
            Cancel
          </Button>
          <Button variant="primary" kbd={connecting ? undefined : "⏎"} loading={connecting} disabled={!connecting && !filled} onClick={() => void submit()} data-testid={IDS.sheetConnect}>
            {connecting ? "Connecting" : "Connect"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
