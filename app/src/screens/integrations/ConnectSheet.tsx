// The Connect GitHub sheet (phase 6 item 11): the mockup's `sheetHTML()`, in
// connect mode and in replace mode (a token already exists), over the shared
// Dialog chrome (`dialog-overlay` / `dialog-panel`). It is its own panel, not
// `<Dialog>`, because the primary button must carry `aria-busy` while the
// kernel checks the token and Dialog's action button cannot; the focus trap,
// Escape and focus return are Dialog's own, shared through `useModalFocus`.
//
// The token field is UNCONTROLLED. The pasted value is read from the input's
// ref in the submit handler and nowhere else; it is emptied in the DOM before
// the request is made, and it is never passed to `useState`, a store, a log, an
// error message or the URL. The one piece of state about the field is whether
// it holds anything (a boolean, so Connect can enable). The token leaves this
// module in one call: `connectGithub`, which hands it to the bridge.
//
// The owner's declaration (phase 6 item 14) is a required confirmation: "This is
// a fine-grained token, and every permission I gave it is Read". GitHub reports
// no permissions for a fine-grained token, so the kernel takes the owner's word,
// records it as the owner's (never as checked) and refuses without it. It is
// ordinary state (a boolean) and never touches the token. Connect stays off, and
// Enter sends nothing, until the field holds something and the box is ticked.
//
// Choice first. With nothing connected the sheet opens on the mockup's choice
// ("Install GitHub App" or "Paste a token"); "Paste a token" shows the token
// form below, unchanged, and "Install GitHub App" hands over to the App setup
// dialog (`AppSetupSheet.tsx`) through `onChooseApp`. Replace token on a token
// connection starts on the form. The choice is a view of this one panel, so the
// focus trap, Escape and the focus return to the opener are the same throughout.
//
// Phases (the mockup's `S.sheet`): blank, connecting (field disabled and
// empty, "Checking with GitHub…", button busy), then a refusal shown inline
// (`invalid`, `write`, `permissions_unknown`, or the kernel's own message) with the field empty again
// and focused, or the kernel's yes, which closes the sheet.
import { type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StudioBridge } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import "../../components/Dialog/Dialog.css";
import { useModalFocus } from "../../components/Dialog/useModalFocus";
import "../../components/Input/Input.css";
import { connectGithub } from "./actions";
import { INTEGRATIONS_TEST_IDS as IDS, type Refusal, refusalOf } from "./model";
import "./integrations.css";

type SheetStep = "choice" | "token";

/** Where the owner creates the token. The main process denies every window open, so it is shown as text to copy, not a link. */
export const TOKEN_PAGE = "github.com/settings/personal-access-tokens/new";

export type SheetMode = "connect" | "replace";

export interface ConnectSheetProps {
  readonly api: StudioBridge;
  readonly mode: SheetMode;
  /** Open on the choice between the GitHub App and a token (nothing is connected). Without it the sheet opens on the token form. */
  readonly choice?: boolean;
  /** The kernel cannot be asked right now: "Install GitHub App" is off (the screen's band says why). */
  readonly offline?: boolean;
  /** "Install GitHub App" was chosen: the screen closes this sheet and opens the setup dialog. */
  readonly onChooseApp?: () => void;
  /** The row being replaced is `expired`: the replace sentence says so. */
  readonly expired?: boolean;
  /** Cancel, Escape, or the kernel's yes. */
  readonly onClose: () => void;
  /** The kernel took the token: the screen re-reads the connectors. Called even if the sheet was closed meanwhile. */
  readonly onConnected: () => void;
  /** True from the moment the token is sent until the kernel answers (the list row reads "connecting"). */
  readonly onBusyChange?: (busy: boolean) => void;
  /**
   * True from the moment a token is sent until the kernel answers. Owned by the screen, not the sheet, so it survives
   * the sheet being cancelled and a new one opened: one token check at a time per screen. Defaults to the sheet's own.
   */
  readonly inFlight?: MutableRefObject<boolean>;
  /** The kernel answered the token (yes or no), whether or not the sheet is still open. */
  readonly onSettled?: () => void;
}

type SheetPhase = { readonly kind: "blank" } | { readonly kind: "connecting" } | { readonly kind: "refused"; readonly refusal: Refusal };

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
      ) : refusal.kind === "permissions_unknown" ? (
        <p>GitHub doesn't report what this token can do. Tick the box that says every permission you gave it is Read, then connect again.</p>
      ) : (
        <p>{refusal.text}</p>
      )}
    </div>
  );
}

