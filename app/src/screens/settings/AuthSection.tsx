// The Settings screen's two kernel-fed sections and the terminal commands between them
// (phase 7 item 08), as the mockup's `settingsScreen` draws them.
//
// - "Auth provider" (read-only): the provider, its account, health, and when a token
//   exists its creation day and life. The Token row says where the value is kept and that
//   it is never shown. There is no input, no sign-in and no way to enter a credential
//   anywhere in this file (invariants 6 and 7); changing the provider is done in the
//   owner's own terminal.
// - "Change it in your terminal": the three commands of the first-run screen
//   (`SETUP_STEPS`, reused, never copied), each with a Copy button.
// - "Kernel" (read-only): the data location with Reveal in Finder, the notifier and the
//   Loomwright install.
//
// Every value comes from `SettingsView`, whose strings are already inert; each renders as
// a React text child, never markup.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { SETUP_STEPS } from "../../shell/KernelStates";
import { KEYCHAIN_ITEM, NOTIFIER_CAPTION, SETTINGS_TEST_IDS as IDS, type SettingsView, commandsHeading, hasToken, healthView, tokenLife } from "./model";
import { Dot } from "./parts";

function Row({ term, children, testId }: { readonly term: string; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <div className="settings-row" data-testid={IDS.row}>
      <dt>{term}</dt>
      <dd data-testid={testId}>{children}</dd>
    </div>
  );
}

function SectionHead({ id, title, badge, lastKnown }: { readonly id: string; readonly title: string; readonly badge?: string; readonly lastKnown?: boolean }) {
  return (
    <div className="settings-sech">
      <h2 className="settings-label" id={id}>
        {title}
      </h2>
      {badge === undefined ? null : <Badge>{badge}</Badge>}
      {lastKnown === true ? (
        <span className="settings-cap" data-testid={IDS.lastKnown}>
          last known
        </span>
      ) : null}
    </div>
  );
}

// ---- Auth provider ----------------------------------------------------------------------------------

export interface AuthSectionProps {
  /** The held view; `undefined` while there is none (loading, a failure, or no answer yet). */
  readonly view: SettingsView | undefined;
  /** What to draw in the section while there is no view: the loading skeleton, the failure card or the "status unknown" note. */
  readonly placeholder: ReactNode;
  readonly offline: boolean;
  readonly now: Date;
}

export function AuthSection({ view, placeholder, offline, now }: AuthSectionProps) {
  let body: ReactNode = placeholder;
  if (view !== undefined) {
    const { provider } = view;
    const health = healthView(provider.health);
    const life = provider.tokenCreatedAt === null ? undefined : tokenLife(provider.tokenCreatedAt, now);
    const token = hasToken(provider.health);
    body = (
      <dl className="settings-kv" data-testid={IDS.auth}>
        <Row term="Provider" testId={IDS.provider}>
          <code className="settings-mono">{provider.id}</code>
        </Row>
        <Row term="Account" testId={IDS.account}>
          {provider.account ?? "none recorded"}
        </Row>
        <Row term="Health" testId={IDS.health}>
          <Dot tone={health.tone} />
          <span data-tone={health.tone}>{health.label}</span>
          {health.note === undefined ? null : (
            <span className="settings-cap" data-testid={IDS.healthNote}>
              {health.note}
            </span>
          )}
        </Row>
        {token ? (
          <Row term="Token created" testId={IDS.tokenCreated}>
            {life === undefined ? (
              <>
                <span>not recorded</span>
                <span className="settings-cap">the kernel has no creation date, so it can't count the token's life</span>
              </>
            ) : (
              <span className="settings-tn">{life.created}</span>
            )}
          </Row>
        ) : null}
        {token && life !== undefined ? (
          <Row term="Token life" testId={IDS.tokenLife}>
            <span className="settings-tn">{life.text}</span>
            {provider.health.status === "expiring" ? <span data-testid={IDS.renewSoon}><Badge tone="attention">renew soon</Badge></span> : null}
          </Row>
        ) : null}
        <Row term="Token" testId={IDS.token}>
          <span>
            {provider.health.status === "missing" ? "Expected in" : "Kept in"} the Keychain as <code className="settings-mono">{KEYCHAIN_ITEM}</code>. The value is never shown, and this app has no field for it.
          </span>
        </Row>
      </dl>
    );
  }
  return (
    <section className="settings-blk" aria-labelledby="settings-h-auth">
      <SectionHead id="settings-h-auth" title="Auth provider" badge="read-only" lastKnown={offline && view !== undefined} />
      {body}
    </section>
  );
}

