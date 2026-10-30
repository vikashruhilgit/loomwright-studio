// The connected GitHub App's detail pane (GitHub App 4): the mockup's
// `appDetailHTML()`, which is the token's pane with these differences. A
// `GitHub App` badge beside `read-only`; rows for the App, the installation and the
// key (kept in the Keychain, never shown); the access token's expiry with a "renews
// automatically" badge and no expiry band (the owner does nothing); permissions
// read "Read-only, checked by GitHub" with the list GitHub reported, never "declared
// by you"; "Repos chosen at install". There is no Replace token. Revoked on GitHub
// (`rejected`), the pane keeps the last-read data and Set up again is the primary.
//
// `Connector` carries no App name, so the App row shows the slug in the name's place
// (the mockup shows both). Every value from the kernel or GitHub is untrusted text.
import { useId } from "react";
import type { Connector, RosterEntry } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { INTEGRATIONS_TEST_IDS as IDS, type IntegrationsView as View, isOffline, permissionLines, whenText } from "./model";
import { CheckGlyph, GitHubMark, GrantSection, RefreshGlyph, RepoGlyph, WarnGlyph } from "./parts";
import "./integrations.css";

export interface AppDetailProps {
  readonly view: View;
  readonly row: Connector;
  readonly repos: { readonly repos: readonly string[]; readonly verifiedAt: string | null };
  readonly roster: readonly RosterEntry[] | undefined;
  readonly rosterError: boolean;
  readonly refreshing: boolean;
  readonly now: Date;
  /** Revoked on GitHub: starts the setup again. */
  readonly onSetUpAgain: () => void;
  readonly onDisconnect: () => void;
  readonly onRefresh: () => void;
}

