// Memory's canned kernel data (phase 7 item 06) for `startFixtureKernel({ routes })`. Every
// body is typed by the contract.
//
// It answers the way the kernel's routes do where the screen can tell
// (`kernel/src/gui/memory.ts`, `kernel/src/gui/memory-paths.ts`):
//   GET /memory        each agent's files (`wright` first), then `shared/`: path relative to `memory/`, size in
//                      bytes, `modified`; none of the kernel's own `_unassigned/` or `playbooks/` folders
//   GET /memory/file   `{path, content, content_hash}`, the hash being the SHA-256 of the text, as the kernel's
//   PUT /memory/file   the guarded write: `200 {path, content_hash, size, modified}` and one `memory_updated`
//                      event `{path, by: "owner", size, content_hash}` when `base_hash` is the hash of the text
//                      on disk; `409 {error: "changed_since_read", current_content, current_hash}` when it is not
//                      (an agent wrote after the owner opened the file); and, scripted per test, any other
//                      refusal (`refuse`) or no answer at all (`holdWrites`: the request stays open until
//                      the kernel is closed, which drops the connection)
//
// The state is mutable and the fixture is a script for a spec. `agentWrites` changes a file as an agent's
// own write does: the kernel records no event for it (`docs/DESIGN.md` open point 3), so the screen learns
// nothing until it reads again. `addFile` and `touch` change the data AND append the event the kernel would
// (`memory_updated`), which is how the screen learns. `holdTree` keeps the next tree read open (the
// loading state) and `failTree` answers it 500 (the route-failure card).
//
// Every name and line of text here is fixture data: no real agent, repo or person.
import { createHash } from "node:crypto";
import type { EventFrame, MemoryFileEntry, MemoryFileResponse, MemoryTreeResponse, MemoryWriteBody, MemoryWriteResponse, RouteKey } from "../../src/api/contract";
import type { FixtureAnswer, FixtureKernel, FixtureKernelOptions, FixtureRequest, FixtureRoute } from "../fixture-kernel";
import { cannedStatus } from "../fixture-kernel";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The file the conflict is shown on: Mason's lessons, which an agent writes during a session. */
export const LESSONS_PATH = "mason/lessons.md";

const nl = (...lines: string[]): string => lines.join("\n");

/** Mason's lessons as the owner opens them. */
export const LESSONS_BASE = nl(
  "# Lessons",
  "",
  "What went wrong in mason's work and how to avoid it. The owner edits this file.",
  "",
  "- A retry loop must reset its counter after a success (PR #3).",
  "- A new test must cover the success path, not only the failure path (PR #3).",
);
/** What the owner adds. */
export const LESSONS_MINE_LINE = "- Quote the file and line when you say a change is wrong.";
export const LESSONS_MINE = nl(LESSONS_BASE, LESSONS_MINE_LINE);
/** What an agent writes while the owner edits. */
export const LESSONS_AGENT_LINE = "- Wait until a PR's head commit has been stable for 2 minutes before reviewing it.";
export const LESSONS_AGENT = nl(LESSONS_BASE, LESSONS_AGENT_LINE);

/** SHA-256 of the text's UTF-8 bytes, hex: the kernel's `content_hash`. */
export function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const preferences = (agent: string): string => nl("# Preferences", "", `How the owner likes ${agent}'s work done. The owner edits this file.`);
const lessons = (agent: string, line: string): string => nl("# Lessons", "", `What went wrong in ${agent}'s work and how to avoid it. The owner edits this file.`, "", line);

