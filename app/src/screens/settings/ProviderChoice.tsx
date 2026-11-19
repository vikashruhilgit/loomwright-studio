// D42: the owner chooses which auth provider every session runs on, and stores an API key.
//
// - "Use for all sessions" sends `PUT /settings/auth-provider`. The kernel refuses while a
//   session runs (switching restarts it), while a flag or env var picks the provider, or
//   while the chosen provider has no usable credential. On success it restarts on the new
//   choice and this window reconnects on its own; the screen reads again on the event.
// - The API key field sends the key once, in `PUT /settings/api-key`; the kernel stores it
//   in the Keychain and never sends it back. The field clears as soon as Save is pressed.
//   There is still no field for the subscription token: that token is made in the owner's
//   own terminal (D27), and a distributed Studio never holds one (D29, invariant 6).
import { useId, useRef, useState } from "react";
import type { StudioBridge } from "../../api/contract";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { NO_ANSWER_TEXT } from "../schedules/model";
import { API_KEY_KEYCHAIN_ITEM, API_KEY_PROVIDER, SETTINGS_TEST_IDS as IDS, type SettingsView, healthViewOf, isRecord, providerName, providerReady, safe } from "./model";
import { Dot } from "./parts";

/** A note under the list or the field: what happened, in the owner's words. */
interface Note {
  readonly tone: "ok" | "danger";
  readonly text: string;
}

function refusalCode(body: unknown): string | undefined {
  return isRecord(body) && typeof body.error === "string" ? safe(body.error) : undefined;
}

/** The words for the kernel's answer to a switch. */
export function choiceNote(status: number, body: unknown, provider: string): Note {
  const name = providerName(provider);
  if (status === 0) return { tone: "danger", text: "The kernel did not answer, so nothing was changed." };
  if (status === 202 && isRecord(body)) {
    return body.restarting === true
      ? { tone: "ok", text: `Switching to the ${name}. The kernel is restarting, and this window reconnects on its own.` }
      : { tone: "ok", text: `Chose the ${name}. It applies the next time the kernel starts.` };
  }
  if (status === 200) return { tone: "ok", text: `The ${name} stays in use, and is now your recorded choice.` };
  switch (refusalCode(body)) {
    case "sessions_running": {
      const count = isRecord(body) && typeof body.count === "number" ? body.count : undefined;
      return { tone: "danger", text: `${count === undefined ? "Sessions are" : `${count} session${count === 1 ? " is" : "s are"}`} running. Switching restarts the kernel, so switch once they finish.` };
    }
    case "provider_not_ready":
      return { tone: "danger", text: provider === API_KEY_PROVIDER ? "Save an API key first: the kernel has none to run sessions on." : `The ${name} has no usable credential, so every session would fail on it.` };
    case "provider_overridden":
      return { tone: "danger", text: "The kernel was started with a provider set on its command line or in STUDIO_AUTH_PROVIDER, which wins over this choice." };
    default:
      return { tone: "danger", text: `The kernel refused the switch (${status}${refusalCode(body) === undefined ? "" : `, ${refusalCode(body)}`}). Nothing was changed.` };
  }
}

/** The words for the kernel's answer to a saved key. */
export function keyNote(status: number, body: unknown): Note {
  if (status === 0) return { tone: "danger", text: "The kernel did not answer, so the key was not stored. Enter it again." };
  if (status === 200) return { tone: "ok", text: `Stored in the Keychain as ${API_KEY_KEYCHAIN_ITEM}. Studio never shows it again.` };
  if (refusalCode(body) === "invalid_key") return { tone: "danger", text: "That isn't a whole API key: it starts sk-ant-, is longer than 80 characters, and has no spaces. A subscription token (sk-ant-oat…) can't go here. Nothing was stored." };
  if (refusalCode(body) === "keychain_write_failed") {
    // 23u: the kernel deletes the old item before the add, and says whether it could put the old key back.
    const previous = isRecord(body) ? body.previous_key : undefined;
    if (previous === "removed") return { tone: "danger", text: "The Keychain refused the new key, and the old one could not be put back: there is no API key now. Enter the key again." };
    if (previous === "none") return { tone: "danger", text: "The Keychain refused the write. No key was stored." };
    return { tone: "danger", text: "The Keychain refused the write. Your previous key is still in place." };
  }
  return { tone: "danger", text: `The kernel refused the key (${status}). Nothing was stored.` };
}

/**
 * How long after a `restarting: true` answer the screen reads the settings again. A restart drops the connection and the
 * screen reads again on reconnect; a deferred one (a session started in its delay, 23u) never does, so this read is what
 * shows it as pending instead of leaving "restarting" up.
 */
export const RESTART_CHECK_MS = 5_000;

export interface ProviderChoiceProps {
  readonly api: StudioBridge;
  readonly view: SettingsView;
  readonly offline: boolean;
  /** Read the settings again (after a stored key, so the API key's health updates at once). */
  readonly onChanged: () => void;
}

