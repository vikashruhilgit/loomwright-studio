// A playbook's version history (phase 7 item 04): the versions newest first, and
// what the picked one changed against the one before it, read-only. A snapshot is
// partial (an older one lacks a column), so a field a snapshot does not carry is
// listed as unrecorded, never shown as a change to or from a guessed value.
import { useState } from "react";
import type { PlaybookListing, PlaybookVersion } from "../../api/contract";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { when } from "../chat/model";
import { Crumb } from "./PlaybookDetail";
import { Skeleton } from "./parts";
import { PLAYBOOKS_TEST_IDS as IDS, UNKNOWN, safe, versionActors, versionChanges, versionFieldLabel } from "./model";
import type { Read } from "./useHistory";

export interface PlaybookHistoryProps {
  readonly playbook: PlaybookListing;
  readonly versions: Read<readonly PlaybookVersion[]> & { readonly refetch: () => void };
  readonly onBack: () => void;
}

function changeCount(n: number): string {
  return `${n} ${n === 1 ? "field" : "fields"} changed`;
}

function VersionDiff({ version, previous, slug }: { readonly version: PlaybookVersion; readonly previous: PlaybookVersion | undefined; readonly slug: string }) {
  const { created, changes, unrecorded } = versionChanges(version, previous);
  const by = versionActors(version, changes);
  return (
    <div className="pb-block" data-testid={IDS.versionDiff} data-version={version.version}>
      <div className="pb-inspector-head">
        <h3>{`${created ? "Created as" : "Changes in"} v${version.version}`}</h3>
        <span className="pb-cap">{`${by === "" ? "" : `by ${by} · `}${when(version.created_at)}`}</span>
      </div>
      <div className="pb-diff" role="group" aria-label={`playbook_versions, ${slug}, v${version.version}`}>
        <div className="pb-diff-head pb-cap">{`playbook_versions · v${version.version}`}</div>
        {changes.length === 0 ? (
          <p className="pb-diff-empty">No field changed in this version.</p>
        ) : (
          changes.map((change) => (
            <div key={change.field}>
              {created ? null : (
                <div className="pb-diff-line" data-kind="del">
                  <span aria-hidden="true">−</span>
                  <span>
                    <span className="pb-vh">removed: </span>
                    {`${versionFieldLabel(change.field)}: ${change.from}`}
                  </span>
                </div>
              )}
              <div className="pb-diff-line" data-kind="add">
                <span aria-hidden="true">+</span>
                <span>
                  <span className="pb-vh">added: </span>
                  {`${versionFieldLabel(change.field)}: ${change.to}`}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
      {unrecorded.length === 0 ? null : (
        <p className="pb-cap">{`Not recorded in ${created ? "this snapshot" : "this or the version before"} (${UNKNOWN}): ${unrecorded.map(versionFieldLabel).join(", ")}.`}</p>
      )}
      <p className="pb-cap">Older versions are read-only. To go back, change the fields or ask Wright; that writes a new version.</p>
    </div>
  );
}

export function PlaybookHistory({ playbook, versions, onBack }: PlaybookHistoryProps) {
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const list = versions.data;
  const selected = list === undefined ? undefined : (list.find((v) => v.version === picked) ?? list[0]);
  const selectedIndex = list === undefined || selected === undefined ? -1 : list.indexOf(selected);
  return (
    <div className="pb-main" data-testid={IDS.historyView}
      data-playbook={playbook.id}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) onBack();
      }}
    >
      <Crumb label="Playbook" name={safe(playbook.name)} onBack={onBack} />
      <div className="pb-head">
        <h2>Version history</h2>
        {list === undefined ? null : <Badge>{`${list.length} ${list.length === 1 ? "version" : "versions"}`}</Badge>}
        <span className="pb-cap pb-mono">{safe(playbook.slug)}</span>
      </div>
      {list === undefined ? (
        versions.failed ? (
          <div className="pb-fail" role="alert">
            <h2>Couldn't load the versions</h2>
            <p>The kernel did not answer the versions request. Nothing on this screen was changed.</p>
            <div className="pb-fail-actions">
              <Button variant="secondary" size="standalone" onClick={versions.refetch}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <div aria-busy="true">
            <span className="pb-vh" role="status">
              Loading versions
            </span>
            <Skeleton rows={3} />
          </div>
        )
      ) : list.length === 0 ? (
        <p className="pb-cap">The kernel has no version recorded for this playbook.</p>
      ) : (
        <div className="pb-history">
          <div className="pb-versions" role="listbox" aria-label="Versions" data-nav-group="" data-testid={IDS.versionList}>
            {list.map((version, i) => {
              const older = list[i + 1];
              const { created, changes } = versionChanges(version, older);
              return (
                <button
                  key={version.version}
                  type="button"
                  role="option"
                  className="pb-version"
                  aria-selected={selected === version}
                  data-nav=""
                  data-testid={IDS.version}
                  data-version={version.version}
                  onClick={() => setPicked(version.version)}
                  onFocus={() => setPicked(version.version)}
                >
                  <span className="pb-version-text">
                    <span className="pb-version-title">
                      {`v${version.version}`}
                      {version.version === playbook.version ? <Badge tone="ok">current</Badge> : null}
                    </span>
                    <span className="pb-cap pb-tn">{`${when(version.created_at)} · ${created ? "created" : changeCount(changes.length)}`}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {selected === undefined ? null : <VersionDiff version={selected} previous={list[selectedIndex + 1]} slug={safe(playbook.slug)} />}
        </div>
      )}
    </div>
  );
}
