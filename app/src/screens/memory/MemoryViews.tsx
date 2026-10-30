// The Memory screen's views (phase 7 item 06), built to the approved GUI v2 mockup
// (`docs/design/mockups/gui-v2.html`, `memoryScreen`): the frame every state is drawn in; the
// loading, error, empty and no-bridge states; the tree of each agent's files and the shared
// ones; the overview ("Pick a file"); a file's view; the editor with its Changes inspector;
// and the conflict view that shows the text on disk beside the owner's edit. Pure drawing: the
// reads, the save, the keys and the palette commands are `MemoryScreen.tsx`'s.
//
// Every string from the kernel (a path, a file name, a refusal's code, a file's text) is
// untrusted: a React text child, never markup. A file's text goes into a `<pre>` or a
// `<textarea>`, which are text.
import { useMemo } from "react";
import type { ReactNode, Ref } from "react";
import type { MemoryConflictError, MemoryFileEntry, MemoryFileResponse, MemoryTreeResponse } from "../../api/contract";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { DiffView } from "../../components/DiffView/DiffView";
import { printable } from "../approvals/printable";
import {
  MEMORY_TEST_IDS as IDS,
  bytesOf,
  countText,
  draftOnTop,
  fileCount,
  fileLabel,
  fileName,
  folderOf,
  fullPath,
  groupsOf,
  helpText,
  isDirty,
  lf,
  lineDiff,
  memoryRoot,
  modifiedText,
  refusalLine,
  sizeText,
  versionOf,
} from "./model";
import type { MemoryDraft, Refusal } from "./model";
import "./memory.css";

export const EMPTY_TITLE = "Nothing remembered yet.";
export const OVERVIEW_TITLE = "Pick a file";

// ---- the frame and the states ----------------------------------------------------------------------------------

export type MemoryState = "loading" | "error" | "empty" | "populated" | "file" | "edit" | "conflict";

interface FrameProps {
  readonly state: MemoryState;
  readonly subtitle: string;
  /** The polite live region's text: what a save, a refusal or a copy just did. */
  readonly announcement: string;
  readonly offline: boolean;
  readonly rootRef?: Ref<HTMLDivElement>;
  readonly children: ReactNode;
}

/** The screen's root (`screen-memory`) and its bar: every state is drawn inside it. */
export function MemoryFrame({ state, subtitle, announcement, offline, rootRef, children }: FrameProps) {
  return (
    <div className="memory" data-testid={IDS.screen} data-state={state} data-offline={offline ? "true" : undefined} ref={rootRef}>
      <div className="memory-bar">
        <span className="memory-subtitle" data-testid={IDS.subtitle}>
          {subtitle}
        </span>
      </div>
      {children}
      <p className="memory-sr" role="status" aria-live="polite" data-testid={IDS.live}>
        {announcement}
      </p>
    </div>
  );
}

/** The screen the shell mounts when there is no bridge (a window without a preload). */
export function MemoryNoKernel() {
  return (
    <div className="memory memory-single" data-testid={IDS.screen} data-state="no-bridge">
      <div className="memory-state">
        <h2 className="memory-state-title">Memory</h2>
        <p className="memory-state-note">This window has no connection to the kernel, so there is nothing to show.</p>
      </div>
    </div>
  );
}

export function MemoryLoading({ announcement, offline }: { readonly announcement: string; readonly offline: boolean }) {
  return (
    <MemoryFrame state="loading" subtitle="" announcement={announcement} offline={offline}>
      <div className="memory-split" aria-busy="true" data-testid={IDS.loading}>
        <div className="memory-tree">
          <span className="memory-sr" role="status">
            Loading memory
          </span>
          {[0, 1, 2].map((n) => (
            <div key={n} className="memory-skel" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          ))}
        </div>
        <div className="memory-pane">
          <div className="memory-pad">
            {[0, 1].map((n) => (
              <div key={n} className="memory-skel" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            ))}
          </div>
        </div>
      </div>
    </MemoryFrame>
  );
}