export function ProviderChoice({ api, view, offline, onChanged }: ProviderChoiceProps) {
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<Note | undefined>(undefined);
  const [saved, setSaved] = useState<Note | undefined>(undefined);
  const [filled, setFilled] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const hintId = useId();
  if (view.providers.length === 0) return null;

  const overridden = view.providerSource === "flag" || view.providerSource === "env";
  // 23u: a choice whose restart was deferred, shown with a way to keep the provider in use instead.
  const pending = view.pendingProvider ?? undefined;
  const inUse = view.providers.find((p) => p.inUse)?.id;
  const hasApiKey = view.providers.some((p) => p.id === API_KEY_PROVIDER);

  const choose = async (provider: string): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.request({ method: "PUT", path: "/settings/auth-provider", body: { provider } });
      const body = "body" in res ? res.body : undefined;
      setChoice(choiceNote(res.status, body, provider));
      if (res.status === 200) onChanged();
      if (res.status === 202 && isRecord(body) && body.restarting === true) {
        setTimeout(() => {
          setChoice(undefined);
          onChanged();
        }, RESTART_CHECK_MS);
      }
    } catch {
      setChoice({ tone: "danger", text: NO_ANSWER_TEXT });
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    const field = input.current;
    if (field === null) return;
    const key = field.value.trim();
    // Cleared before the request: the key is never held by the screen past this point.
    field.value = "";
    setFilled(false);
    if (key === "") return;
    setBusy(true);
    try {
      const res = await api.request({ method: "PUT", path: "/settings/api-key", body: { key } });
      setSaved(keyNote(res.status, "body" in res ? res.body : undefined));
      if (res.status === 200) onChanged();
    } catch {
      setSaved({ tone: "danger", text: NO_ANSWER_TEXT });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-choice" data-testid={IDS.choice}>
      <h3 className="settings-title">Sessions run on</h3>
      {overridden ? (
        <p className="settings-cap" data-tone="danger" data-testid={IDS.choiceOverridden}>
          The kernel was started with {view.providerSource === "flag" ? "--auth-provider" : "STUDIO_AUTH_PROVIDER"}, which wins over the choice here.
        </p>
      ) : null}
      <ul className="settings-choice-list">
        {view.providers.map((p) => {
          const health = healthViewOf(p.health, offline);
          const ready = providerReady(p.health);
          return (
            <li key={p.id} className="settings-row" data-testid={IDS.choiceRow} data-provider={p.id}>
              <span>{providerName(p.id)}</span>
              <Dot tone={health.tone} />
              <span className="settings-cap" data-tone={health.tone}>
                {health.label}
              </span>
              {p.inUse ? (
                <span data-testid={IDS.choiceInUse}>
                  <Badge tone="ok">in use</Badge>
                </span>
              ) : (
                <Button
                  size="row"
                  variant="secondary"
                  disabled={busy || offline || overridden || !ready}
                  title={!ready ? (p.id === API_KEY_PROVIDER ? "Save an API key first" : "No usable credential") : offline ? "Needs the kernel" : undefined}
                  data-testid={IDS.choiceUse}
                  onClick={() => void choose(p.id)}
                >
                  Use for all sessions
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {pending === undefined ? null : (
        <div className="settings-choice-pending" data-testid={IDS.choicePending}>
          <p className="settings-cap" data-tone="attention">
            You chose the {providerName(pending)}, but the kernel has not restarted onto it{inUse === undefined ? "" : `, so sessions still run on the ${providerName(inUse)}`}. It applies at the next kernel start.
          </p>
          {inUse === undefined ? null : (
            <Button size="row" variant="secondary" disabled={busy || offline} data-testid={IDS.choiceKeep} onClick={() => void choose(inUse)}>
              Keep the {providerName(inUse)}
            </Button>
          )}
        </div>
      )}
      {choice === undefined ? null : (
        <p className="settings-cap" data-tone={choice.tone} role="status" data-testid={IDS.choiceNote}>
          {choice.text}
        </p>
      )}
      <p className="settings-cap">Switching restarts the kernel, so it waits until no session is running.</p>
      {hasApiKey ? (
        <form
          className="field-group"
          data-testid={IDS.apiKey}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="field-label" htmlFor={fieldId}>
            Anthropic API key
          </label>
          <div className="field" data-variant="text">
            <input
              ref={input}
              id={fieldId}
              className="field-control"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              disabled={busy || offline}
              placeholder="sk-ant-api03-…"
              aria-describedby={hintId}
              data-testid={IDS.apiKeyInput}
              onChange={(event) => setFilled(event.currentTarget.value.trim() !== "")}
            />
            <Button size="row" variant="primary" type="submit" disabled={busy || offline || !filled} data-testid={IDS.apiKeySave}>
              Save key
            </Button>
          </div>
          <div className="field-hint" id={hintId}>
            Kept in the macOS Keychain as {API_KEY_KEYCHAIN_ITEM}. Studio never shows it again, and this field clears the moment you press Save. Sessions on the API key are billed to your Anthropic account.
          </div>
          {saved === undefined ? null : (
            <p className="settings-cap" data-tone={saved.tone} role="status" data-testid={IDS.apiKeyNote}>
              {saved.text}
            </p>
          )}
        </form>
      ) : null}
    </div>
  );
}
