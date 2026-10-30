// The Memory screen (phase 7 item 06): each agent's memory files and the shared ones as a
// tree, a file's view, an editor that saves, and the conflict view that shows the text on disk
// beside the owner's edit, built to the approved GUI v2 mockup (`memoryScreen`).
//
// - Data: `GET /memory` (the tree), `GET /memory/file?path=` (the open file and its content
//   hash) and `GET /settings` (only its `data_dir`, for the root shown above the tree). All
//   three are screen-local reads; no resource is added to the live store. The tree is keyed by
//   path and every read keeps the last answer until a newer one lands, so rows keep their place.
// - Writes: Save is one `PUT /memory/file` with the hash the file was opened at as `base_hash`.
//   The kernel checks it against the file on disk. A `409` is a conflict (both versions are
//   shown, nothing was written); any other refusal, and a save nobody answered, keep the draft
//   and say it was not saved, naming the code. Nothing shown changes before the kernel answers.
// - The draft is this component's state, so no refetch, feed event or outage replaces it. A
//   file view that is not being edited reads its file again when the feed says memory changed;
//   an editor never does.
// - Live: a `memory_updated` or `session_status` event reads the tree again. The kernel records
//   `memory_updated` for the owner's own writes only: an agent's write shows when a session
//   ends (`session_status`) or on the next read, and a save over it is refused by the hash.
// - The kernel going away: the screen keeps its last data (subtitle "last known"), Edit, Save
//   and the conflict's actions are off, the draft stays, and it never falls back to the empty state.
// - The keys: J / K and the arrows move between files, Enter opens one, Esc leaves a file view
//   (focus on that file's button) or an unchanged editor. ⌘K: `memory.open:<path>` and `memory.edit`.
//
// `index.tsx` hands this screen the bridge, so no store hook runs without one.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ApiResult, MemoryConflictError, MemoryFileResponse, MemoryTreeResponse, MemoryWriteBody, MemoryWriteResponse, SettingsResponse, StudioBridge } from "../../api/contract";
import { isComposingKey, isEditableTarget } from "../../commands/keyboard";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { ToastStack } from "../../components/Toast/Toast";
import type { ToastItem } from "../../components/Toast/Toast";
import { useLiveStore } from "../../store/react";
import { useMemoryCommands } from "./commands";
import {
  MEMORY_TEST_IDS as IDS,
  contentToSend,
  countText,
  draftOnTop,
  entryOf,
  fileCount,
  fileOrder,
  isConflictBody,
  isDirty,
  isFileBody,
  isTreeBody,
  memoryRefetchMark,
  modifiedText,
  notSavedText,
  openDraft,
  refusalLine,
  refusalOf,
  versionOf,
} from "./model";
import type { MemoryDraft, Refusal } from "./model";
import { ConflictView, FileView, MemoryEditor, MemoryEmpty, MemoryFailure, MemoryFrame, MemoryLoading, MemoryOverview, MemoryTree } from "./MemoryViews";
import type { MemoryState } from "./MemoryViews";

// ---- reading and writing ------------------------------------------------------------------------------------

const NO_ANSWER = { ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } } as const;

/** One call: a throw is "no answer", and a success whose body is not the shape `valid` accepts is a failed read, never data. */
async function call<R>(api: StudioBridge, request: Parameters<StudioBridge["request"]>[0], valid: (body: unknown) => boolean): Promise<ApiResult<R>> {
  let result: ApiResult<R>;
  try {
    result = await api.request<R>(request);
  } catch {
    return NO_ANSWER;
  }
  if (result.ok && !valid(result.body)) return { ok: false, status: result.status, body: { error: "invalid_response" } };
  return result;
}

const readTree = (api: StudioBridge) => call<MemoryTreeResponse>(api, { method: "GET", path: "/memory" }, isTreeBody);
const readFile = (api: StudioBridge, path: string) => call<MemoryFileResponse>(api, { method: "GET", path: "/memory/file", query: { path } }, isFileBody);
const readSettings = (api: StudioBridge) => call<SettingsResponse>(api, { method: "GET", path: "/settings" }, (b) => typeof (b as Partial<SettingsResponse> | null)?.data_dir === "string");
const writeFile = (api: StudioBridge, body: MemoryWriteBody) => call<MemoryWriteResponse>(api, { method: "PUT", path: "/memory/file", body }, (b) => typeof b === "object" && b !== null);

// ---- the screen -----------------------------------------------------------------------------------------------------

export interface MemoryScreenProps {
  readonly api: StudioBridge;
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
}