export function MemoryFailure({ error, announcement, offline, onRetry }: { readonly error: Refusal | undefined; readonly announcement: string; readonly offline: boolean; readonly onRetry: () => void }) {
  const noAnswer = error === undefined || error.status === 0;
  return (
    <MemoryFrame state="error" subtitle="memory" announcement={announcement} offline={offline}>
      <div className="memory-fail" role="alert" data-testid={IDS.error}>
        <h2 className="memory-fail-title">Couldn't load memory</h2>
        <p className="memory-fail-note">
          {noAnswer
            ? "The kernel isn't answering, so memory can't be read until it is back. This screen reads again on its own."
            : "The kernel answered, but the memory request failed. Nothing on this screen was changed."}
        </p>
        {error === undefined ? null : (
          <p className="memory-fail-detail" data-testid={IDS.errorDetail}>
            {refusalLine("GET /memory", error)}
          </p>
        )}
        <div>
          <Button size="row" data-testid={IDS.retry} onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    </MemoryFrame>
  );
}

export function MemoryEmpty({ dataDir, announcement, offline, onAsk }: { readonly dataDir: string | undefined; readonly announcement: string; readonly offline: boolean; readonly onAsk: () => void }) {
  return (
    <MemoryFrame state="empty" subtitle="0 files" announcement={announcement} offline={offline}>
      <div className="memory-state" data-testid={IDS.empty}>
        <h2 className="memory-state-title">{EMPTY_TITLE}</h2>
        <p className="memory-state-note">
          Memory is plain markdown files under <span className="memory-mono">{memoryRoot(dataDir)}</span>. Wright creates its own the first time you talk to it, and a crew member's appear when you create the member.
          Nothing here is hidden in a database.
        </p>
        <Button variant="primary" data-testid={IDS.askWright} onClick={onAsk}>
          Ask Wright
        </Button>
      </div>
    </MemoryFrame>
  );
}

// ---- the tree ---------------------------------------------------------------------------------------------------

interface TreeProps {
  readonly tree: MemoryTreeResponse;
  readonly dataDir: string | undefined;
  /** The file whose view is open (marked current). */
  readonly openPath: string | undefined;
  /** The one file button in the tab order (the others are reached with J, K and the arrows). */
  readonly tabPath: string | undefined;
  readonly offline: boolean;
  readonly now: number;
  readonly onOpen: (path: string) => void;
  readonly onFocused: (path: string) => void;
}