// ---- The terminal commands --------------------------------------------------------------------------

/**
 * Copies the text of `node` by selecting it and running the browser's own copy, then puts the owner's selection back.
 * `false` when the window has no such command or it refused. It builds no input and no textarea (there is no place on
 * this screen to type), and it reads only text the screen itself is showing.
 */
function copySelection(node: HTMLElement): boolean {
  const selection = window.getSelection();
  if (selection === null || typeof document.execCommand !== "function") return false;
  const saved = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : undefined;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    selection.removeAllRanges();
    if (saved !== undefined) selection.addRange(saved);
  }
}

export function CommandsSection({ view }: { readonly view: SettingsView | undefined }) {
  const [copied, setCopied] = useState<{ readonly command: string; readonly ok: boolean } | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async (command: string, shown: HTMLElement | null): Promise<void> => {
    // The command's own text, selected and copied by the browser: it needs no permission. The async clipboard needs one
    // that the shell's permission handler denies for every request (`main.ts`), so it is the second try, for a window
    // that has no copy command.
    let ok = shown !== null && copySelection(shown);
    if (!ok) {
      try {
        await navigator.clipboard.writeText(command);
        ok = true;
      } catch {
        // Said below; the command stays selectable.
      }
    }
    setCopied({ command, ok });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(undefined), 2500);
  };

  return (
    <section className="settings-blk" aria-labelledby="settings-h-cmd" data-testid={IDS.commands}>
      <SectionHead id="settings-h-cmd" title={view === undefined ? "Change it in your terminal" : commandsHeading(view.provider.health)} />
      <p className="settings-text">Studio never asks for the token. These three commands, run in your own terminal, set it up; the first-run screen shows the same ones.</p>
      <ol className="settings-steps">
        {SETUP_STEPS.map((step, i) => (
          <li key={step.command} data-testid={IDS.step}>
            <Badge>{String(i + 1)}</Badge>
            <div>
              <span>{step.what}</span>
              <div className="settings-cmdline">
                <code className="settings-mono" data-testid={IDS.command}>
                  {step.command}
                </code>
                <Button size="row" variant="ghost" aria-label={`Copy command: ${step.command}`} data-testid={IDS.copy} onClick={(event) => void copy(step.command, event.currentTarget.parentElement?.querySelector("code") ?? null)}>
                  Copy
                </Button>
                <span className="settings-cap settings-copied" role="status" data-testid={IDS.copied}>
                  {copied?.command !== step.command ? "" : copied.ok ? "Copied" : "Couldn't copy: select the command and copy it"}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---- Kernel ------------------------------------------------------------------------------------------

export interface KernelSectionProps {
  readonly view: SettingsView;
  readonly offline: boolean;
  /** The preferences bridge exists (Reveal goes through it). */
  readonly canReveal: boolean;
  readonly onReveal: () => void;
  /** A reveal was asked and the main process could not open the folder. */
  readonly revealFailed: boolean;
}

export function KernelSection({ view, offline, canReveal, onReveal, revealFailed }: KernelSectionProps) {
  return (
    <section className="settings-blk" aria-labelledby="settings-h-kern">
      <SectionHead id="settings-h-kern" title="Kernel" badge="read-only" lastKnown={offline} />
      <dl className="settings-kv" data-testid={IDS.kernel}>
        <Row term="Data location" testId={IDS.dataDir}>
          <code className="settings-mono">{view.dataDir}</code>
          <Button size="row" variant="ghost" disabled={offline || !canReveal} title={offline ? "Needs the kernel" : undefined} data-testid={IDS.reveal} onClick={onReveal}>
            Reveal in Finder
          </Button>
          {revealFailed ? (
            <span className="settings-cap" data-tone="danger" role="status" data-testid={IDS.revealNote}>
              Couldn't open the folder
            </span>
          ) : null}
        </Row>
        <Row term="Notifier" testId={IDS.notifier}>
          <code className="settings-mono">{view.notifier}</code>
          <span className="settings-cap">{NOTIFIER_CAPTION}</span>
        </Row>
        <Row term="Loomwright" testId={IDS.loomwright}>
          {view.loomwright.ok ? (
            <code className="settings-mono">{view.loomwright.installPath}</code>
          ) : (
            <>
              <span data-tone="danger">error</span>
              <code className="settings-mono">{view.loomwright.reason}</code>
            </>
          )}
        </Row>
      </dl>
    </section>
  );
}
