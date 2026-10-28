// The inspector's Connectors row (phase 6 item 08): whether the owner granted
// this agent GitHub, the connector's own state, and the one button that grants
// or revokes it. The grant is `connectors` on the agent's settings file, read
// from the roster (`RosterEntry.connectors`); the connector's state is
// `GET /connectors`, read by the screen. Both come in as props.
//
// The button and the ⌘K command call the same `changeGithubGrant`, which posts
// `{field: "connectors", value}` to `POST /agents/:id/set`. Nothing here edits
// the row: it changes only when the feed's `agent_*` event refetches the
// roster, as with every other Team write. The grant is allowed while GitHub is
// not connected (the kernel never reads the connector to decide it), which is
// why the state is shown beside it. Every string is a React text child.
import type { StudioBridge } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { setAgentConnectors } from "./actions";
import { type ConnectorsState, connectorStateText } from "./model";

/** What the owner asked for: give the agent GitHub, or take it away. */
export type GrantChange = "grant" | "revoke";

/** The result of one grant or revoke, in words: the owner's route answered, or refused. */
export interface GrantOutcome {
  readonly ok: boolean;
  readonly text: string;
}

/** The grant words in the row: unknown when the roster did not report the agent's `connectors`. */
export const GRANT_WORDS = { granted: "granted", notGranted: "not granted", unknown: "grant unknown" } as const;

/**
 * Grant or revoke GitHub for `agent` through `POST /agents/:id/set`. The one
 * call both the Connectors button and the ⌘K commands make.
 */
export async function changeGithubGrant(api: StudioBridge, agent: { readonly id: string; readonly display_name: string }, change: GrantChange): Promise<GrantOutcome> {
  const outcome = await setAgentConnectors(api, agent.id, change === "grant" ? "github" : "none");
  if (!outcome.ok) return { ok: false, text: outcome.message };
  if (change === "grant") return { ok: true, text: outcome.body.changed ? `GitHub granted to ${agent.display_name}.` : `${agent.display_name} already has GitHub.` };
  return { ok: true, text: outcome.body.changed ? `GitHub revoked from ${agent.display_name}.` : `${agent.display_name} already has no GitHub.` };
}

export interface ConnectorsProps {
  /** The roster's read of the grant: true, false, or undefined when unknown. */
  readonly granted: boolean | undefined;
  /** `GET /connectors`, as the screen holds it. */
  readonly state: ConnectorsState;
  readonly busy: boolean;
  readonly onChange: (change: GrantChange) => void;
}

export function Connectors({ granted, state, busy, onChange }: ConnectorsProps) {
  const grantWords = granted === undefined ? GRANT_WORDS.unknown : granted ? GRANT_WORDS.granted : GRANT_WORDS.notGranted;
  return (
    <>
      <dl className="team-insp-kv" data-testid="team-connector-github">
        <dt>GitHub</dt>
        <dd>
          <span data-testid="team-connector-grant">{grantWords}</span>
          {" · "}
          <span data-testid="team-connector-state">{connectorStateText(state)}</span>
        </dd>
      </dl>
      {granted === undefined ? null : granted ? (
        <Button className="team-insp-conn-action" size="row" variant="ghost" loading={busy} onClick={() => onChange("revoke")}>
          Revoke
        </Button>
      ) : (
        <Button className="team-insp-conn-action" size="row" variant="secondary" loading={busy} onClick={() => onChange("grant")}>
          Grant GitHub
        </Button>
      )}
    </>
  );
}