export function AppDetail({ view, row, repos, roster, rosterError, refreshing, now, onSetUpAgain, onDisconnect, onRefresh }: AppDetailProps) {
  const ids = useId();
  const offline = isOffline(view);
  const revoked = view.state === "revoked";
  const dis = offline ? { disabled: true, title: "Needs the kernel" } : {};
  const verified = whenText(row.verified_at, now);
  const lines = permissionLines(row.permissions);
  // A level above Read is never called read-only: the kernel refuses such an App, so this is GitHub or the row contradicting itself.
  const writes = Object.values(row.permissions ?? {}).some((level) => level !== "read" && level !== "none");
  const stale = revoked || offline;
  const read = stale ? `last read ${verified}` : `read from GitHub ${verified}`;
  const slug = row.app_slug ?? "unknown";
  const installation = row.installation_id === null || row.installation_id === undefined ? "unknown" : String(row.installation_id);

  return (
    <div className="integrations-detail" aria-label="GitHub" data-testid={IDS.detail} data-state={view.state} data-method="app">
      <div className="integrations-dhead" data-testid={IDS.detailHeader}>
        <GitHubMark />
        <h2>GitHub</h2>
        <span className="integrations-badge" data-tone="neutral">
          read-only
        </span>
        <span className="integrations-badge" data-tone="neutral">
          GitHub App
        </span>
        <span className="integrations-spacer" />
        {revoked ? (
          <Button size="row" variant="primary" onClick={onSetUpAgain} data-testid={IDS.appSetUpAgain} {...dis}>
            Set up again
          </Button>
        ) : null}
        <Button size="row" variant="danger" onClick={onDisconnect} data-testid={IDS.disconnect} {...dis}>
          Disconnect
        </Button>
      </div>

      {revoked ? (
        <div className="integrations-inband" data-tone="danger" role="alert" data-testid={IDS.inBand}>
          <WarnGlyph />
          <span>GitHub no longer accepts this App. It may have been uninstalled, its key revoked, or the App deleted on GitHub. Playbooks that need GitHub are parked. Set the App up again to resume them.</span>
        </div>
      ) : null}

      <dl className="integrations-kv">
        <dt>Status</dt>
        <dd data-testid={IDS.status}>
          {offline ? (
            <span className="integrations-cap">{`Unknown while the kernel is unreachable · last verified ${verified}`}</span>
          ) : revoked ? (
            <>
              <span className="integrations-dot" data-state="danger" aria-hidden="true" />
              rejected
              <span className="integrations-cap">{`GitHub refused the App's key ${whenText(row.updated_at, now)}`}</span>
            </>
          ) : (
            <>
              <span className="integrations-dot" data-state={row.status === "connected" ? "ok" : row.status === "expiring" ? "waiting" : "danger"} aria-hidden="true" />
              {row.status}
              <span className="integrations-cap">{`verified ${verified}`}</span>
            </>
          )}
        </dd>
        <dt>Account</dt>
        <dd>
          <span className="integrations-mono" data-testid={IDS.account}>
            {row.account_login ?? "unknown"}
          </span>
        </dd>
        <dt>App</dt>
        <dd>
          <span className="integrations-mono" data-testid={IDS.appName}>
            {slug}
          </span>
        </dd>
        <dt>Installation</dt>
        <dd>
          <span className="integrations-mono" data-testid={IDS.appInstallation}>
            {installation}
          </span>
        </dd>
        <dt>Key</dt>
        <dd data-testid={IDS.appKey}>
          <span>Kept in the Keychain. The value is never shown.</span>
        </dd>
        <dt>Access token</dt>
        <dd data-testid={IDS.appAccess}>
          {revoked ? (
            <span>None: GitHub refused the App&apos;s key</span>
          ) : (
            <>
              <span>{`${offline ? "last known: expires" : "expires"} ${whenText(row.expires_at, now)}`}</span>
              <span className="integrations-badge" data-tone="neutral">
                renews automatically
              </span>
            </>
          )}
        </dd>
      </dl>

      <section className="integrations-sec" aria-labelledby={`${ids}-perm`}>
        <div className="integrations-sech">
          <h3 className="integrations-label" id={`${ids}-perm`}>
            Permissions
          </h3>
          <span className="integrations-cap">{stale ? read : `checked by GitHub ${verified}`}</span>
        </div>
        {writes ? (
          <p className="integrations-refusal" role="alert">
            GitHub reports a permission above Read on this App. Studio takes only read-only access.
          </p>
        ) : (
          <p data-testid={IDS.appChecked}>
            <b>Read-only</b>, {stale ? "as last checked by GitHub" : "checked by GitHub"}.
          </p>
        )}
        {lines.length === 0 ? (
          <p className="integrations-cap">No permissions reported.</p>
        ) : (
          <ul className="integrations-perm" data-testid={IDS.permissions}>
            {lines.map((p) => (
              <li key={p.label}>
                <CheckGlyph />
                <b>{p.label}</b>
                <span className="integrations-level">{p.level}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="integrations-cap">If GitHub ever reports a write permission on the App, Studio refuses it.</p>
      </section>

      <section className="integrations-sec" aria-labelledby={`${ids}-repos`}>
        <div className="integrations-sech">
          <h3 className="integrations-label" id={`${ids}-repos`} data-testid={IDS.reposHeading}>
            {`Repos chosen at install · ${repos.repos.length}`}
          </h3>
          <span className="integrations-cap">{stale ? `last read ${whenText(repos.verifiedAt, now)}` : `read from GitHub ${whenText(repos.verifiedAt, now)}`}</span>
          <span className="integrations-spacer" />
          <Button size="row" variant="ghost" icon={<RefreshGlyph />} loading={refreshing} onClick={onRefresh} data-testid={IDS.refresh} {...dis}>
            Refresh
          </Button>
        </div>
        {repos.repos.length === 0 ? (
          <p className="integrations-cap">No repos were chosen at install.</p>
        ) : (
          <ul className="integrations-box" data-testid={IDS.repos}>
            {repos.repos.map((name) => (
              <li key={name}>
                <RepoGlyph />
                <span className="integrations-mono">{name}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="integrations-cap">Exactly the repos you chose when you installed the App. A poll trigger can name only these. To change them, edit the installation on GitHub, then Refresh.</p>
      </section>

      <GrantSection roster={roster} rosterError={rosterError} />
    </div>
  );
}