/** [path, text, minutes before the fixture was made it was modified]. The kernel lists a crew member's files in the order role, preferences, people, lessons. */
function makeFiles(): [string, string, number][] {
  return [
    ["wright/role.md", nl("# Wright", "", "Lead agent. Talks with the owner in Chat, drafts playbooks and crew charters as proposals, and hands work to the crew.", "", "- Sends nothing outward without an approval.", "- Says what it is unsure of."), 5 * DAY / MINUTE],
    ["wright/preferences.md", nl(preferences("wright"), "", "- Answers in five lines or fewer unless asked for more.", "- Proposes a playbook as a draft first; nothing is turned on without a dry run."), 3 * DAY / MINUTE],
    ["wright/people.md", nl("# People", "", "- The owner. Personal repos only; studio-sandbox is the test repo."), 5 * DAY / MINUTE],
    ["wright/lessons.md", lessons("wright", "- Ask which repos to cover before planning reviews."), 2 * DAY / MINUTE],
    ["mason/role.md", nl("# Mason", "", "Reviewer. Reads pull requests on the repos it was granted and saves a draft review for the owner.", "", "- Comments only; it cannot push.", "- Drafts are recorded, never sent, in this phase."), 3 * DAY / MINUTE],
    ["mason/preferences.md", nl(preferences("mason"), "", "- Quote the file and line.", "- One summary comment, then line comments."), 3 * DAY / MINUTE],
    ["mason/people.md", nl("# People", "", "- The owner."), 3 * DAY / MINUTE],
    [LESSONS_PATH, LESSONS_BASE, 70],
    ["ada/role.md", nl("# Ada", "", "Builder. Writes in worktrees only, never in the main checkout.", "", "- Drafts the weekly changelog as a file.", "- Stops and asks before touching more than 5 files."), 2 * DAY / MINUTE],
    ["ada/preferences.md", nl(preferences("ada"), "", "- Small commits with conventional messages.", "- A dry run before the first real run."), 2 * DAY / MINUTE],
    ["ada/people.md", nl("# People", "", "- The owner.", "- Mason: reviews what Ada builds."), 2 * DAY / MINUTE],
    ["ada/lessons.md", lessons("ada", "- The refactor spike lost its work when the kernel restarted. Commit before a long step."), 130],
    ["shared/README.md", nl("# Shared memory", "", "Things every agent should know about the user. The owner edits these files; agents read them."), 4 * DAY / MINUTE],
    ["shared/about-me.md", nl("# About the owner", "", "- Works on personal projects in the evenings and on Fridays.", "- Prefers plain English and short answers."), 3 * DAY / MINUTE],
  ];
}

export type MemoryState = "populated" | "empty";

export interface MemoryFixtureOptions {
  /** `empty`: no memory file at all (the default kernel answer). Default `populated`. */
  readonly state?: MemoryState;
}

export interface MemoryFixture {
  /** Pass to `startFixtureKernel`. */
  readonly options: FixtureKernelOptions;
  /** Every `PUT /memory/file` body the kernel received, in order. */
  readonly puts: MemoryWriteBody[];
  /** Every `GET /memory/file` path asked for, in order. */
  readonly fileReads: string[];
  /** Every `GET /memory` the kernel answered or held, counted. */
  treeReads(): number;
  /** Give the routes the started kernel, so they can append events. */
  attach(kernel: FixtureKernel): void;
  /** The next `GET /memory` is not answered until `releaseTree`: the screen shows its loading state. */
  holdTree(): void;
  releaseTree(): void;
  /** `GET /memory` answers `500 {"error": "store_unreadable"}` from now on (`false`: it answers normally again). */
  failTree(failing: boolean): void;
  /** An agent writes `path` during a session: the text changes, and the kernel records no event. */
  agentWrites(path: string, text: string): void;
  /** A new file appears (an agent's first lesson, say) and a `memory_updated` event follows. */
  addFile(path: string, text: string): void;
  /** A file's text changes and a `memory_updated` event follows (the kernel's record of an owner's write made elsewhere). */
  touch(path: string, text: string): void;
  /** A `session_status` event: a session ended, which is when agents write their lessons. */
  sessionEnds(): void;
  /** The next saves are refused `status` with `code` (nothing is written); `undefined` puts the kernel back to answering by the hash. */
  refuse(refusal: { readonly status: number; readonly code: string } | undefined): void;
  /** The next saves are not answered: the request stays open until the kernel is closed. */
  holdWrites(holding: boolean): void;
  /** The text of a file now on disk (`undefined` when there is none). */
  contentOf(path: string): string | undefined;
}

