// The repo policy card (phase 8, `docs/design/mockups/phase-8.html` `polCard` and `polPane`): per reached repo, what GitHub
// enforces (from the kernel's detection), the proposal made from it, and the merge policy the owner sets. The kernel
// provides the mechanism and the owner sets the policy (invariant 1): nothing is applied until a press, and every write is
// one `POST /repos/policy/:owner/:repo` (or `…/detect` for Re-detect) through `./actions.ts`.
//
//   Accept        sends `{kind: proposal.kind}`, plus `required: proposal.required_reviews` for `reviews`
//   the presets   Solo / Approve in Studio / N GitHub reviews (an N input): "Set policy" sends the picked one
//   unenforceable GitHub cannot protect the branch (`proposal.choices`, a private repo on Free): exactly three ways on,
//                 none picked for the owner. Make public / Upgrade are two links (no POST); Safe mode sends nothing and
//                 leaves the repo with no policy, so its PRs park; Trust unprotected asks first (the confirm names what
//                 it waives: condition 4 only, never the high-risk park), then the owner picks a preset and "Set policy"
//                 sends `{kind: <preset>, trust_unprotected: true}`
//
// Studio never changes branch protection. A link opens only through `openExternalUrl`, with a `false` answer shown as a
// failure line. Every string from the kernel or GitHub (repo, logins, check names) is untrusted: a React text child.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RepoPolicy, RepoPolicyChoice, RepoPolicyKind, StudioBridge } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { Dialog } from "../../components/Dialog/Dialog";
import { TextField } from "../../components/Input/Input";
import { REFETCH_THROTTLE_MS } from "../../store/store";
import { detectRepoPolicy, openExternalUrl, readRepoPolicies, setRepoPolicy } from "./actions";
import { useEscape } from "./McpConnect";
import {
  BILLING_PLANS_URL,
  INTEGRATIONS_TEST_IDS as IDS,
  POLICY_PRESETS,
  type PolicyRead,
  acceptBody,
  detectionOf,
  policyWords,
  presetBody,
  protectionOf,
  repoSettingsUrl,
  replyText,
  reviewsValid,
  whenText,
} from "./model";
import { ExternalGlyph, RefreshGlyph, RepoGlyph } from "./parts";
import "./integrations.css";

// ---- Data ----------------------------------------------------------------------------------------

/**
 * `GET /repos/policy`: read when the pane is first opened (`enabled`), not on mount, so a screen nobody opens asks the
 * kernel for nothing; after that, again when a `connector_status` event arrives (a newly reached repo appears). The
 * last good list stays while a later read fails, with the failure beside it. A write replaces its repo in the list with the
 * kernel's answer (`replace`), never a local edit.
 */
export function useRepoPolicies(api: StudioBridge, eventId: number, enabled: boolean): { readonly read: PolicyRead; readonly replace: (policy: RepoPolicy) => void } {
  const [read, setRead] = useState<PolicyRead>({ phase: "idle", repos: [], error: undefined });
  const generation = useRef(0);
  const latestEvent = useRef(eventId);
  latestEvent.current = eventId;
  // The event the read in hand already follows: an event that was in the feed before the pane opened is not a reason to read twice.
  const handled = useRef(eventId);

  const reload = useCallback(() => {
    generation.current += 1;
    const mine = generation.current;
    void readRepoPolicies(api).then((reply) => {
      if (generation.current !== mine) return;
      if (reply.kind === "ok" && Array.isArray(reply.body.repos)) {
        setRead({ phase: "ready", repos: reply.body.repos, error: undefined });
      } else {
        setRead((prev) => ({ phase: "error", repos: prev.repos, error: reply.kind === "ok" ? "the kernel's answer was not a list of repos" : replyText(reply) }));
      }
    });
  }, [api]);

  useEffect(() => {
    if (!enabled) return;
    handled.current = latestEvent.current;
    setRead((prev) => (prev.phase === "idle" ? { ...prev, phase: "loading" } : prev));
    reload();
    return () => {
      // The answer in flight is dropped once the screen unmounts.
      generation.current += 1;
    };
  }, [enabled, reload]);

  useEffect(() => {
    if (!enabled || eventId === 0 || eventId === handled.current) return;
    const timer = window.setTimeout(() => {
      handled.current = eventId;
      reload();
    }, REFETCH_THROTTLE_MS);
    return () => window.clearTimeout(timer);
  }, [eventId, enabled, reload]);

  const replace = useCallback((policy: RepoPolicy) => {
    if (typeof policy.repo !== "string") return;
    // An older read still in flight would put the stale policy back: it is dropped.
    generation.current += 1;
    setRead((prev) => {
      const known = prev.repos.some((repo) => repo.repo === policy.repo);
      return { ...prev, repos: known ? prev.repos.map((repo) => (repo.repo === policy.repo ? policy : repo)) : [...prev.repos, policy] };
    });
  }, []);

  return { read, replace };
}