export function MemoryScreen({ api, registry = commandRegistry }: MemoryScreenProps) {
  const { connection, eventLog } = useLiveStore(api);
  const [tree, setTree] = useState<MemoryTreeResponse | undefined>();
  const [treeError, setTreeError] = useState<Refusal | undefined>();
  const [dataDir, setDataDir] = useState<string | undefined>();
  const [now, setNow] = useState(() => Date.now());
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [file, setFile] = useState<MemoryFileResponse | undefined>();
  const [fileError, setFileError] = useState<Refusal | undefined>();
  const [draft, setDraft] = useState<MemoryDraft | undefined>();
  const [conflict, setConflict] = useState<MemoryConflictError | undefined>();
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [activePath, setActivePath] = useState<string | null>(null);
  const mounted = useRef(true);
  const treeSeq = useRef(0);
  const fileSeq = useRef(0);
  const toastSeq = useRef(0);
  const saveInFlight = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** The selector focus goes to once the next view is drawn. */
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ---- reads --------------------------------------------------------------------------------------------------

  const refetchTree = useCallback(async (): Promise<void> => {
    treeSeq.current += 1;
    const mine = treeSeq.current;
    const result = await readTree(api);
    if (!mounted.current || mine !== treeSeq.current) return;
    // A read the kernel did not answer (or refused) never replaces what is on screen.
    setTree((last) => (result.status === 0 ? last : result.ok ? result.body : last));
    setTreeError(refusalOf(result));
    setNow(Date.now());
  }, [api]);

  // Any event that says memory may have changed (and a change of connection) reads the tree again.
  const feedMark = `${memoryRefetchMark(eventLog)}:${connection.state}`;
  useEffect(() => { void refetchTree(); }, [refetchTree, feedMark]);

  // The root shown above the tree is `data_dir` from Settings; until that answers, or if it fails, none is shown.
  useEffect(() => {
    if (dataDir !== undefined) return;
    void readSettings(api).then((result) => {
      if (mounted.current && result.ok) setDataDir(result.body.data_dir);
    });
  }, [api, connection.state, dataDir]);

  const draft$ = useRef(draft);
  useLayoutEffect(() => {
    draft$.current = draft;
  });

  /** One read of the open file. A draft is never replaced: while one exists the read is dropped. */
  const refetchFile = useCallback(
    async (path: string): Promise<void> => {
      fileSeq.current += 1;
      const mine = fileSeq.current;
      const result = await readFile(api, path);
      if (!mounted.current || mine !== fileSeq.current || draft$.current !== undefined) return;
      if (result.ok) setFile(result.body);
      setFileError(refusalOf(result));
    },
    [api],
  );
  // The open file is read when it opens, and again when the feed says memory changed, while no edit is under way.
  const editing = draft !== undefined;
  useEffect(() => {
    if (openPath !== null && !editing) void refetchFile(openPath);
  }, [refetchFile, openPath, editing, feedMark]);

  const offline = connection.state === "reconnecting" || connection.state === "unreachable" || connection.state === "not_installed" || treeError?.status === 0;

  // ---- moving between views -------------------------------------------------------------------------------------

  const announce = useCallback((text: string): void => setAnnouncement(text), []);
  const open = useCallback((path: string): void => {
    fileSeq.current += 1;
    setFile(undefined);
    setFileError(undefined);
    setOpenPath(path);
  }, []);
  const closeFile = useCallback((): void => {
    if (openPath !== null) focusAfter.current = `[data-testid="${IDS.fileButton}"][data-path="${CSS.escape(openPath)}"]`;
    fileSeq.current += 1;
    setOpenPath(null);
    setFile(undefined);
    setFileError(undefined);
  }, [openPath]);
  const startEdit = useCallback((): void => {
    if (file === undefined || offline || draft$.current !== undefined) return;
    setDraft(openDraft(file));
    setConflict(undefined);
    setSaveError(undefined);
    setOpenedAt(Date.now());
    focusAfter.current = `[data-testid="${IDS.textarea}"]`;
  }, [file, offline]);
  const leaveEditor = useCallback((): void => {
    setDraft(undefined);
    setConflict(undefined);
    setSaveError(undefined);
    focusAfter.current = `[data-testid="${IDS.edit}"]`;
  }, []);

  // Focus goes where the view that replaced the control says, once that view is drawn.
  useLayoutEffect(() => {
    const selector = focusAfter.current;
    if (selector === null) return;
    const el = rootRef.current?.querySelector<HTMLElement>(selector);
    // The control is not drawn yet: ask again after the next render. One that is drawn but off (the kernel is away) is not owed focus later.
    if (el === null || el === undefined) return;
    focusAfter.current = null;
    if ((el as HTMLButtonElement).disabled !== true) el.focus({ preventScroll: true });
  });

  // ---- save -----------------------------------------------------------------------------------------------------

  const pushToast = (toast: Omit<ToastItem, "id">): void => {
    toastSeq.current += 1;
    setToasts((all) => [...all, { ...toast, id: `memory-toast-${toastSeq.current}` }]);
  };

  const save = async (): Promise<void> => {
    if (draft === undefined || offline || saveInFlight.current || !isDirty(draft)) return;
    saveInFlight.current = true;
    setSaving(true);
    setSaveError(undefined);
    const sent = contentToSend(draft);
    const result = await writeFile(api, { path: draft.path, content: sent, base_hash: draft.baseHash });
    saveInFlight.current = false;
    if (!mounted.current) return;
    setSaving(false);
    if (result.ok) {
      const hash = (result.body as Partial<MemoryWriteResponse>).content_hash;
      // Back to the file view with the version the kernel answered with (read again if it named none).
      setFile(typeof hash === "string" ? { path: draft.path, content: sent, content_hash: hash } : undefined);
      setFileError(undefined);
      setDraft(undefined);
      setConflict(undefined);
      focusAfter.current = `[data-testid="${IDS.edit}"]`;
      pushToast({
        status: { state: "ok", verified: { at: modifiedText((result.body as Partial<MemoryWriteResponse>).modified ?? new Date().toISOString()) } },
        title: `Saved memory/${draft.path}.`,
        body: typeof hash === "string" ? `Version ${versionOf(hash)}.` : "",
      });
      void refetchTree();
      return;
    }
    const refusal = refusalOf(result) as Refusal;
    if (result.status === 409 && !isConflictBody(result.body)) {
      // A 409 that does not carry both versions cannot show them: it is a refusal like any other.
      const text = notSavedText(refusal);
      setSaveError(text);
      announce(text);
      return;
    }
    if (result.status === 409) {
      setConflict(result.body as MemoryConflictError);
      focusAfter.current = `[data-testid="${IDS.conflict}"]`;
      announce("Not saved. The file changed since you opened it. Both versions are shown.");
    } else {
      const text = notSavedText(refusal);
      setSaveError(text);
      announce(text);
    }
  };

  const copyMine = async (): Promise<void> => {
    if (draft === undefined) return;
    try {
      await navigator.clipboard.writeText(contentToSend(draft));
      announce("Copied your version to the clipboard.");
    } catch {
      announce("Could not copy. Select the text under Your edit and copy it.");
    }
  };
  const discardMine = (): void => {
    if (conflict !== undefined && draft !== undefined) {
      // The disk's text is what the file view shows now.
      fileSeq.current += 1;
      setFile({ path: draft.path, content: conflict.current_content, content_hash: conflict.current_hash });
      setFileError(undefined);
    }
    leaveEditor();
    announce("Your edit was discarded. The file on disk is unchanged.");
    void refetchTree();
  };
  const editOnTop = (): void => {
    if (draft === undefined || conflict === undefined) return;
    const next = draftOnTop(draft, conflict);
    if (next === null) return;
    fileSeq.current += 1;
    setFile({ path: draft.path, content: conflict.current_content, content_hash: conflict.current_hash });
    setDraft(next);
    setConflict(undefined);
    setSaveError(undefined);
    setOpenedAt(Date.now());
    focusAfter.current = `[data-testid="${IDS.textarea}"]`;
    announce("Editing on top of the current version. Your added lines were carried over.");
  };
  const backToEditing = (): void => {
    setConflict(undefined);
    focusAfter.current = `[data-testid="${IDS.textarea}"]`;
  };

  // ---- ⌘K ------------------------------------------------------------------------------------------------------------

  const mode = draft !== undefined ? (conflict !== undefined ? "conflict" : "edit") : openPath !== null ? "file" : "tree";
  const paths = tree === undefined ? [] : fileOrder(tree);
  const openFromPalette = useCallback(
    (path: string): void => {
      open(path);
      focusAfter.current = `[data-testid="${IDS.fileButton}"][data-path="${CSS.escape(path)}"]`;
    },
    [open],
  );
  useMemoryCommands(registry, { files: paths, viewing: mode === "file" && openPath !== null ? openPath : undefined, offline }, { open: openFromPalette, edit: startEdit });

  // ---- the keys ---------------------------------------------------------------------------------------------------------

  const latest = useRef({ mode, dirty: draft !== undefined && isDirty(draft), closeFile, leaveEditor });
  useLayoutEffect(() => {
    latest.current = { mode, dirty: draft !== undefined && isDirty(draft), closeFile, leaveEditor };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isComposingKey(event)) return;
      // Nothing runs behind an open dialog (the kill switch's confirm is `aria-modal`) or the ⌘K palette.
      if (document.querySelector('[aria-modal="true"], [data-testid="command-palette"]') !== null) return;
      const now$ = latest.current;
      if (event.key === "Escape") {
        // From the file view back to the tree; from an unchanged editor back to the file view. A changed editor keeps its text.
        if (now$.mode === "file") {
          event.preventDefault();
          now$.closeFile();
        } else if (now$.mode === "edit" && !now$.dirty) {
          event.preventDefault();
          now$.leaveEditor();
        }
        return;
      }
      if (now$.mode === "edit" || now$.mode === "conflict" || isEditableTarget(event.target)) return;
      let delta: 1 | -1;
      switch (event.key) {
        case "j":
          delta = 1;
          break;
        case "ArrowDown":
          delta = 1;
          break;
        case "k":
          delta = -1;
          break;
        case "ArrowUp":
          delta = -1;
          break;
        default:
          return;
      }
      const root = rootRef.current;
      if (root === null) return;
      const buttons = [...root.querySelectorAll<HTMLElement>(`[data-testid="${IDS.fileButton}"]`)];
      if (buttons.length === 0) return;
      const active = document.activeElement;
      const at = buttons.findIndex((el) => el === active);
      // The arrows scroll a file's text when it has focus: they move between files only from the tree or from nowhere.
      if (event.key.startsWith("Arrow") && at === -1 && active !== null && active !== document.body) return;
      event.preventDefault();
      const next = at === -1 ? buttons[0] : buttons[Math.min(buttons.length - 1, Math.max(0, at + delta))];
      next?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---- render -----------------------------------------------------------------------------------------------------------

  if (tree === undefined) {
    if (treeError === undefined) return <MemoryLoading announcement={announcement} offline={offline} />;
    return <MemoryFailure error={treeError} announcement={announcement} offline={offline} onRetry={() => void refetchTree()} />;
  }
  if (fileCount(tree) === 0) return <MemoryEmpty dataDir={dataDir} announcement={announcement} offline={offline} onAsk={() => { window.location.hash = "#/chat"; }} />;

  const lastKnown = offline ? " · last known" : "";
  const stale =
    treeError === undefined || treeError.status === 0 ? null : (
      <p className="memory-stale" role="status" data-testid={IDS.stale}>
        This tree is from the last read that answered; the latest one failed ({refusalLine("GET /memory", treeError)}).
      </p>
    );
  const toastStack = <ToastStack toasts={toasts} onDismiss={(id) => setToasts((all) => all.filter((t) => t.id !== id))} />;

  if (draft !== undefined && conflict !== undefined) {
    return (
      <MemoryFrame state="conflict" subtitle={`Changed since you opened it${lastKnown}`} announcement={announcement} offline={offline} rootRef={rootRef}>
        <ConflictView draft={draft} conflict={conflict} openedAt={openedAt} offline={offline} now={now} onBack={backToEditing} onDiscard={discardMine} onCopy={() => void copyMine()} onEditOnTop={editOnTop} />
        {toastStack}
      </MemoryFrame>
    );
  }
  if (draft !== undefined) {
    return (
      <MemoryFrame state="edit" subtitle={`Edit${lastKnown}`} announcement={announcement} offline={offline} rootRef={rootRef}>
        {stale}
        <MemoryEditor
          draft={draft}
          dataDir={dataDir}
          version={versionOf(draft.baseHash)}
          saving={saving}
          offline={offline}
          saveError={saveError}
          textareaRef={textareaRef}
          onChange={(text) => {
            setDraft((d) => (d === undefined ? d : { ...d, text }));
            setSaveError(undefined);
          }}
          onCancel={leaveEditor}
          onSave={() => void save()}
        />
        {toastStack}
      </MemoryFrame>
    );
  }

  const state: MemoryState = openPath === null ? "populated" : "file";
  const tabPath = activePath !== null && paths.includes(activePath) ? activePath : openPath !== null && paths.includes(openPath) ? openPath : paths[0];
  return (
    <MemoryFrame state={state} subtitle={`${countText(fileCount(tree))}${lastKnown}`} announcement={announcement} offline={offline} rootRef={rootRef}>
      {stale}
      <div className="memory-split">
        <MemoryTree tree={tree} dataDir={dataDir} openPath={openPath ?? undefined} tabPath={tabPath} offline={offline} now={now} onOpen={open} onFocused={setActivePath} />
        <div className="memory-pane">
          {openPath === null ? (
            <MemoryOverview tree={tree} dataDir={dataDir} />
          ) : (
            <FileView
              key={openPath}
              path={openPath}
              dataDir={dataDir}
              entry={entryOf(tree, openPath)}
              file={file}
              readError={fileError}
              offline={offline}
              now={now}
              editRef={editRef}
              onEdit={startEdit}
              onRetry={() => void refetchFile(openPath)}
            />
          )}
        </div>
      </div>
      {toastStack}
    </MemoryFrame>
  );
}
