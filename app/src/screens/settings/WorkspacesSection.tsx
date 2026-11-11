// Settings → Workspaces (phase 8 item 18c), built to the approved mockup (`docs/design/mockups/charter-card.html`,
// `settingsScreen`, the views `settings-workspaces`, `settings-removed`, `settings-empty`, `settings-loading` and
// `settings-error`) and `docs/DESIGN.md` §"Settings → Workspaces (18c)": the kernel's one list of the owner's saved repo
// folders, as a table of repo, path (from `~`) and last used, with a remove icon on each row and Add folder….
//
// Data. `GET /workspaces` is read on mount and again when the kernel answers after being unreachable; every read is the
// kernel's fresh re-read of each folder, so a row's state is now: a `missing` row says "Missing" and an `unreadable` one
// "Can't be read", in words. While the kernel is unreachable the last list stays, and Add, remove and Undo are disabled.
//
// Writes go through the owner's routes only (the bearer token is the main process's): `POST /workspaces {path}` saves a
// folder (Add folder…, and Undo), `POST /workspaces/:id/remove` forgets one row. Remove never touches the folder on
// disk or any crew member's settings file. Undo saves the same path again, so its last used becomes now and it gets a
// new id: an honest limit, and the removed row says so. A refusal (a macOS-protected folder, D31; a folder that is not
// a git checkout; one that can't be read) and the note for a folder with no GitHub remote are the kernel's own plain
// sentences, shown as text with the owner's home read as `~`.
//
// The folder picker is the bridge's `chooseFolder()` (`studio:choose-folder`): the main process opens the dialog and
// answers a path or `null`. The renderer never reads the disk. A bridge without the member (a test fake) has no Add
// folder. There is no text input here (Settings has none, invariants 6 and 7). Every kernel string passes through
// `safe` and renders as a React text child.
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { ApiRequest, RemoveWorkspaceResponse, SaveWorkspaceResponse, SavedWorkspacesResponse, StudioBridge } from "../../api/contract";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { formatHomePath } from "../../shell/home-path";
import { useHomeDir } from "../../shell/useHomeDir";
import { type Reply, failureDetail, replyOf, timelineTime } from "../schedules/model";
import { isRecord, safe } from "./model";
import { Skeleton, WarnGlyph } from "./parts";

/** The ids the unit tests and the e2e spec target (the e2e project can't import a `.tsx`, so it repeats the strings it uses). */
export const WORKSPACES_TEST_IDS = {
  section: "settings-workspaces",
  loading: "settings-workspaces-loading",
  unknown: "settings-workspaces-unknown",
  error: "settings-workspaces-error",
  errorDetail: "settings-workspaces-error-detail",
  retry: "settings-workspaces-retry",
  empty: "settings-workspaces-empty",
  table: "settings-workspaces-table",
  row: "settings-workspaces-row",
  repo: "settings-workspaces-repo",
  path: "settings-workspaces-path",
  state: "settings-workspaces-state",
  used: "settings-workspaces-used",
  remove: "settings-workspaces-remove",
  gone: "settings-workspaces-gone",
  undo: "settings-workspaces-undo",
  add: "settings-workspaces-add",
  notice: "settings-workspaces-notice",
  live: "settings-workspaces-live",
} as const;

const IDS = WORKSPACES_TEST_IDS;

/** One saved workspace as the section holds it: the contract's fields, every string already inert. */
export interface WorkspaceRow {
  readonly id: number;
  readonly path: string;
  readonly repo: string | null;
  readonly lastUsedAt: string;
  /** `ready`, `missing`, `unreadable`, or a word this build does not know, kept as inert text. */
  readonly state: string;
}

/** A row from the kernel, field by field, or `undefined` when it is not the contract's shape. */
function rowOf(raw: unknown): WorkspaceRow | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, path, repo, last_used_at: lastUsed, state } = raw;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || typeof path !== "string" || path === "") return undefined;
  if (repo !== null && typeof repo !== "string") return undefined;
  return { id, path: safe(path), repo: repo === null ? null : safe(repo), lastUsedAt: typeof lastUsed === "string" ? lastUsed : "", state: typeof state === "string" ? safe(state) : "" };
}