function ShieldGlyph() {
  return (
    <svg className="integrations-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function KeyGlyph() {
  return (
    <svg className="integrations-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

export function ConnectSheet({ api, mode, choice = false, offline = false, onChooseApp, expired = false, onClose, onConnected, onBusyChange, inFlight: screenInFlight, onSettled }: ConnectSheetProps) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const descId = `${ids}-desc`;
  const fieldId = `${ids}-token`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;
  const declareId = `${ids}-declare`;
  const declareHintId = `${ids}-declare-hint`;

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const ownInFlight = useRef(false);
  const inFlight = screenInFlight ?? ownInFlight;
  const [filled, setFilled] = useState(false);
  // Unticked each time the sheet opens; it stays ticked through a refusal, so a retry needs only a new paste.
  const [declared, setDeclared] = useState(false);
  const [phase, setPhase] = useState<SheetPhase>({ kind: "blank" });
  const [step, setStep] = useState<SheetStep>(choice ? "choice" : "token");
  const appRef = useRef<HTMLButtonElement>(null);
  const tokenCardRef = useRef<HTMLButtonElement>(null);

  // The handlers the document listener and the late answer read: the latest props, never stale ones.
  const latest = useRef({ onClose, onConnected, onBusyChange, onSettled, onChooseApp });
  latest.current = { onClose, onConnected, onBusyChange, onSettled, onChooseApp };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Focus in on open and back out on close, a Tab trap, and Escape: Dialog's own behaviour.
  useModalFocus(panelRef, true, () => latest.current.onClose());
  useEffect(() => {
    return () => {
      // A sheet closed while the kernel is still checking no longer holds the list row at "connecting".
      latest.current.onBusyChange?.(false);
    };
  }, []);

  // The field takes focus on open and again after a refusal; while the kernel checks, Cancel holds it (a disabled field cannot).
  // On the choice, the suggested card does (the token card when the App is off).
  const phaseKind = phase.kind;
  useEffect(() => {
    if (step === "choice") (appRef.current !== null && !appRef.current.disabled ? appRef.current : tokenCardRef.current)?.focus();
    else if (phaseKind === "connecting") cancelRef.current?.focus();
    else inputRef.current?.focus();
  }, [phaseKind, step]);

  const submit = async () => {
    const input = inputRef.current;
    // Without the owner's declaration nothing is sent and the field keeps what was pasted.
    if (input === null || inFlight.current || !declared) return;
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
    latest.current.onSettled?.();
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

  if (step === "choice") {
    return createPortal(
      <div className="dialog-overlay" data-state="open">
        <div ref={panelRef} className="dialog-panel integrations-sheet" data-wide="true" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} tabIndex={-1} data-testid={IDS.choice} data-mode={mode}>
          <h2 className="dialog-title" id={titleId}>
            Connect GitHub
          </h2>
          <div className="dialog-description" id={descId}>
            <p>Choose how Studio gets read access to your repos. Either way it only reads: it can't comment, push or merge.</p>
          </div>
          <div className="integrations-opts">
            <button ref={appRef} type="button" className="integrations-option" data-suggested="true" disabled={offline} title={offline ? "Needs the kernel" : undefined} onClick={() => latest.current.onChooseApp?.()} data-testid={IDS.choiceApp}>
              <ShieldGlyph />
              <span className="integrations-option-text">
                <span className="integrations-option-head">
                  <span className="integrations-option-name">Install GitHub App</span>
                  <span className="integrations-badge" data-tone="neutral">
                    Suggested
                  </span>
                </span>
                <span className="integrations-cap">GitHub opens in your browser. You click Create, then pick the repos and click Install. Permissions are checked by GitHub, and access renews itself.</span>
              </span>
            </button>
            <button ref={tokenCardRef} type="button" className="integrations-option" onClick={() => setStep("token")} data-testid={IDS.choiceToken}>
              <KeyGlyph />
              <span className="integrations-option-text">
                <span className="integrations-option-name">Paste a token</span>
                <span className="integrations-cap">A fine-grained token you create on GitHub. Permissions are declared by you: GitHub doesn't tell Studio what a token can do.</span>
              </span>
            </button>
          </div>
          <p className="integrations-cap">Studio keeps one GitHub connection at a time.</p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={onClose} data-testid={IDS.choiceCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

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
          <div className="integrations-declare">
            <label className="integrations-check" htmlFor={declareId}>
              <input id={declareId} type="checkbox" checked={declared} disabled={connecting} aria-describedby={declareHintId} data-testid={IDS.sheetDeclare} onChange={(event) => setDeclared(event.currentTarget.checked)} />
              <span>This is a fine-grained token, and every permission I gave it is Read</span>
            </label>
            <div className="field-hint" id={declareHintId}>
              GitHub doesn't tell Studio what a fine-grained token can do, so Studio keeps this as your word, never as checked.
            </div>
          </div>
        </form>
        <div className="dialog-actions">
          <Button ref={cancelRef} variant="secondary" kbd="Esc" onClick={onClose} data-testid={IDS.sheetCancel}>
            Cancel
          </Button>
          <Button variant="primary" kbd={connecting ? undefined : "⏎"} loading={connecting} disabled={!connecting && !(filled && declared)} onClick={() => void submit()} data-testid={IDS.sheetConnect}>
            {connecting ? "Connecting" : "Connect"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