// ---- The card ---------------------------------------------------------------------------------

export interface RepoPolicyCardProps {
  readonly api: StudioBridge;
  readonly policy: RepoPolicy;
  readonly offline: boolean;
  readonly now: Date;
  /** The kernel answered a write with the repo's policy: the screen replaces it. */
  readonly onUpdated: (policy: RepoPolicy) => void;
}

const CHOICE_ORDER: readonly RepoPolicyChoice[] = ["make_public_or_upgrade", "trust_unprotected", "safe_mode"];

/** The kernel's words for a write that did not land. */
const failedText = (what: string, reason: string): string => `Couldn't ${what}: ${reason}`;

export function RepoPolicyCard({ api, policy, offline, now, onUpdated }: RepoPolicyCardProps) {
  const [pick, setPick] = useState<RepoPolicyKind | undefined>(undefined);
  const [reviews, setReviews] = useState("");
  const [busy, setBusy] = useState<"set" | "accept" | "detect" | undefined>(undefined);
  const [confirmingTrust, setConfirmingTrust] = useState(false);
  const [trusting, setTrusting] = useState(false);
  const [safe, setSafe] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [linkFailure, setLinkFailure] = useState<string | undefined>(undefined);
  const sending = useRef(false);
  useEscape(confirmingTrust, () => setConfirmingTrust(false));

  const protection = protectionOf(policy.detected);
  const proposal = policy.proposal;
  // Where GitHub cannot enforce protection the kernel sends `choices` and no kind: the card offers exactly those.
  const choices = proposal?.choices === undefined ? undefined : CHOICE_ORDER.filter((choice) => proposal.choices?.includes(choice) === true);
  const unenforceable = choices !== undefined && choices.length > 0;
  const detection = detectionOf(policy.detected, now);
  const isSet = policy.kind !== null;
  const dis = offline ? { disabled: true, title: "Needs the kernel" } : {};
  const nHint = reviews.trim() === "" ? "Enter how many approving reviews." : reviewsValid(reviews) ? undefined : "Use a whole number from 1 up.";

  /** One write, one at a time: the answer replaces the repo's policy, a refusal says why and changes nothing. */
  const write = async (what: "set" | "accept" | "detect", run: () => ReturnType<typeof setRepoPolicy>) => {
    if (sending.current || offline) return;
    sending.current = true;
    setBusy(what);
    setNotice(undefined);
    const reply = await run();
    sending.current = false;
    setBusy(undefined);
    if (reply.kind !== "ok") {
      setNotice(failedText(what === "detect" ? "re-detect this repo" : "set the policy", replyText(reply)));
      return;
    }
    onUpdated(reply.body);
    if (what !== "detect") {
      setEditing(false);
      setTrusting(false);
      setSafe(false);
      setPick(undefined);
    }
  };

  const accept = () => {
    const body = proposal === null ? undefined : acceptBody(proposal);
    if (body === undefined) return;
    void write("accept", () => setRepoPolicy(api, policy.repo, body));
  };

  const setPicked = () => {
    if (pick === undefined) return;
    const body = presetBody(pick, reviews, trusting);
    if (body === undefined) return;
    void write("set", () => setRepoPolicy(api, policy.repo, body));
  };

  const redetect = () => void write("detect", () => detectRepoPolicy(api, policy.repo));

  /** A GitHub page, through the open-external channel: a `false` answer is a failure line, never a silent no-op. */
  const openPage = async (url: string | undefined, what: string) => {
    if (url === undefined) {
      setLinkFailure(`Studio can't make a safe link for this repo's name, so ${what} was not opened.`);
      return;
    }
    const opened = await openExternalUrl(api, url);
    setLinkFailure(opened ? undefined : `Studio couldn't open ${what} in your browser.`);
  };
  const settingsUrl = repoSettingsUrl(policy.repo);

  const noReviews = unenforceable || protection === "protection_unavailable";
  const showPresets = (isSet ? editing : true) && !safe && (!unenforceable || trusting);
  const proposed = !isSet && proposal !== null && proposal.kind !== null && !unenforceable;

  let sub: { readonly tone: string; readonly text: string } | undefined;
  if (isSet) sub = undefined;
  else if (safe) sub = { tone: "neutral", text: "safe mode" };
  else if (trusting) sub = { tone: "attention", text: "trusted · pick a policy" };
  else if (unenforceable) sub = { tone: "attention", text: "can't be protected" };
  else if (proposed) sub = { tone: "attention", text: "proposal waiting" };

  const footer = isSet
    ? "Policy set. Loomwright's gate takes only the PRs this policy lets through."
    : safe
      ? "Safe mode: nothing on this repo goes to Loomwright's gate."
      : unenforceable
        ? "No policy: PRs on this repo park until you choose one of the three ways above."
        : "No policy yet: PRs on this repo park until you accept one.";

  return (
    <section className="integrations-card" data-testid={IDS.policyCard} data-repo={policy.repo} data-state={isSet ? "set" : "none"}>
      <div className="integrations-card-head">
        <RepoGlyph />
        <h3>{policy.repo}</h3>
        {isSet ? (
          <span className="integrations-badge" data-tone="ok">
            policy set
          </span>
        ) : (
          <span className="integrations-badge" data-tone="parked" data-testid={IDS.policyNone}>
            No policy: PRs park
          </span>
        )}
        {sub === undefined ? null : (
          <span className="integrations-badge" data-tone={sub.tone}>
            {sub.text}
          </span>
        )}
      </div>

      <div className="integrations-card-body">
        <section className="integrations-sec" aria-label="On GitHub" data-testid={IDS.policyDetected}>
          <div className="integrations-sech">
            <h4 className="integrations-label">On GitHub</h4>
            <span className="integrations-cap">{detection === undefined ? "not read yet" : detection.read}</span>
            <span className="integrations-spacer" />
            <Button size="row" variant="ghost" icon={<RefreshGlyph />} loading={busy === "detect"} onClick={redetect} data-testid={IDS.policyRedetect} {...dis}>
              Re-detect
            </Button>
          </div>
          {detection === undefined ? (
            <p className="integrations-cap">Nothing has been read from GitHub for this repo yet. Press Re-detect.</p>
          ) : (
            <dl className="integrations-kv">
              {detection.lines.map((line) => (
                <div className="integrations-kv-row" key={line.label}>
                  <dt>{line.label}</dt>
                  <dd>
                    <span className={line.mono ? "integrations-mono" : undefined}>{line.value}</span>
                    <span className="integrations-badge" data-tone="neutral">
                      detected from GitHub
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {protection === "unprotected" ? (
            <p className="integrations-cap">
              Branch protection is missing on the default branch. Studio never changes it: to back a policy with GitHub, require status checks or at least 1 approving review on GitHub, then press Re-detect. Loomwright&apos;s gate won&apos;t go ahead on an unprotected branch, whatever the policy.
            </p>
          ) : null}
        </section>

        {isSet && !editing ? (
          <section className="integrations-sec" data-testid={IDS.policyCurrent}>
            <h4 className="integrations-label">Policy</h4>
            <dl className="integrations-kv">
              <div className="integrations-kv-row">
                <dt>Merge policy</dt>
                <dd>
                  <b>{policy.kind === null ? "" : policyWords(policy.kind, policy.required_reviews)}</b>
                  <span className="integrations-badge" data-tone="neutral">
                    {policy.set_by === null ? "set" : `set by ${policy.set_by}`}
                  </span>
                  {policy.set_at === null ? null : <span className="integrations-cap">{`set ${whenText(policy.set_at, now)}`}</span>}
                </dd>
              </div>
              {policy.trust_unprotected ? (
                <div className="integrations-kv-row">
                  <dt>Trusted</dt>
                  <dd>
                    <span>Unprotected, for this repo only</span>
                    <span className="integrations-cap">waives condition 4 and nothing else</span>
                  </dd>
                </div>
              ) : null}
            </dl>
            <p>{POLICY_PRESETS.find((preset) => preset.kind === policy.kind)?.blurb}</p>
            <p className="integrations-cap">A playbook may only be stricter than this.</p>
            <div>
              <Button size="row" variant="secondary" onClick={() => setEditing(true)} data-testid={IDS.policyChange} {...dis}>
                Change policy
              </Button>
            </div>
          </section>
        ) : null}

        {proposed && proposal !== null && proposal.kind !== null ? (
          <section className="integrations-sec" data-testid={IDS.policyProposal} data-kind={proposal.kind}>
            <h4 className="integrations-label">Proposal</h4>
            <p>
              <b>{policyWords(proposal.kind, proposal.required_reviews)}</b>
            </p>
            <p className="integrations-cap">Studio read this repo&apos;s protection and proposes this. Nothing is applied until you accept it below, or choose another.</p>
            <div>
              <Button variant="primary" loading={busy === "accept"} onClick={accept} data-testid={IDS.policyAccept} {...dis}>
                Accept proposal
              </Button>
            </div>
          </section>
        ) : null}

        {choices !== undefined && unenforceable && !isSet && !safe && !trusting ? (
          <section className="integrations-sec" data-testid={IDS.policyChoices}>
            <div className="integrations-inband" data-tone="attention" role="note">
              <b>GitHub can&apos;t enforce protection on this repo (a private repo on Free)</b>
              <span>GitHub refuses branch protection here, so Loomwright&apos;s gate has nothing to check and there is no proposal. Choose how to go on. Nothing is picked for you.</span>
            </div>
            <ul className="integrations-box" aria-label="Ways to go on">
              {choices.map((choice) =>
                choice === "make_public_or_upgrade" ? (
                  <li key={choice} data-choice={choice}>
                    <span>
                      <b>Make public or upgrade</b>
                      <span className="integrations-cap integrations-block">Change it on GitHub, then press Re-detect. Studio changes nothing there.</span>
                    </span>
                    <span className="integrations-spacer" />
                    <span className="integrations-links">
                      <a
                        className="integrations-link"
                        href={settingsUrl ?? "#"}
                        data-testid={IDS.policyMakePublic}
                        onClick={(event) => {
                          event.preventDefault();
                          void openPage(settingsUrl, "the repo's settings");
                        }}
                      >
                        <ExternalGlyph />
                        Make public on GitHub
                      </a>
                      <a
                        className="integrations-link"
                        href={BILLING_PLANS_URL}
                        data-testid={IDS.policyUpgrade}
                        onClick={(event) => {
                          event.preventDefault();
                          void openPage(BILLING_PLANS_URL, "GitHub's plans page");
                        }}
                      >
                        <ExternalGlyph />
                        Upgrade on GitHub
                      </a>
                    </span>
                  </li>
                ) : choice === "trust_unprotected" ? (
                  <li key={choice} data-choice={choice}>
                    <span>
                      <b>Trust this repo unprotected</b>
                      <span className="integrations-cap integrations-block">
                        Go on without protection. This is recorded, and passed to Loomwright as <span className="integrations-mono">--trust-unprotected</span> for this repo only.
                      </span>
                    </span>
                    <span className="integrations-spacer" />
                    <Button size="row" variant="secondary" onClick={() => setConfirmingTrust(true)} data-testid={IDS.policyTrust} {...dis}>
                      Trust unprotected…
                    </Button>
                  </li>
                ) : (
                  <li key={choice} data-choice={choice}>
                    <span>
                      <b>Safe mode</b>
                      <span className="integrations-cap integrations-block">/automate opens and fixes PRs here and stops before Loomwright&apos;s gate. Nothing is handed to the gate, so you decide each PR on GitHub yourself.</span>
                    </span>
                    <span className="integrations-spacer" />
                    <Button size="row" variant="secondary" onClick={() => setSafe(true)} data-testid={IDS.policySafe} {...dis}>
                      Use safe mode
                    </Button>
                  </li>
                ),
              )}
            </ul>
            {linkFailure === undefined ? null : (
              <p className="integrations-notice" data-tone="danger" role="alert" data-testid={IDS.policyLinkError}>
                {linkFailure}
              </p>
            )}
          </section>
        ) : null}

        {safe && !isSet ? (
          <section className="integrations-sec" data-testid={IDS.policySafeView}>
            <h4 className="integrations-label">Safe mode</h4>
            <p>
              /automate opens and fixes PRs here and stops before Loomwright&apos;s gate. Studio records nothing: the repo stays with no policy, so its PRs park, and nothing on it goes to the gate until you choose another way.
            </p>
            <div>
              <Button size="row" variant="secondary" onClick={() => setSafe(false)} data-testid={IDS.policySafeAgain}>
                Choose again
              </Button>
            </div>
          </section>
        ) : null}

        {trusting && !isSet ? (
          <section className="integrations-sec" data-testid={IDS.policyTrusting}>
            <h4 className="integrations-label">Trusting unprotected</h4>
            <p>You confirmed it. Nothing is saved yet: pick a policy below and press Set policy, and it is recorded with the trust for this repo only (condition 4 is waived, nothing else).</p>
            <div>
              <Button size="row" variant="secondary" onClick={() => setTrusting(false)}>
                Don&apos;t trust it
              </Button>
            </div>
          </section>
        ) : null}

        {showPresets ? (
          <section className="integrations-sec">
            <div className="integrations-sech">
              <h4 className="integrations-label">{isSet ? "Change policy" : "Policy"}</h4>
              <span className="integrations-cap">pick one; nothing is set until you press Set policy</span>
            </div>
            <fieldset className="integrations-presets">
              <legend className="integrations-sr-only">{`Merge policy for ${policy.repo}`}</legend>
              {POLICY_PRESETS.map((preset) => {
                const off = offline || (preset.kind === "reviews" && noReviews);
                return (
                  <div key={preset.kind} className="integrations-preset" data-on={pick === preset.kind ? "true" : undefined}>
                    <label>
                      <input type="radio" name={`policy-${policy.repo}`} value={preset.kind} checked={pick === preset.kind} disabled={off} onChange={() => setPick(preset.kind)} data-testid={IDS.policyPreset} data-kind={preset.kind} />
                      <span>
                        <b>{preset.label}</b>
                        <span className="integrations-cap integrations-block">
                          {preset.blurb}
                          {preset.kind === "reviews" && noReviews ? " GitHub can't enforce reviews on this repo, so this one is off." : ""}
                        </span>
                      </span>
                    </label>
                    {preset.kind === "reviews" && pick === "reviews" ? (
                      <TextField
                        label="GitHub reviews needed"
                        inputMode="numeric"
                        value={reviews}
                        placeholder="N"
                        error={reviews.trim() === "" ? undefined : nHint}
                        hint={nHint ?? "GitHub reviews needed before the PR goes on."}
                        disabled={offline}
                        onChange={(event) => setReviews(event.target.value)}
                        data-testid={IDS.policyReviews}
                      />
                    ) : null}
                  </div>
                );
              })}
            </fieldset>
            <div className="integrations-actions">
              {isSet ? (
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  Keep it as it is
                </Button>
              ) : null}
              <Button
                variant="primary"
                loading={busy === "set"}
                disabled={offline || pick === undefined || (pick === "reviews" && !reviewsValid(reviews))}
                title={offline ? "Needs the kernel" : undefined}
                onClick={setPicked}
                data-testid={IDS.policySet}
              >
                Set policy
              </Button>
            </div>
          </section>
        ) : null}

        {notice === undefined ? null : (
          <p className="integrations-notice" data-tone="danger" role="alert" data-testid={IDS.policyNotice}>
            {notice}
          </p>
        )}
      </div>

      <div className="integrations-card-foot">
        <span className="integrations-cap" role="status" data-testid={IDS.policyStatus}>
          {footer}
        </span>
      </div>

      {confirmingTrust ? (
        <Dialog
          kind="confirm"
          wide
          title={`Trust ${policy.repo} unprotected?`}
          description="GitHub can't protect this repo, so Loomwright's gate has nothing to check. Trusting it unprotected is your call, for this repo only."
          action={{
            label: "Trust unprotected",
            onAction: () => {
              setConfirmingTrust(false);
              setTrusting(true);
            },
          }}
          cancelLabel="Cancel"
          onCancel={() => setConfirmingTrust(false)}
        >
          <ul className="integrations-box" aria-label="What this waives and what it does not" data-testid={IDS.policyTrustConfirm}>
            <li>
              <span className="integrations-dot" data-state="waiting" aria-hidden="true" />
              <span>
                <b>Waives condition 4 only.</b> The gate&apos;s check that the branch has enforceable protection: a required review or required status checks.
              </span>
            </li>
            <li>
              <span className="integrations-dot" data-state="ok" aria-hidden="true" />
              <span>
                <b>Does not waive the high-risk park.</b> A PR Loomwright classifies as high-risk still parks for you, with or without this. Every other condition still applies.
              </span>
            </li>
            <li>
              <span className="integrations-dot" data-state="idle" aria-hidden="true" />
              <span>
                <b>Recorded.</b> Saved with the time and that you chose it, and passed to Loomwright as <span className="integrations-mono">--trust-unprotected</span> for this repo only.
              </span>
            </li>
          </ul>
        </Dialog>
      ) : null}
    </section>
  );
}

// ---- The pane ----------------------------------------------------------------------------------

export interface RepoPolicyPaneProps {
  readonly api: StudioBridge;
  readonly read: PolicyRead;
  readonly offline: boolean;
  readonly now: Date;
  readonly onUpdated: (policy: RepoPolicy) => void;
}

/** The "Repo policy" pane: the reached repos as chips, and the selected repo's card. Its read failing never touches the rest of the screen. */
export function RepoPolicyPane({ api, read, offline, now, onUpdated }: RepoPolicyPaneProps) {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const repo = read.repos.find((entry) => entry.repo === chosen) ?? read.repos[0];

  let body;
  if (read.phase === "idle" || read.phase === "loading") {
    body = (
      <div aria-busy="true">
        <p className="integrations-sr-only" role="status">
          Reading the repo policies…
        </p>
        <span className="integrations-skel integrations-skel-title" aria-hidden="true" />
        <span className="integrations-skel" aria-hidden="true" />
      </div>
    );
  } else if (repo === undefined && read.phase === "error") {
    body = (
      <div className="integrations-empty" data-testid={IDS.policyError}>
        <h2>Status unknown</h2>
        <p>{`Couldn't read the repo policies: ${read.error ?? "no answer"}`}</p>
      </div>
    );
  } else if (repo === undefined) {
    body = (
      <div className="integrations-empty" data-testid={IDS.policyEmpty}>
        <h2>No repos reached yet.</h2>
        <p>Each repo your GitHub App can reach gets a policy card here: what GitHub enforces, the policy Studio proposes, and the policy you set. Install the App on a repo and it appears.</p>
      </div>
    );
  } else {
    body = (
      <>
        <div className="integrations-dhead">
          <h2>Repo policy</h2>
          <span className="integrations-cap">{`${read.repos.length} ${read.repos.length === 1 ? "repo" : "repos"} reached`}</span>
        </div>
        <p className="integrations-cap">Per repo: what GitHub enforces, what Studio proposes, and the policy you set. Studio never changes branch protection.</p>
        {read.phase === "error" ? (
          <p className="integrations-notice" data-tone="danger" role="alert" data-testid={IDS.policyError}>
            {`Couldn't refresh the repo policies: ${read.error ?? "no answer"}`}
          </p>
        ) : null}
        <div className="integrations-chips" role="group" aria-label="Repos">
          {read.repos.map((entry) => (
            <button key={entry.repo} type="button" className="integrations-chip" aria-pressed={entry.repo === repo.repo} onClick={() => setChosen(entry.repo)} data-testid={IDS.policyChip} data-repo={entry.repo}>
              {entry.repo}
            </button>
          ))}
        </div>
        <RepoPolicyCard key={repo.repo} api={api} policy={repo} offline={offline} now={now} onUpdated={onUpdated} />
      </>
    );
  }

  return (
    <div className="integrations-detail" aria-label="Repo policy" data-testid={IDS.policy} data-state={read.phase}>
      {body}
    </div>
  );
}
