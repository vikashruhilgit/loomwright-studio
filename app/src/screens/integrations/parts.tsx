// Marks and sections the Integrations screen's two detail panes share (the token's
// `TokenDetail` in `IntegrationsView.tsx` and the App's `AppDetail`): the glyphs,
// and the "Agents with the GitHub grant" section. Every string from the kernel
// (agent names, models) is untrusted text, rendered as a React text child.
import { type ReactNode, useId } from "react";
import type { RosterEntry, StudioBridge } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import { memberHash } from "../team/model";
import { openExternalUrl } from "./actions";
import { GITHUB_APPS_TEXT, appPageUrl } from "./app-setup";
import { INTEGRATIONS_TEST_IDS as IDS, grantedAgents, ungrantedNote } from "./model";
import "./integrations.css";

export function GitHubMark() {
  return (
    <svg className="integrations-mark" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

function Glyph({ children }: { readonly children: ReactNode }) {
  return (
    <svg className="integrations-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const WarnGlyph = () => (
  <Glyph>
    <path d="M12 8v5M12 16h.01M4.9 19h14.2a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0L3.2 16a2 2 0 0 0 1.7 3Z" />
  </Glyph>
);
export const CheckGlyph = () => (
  <Glyph>
    <path d="m5 12 5 5L20 7" />
  </Glyph>
);
export const RepoGlyph = () => (
  <Glyph>
    <path d="M4 19.5V5a2 2 0 0 1 2-2h14v14H6.5a2.5 2.5 0 0 0 0 5H20" />
  </Glyph>
);
export const RefreshGlyph = () => (
  <Glyph>
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5" />
  </Glyph>
);

export const ExternalGlyph = () => (
  <Glyph>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Glyph>
);

/**
 * A link to a GitHub page. The window can't open it (the main process denies every
 * window open and navigation), so the click is handed to the open-external channel
 * and the browser never navigates; the channel re-checks the address against its allowlist.
 */
export function ExternalLink({ api, url, testId, children }: { readonly api: StudioBridge; readonly url: string; readonly testId?: string; readonly children: ReactNode }) {
  return (
    <a
      className="integrations-link"
      href={url}
      data-testid={testId}
      onClick={(event) => {
        event.preventDefault();
        void openExternalUrl(api, url);
      }}
    >
      <ExternalGlyph />
      {children}
    </a>
  );
}

/**
 * "Open your GitHub Apps": the App's own page when its slug is known (the one App page the channel allows), else
 * the address as text to copy, because the bare GitHub Apps page is not on the allowlist.
 */
export function AppsPageLink({ api, slug, testId }: { readonly api: StudioBridge; readonly slug: string | undefined; readonly testId?: string }) {
  const url = appPageUrl(slug);
  if (url !== undefined) {
    return (
      <ExternalLink api={api} url={url} testId={testId}>
        Open your GitHub Apps
      </ExternalLink>
    );
  }
  return (
    <p className="integrations-cap" data-testid={testId}>
      Your GitHub Apps are at <span className="integrations-mono">{GITHUB_APPS_TEXT}</span>
    </p>
  );
}

export interface GrantSectionProps {
  /** `undefined` until the roster is read. */
  readonly roster: readonly RosterEntry[] | undefined;
  readonly rosterError: boolean;
}

/** The agents the roster says hold GitHub, and who does not: the same for a token and for an App. */
export function GrantSection({ roster, rosterError }: GrantSectionProps) {
  const id = useId();
  const granted = roster === undefined ? undefined : grantedAgents(roster);
  const others = roster === undefined ? undefined : ungrantedNote(roster);
  return (
    <section className="integrations-sec" aria-labelledby={`${id}-grant`}>
      <div className="integrations-sech">
        <h3 className="integrations-label" id={`${id}-grant`}>
          {granted === undefined ? "Agents with the GitHub grant" : `Agents with the GitHub grant · ${granted.length}`}
        </h3>
      </div>
      {granted === undefined ? (
        <p className="integrations-cap" data-testid={IDS.agentsNote}>
          {rosterError ? "Couldn't read the team." : "Reading the team…"}
        </p>
      ) : (
        <>
          {granted.length === 0 ? null : (
            <div className="integrations-cards" data-testid={IDS.agents}>
              {granted.map((agent) => (
                <a key={agent.id} className="integrations-agent" href={memberHash(agent.id)} data-testid={IDS.agentCard} data-agent-id={agent.id}>
                  <Avatar agent={{ id: agent.id, name: agent.display_name, shape: agent.avatar.shape, hue: agent.avatar.hue }} state="idle" size={36} />
                  <span className="integrations-agent-text">
                    <span className="integrations-agent-name">{agent.display_name}</span>
                    <span className="integrations-cap">{agent.model ?? "model not reported"}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
          <p className="integrations-cap" data-testid={IDS.agentsNote}>
            {`${granted.length === 0 ? "No agent has it. " : others === undefined ? "" : `${others} `}The grant is set per agent in Team.`}
          </p>
        </>
      )}
    </section>
  );
}