/** `GET /workspaces`'s rows, or `undefined` when the body is not a list of them. A row that is not the shape is dropped. */
export function parseWorkspaces(body: unknown): WorkspaceRow[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.workspaces)) return undefined;
  return body.workspaces.flatMap((raw: unknown) => {
    const row = rowOf(raw);
    return row === undefined ? [] : [row];
  });
}

/** A saved row's state in words: nothing for `ready`, "Missing", "Can't be read", or the kernel's own word. */
export function stateWords(state: string): string | undefined {
  if (state === "ready") return undefined;
  if (state === "missing") return "Missing";
  if (state === "unreadable") return "Can't be read";
  return state === "" ? "Unknown" : state;
}

/** The Last used column: "Today, 09:40" on `now`'s day, else "2 Oct" (local time); a time that does not parse as it came. */
export function lastUsedLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay ? `Today, ${timelineTime(iso, now)}` : timelineTime(iso, now);
}

/**
 * A kernel sentence (a refusal's `message`, an add's `note`) for the owner: inert, a leading folder path read from `~`,
 * and closed with a full stop. The kernel's sentences start with the path they are about.
 */
export function plainSentence(text: string, paths: readonly string[], home: string | undefined): string {
  let words = safe(text).trim();
  for (const path of paths) {
    if (path !== "" && words.startsWith(path)) {
      words = `${formatHomePath(path, home)}${words.slice(path.length)}`;
      break;
    }
  }
  return /[.!?]$/.test(words) ? words : `${words}.`;
}

/** A line under the list: a refusal or note (attention), a failure (danger), or plain news (neutral). */
interface Notice {
  readonly tone: "attention" | "danger" | "neutral";
  readonly text: string;
}

/** A row the owner removed, kept in its place with Undo until undone or the section goes away. */
interface Gone {
  readonly row: WorkspaceRow;
  readonly index: number;
}

/** The list as shown: the kernel's rows with the removed ones put back at their places. */
type Shown = { readonly kind: "row"; readonly row: WorkspaceRow } | { readonly kind: "gone"; readonly row: WorkspaceRow };

export function withGone(rows: readonly WorkspaceRow[], gone: ReadonlyMap<number, Gone>): Shown[] {
  const shown: Shown[] = rows.filter((r) => !gone.has(r.id)).map((row) => ({ kind: "row", row }));
  for (const { row, index } of [...gone.values()].sort((a, b) => a.index - b.index)) shown.splice(Math.min(index, shown.length), 0, { kind: "gone", row });
  return shown;
}

async function send<R>(api: StudioBridge, request: ApiRequest): Promise<Reply<R>> {
  try {
    return replyOf(await api.request<R>(request));
  } catch {
    return replyOf<R>(undefined);
  }
}

/** Why a write failed, in words: the kernel's refusal sentence (attention), or what went wrong (danger). */
function writeFailure(what: string, request: string, reply: Exclude<Reply<unknown>, { readonly kind: "ok" }>, paths: readonly string[], home: string | undefined): Notice {
  if (reply.kind === "unreachable") return { tone: "danger", text: `${what}: the kernel could not be reached. Nothing was changed.` };
  if (reply.kind === "refused" && reply.status === 400 && reply.message !== undefined) return { tone: "attention", text: `${what}. ${plainSentence(reply.message, paths, home)}` };
  return { tone: "danger", text: `${what}: ${failureDetail(request, reply)}.` };
}

const ICON = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** Lucide `trash-2` (remove). Decorative: the button's name says what it does. */
const TrashIcon = () => (
  <svg {...ICON} className="settings-ws-icon">
    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6" />
  </svg>
);

/** Lucide `folder` (Add folder…, the empty state). */
const FolderIcon = () => (
  <svg {...ICON} className="settings-ws-icon">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
);