/** The memory root above the tree, then each folder's files: a `nav` labelled "Memory files". */
export function MemoryTree({ tree, dataDir, openPath, tabPath, offline, now, onOpen, onFocused }: TreeProps) {
  return (
    <nav className="memory-tree" aria-label="Memory files" data-testid={IDS.tree}>
      <p className="memory-root" data-testid={IDS.root}>
        {memoryRoot(dataDir)}
      </p>
      {groupsOf(tree).map((group) => (
        <div key={group.folder} className="memory-group" role="group" aria-label={`${group.label} files`}>
          <div className="memory-folder" data-testid={IDS.folder}>
            <span className="memory-folder-name">{group.label}</span>
            <span className="memory-cap">{printable(group.folder)}/</span>
          </div>
          {group.files.map((file) => {
            const current = file.path === openPath;
            return (
              <button
                key={file.path}
                type="button"
                className={current ? "memory-file memory-file-current" : "memory-file"}
                data-testid={IDS.fileButton}
                data-path={file.path}
                aria-label={fileLabel(file, now)}
                aria-current={current ? "true" : undefined}
                aria-disabled={offline ? true : undefined}
                tabIndex={file.path === tabPath ? 0 : -1}
                onFocus={() => onFocused(file.path)}
                onClick={() => {
                  if (!offline) onOpen(file.path);
                }}
              >
                <span className="memory-file-name">{printable(fileName(file.path))}</span>
                <span className="memory-file-size">{sizeText(file.size)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** "Pick a file": what the pane says before a file is open (the mockup's `memoryOverview`). */
export function MemoryOverview({ tree, dataDir }: { readonly tree: MemoryTreeResponse; readonly dataDir: string | undefined }) {
  return (
    <div className="memory-pad" data-testid={IDS.overview}>
      <div className="memory-head">
        <h2 className="memory-h">{OVERVIEW_TITLE}</h2>
        <Badge>{countText(fileCount(tree))}</Badge>
      </div>
      <p className="memory-text">
        Every file is plain markdown on your disk, under <span className="memory-mono">{memoryRoot(dataDir)}</span>. Read it here, edit it and save. Agents write their lessons during sessions, so a save is checked against what is on disk.
      </p>
      <ul className="memory-box">
        {groupsOf(tree).map((group) => (
          <li key={group.folder}>
            <span className="memory-box-text">
              <b>{group.label}</b>
              <span className="memory-cap">{group.files.map((f) => printable(fileName(f.path)).replace(/\.md$/, "")).join(", ")}</span>
            </span>
            <span className="memory-cap">{countText(group.files.length)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- a file ------------------------------------------------------------------------------------------------------

interface FileViewProps {
  readonly path: string;
  readonly dataDir: string | undefined;
  /** The tree's row for the file, when it has one: its size and modified time are the kernel's. */
  readonly entry: MemoryFileEntry | undefined;
  /** The file as last read; `undefined` until the first read answers. */
  readonly file: MemoryFileResponse | undefined;
  /** The last read of this file did not go through. */
  readonly readError: Refusal | undefined;
  readonly offline: boolean;
  readonly now: number;
  readonly editRef: Ref<HTMLButtonElement>;
  readonly onEdit: () => void;
  readonly onRetry: () => void;
}

export function FileView({ path, dataDir, entry, file, readError, offline, now, editRef, onEdit, onRetry }: FileViewProps) {
  const folder = folderOf(path);
  const size = entry === undefined ? (file === undefined ? undefined : bytesOf(file.content)) : entry.size;
  return (
    <div className="memory-pad" data-testid={IDS.fileView} data-path={path}>
      <div className="memory-head">
        <h2 className="memory-h" data-testid={IDS.fileTitle}>
          {printable(fileName(path))}
        </h2>
        <Badge>{folder === "shared" ? "Shared" : printable(folder)}</Badge>
        <span className="memory-spacer" />
        <Button variant="primary" size="row" data-testid={IDS.edit} ref={editRef} disabled={offline || file === undefined} onClick={onEdit}>
          Edit
        </Button>
      </div>
      <dl className="memory-kv">
        <dt>Path</dt>
        <dd className="memory-mono" data-testid={IDS.filePath}>
          {fullPath(dataDir, path)}
        </dd>
        <dt>Size</dt>
        <dd className="memory-tn" data-testid={IDS.fileSize}>
          {size === undefined ? "reading…" : sizeText(size)}
        </dd>
        <dt>Modified</dt>
        <dd data-testid={IDS.fileModified}>{entry === undefined ? "unknown" : modifiedText(entry.modified, now)}</dd>
        <dt>Version</dt>
        <dd>
          <span className="memory-mono" data-testid={IDS.fileVersion}>
            {file === undefined ? "reading…" : versionOf(file.content_hash)}
          </span>
          <span className="memory-cap">content hash; a save is checked against it</span>
        </dd>
      </dl>
      {readError === undefined ? null : (
        <p className="memory-note" data-tone="danger" role="alert" data-testid={IDS.fileError}>
          {file === undefined ? "Couldn't open this file" : "Couldn't read this file again; the text below is from the last read that answered"} ({refusalLine("GET /memory/file", readError)}).{" "}
          <button type="button" className="memory-link" onClick={onRetry}>
            Try again
          </button>
        </p>
      )}
      {file === undefined ? (
        readError === undefined ? (
          <div className="memory-skel" aria-busy="true" data-testid={IDS.fileLoading}>
            <span className="memory-sr" role="status">
              Loading {printable(path)}
            </span>
            <i />
            <i />
            <i />
          </div>
        ) : null
      ) : (
        <section className="memory-blk" aria-labelledby="memory-h-body">
          <h3 className="memory-label" id="memory-h-body">
            Contents
          </h3>
          <pre className="memory-src" tabIndex={0} aria-label={`Contents of ${printable(path)}`} data-testid={IDS.contents}>
            {file.content}
          </pre>
          <p className="memory-cap">{file.content === "" ? "This file is empty. " : ""}{helpText(path)}</p>
        </section>
      )}
    </div>
  );
}

// ---- the editor ---------------------------------------------------------------------------------------------------

interface EditorProps {
  readonly draft: MemoryDraft;
  readonly dataDir: string | undefined;
  readonly version: string;
  readonly saving: boolean;
  readonly offline: boolean;
  /** Why the last save did not go through, in words; the draft is kept. */
  readonly saveError: string | undefined;
  readonly textareaRef: Ref<HTMLTextAreaElement>;
  readonly onChange: (text: string) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

export function MemoryEditor({ draft, dataDir, version, saving, offline, saveError, textareaRef, onChange, onCancel, onSave }: EditorProps) {
  const dirty = isDirty(draft);
  const hunks = useMemo(() => lineDiff(draft.baseText, draft.text), [draft.baseText, draft.text]);
  const name = printable(fileName(draft.path));
  return (
    <div className="memory-edit" data-testid={IDS.editor} data-path={draft.path}>
      <div className="memory-scroll">
        <div className="memory-pad memory-tight">
          <div className="memory-crumb">
            <Button variant="ghost" size="row" aria-label={`Back to ${name}`} onClick={onCancel}>
              {name}
            </Button>
            <span aria-hidden="true">/</span>
            <span>Edit</span>
          </div>
          <div className="memory-head">
            <h2 className="memory-h">Edit {printable(draft.path)}</h2>
            <Badge>
              opened at version <span className="memory-mono">{version}</span>
            </Badge>
          </div>
        </div>
        <div className="memory-pad">
          <div className="memory-field">
            <textarea
              ref={textareaRef}
              className="memory-textarea"
              data-testid={IDS.textarea}
              rows={16}
              spellCheck={false}
              aria-label={`Contents of ${printable(draft.path)}`}
              aria-describedby="memory-editor-help"
              value={draft.text}
              onChange={(event) => onChange(event.target.value)}
            />
          </div>
          <span className="memory-cap" id="memory-editor-help">
            Plain markdown, saved to <span className="memory-mono">{fullPath(dataDir, draft.path)}</span>. Lessons files can change under you: agents write them during sessions.
          </span>
        </div>
      </div>
      <aside className="memory-inspector" aria-label="Changes" data-testid={IDS.changes}>
        <h3 className="memory-label">Changes</h3>
        {hunks === null ? (
          <p className="memory-cap">This file is too large to compare here. Saving still works.</p>
        ) : (
          <DiffView path={printable(draft.path)} scope="your edit" hunks={hunks} />
        )}
        <p className="memory-cap">{dirty ? "Saving checks that nobody wrote to the file since you opened it." : "Nothing changed. Edit the text to see it here."}</p>
        {saveError === undefined ? null : (
          <p className="memory-note" data-tone="danger" role="alert" data-testid={IDS.saveError}>
            {saveError}
          </p>
        )}
        <div className="memory-actions">
          <span className="memory-spacer" />
          <Button variant="secondary" data-testid={IDS.cancel} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" data-testid={IDS.save} disabled={!dirty || offline} loading={saving} onClick={onSave}>
            Save
          </Button>
        </div>
      </aside>
    </div>
  );
}

// ---- the conflict ---------------------------------------------------------------------------------------------------

interface ConflictProps {
  readonly draft: MemoryDraft;
  readonly conflict: MemoryConflictError;
  /** When the owner opened the file, ms since the epoch. */
  readonly openedAt: number;
  readonly offline: boolean;
  readonly now: number;
  readonly onBack: () => void;
  readonly onDiscard: () => void;
  readonly onCopy: () => void;
  readonly onEditOnTop: () => void;
}

export function ConflictView({ draft, conflict, openedAt, offline, now, onBack, onDiscard, onCopy, onEditOnTop }: ConflictProps) {
  const disk = lf(conflict.current_content);
  const hunks = useMemo(() => lineDiff(disk, draft.text), [disk, draft.text]);
  const canCarry = useMemo(() => draftOnTop(draft, conflict) !== null, [draft, conflict]);
  const path = printable(draft.path);
  return (
    <div className="memory-conflict" data-testid={IDS.conflict} data-path={draft.path} tabIndex={-1}>
      <div className="memory-band" role="alert" data-testid={IDS.conflictBand}>
        <span className="memory-band-dot" aria-hidden="true" />
        <span>
          <b>{path}</b> changed since you opened it. Your save was refused, nothing was overwritten and nothing of yours is lost.
        </span>
      </div>
      <div className="memory-scroll">
        <div className="memory-pad memory-tight">
          <div className="memory-crumb">
            <Button variant="ghost" size="row" data-testid={IDS.backToEditing} onClick={onBack}>
              Back to editing
            </Button>
            <span aria-hidden="true">/</span>
            <span>{path}</span>
          </div>
          <div className="memory-head">
            <h2 className="memory-h">Changed since you opened it</h2>
            <Badge tone="attention">not saved</Badge>
          </div>
          <dl className="memory-kv">
            <dt>You opened it</dt>
            <dd>
              {modifiedText(new Date(openedAt).toISOString(), now)} · version <span className="memory-mono">{versionOf(draft.baseHash)}</span>
            </dd>
            <dt>On disk now</dt>
            <dd>
              version <span className="memory-mono">{versionOf(conflict.current_hash)}</span>
            </dd>
          </dl>
          <div className="memory-actions">
            <span className="memory-spacer" />
            <Button variant="ghost" data-testid={IDS.discard} disabled={offline} onClick={onDiscard}>
              Discard my edit
            </Button>
            <Button variant="secondary" data-testid={IDS.copy} disabled={offline} onClick={onCopy}>
              Copy my version
            </Button>
            <Button variant="primary" data-testid={IDS.onTop} disabled={offline || !canCarry} onClick={onEditOnTop}>
              Edit on top of the current version
            </Button>
          </div>
          <p className="memory-cap">Editing on top of the current version carries over the lines you added, not the lines you removed. Check the result before you save.</p>
        </div>
        <div className="memory-pad">
          <div className="memory-cmp">
            <section aria-labelledby="memory-c-cur">
              <h3 className="memory-label" id="memory-c-cur">
                On disk now
              </h3>
              <pre className="memory-src memory-src-current" tabIndex={0} aria-label="The file on disk now" data-testid={IDS.onDisk}>
                {conflict.current_content}
              </pre>
            </section>
            <section aria-labelledby="memory-c-mine">
              <h3 className="memory-label" id="memory-c-mine">
                Your edit
              </h3>
              <pre className="memory-src" tabIndex={0} aria-label="Your edit" data-testid={IDS.mine}>
                {draft.text}
              </pre>
            </section>
          </div>
          <section className="memory-blk" aria-labelledby="memory-c-diff">
            <h3 className="memory-label" id="memory-c-diff">
              Your edit compared with what is on disk now
            </h3>
            {hunks === null ? <p className="memory-cap">These texts are too large to compare here. Both are shown above in full.</p> : <DiffView path={path} scope="disk now to your edit" hunks={hunks} />}
          </section>
        </div>
      </div>
    </div>
  );
}