export function memoryFixture(options: MemoryFixtureOptions = {}): MemoryFixture {
  const made = Date.now();
  const files = new Map<string, { text: string; modified: number }>();
  if (options.state !== "empty") for (const [path, text, minutesAgo] of makeFiles()) files.set(path, { text, modified: made - minutesAgo * MINUTE });
  const puts: MemoryWriteBody[] = [];
  const fileReads: string[] = [];
  let reads = 0;
  let kernel: FixtureKernel | undefined;
  let nextEvent = 1;
  let hold: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let failing = false;
  let refusal: { readonly status: number; readonly code: string } | undefined;
  let holdingWrites = false;

  const event = (kind: string, payload: unknown): EventFrame => ({ type: "event", id: nextEvent++, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload });
  const entry = (path: string): MemoryFileEntry => {
    const file = files.get(path) as { text: string; modified: number };
    return { path, size: Buffer.byteLength(file.text), modified: new Date(file.modified).toISOString() };
  };
  const folderOrder = (folder: string): number => (folder === "wright" ? 0 : 1);

  /** `GET /memory`: `wright` first, then the rest by id ascending; `shared/` apart. */
  const tree = (): MemoryTreeResponse => {
    const byFolder = new Map<string, MemoryFileEntry[]>();
    for (const path of files.keys()) {
      const folder = path.split("/")[0] as string;
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), entry(path)]);
    }
    const shared = byFolder.get("shared") ?? [];
    byFolder.delete("shared");
    const agents = [...byFolder.keys()].sort((a, b) => folderOrder(a) - folderOrder(b) || a.localeCompare(b));
    return { agents: agents.map((agent) => ({ agent, files: byFolder.get(agent) ?? [] })), shared };
  };

  const treeRoute = async (): Promise<FixtureAnswer> => {
    reads += 1;
    if (hold !== undefined) await hold;
    if (failing) return { status: 500, body: { error: "store_unreadable" } };
    return { status: 200, body: tree() satisfies MemoryTreeResponse };
  };

  const fileRoute = (req: FixtureRequest): FixtureAnswer => {
    const path = req.query.path ?? "";
    fileReads.push(path);
    const file = files.get(path);
    if (file === undefined) return { status: 404, body: { error: "not_found" } };
    return { status: 200, body: { path, content: file.text, content_hash: hashOf(file.text) } satisfies MemoryFileResponse };
  };

  const putRoute = async (req: FixtureRequest): Promise<FixtureAnswer> => {
    const body = req.body as MemoryWriteBody;
    puts.push(body);
    // A save nobody answers: the request stays open until the kernel closes (the connection is dropped).
    if (holdingWrites) await new Promise<never>(() => undefined);
    if (refusal !== undefined) return { status: refusal.status, body: { error: refusal.code } };
    const current = files.get(body.path);
    if (current === undefined) return { status: 404, body: { error: "not_found" } };
    const currentHash = hashOf(current.text);
    if (currentHash !== body.base_hash) return { status: 409, body: { error: "changed_since_read", current_content: current.text, current_hash: currentHash } };
    const modified = Date.now();
    files.set(body.path, { text: body.content, modified });
    const hash = hashOf(body.content);
    const size = Buffer.byteLength(body.content);
    kernel?.appendEvent(event("memory_updated", { path: body.path, by: "owner", size, content_hash: hash }));
    return { status: 200, body: { path: body.path, content_hash: hash, size, modified: new Date(modified).toISOString() } satisfies MemoryWriteResponse };
  };

  const routes: Partial<Record<RouteKey, FixtureRoute>> = {
    "GET /status": () => ({ status: 200, body: cannedStatus() }),
    "GET /memory": treeRoute,
    "GET /memory/file": fileRoute,
    "PUT /memory/file": putRoute,
    // The sidebar's Crew section reads these; nothing here is about them.
    "GET /agents": () => ({ status: 200, body: { agents: [] } }),
    "GET /approvals": () => ({ status: 200, body: { approvals: [] } }),
    "GET /messages": () => ({ status: 200, body: { messages: [] } }),
    "GET /notifications": () => ({ status: 200, body: { notifications: [] } }),
  };

  return {
    options: { routes },
    puts,
    fileReads,
    treeReads: () => reads,
    attach(started) {
      kernel = started;
    },
    holdTree() {
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseTree() {
      release?.();
      hold = undefined;
      release = undefined;
    },
    failTree(value) {
      failing = value;
    },
    agentWrites(path, text) {
      files.set(path, { text, modified: Date.now() });
    },
    addFile(path, text) {
      files.set(path, { text, modified: Date.now() });
      kernel?.appendEvent(event("memory_updated", { path, by: "owner", size: Buffer.byteLength(text), content_hash: hashOf(text) }));
    },
    touch(path, text) {
      files.set(path, { text, modified: Date.now() });
      kernel?.appendEvent(event("memory_updated", { path, by: "owner", size: Buffer.byteLength(text), content_hash: hashOf(text) }));
    },
    sessionEnds() {
      kernel?.appendEvent(event("session_status", { status: "completed" }));
    },
    refuse(value) {
      refusal = value;
    },
    holdWrites(value) {
      holdingWrites = value;
    },
    contentOf: (path) => files.get(path)?.text,
  };
}