/** `Esc` hides a shown tooltip until the pointer or focus leaves the button (WCAG 1.4.13). */
function hideTip(event: KeyboardEvent<HTMLButtonElement>): void {
  if (event.key === "Escape") event.currentTarget.dataset.tipHidden = "true";
}
function showTipAgain(event: { readonly currentTarget: HTMLButtonElement }): void {
  delete event.currentTarget.dataset.tipHidden;
}

export interface WorkspacesSectionProps {
  readonly api: StudioBridge;
  /** The kernel is unreachable (the screen's own flag): nothing is read or written, and the held list stays. */
  readonly offline: boolean;
}

export function WorkspacesSection({ api, offline }: WorkspacesSectionProps) {
  const home = useHomeDir(api);
  const [rows, setRows] = useState<readonly WorkspaceRow[] | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [unreachable, setUnreachable] = useState(false);
  const [gone, setGone] = useState<ReadonlyMap<number, Gone>>(new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const [live, setLive] = useState("");
  const section = useRef<HTMLElement>(null);
  const focusNext = useRef<string | undefined>(undefined);
  const round = useRef(0);
  const mounted = useRef(true);
  // The writes in flight, by key: a second click (a double-click, Enter held) on the same control sends nothing. A ref,
  // not state, so two clicks inside one render are refused too.
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      round.current += 1;
    };
  }, []);

  const read = useCallback(async () => {
    round.current += 1;
    const mine = round.current;
    const reply = await send<SavedWorkspacesResponse>(api, { method: "GET", path: "/workspaces" });
    if (round.current !== mine) return;
    if (reply.kind === "unreachable") {
      setUnreachable(true);
      return;
    }
    setUnreachable(false);
    if (reply.kind !== "ok") {
      setFailure(failureDetail("GET /workspaces", reply));
      return;
    }
    const parsed = parseWorkspaces(reply.body);
    if (parsed === undefined) {
      setFailure("GET /workspaces · the answer is not a list of saved workspaces");
      return;
    }
    setFailure(undefined);
    setRows(parsed);
  }, [api]);

  useEffect(() => {
    if (!offline) void read();
  }, [offline, read]);

  // Focus moves somewhere explicit after an action: to Undo after a remove, to the row's remove icon after an Undo.
  useEffect(() => {
    const target = focusNext.current;
    if (target === undefined) return;
    const el = section.current?.querySelector<HTMLElement>(target);
    if (el !== null && el !== undefined) {
      el.focus();
      focusNext.current = undefined;
    }
  });

  /** Marks `key` in flight; `false` (and nothing marked) when it already is. */
  const begin = (key: string): boolean => {
    if (inflight.current.has(key)) return false;
    inflight.current.add(key);
    setBusy((prev) => new Set(prev).add(key));
    return true;
  };
  const end = (key: string): void => {
    inflight.current.delete(key);
    setBusy((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  /** The kernel's answer to a save, put first (it is the most recently used) before the next read confirms it. */
  const placeSaved = (saved: unknown): WorkspaceRow | undefined => {
    const row = isRecord(saved) ? rowOf(saved.workspace) : undefined;
    if (row !== undefined) setRows((prev) => [row, ...(prev ?? []).filter((r) => r.id !== row.id)]);
    return row;
  };

  /** `POST /workspaces {path}`: the shared write of Add folder… and Undo. */
  const save = async (path: string): Promise<Reply<SaveWorkspaceResponse>> => send<SaveWorkspaceResponse>(api, { method: "POST", path: "/workspaces", body: { path } });

  const add = async (): Promise<void> => {
    if (offline || api.chooseFolder === undefined || !begin("add")) return;
    try {
      let chosen: string | null;
      try {
        chosen = await api.chooseFolder();
      } catch {
        if (mounted.current) setNotice({ tone: "danger", text: "Couldn't open the folder picker. Nothing was changed." });
        return;
      }
      if (!mounted.current || typeof chosen !== "string" || chosen === "") return;
      const reply = await save(chosen);
      if (!mounted.current) return;
      const shown = formatHomePath(safe(chosen), home);
      if (reply.kind !== "ok") {
        setNotice(writeFailure(`Not saved: ${shown}`, "POST /workspaces", reply, [chosen], home));
        return;
      }
      const row = placeSaved(reply.body);
      const note = isRecord(reply.body) && typeof reply.body.note === "string" && reply.body.note !== "" ? reply.body.note : undefined;
      setNotice(note === undefined ? undefined : { tone: "attention", text: plainSentence(note, row === undefined ? [chosen] : [row.path, chosen], home) });
      setLive(`Saved ${row === undefined ? shown : formatHomePath(row.path, home)}.`);
      void read();
    } finally {
      if (mounted.current) end("add");
    }
  };

  const remove = async (row: WorkspaceRow, index: number): Promise<void> => {
    if (offline) return;
    const key = `remove-${row.id}`;
    if (!begin(key)) return;
    const reply = await send<RemoveWorkspaceResponse>(api, { method: "POST", path: "/workspaces/:id/remove", params: { id: row.id } });
    if (!mounted.current) return;
    end(key);
    const shown = formatHomePath(row.path, home);
    if (reply.kind !== "ok") {
      setNotice(writeFailure(`Couldn't remove ${shown}`, `POST /workspaces/${row.id}/remove`, reply, [row.path], home));
      return;
    }
    setNotice(undefined);
    setGone((prev) => new Map(prev).set(row.id, { row, index }));
    focusNext.current = `[data-testid="${IDS.undo}"][data-id="${row.id}"]`;
    setLive(`Removed ${shown}.`);
    void read();
  };

  const undo = async (row: WorkspaceRow): Promise<void> => {
    if (offline) return;
    const key = `undo-${row.id}`;
    if (!begin(key)) return;
    const reply = await save(row.path);
    if (!mounted.current) return;
    end(key);
    const shown = formatHomePath(row.path, home);
    if (reply.kind !== "ok") {
      setNotice(writeFailure(`Couldn't put back ${shown}`, "POST /workspaces", reply, [row.path], home));
      return;
    }
    setGone((prev) => {
      const next = new Map(prev);
      next.delete(row.id);
      return next;
    });
    const saved = placeSaved(reply.body);
    const note = isRecord(reply.body) && typeof reply.body.note === "string" && reply.body.note !== "" ? reply.body.note : undefined;
    setNotice(note === undefined ? undefined : { tone: "attention", text: plainSentence(note, [row.path], home) });
    if (saved !== undefined) focusNext.current = `[data-testid="${IDS.remove}"][data-id="${saved.id}"]`;
    setLive(`${shown} is back in your saved workspaces.`);
    void read();
  };

  const now = new Date();
  let body: ReactNode;
  if (rows === undefined) {
    if (failure !== undefined) {
      body = (
        <div className="settings-fail" role="alert" data-testid={IDS.error}>
          <div className="settings-fail-head">
            <WarnGlyph />
            <h3 className="settings-title">Couldn't read your saved workspaces</h3>
          </div>
          <p>The list didn't load. Nothing was changed.</p>
          <div className="settings-fail-detail settings-mono" data-testid={IDS.errorDetail}>
            {failure}
          </div>
          <div>
            <Button size="row" variant="secondary" disabled={offline} onClick={() => void read()} data-testid={IDS.retry}>
              Try again
            </Button>
          </div>
        </div>
      );
    } else if (offline || unreachable) {
      body = (
        <p className="settings-text" data-testid={IDS.unknown}>
          Unknown until the kernel answers.
        </p>
      );
    } else body = <Skeleton testId={IDS.loading} what="your saved workspaces" rows={3} />;
  } else {
    const shown = withGone(rows, gone);
    const flagged = rows.some((r) => !gone.has(r.id) && r.state !== "ready");
    body = (
      <>
        {failure === undefined ? null : (
          <p className="settings-notice" data-tone="danger" role="alert">
            {`Couldn't refresh your saved workspaces: ${failure}. What is shown is the last read.`}
          </p>
        )}
        {shown.length === 0 ? (
          <p className="settings-ws-empty" data-testid={IDS.empty}>
            <FolderIcon />
            <span>No saved workspaces yet. Add folder… saves one.</span>
          </p>
        ) : (
          <table className="settings-ws-table" data-testid={IDS.table} aria-label="Saved workspaces">
            <thead>
              <tr>
                <th scope="col">Repo</th>
                <th scope="col">Path</th>
                <th scope="col">Last used</th>
                <th scope="col">
                  <span className="settings-sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry, index) => {
                const { row } = entry;
                const path = formatHomePath(row.path, home);
                if (entry.kind === "gone") {
                  return (
                    <tr key={`gone-${row.id}`} className="settings-ws-gone" data-testid={IDS.gone} data-id={row.id}>
                      <td colSpan={4}>
                        <span>
                          Removed <span className="settings-mono">{path}</span> from your saved workspaces. The folder is still on disk, and no crew member's settings change. Undo saves it again, as used now.
                        </span>{" "}
                        <button type="button" className="settings-ws-undo" disabled={offline} aria-busy={busy.has(`undo-${row.id}`) ? "true" : undefined} data-testid={IDS.undo} data-id={row.id} onClick={() => void undo(row)}>
                          Undo
                        </button>
                      </td>
                    </tr>
                  );
                }
                const words = stateWords(row.state);
                const label = `Remove ${path}`;
                return (
                  <tr key={row.id} data-testid={IDS.row} data-id={row.id} data-state={row.state}>
                    <td data-testid={IDS.repo}>{row.repo ?? <span className="settings-cap">No GitHub remote</span>}</td>
                    <td>
                      <span className="settings-ws-path">
                        <span className="settings-mono" data-testid={IDS.path}>
                          {path}
                        </span>
                        {words === undefined ? null : (
                          <span data-testid={IDS.state}>
                            <span className="settings-sr-only"> · </span>
                            <Badge tone="attention">{words}</Badge>
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="settings-tn" data-testid={IDS.used}>
                      <time dateTime={row.lastUsedAt}>{lastUsedLabel(row.lastUsedAt, now)}</time>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn settings-ws-remove"
                        data-variant="ghost"
                        data-size="row"
                        aria-label={label}
                        aria-busy={busy.has(`remove-${row.id}`) ? "true" : undefined}
                        disabled={offline}
                        data-testid={IDS.remove}
                        data-id={row.id}
                        onClick={() => void remove(row, index)}
                        onKeyDown={hideTip}
                        onBlur={showTipAgain}
                        onMouseLeave={showTipAgain}
                      >
                        <TrashIcon />
                        <span className="settings-ws-tip" aria-hidden="true">
                          {label}
                        </span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {flagged ? (
          <p className="settings-cap">Missing: the folder or its .git was moved, renamed or deleted. Can't be read: the folder refused the read. Neither is offered to a crew member.</p>
        ) : null}
      </>
    );
  }

  return (
    <section ref={section} className="settings-blk" aria-labelledby="settings-h-workspaces" data-testid={IDS.section}>
      <div className="settings-sech">
        <h2 className="settings-label" id="settings-h-workspaces">
          Workspaces
        </h2>
        <span className="settings-cap">Kept by the kernel, in one list</span>
      </div>
      <p className="settings-text">Folders you saved for a repo. When a crew member needs a copy of a repo, the saved ones whose remote matches are offered. Removing one forgets it here only.</p>
      {body}
      {notice === undefined ? null : (
        <p className="settings-notice" data-tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"} data-testid={IDS.notice}>
          {notice.text}
        </p>
      )}
      {rows !== undefined && api.chooseFolder !== undefined ? (
        <div>
          <Button size="row" variant="secondary" icon={<FolderIcon />} disabled={offline} loading={busy.has("add")} onClick={() => void add()} data-testid={IDS.add}>
            Add folder…
          </Button>
        </div>
      ) : null}
      <span className="settings-sr-only" role="status" data-testid={IDS.live}>
        {live}
      </span>
    </section>
  );
}
