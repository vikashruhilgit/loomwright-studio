// The GitHub App's "needs new permissions" upgrade (phase 8, `docs/design/mockups/phase-8.html` `appPane`), mounted by
// `AppDetail` above the connected App's pane while the App row reads `needs_permissions`. It states what is waiting
// (the App holds fewer permissions than Studio now asks for; reads keep working), and "Accept on GitHub" opens exactly the
// address `GET /connectors/github/app/upgrade` returned: the renderer never builds that URL, and the main process's
// open-external channel opens only an address the kernel answered. Nothing changes until GitHub reports the new set: the
// pane leaves when a later `GET /connectors` reads the App row `connected` (the screen re-reads on every
// `connector_status` event, and "Check now" re-reads at once).
//
// It also states that session tokens stay down-scoped (D39: the App may hold every permission, a session's token is cut
// down to Pull requests, Contents, Issues and Checks). The kernel's address is untrusted text.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { StudioBridge } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { openExternalUrl, readUpgrade } from "./actions";
import { INTEGRATIONS_TEST_IDS as IDS, SESSION_TOKEN_PERMISSIONS, replyText } from "./model";
import { CheckGlyph, ExternalGlyph, WarnGlyph } from "./parts";
import "./integrations.css";

export interface AppUpgradeProps {
  readonly api: StudioBridge;
  /** The kernel cannot be asked: Accept and Check now wait. */
  readonly offline: boolean;
  /** "Check now": the screen re-reads `GET /connectors`. */
  readonly onCheck: () => void;
}

type AddressRead =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly url: string | null }
  | { readonly phase: "error"; readonly text: string };

export function AppUpgrade({ api, offline, onCheck }: AppUpgradeProps) {
  const id = useId();
  const [address, setAddress] = useState<AddressRead>({ phase: "loading" });
  const [openFailed, setOpenFailed] = useState(false);
  const generation = useRef(0);
  const opening = useRef(false);

  const read = useCallback(() => {
    generation.current += 1;
    const mine = generation.current;
    void readUpgrade(api).then((reply) => {
      if (generation.current !== mine) return;
      if (reply.kind !== "ok") {
        setAddress({ phase: "error", text: replyText(reply) });
        return;
      }
      const url: unknown = reply.body.url;
      setAddress({ phase: "ready", url: typeof url === "string" && url !== "" ? url : null });
    });
  }, [api]);

  useEffect(() => {
    read();
    return () => {
      // The answer in flight is dropped once the pane goes away.
      generation.current += 1;
    };
  }, [read]);

  const url = address.phase === "ready" ? address.url : null;

  const accept = async () => {
    if (url === null || opening.current) return;
    opening.current = true;
    setOpenFailed(false);
    const opened = await openExternalUrl(api, url);
    opening.current = false;
    // The channel refused the address (or could not open it): never a silent no-op.
    if (!opened) setOpenFailed(true);
  };

  const check = () => {
    setOpenFailed(false);
    onCheck();
    read();
  };

  const dis = offline ? { disabled: true, title: "Needs the kernel" } : {};

  return (
    <section className="integrations-sec" aria-labelledby={`${id}-head`} data-testid={IDS.upgrade}>
      <div className="integrations-inband" data-tone="attention" role="status">
        <WarnGlyph />
        <span>This App holds fewer permissions than Studio now asks for. Reads keep working. A live playbook can&apos;t act on GitHub until you accept the new permissions on github.com, and nothing changes until GitHub reports them.</span>
      </div>
      <div className="integrations-sech">
        <h3 className="integrations-label" id={`${id}-head`}>
          Needs new permissions
        </h3>
        <span className="integrations-badge" data-tone="attention">
          Needs new permissions
        </span>
        <span className="integrations-spacer" />
        <Button size="row" variant="primary" icon={<ExternalGlyph />} disabled={offline || url === null} title={offline ? "Needs the kernel" : undefined} onClick={() => void accept()} data-testid={IDS.upgradeAccept}>
          Accept on GitHub
        </Button>
        <Button size="row" variant="ghost" onClick={check} data-testid={IDS.upgradeCheck} {...dis}>
          Check now
        </Button>
      </div>
      {address.phase === "error" ? (
        <p className="integrations-notice" data-tone="danger" role="alert" data-testid={IDS.upgradeError}>
          {`Couldn't read where to accept the new permissions: ${address.text}`}
        </p>
      ) : null}
      {address.phase === "ready" && address.url === null ? (
        <p className="integrations-cap" data-testid={IDS.upgradeError}>
          The kernel has no address to accept at right now. Press Check now to ask again.
        </p>
      ) : null}
      {url === null ? null : (
        <dl className="integrations-kv">
          <dt>Accept at</dt>
          <dd>
            <span className="integrations-mono" data-testid={IDS.upgradeAddress}>
              {url}
            </span>
            <span className="integrations-cap">the address the kernel gives Studio</span>
          </dd>
        </dl>
      )}
      {openFailed ? (
        <p className="integrations-notice" data-tone="danger" role="alert" data-testid={IDS.upgradeError}>
          Studio couldn&apos;t open that address in your browser. Nothing changed on GitHub.
        </p>
      ) : null}
      <h3 className="integrations-label">Session tokens are down-scoped</h3>
      <p data-testid={IDS.upgradeScope}>
        The App may hold every permission, but a session never gets them all. Each session token is cut down to <b>Pull requests, Contents, Issues and Checks</b>, and to the repos that session works on. The App&apos;s key stays in the Keychain. Merging stays with Loomwright&apos;s gate.
      </p>
      <ul className="integrations-perm" aria-label="What a session token holds">
        {SESSION_TOKEN_PERMISSIONS.map((permission) => (
          <li key={permission}>
            <CheckGlyph />
            <b>{permission}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}
