// @vitest-environment jsdom
// The Memory screen (phase 7 item 06, AC6-AC12) against a scripted bridge (`fake-bridge.ts`):
// the states (loading, empty, error, populated), the tree with its root and sizes, a file's
// view, the editor and its save with the hash it was opened at, the conflict view and what it
// keeps, every other refusal, the kernel going away, the keys, the ⌘K commands, the live
// refetch and untrusted text shown literally. The kernel's own routes are covered by
// `kernel/test/gui-memory.test.ts`; the built app by `e2e/memory.spec.ts`.
import { createHash } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiRequest, ApiResult, MemoryFileEntry, MemoryTreeResponse, MemoryWriteBody, StatusBody } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { Titlebar } from "../../shell/Titlebar";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import type { StudioBridge } from "../../api/contract";
import { MEMORY_OWNER } from "./commands";
import { resetHeldMemory } from "./held";
import { MEMORY_TEST_IDS as IDS } from "./model";
import { MemoryScreen } from "./MemoryScreen";
import { screen as memoryScreenDefinition } from "./index";

afterEach(() => {
  cleanup();
  resetHeldMemory();
  window.location.hash = "";
  vi.restoreAllMocks();
});

// ---- A scripted kernel ---------------------------------------------------------------------------------------

const STATUS: StatusBody = {
  kernel: { version: "1.0.0", uptime_s: 1, pid: 7 },
  kill_switch: { engaged: false, since: null },
  auth: [],
  sessions: [],
  kill_unconfirmed: [],
  orphaned: [],
  queue: { pending: 0, events: [] },
  wakeups: { pending: 0, items: [] },
  tokens_today: { day: "2026-10-30", agents: [] },
  cap_state: [],
};

const UNREACHABLE: ApiResult<unknown> = { ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } };
const refused = (status: number, body: { readonly error: string } & Record<string, unknown>): ApiResult<unknown> => ({ ok: false, status, body });
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const MODIFIED = new Date(2026, 9, 28, 9, 5).toISOString();
const LESSONS = "# Lessons\n\n- A retry loop must reset its counter.\n- A new test must cover the success path.\n";
const DISK = `${LESSONS}- Wait until a PR's head commit is stable.\n`;
const MINE = `${LESSONS}- Quote the file and line.\n`;
const PATH = "mason/lessons.md";
const DATA_DIR = "/Users/me/.loomwright-studio";

type Answer = ApiResult<unknown> | Promise<ApiResult<unknown>>;

interface Kernel {
  readonly fake: FakeBridge;
  readonly registry: CommandRegistry;
  /** The files on disk, by path under `memory/`. */
  files: Map<string, string>;
  /** Every body `PUT /memory/file` received. */
  readonly puts: MemoryWriteBody[];
  tree: (req: ApiRequest) => Answer;
  file: (req: ApiRequest) => Answer;
  put: (req: ApiRequest) => Answer;
  settings: (req: ApiRequest) => Answer;
}

function treeOf(files: ReadonlyMap<string, string>): MemoryTreeResponse {
  const entry = (path: string, text: string): MemoryFileEntry => ({ path, size: Buffer.byteLength(text), modified: MODIFIED });
  const folders = new Map<string, MemoryFileEntry[]>();
  for (const [path, text] of files) {
    const folder = path.split("/")[0] as string;
    folders.set(folder, [...(folders.get(folder) ?? []), entry(path, text)]);
  }
  const shared = folders.get("shared") ?? [];
  folders.delete("shared");
  return { agents: [...folders].map(([agent, list]) => ({ agent, files: list })), shared };
}

function createKernel(initial?: Record<string, string>): Kernel {
  const fake = fakeBridge();
  const kernel: Kernel = {
    fake,
    registry: createCommandRegistry(),
    files: new Map(
      Object.entries(
        initial ?? {
          "wright/role.md": "# Wright\n\nLead agent.\n",
          "wright/lessons.md": "# Lessons\n\n- Ask which repos to cover.\n",
          [PATH]: LESSONS,
          "mason/role.md": "# Mason\n\nReviewer.\n",
          "shared/README.md": "# Shared memory\n",
          "shared/about-me.md": "# About the owner\n",
        },
      ),
    ),
    puts: [],
    tree: () => ok(treeOf(kernel.files)),
    file: (req) => {
      const path = req.query?.path ?? "";
      const text = kernel.files.get(path);
      return text === undefined ? refused(404, { error: "not_found" }) : ok({ path, content: text, content_hash: sha(text) });
    },
    put: (req) => {
      const body = req.body as MemoryWriteBody;
      kernel.puts.push(body);
      const current = kernel.files.get(body.path);
      if (current === undefined) return refused(404, { error: "not_found" });
      if (sha(current) !== body.base_hash) return refused(409, { error: "changed_since_read", current_content: current, current_hash: sha(current) });
      kernel.files.set(body.path, body.content);
      return ok({ path: body.path, content_hash: sha(body.content), size: Buffer.byteLength(body.content), modified: new Date().toISOString() });
    },
    settings: () => ok({ provider: { id: "x", account: "x", health: { status: "ok" }, token_created_at: null }, data_dir: DATA_DIR, notifier: "none", loomwright: {} }),
  };
  fake.route("GET /status", () => ok(STATUS));
  fake.route("GET /memory", (req) => kernel.tree(req));
  fake.route("GET /memory/file", (req) => kernel.file(req));
  fake.route("PUT /memory/file", (req) => kernel.put(req));
  fake.route("GET /settings", (req) => kernel.settings(req));
  return kernel;
}

const BAND = "kernel-unreachable-band";
const HOME = "/Users/me";

/** The window around the screen: the shell's title bar (which draws the screen's `Subtitle`) above the screen itself. */
function Window({ api, registry }: { readonly api: StudioBridge; readonly registry: CommandRegistry }) {
  return (
    <>
      <Titlebar screen={memoryScreenDefinition} />
      <MemoryScreen api={api} registry={registry} />
    </>
  );
}

/** `kernel`'s bridge, with the main process's `homeDir` when `home` is given (the fake has none). */
const bridgeOf = (kernel: Kernel, home?: string): StudioBridge => (home === undefined ? kernel.fake.bridge : { ...kernel.fake.bridge, homeDir: async () => home });

/** Render the screen over `kernel` and wait until the tree (or its failure) is on it. */
async function mount(kernel: Kernel, home?: string): Promise<void> {
  render(<Window api={bridgeOf(kernel, home)} registry={kernel.registry} />);
  await waitFor(() => expect(screen.queryByTestId(IDS.loading)).toBeNull());
}

async function start(initial?: Record<string, string>, home?: string): Promise<Kernel> {
  const kernel = createKernel(initial);
  await mount(kernel, home);
  return kernel;
}

let nextEventId = 1;
function emit(kernel: Kernel, kind: string): void {
  const id = nextEventId;
  nextEventId += 1;
  act(() => kernel.fake.emit({ type: "event", id, at: new Date(id * 1000).toISOString(), kind, session_id: null, task_id: null, payload: {} }));
}

const reads = (kernel: Kernel, key: string): ApiRequest[] => kernel.fake.requestsTo(key).map((r) => r.req);
const fileButton = (path: string): HTMLElement => screen.getAllByTestId(IDS.fileButton).find((b) => b.getAttribute("data-path") === path) as HTMLElement;
const text = (id: string): string => screen.getByTestId(id).textContent ?? "";
const textarea = (): HTMLTextAreaElement => screen.getByTestId(IDS.textarea) as HTMLTextAreaElement;
const enabled = (id: string): boolean => (screen.getByTestId(id) as HTMLButtonElement).disabled === false;

async function openFile(path: string): Promise<void> {
  fireEvent.click(await waitFor(() => fileButton(path)));
  await waitFor(() => expect(screen.getByTestId(IDS.contents)).toBeTruthy());
}

async function openEditor(path = PATH): Promise<void> {
  await openFile(path);
  fireEvent.click(screen.getByTestId(IDS.edit));
  await screen.findByTestId(IDS.editor);
}

const type = (value: string): void => {
  fireEvent.change(textarea(), { target: { value } });
};

// ---- The states ---------------------------------------------------------------------------------------------------

describe("the states", () => {
  it("with no bridge it renders a plain state, never a throw", () => {
    const Route = memoryScreenDefinition.Component;
    render(<Route />);
    const root = screen.getByTestId(IDS.screen);
    expect(root.getAttribute("data-state")).toBe("no-bridge");
    expect(root.textContent).toContain("This window has no connection to the kernel");
    expect(memoryScreenDefinition.id).toBe("memory");
    expect(memoryScreenDefinition.title).toBe("Memory");
    expect(memoryScreenDefinition.nav).toEqual({ label: "Memory", order: 9, shortcut: "⌘9" });
  });

  it("loading: skeleton rows while the tree has not answered, then the tree", async () => {
    let release: (value: ApiResult<unknown>) => void = () => undefined;
    const held = new Promise<ApiResult<unknown>>((resolve) => {
      release = resolve;
    });
    const kernel = createKernel();
    kernel.tree = () => held;
    render(<Window api={kernel.fake.bridge} registry={kernel.registry} />);
    const loading = await screen.findByTestId(IDS.loading);
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(within(loading).getByRole("status").textContent).toBe("Loading memory");
    expect(screen.queryByTestId(IDS.tree)).toBeNull();
    release(ok(treeOf(kernel.files)));
    await screen.findByTestId(IDS.tree);
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
  });

  it("empty: with no file at all it says 'Nothing remembered yet.' and the mockup's note, never an empty tree", async () => {
    await start({});
    const empty = await screen.findByTestId(IDS.empty);
    expect(within(empty).getByRole("heading", { level: 2 }).textContent).toBe("Nothing remembered yet.");
    expect(empty.textContent).toContain("Memory is plain markdown files under");
    expect(empty.textContent).toContain("Nothing here is hidden in a database.");
    await waitFor(() => expect(empty.textContent).toContain(`${DATA_DIR}/memory/`));
    expect(screen.queryByTestId(IDS.tree)).toBeNull();
    fireEvent.click(screen.getByTestId(IDS.askWright));
    expect(window.location.hash).toBe("#/chat");
  });

  it("empty: a tree whose folders hold no file is empty too", async () => {
    const kernel = createKernel({});
    kernel.tree = () => ok({ agents: [{ agent: "wright", files: [] }], shared: [] });
    await mount(kernel);
    expect(await screen.findByTestId(IDS.empty)).toBeTruthy();
  });

  it("error: a route failure with no data names the request, its status and its code, apart from the kernel band; Try again reads once more", async () => {
    const kernel = createKernel();
    kernel.tree = () => refused(500, { error: "store_unreadable" });
    await mount(kernel);
    const card = await screen.findByTestId(IDS.error);
    expect(card.getAttribute("role")).toBe("alert");
    expect(within(card).getByRole("heading", { level: 2 }).textContent).toBe("Couldn't load memory");
    expect(text(IDS.errorDetail)).toBe("GET /memory · 500 · store_unreadable");
    kernel.tree = () => ok(treeOf(kernel.files));
    fireEvent.click(screen.getByTestId(IDS.retry));
    await screen.findByTestId(IDS.tree);
    expect(screen.queryByTestId(IDS.error)).toBeNull();
  });

  it("error: a body that is not a tree is a failed read, never a tree", async () => {
    const kernel = createKernel();
    kernel.tree = () => ok({ nope: true });
    await mount(kernel);
    expect(text(IDS.errorDetail)).toBe("GET /memory · 200 · invalid_response");
  });

  it("with no data and the kernel not answering it says so, never 'nothing remembered yet', and shows no request text", async () => {
    const kernel = createKernel();
    kernel.tree = () => UNREACHABLE;
    await mount(kernel);
    expect(await screen.findByTestId(IDS.error)).toBeTruthy();
    expect(screen.getByTestId(IDS.screen).getAttribute("data-offline")).toBe("true");
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    // Status 0: no request line, no "no answer", no connection code anywhere in the window.
    expect(screen.queryByTestId(IDS.errorDetail)).toBeNull();
    expectNoRequestText();
    expect(text(IDS.error)).toContain("The kernel isn't answering");
    // The title bar has no count line to show before a tree has answered.
    expect(text(IDS.subtitle)).toBe("");
  });
});

/** AC4: the page text names no request, no "no answer" and no connection code. */
function expectNoRequestText(): void {
  const page = document.body.textContent ?? "";
  for (const forbidden of ["GET /memory", "GET /memory/file", "no answer", "not_installed", "daemon_not_running", "connection_failed"]) expect(page, forbidden).not.toContain(forbidden);
}

// ---- the title bar -----------------------------------------------------------------------------------------------

describe("the count line", () => {
  it("is in the title bar beside the heading, and the screen draws no bar of its own", async () => {
    await start();
    const bar = screen.getByTestId("titlebar-subtitle");
    const line = within(bar).getByTestId(IDS.subtitle);
    expect(line.textContent).toBe("6 files");
    expect(bar.previousElementSibling?.tagName).toBe("H1");
    const root = screen.getByTestId(IDS.screen);
    expect(root.contains(line)).toBe(false);
    expect(root.querySelector(".memory-bar")).toBeNull();
    expect(root.querySelector(`[data-testid="${IDS.subtitle}"]`)).toBeNull();
  });

  it("reads 'Edit' in the editor, in the title bar", async () => {
    await start();
    await openEditor();
    expect(within(screen.getByTestId("titlebar-subtitle")).getByTestId(IDS.subtitle).textContent).toBe("Edit");
  });

  it("is cleared when the screen goes, so the next mount never shows the last one's line", async () => {
    await start();
    expect(text(IDS.subtitle)).toBe("6 files");
    cleanup();
    render(<Titlebar screen={memoryScreenDefinition} />);
    expect(text(IDS.subtitle)).toBe("");
  });
});

// ---- ~ paths ---------------------------------------------------------------------------------------------------------

describe("paths under the home folder", () => {
  it("read ~/… in the root and in a file's Path when the data folder is under home", async () => {
    await start(undefined, HOME);
    await waitFor(() => expect(text(IDS.root)).toBe("~/.loomwright-studio/memory/"));
    await openFile(PATH);
    expect(text(IDS.filePath)).toBe(`~/.loomwright-studio/memory/${PATH}`);
    expect(text(IDS.fileView)).not.toContain(HOME);
  });

  it("read in full when home is unknown (the bridge has no homeDir)", async () => {
    await start();
    await waitFor(() => expect(text(IDS.root)).toBe(`${DATA_DIR}/memory/`));
    await openFile(PATH);
    expect(text(IDS.filePath)).toBe(`${DATA_DIR}/memory/${PATH}`);
  });

  it("read in full when the data folder is outside home", async () => {
    const kernel = createKernel();
    kernel.settings = () => ok({ provider: { id: "x", account: "x", health: { status: "ok" }, token_created_at: null }, data_dir: "/fixture/studio-data", notifier: "none", loomwright: {} });
    await mount(kernel, HOME);
    await waitFor(() => expect(text(IDS.root)).toBe("/fixture/studio-data/memory/"));
  });

  it("read ~/… in the editor's note and the empty state too", async () => {
    await start(undefined, HOME);
    await waitFor(() => expect(text(IDS.root)).toBe("~/.loomwright-studio/memory/"));
    await openEditor();
    expect(document.getElementById("memory-editor-help")?.textContent).toContain(`saved to ~/.loomwright-studio/memory/${PATH}.`);
    cleanup();
    resetHeldMemory();
    await start({}, HOME);
    await waitFor(() => expect(text(IDS.empty)).toContain("under ~/.loomwright-studio/memory/."));
  });
});

// ---- AC6: the tree and the paths ------------------------------------------------------------------------------------

describe("the tree", () => {
  it("lists every agent's files and the shared files under their folder, with sizes, in a nav labelled 'Memory files'", async () => {
    const kernel = await start();
    const nav = screen.getByRole("navigation", { name: "Memory files" });
    expect(within(nav).getAllByTestId(IDS.folder).map((el) => el.textContent)).toEqual(["Wrightwright/", "Masonmason/", "Sharedshared/"]);
    const rows = within(nav).getAllByTestId(IDS.fileButton);
    expect(rows.map((el) => el.getAttribute("data-path"))).toEqual(["wright/role.md", "wright/lessons.md", "mason/lessons.md", "mason/role.md", "shared/README.md", "shared/about-me.md"]);
    expect(rows.map((el) => el.querySelector(".memory-file-size")?.textContent)).toEqual(
      ["wright/role.md", "wright/lessons.md", "mason/lessons.md", "mason/role.md", "shared/README.md", "shared/about-me.md"].map((p) => `${Buffer.byteLength(kernel.files.get(p) as string)} B`),
    );
    expect(text(IDS.subtitle)).toBe("6 files");
  });

  it("names each file button '<path>, <size>, modified <time>'", async () => {
    await start();
    expect(fileButton(PATH).getAttribute("aria-label")).toBe(`mason/lessons.md, ${Buffer.byteLength(LESSONS)} B, modified Wed 28 Oct`);
  });

  it("shows the memory root above the tree, <data_dir>/memory/, once Settings answers", async () => {
    await start();
    await waitFor(() => expect(text(IDS.root)).toBe(`${DATA_DIR}/memory/`));
  });

  it("shows memory/ with no root until Settings answers, and keeps showing it when Settings fails", async () => {
    let release: (value: ApiResult<unknown>) => void = () => undefined;
    const held = new Promise<ApiResult<unknown>>((resolve) => {
      release = resolve;
    });
    const kernel = createKernel();
    kernel.settings = () => held;
    await mount(kernel);
    expect(text(IDS.root)).toBe("memory/");
    await openFile(PATH);
    expect(text(IDS.filePath)).toBe("memory/mason/lessons.md");
    release(ok({ data_dir: DATA_DIR }));
    await waitFor(() => expect(text(IDS.root)).toBe(`${DATA_DIR}/memory/`));
    expect(text(IDS.filePath)).toBe(`${DATA_DIR}/memory/mason/lessons.md`);
    // A new session: the data folder the first mount learnt is forgotten.
    cleanup();
    resetHeldMemory();

    const failing = createKernel();
    failing.settings = () => refused(500, { error: "store_unreadable" });
    await mount(failing);
    await waitFor(() => expect(reads(failing, "GET /settings").length).toBeGreaterThan(0));
    expect(text(IDS.root)).toBe("memory/");
    await openFile(PATH);
    expect(text(IDS.filePath)).toBe("memory/mason/lessons.md");
  });

  it("the overview reads 'Pick a file', with the count and a row per folder, until a file is opened", async () => {
    await start();
    const overview = screen.getByTestId(IDS.overview);
    expect(within(overview).getByRole("heading", { level: 2 }).textContent).toBe("Pick a file");
    expect(overview.textContent).toContain("6 files");
    expect(overview.textContent).toContain("a save is checked against what is on disk");
    expect(within(overview).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Wrightrole, lessons2 files", "Masonlessons, role2 files", "SharedREADME, about-me2 files"]);
  });

  it("opening a file shows its path, size, modified time, version (the hash's first 8 characters) and its text in a focusable <pre>", async () => {
    await start();
    await waitFor(() => expect(text(IDS.root)).toBe(`${DATA_DIR}/memory/`));
    await openFile(PATH);
    expect(text(IDS.filePath)).toBe(`${DATA_DIR}/memory/${PATH}`);
    expect(text(IDS.fileSize)).toBe(`${Buffer.byteLength(LESSONS)} B`);
    expect(text(IDS.fileModified)).toBe("Wed 28 Oct");
    expect(text(IDS.fileVersion)).toBe(sha(LESSONS).slice(0, 8));
    const pre = screen.getByTestId(IDS.contents);
    expect(pre.tagName).toBe("PRE");
    expect(pre.getAttribute("tabindex")).toBe("0");
    expect(pre.getAttribute("aria-label")).toBe(`Contents of ${PATH}`);
    expect(pre.textContent).toBe(LESSONS);
    expect(fileButton(PATH).getAttribute("aria-current")).toBe("true");
  });

  it("asks for the file by its path under memory/", async () => {
    const kernel = await start();
    await openFile(PATH);
    expect(reads(kernel, "GET /memory/file")[0]?.query).toEqual({ path: PATH });
  });

  it("a file that cannot be read says so and names the code; Try again reads it once more", async () => {
    const kernel = await start();
    kernel.file = () => refused(404, { error: "not_found" });
    fireEvent.click(fileButton(PATH));
    const note = await screen.findByTestId(IDS.fileError);
    expect(note.textContent).toContain("Couldn't open this file");
    expect(note.textContent).toContain("GET /memory/file · 404 · not_found");
    expect(enabled(IDS.edit)).toBe(false);
    kernel.file = (req) => ok({ path: req.query?.path, content: LESSONS, content_hash: sha(LESSONS) });
    fireEvent.click(within(note).getByRole("button", { name: "Try again" }));
    await screen.findByTestId(IDS.contents);
    expect(screen.queryByTestId(IDS.fileError)).toBeNull();
  });
});

// ---- AC7: edit and save ----------------------------------------------------------------------------------------------

describe("edit and save", () => {
  it("draws the editor's crumb as the shared crumb '‹ lessons.md / Edit': one button named 'Back to lessons.md' that cancels the edit", async () => {
    await start();
    await openEditor();
    const back = screen.getByRole("button", { name: "Back to lessons.md" });
    expect(back.querySelector("svg")?.getAttribute("aria-hidden"), "the shared crumb's chevron").toBe("true");
    const crumb = back.parentElement as HTMLElement;
    expect(crumb.className).toBe("memory-crumb");
    expect(crumb.textContent).toBe("lessons.md/Edit");
    fireEvent.click(back);
    await screen.findByTestId(IDS.fileView);
  });

  it("Edit opens a textarea holding the text, labelled 'Contents of <path>', and a Changes inspector with a DiffView; Save is off until the text differs", async () => {
    await start();
    await openEditor();
    expect(textarea().value).toBe(LESSONS);
    expect(screen.getByLabelText(`Contents of ${PATH}`)).toBe(textarea());
    const changes = screen.getByRole("complementary", { name: "Changes" });
    expect(within(changes).getByText("Nothing changed. Edit the text to see it here.")).toBeTruthy();
    expect(within(changes).getByRole("region", { name: `Diff of ${PATH}` }).textContent).toContain("No changes in this diff.");
    expect(enabled(IDS.save)).toBe(false);
    type(MINE);
    expect(enabled(IDS.save)).toBe(true);
    expect(within(changes).getByText("Saving checks that nobody wrote to the file since you opened it.")).toBeTruthy();
    const diff = within(changes).getByRole("region", { name: `Diff of ${PATH}` });
    expect(diff.querySelectorAll('[data-line="add"]')).toHaveLength(1);
    expect(diff.querySelector('[data-line="add"]')?.textContent).toContain("- Quote the file and line.");
    expect(text(IDS.editor)).toContain(`opened at version ${sha(LESSONS).slice(0, 8)}`);
    type(LESSONS);
    expect(enabled(IDS.save)).toBe(false);
  });

  it("Save sends PUT /memory/file with the hash the file was opened at as base_hash, then returns to the file view with the new version and a toast", async () => {
    const kernel = await start();
    await openEditor();
    type(MINE);
    fireEvent.click(screen.getByTestId(IDS.save));
    await screen.findByTestId(IDS.fileView);
    expect(kernel.puts).toEqual([{ path: PATH, content: MINE, base_hash: sha(LESSONS) }]);
    expect(text(IDS.fileVersion)).toBe(sha(MINE).slice(0, 8));
    expect(screen.getByTestId(IDS.contents).textContent).toBe(MINE);
    const toast = await waitFor(() => {
      const el = document.querySelector(".toast-text");
      expect(el).not.toBeNull();
      return el as Element;
    });
    expect(toast.textContent).toBe(`Saved memory/${PATH}. Version ${sha(MINE).slice(0, 8)}.`);
    // The tree is read again, so its size is the new one.
    await waitFor(() => expect(fileButton(PATH).getAttribute("aria-label")).toContain(`${Buffer.byteLength(MINE)} B`));
    // Focus returns to Edit, the control that opened the editor.
    expect(document.activeElement).toBe(screen.getByTestId(IDS.edit));
  });

  it("sends one save when Save is pressed twice before the kernel answers", async () => {
    const kernel = await start();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = kernel.put;
    let calls = 0;
    kernel.put = (req) => {
      calls += 1;
      return held.then(() => original(req));
    };
    await openEditor();
    type(MINE);
    fireEvent.click(screen.getByTestId(IDS.save));
    fireEvent.click(screen.getByTestId(IDS.save));
    await waitFor(() => expect(calls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(1);
    release();
    await screen.findByTestId(IDS.fileView);
    expect(kernel.puts).toHaveLength(1);
  });

  it("Cancel returns to the file view and discards the edit", async () => {
    const kernel = await start();
    await openEditor();
    type(MINE);
    fireEvent.click(screen.getByTestId(IDS.cancel));
    await screen.findByTestId(IDS.fileView);
    expect(screen.getByTestId(IDS.contents).textContent).toBe(LESSONS);
    expect(kernel.puts).toEqual([]);
    fireEvent.click(screen.getByTestId(IDS.edit));
    await screen.findByTestId(IDS.editor);
    expect(textarea().value).toBe(LESSONS);
  });

  it("keeps a CRLF file's line breaks: it is not changed by opening it, and a save sends CRLF", async () => {
    const kernel = await start({ [PATH]: "a\r\nb\r\n", "wright/role.md": "x" });
    await openEditor();
    expect(textarea().value).toBe("a\nb\n");
    expect(enabled(IDS.save)).toBe(false);
    type("a\nb\nc\n");
    fireEvent.click(screen.getByTestId(IDS.save));
    await screen.findByTestId(IDS.fileView);
    expect(kernel.puts[0]?.content).toBe("a\r\nb\r\nc\r\n");
  });
});

// ---- AC8: the conflict, nothing lost ----------------------------------------------------------------------------------

describe("the conflict", () => {
  /** The owner edits mason/lessons.md; an agent writes it; the owner saves. */
  async function conflict(): Promise<Kernel> {
    const kernel = await start();
    await openEditor();
    type(MINE);
    kernel.files.set(PATH, DISK);
    fireEvent.click(screen.getByTestId(IDS.save));
    await screen.findByTestId(IDS.conflict);
    return kernel;
  }

  it("a 409 shows the attention band, the disk's text beside the owner's edit and a diff from disk to the edit; nothing was written", async () => {
    const kernel = await conflict();
    const band = screen.getByTestId(IDS.conflictBand);
    expect(band.getAttribute("role")).toBe("alert");
    expect(band.textContent).toBe(`${PATH} changed since you opened it. Your save was refused, nothing was overwritten and nothing of yours is lost.`);
    expect(screen.getByRole("heading", { level: 3, name: "On disk now" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Your edit" })).toBeTruthy();
    expect(screen.getByTestId(IDS.onDisk).textContent).toBe(DISK);
    expect(screen.getByTestId(IDS.mine).textContent).toBe(MINE);
    const diff = screen.getByRole("region", { name: `Diff of ${PATH}` });
    expect(diff.querySelector('[data-line="del"]')?.textContent).toContain("- Wait until a PR's head commit is stable.");
    expect(diff.querySelector('[data-line="add"]')?.textContent).toContain("- Quote the file and line.");
    expect(text(IDS.conflict)).toContain(`version ${sha(LESSONS).slice(0, 8)}`);
    expect(text(IDS.conflict)).toContain(`version ${sha(DISK).slice(0, 8)}`);
    expect(kernel.files.get(PATH)).toBe(DISK);
    expect(text(IDS.live)).toBe("Not saved. The file changed since you opened it. Both versions are shown.");
  });

  it("the owner's draft survives a refetch, a feed event and an outage", async () => {
    const kernel = await conflict();
    emit(kernel, "memory_updated");
    await waitFor(() => expect(reads(kernel, "GET /memory").length).toBeGreaterThan(1));
    expect(screen.getByTestId(IDS.mine).textContent).toBe(MINE);
    kernel.tree = () => UNREACHABLE;
    emit(kernel, "session_status");
    await waitFor(() => expect(text(IDS.subtitle)).toContain("last known"));
    expect(screen.getByTestId(IDS.mine).textContent).toBe(MINE);
    expect(screen.getByTestId(IDS.onDisk).textContent).toBe(DISK);
  });

  it("Discard my edit returns to the file view showing the text on disk", async () => {
    const kernel = await conflict();
    fireEvent.click(screen.getByTestId(IDS.discard));
    await screen.findByTestId(IDS.fileView);
    expect(screen.getByTestId(IDS.contents).textContent).toBe(DISK);
    expect(text(IDS.fileVersion)).toBe(sha(DISK).slice(0, 8));
    expect(kernel.files.get(PATH)).toBe(DISK);
    expect(text(IDS.live)).toBe("Your edit was discarded. The file on disk is unchanged.");
  });

  it("Copy my version puts the draft on the clipboard, and says so", async () => {
    await conflict();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByTestId(IDS.copy));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MINE));
    await waitFor(() => expect(text(IDS.live)).toBe("Copied your version to the clipboard."));
  });

  it("Copy my version says when it could not copy", async () => {
    await conflict();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => Promise.reject(new Error("denied")) }, configurable: true });
    fireEvent.click(screen.getByTestId(IDS.copy));
    await waitFor(() => expect(text(IDS.live)).toMatch(/^Could not copy\./));
  });

  it("Edit on top of the current version opens the editor on the disk text plus the lines the owner added, based on the disk's version", async () => {
    const kernel = await conflict();
    fireEvent.click(screen.getByTestId(IDS.onTop));
    await screen.findByTestId(IDS.editor);
    expect(textarea().value).toBe(`${DISK}- Quote the file and line.\n`);
    expect(text(IDS.editor)).toContain(`opened at version ${sha(DISK).slice(0, 8)}`);
    expect(document.activeElement).toBe(textarea());
    fireEvent.click(screen.getByTestId(IDS.save));
    await screen.findByTestId(IDS.fileView);
    expect(kernel.puts.at(-1)).toEqual({ path: PATH, content: `${DISK}- Quote the file and line.\n`, base_hash: sha(DISK) });
    expect(kernel.files.get(PATH)).toBe(`${DISK}- Quote the file and line.\n`);
  });

  it("Back to editing returns to the editor with the draft", async () => {
    await conflict();
    fireEvent.click(screen.getByTestId(IDS.backToEditing));
    await screen.findByTestId(IDS.editor);
    expect(textarea().value).toBe(MINE);
  });

  it("draws the shared crumb '‹ Edit / mason/lessons.md': one button named 'Back to Edit', with the chevron and no word 'Back'", async () => {
    await conflict();
    const back = screen.getByRole("button", { name: "Back to Edit" });
    expect(back.getAttribute("data-testid")).toBe(IDS.backToEditing);
    expect(back.querySelector("svg")?.getAttribute("aria-hidden"), "the shared crumb's chevron").toBe("true");
    const crumb = back.parentElement as HTMLElement;
    expect(crumb.className).toBe("memory-crumb");
    expect(crumb.textContent).toBe(`Edit/${PATH}`);
  });

  it.each([
    [400, "not_markdown"],
    [400, "path_protected"],
    [404, "not_found"],
    [413, "body_too_large"],
    [500, "store_unreadable"],
  ])("a %i %s refusal keeps the draft and says it was not saved, naming the code", async (status, code) => {
    const kernel = await start();
    kernel.put = () => refused(status, { error: code });
    await openEditor();
    type(MINE);
    fireEvent.click(screen.getByTestId(IDS.save));
    const note = await screen.findByTestId(IDS.saveError);
    expect(note.textContent).toBe(`Not saved: the kernel refused it (${status} · ${code}). Your edit is kept here.`);
    expect(note.getAttribute("role")).toBe("alert");
    expect(textarea().value).toBe(MINE);
    expect(screen.queryByTestId(IDS.conflict)).toBeNull();
    expect(text(IDS.live)).toBe(note.textContent);
    expect(enabled(IDS.save)).toBe(true);
  });

  it("a save nobody answers keeps the draft and says so, naming why", async () => {
    const kernel = await start();
    kernel.put = () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "timeout" } });
    await openEditor();
    type(MINE);
    fireEvent.click(screen.getByTestId(IDS.save));
    const note = await screen.findByTestId(IDS.saveError);
    expect(note.textContent).toMatch(/^Not saved: the kernel did not answer \(timeout\)\. Your edit is kept here/);
    expect(textarea().value).toBe(MINE);
  });

  it("a 409 that does not carry both versions is a refusal like any other: the draft is kept", async () => {
    const kernel = await start();
    kernel.put = () => refused(409, { error: "changed_since_read" });
    await openEditor();
    type(MINE);
    fireEvent.click(screen.getByTestId(IDS.save));
    expect((await screen.findByTestId(IDS.saveError)).textContent).toContain("409 · changed_since_read");
    expect(screen.queryByTestId(IDS.conflict)).toBeNull();
    expect(textarea().value).toBe(MINE);
  });
});

// ---- AC9: the kernel unreachable --------------------------------------------------------------------------------------

describe("the kernel unreachable", () => {
  it("keeps the last tree marked last known, never falls back to the empty state, and turns Edit off", async () => {
    const kernel = await start();
    await openFile(PATH);
    kernel.tree = () => UNREACHABLE;
    emit(kernel, "memory_updated");
    await waitFor(() => expect(text(IDS.subtitle)).toBe("6 files · last known"));
    expect(screen.getByTestId(IDS.screen).getAttribute("data-offline")).toBe("true");
    expect(screen.getAllByTestId(IDS.fileButton)).toHaveLength(6);
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(screen.queryByTestId(IDS.error)).toBeNull();
    expect(enabled(IDS.edit)).toBe(false);
    expect(screen.getByTestId(IDS.contents).textContent).toBe(LESSONS);
    // A file button is off too (it stays focusable), and a click sends nothing.
    expect(fileButton("wright/role.md").getAttribute("aria-disabled")).toBe("true");
    const before = reads(kernel, "GET /memory/file").length;
    fireEvent.click(fileButton("wright/role.md"));
    expect(reads(kernel, "GET /memory/file")).toHaveLength(before);
  });

  it("shows no request text when the tree read gets no answer, and draws exactly one band (its own, while the shell's is not up)", async () => {
    const kernel = await start();
    expect(screen.queryAllByTestId(BAND)).toHaveLength(0);
    kernel.tree = () => UNREACHABLE;
    emit(kernel, "memory_updated");
    await waitFor(() => expect(text(IDS.subtitle)).toBe("6 files · last known"));
    expect(screen.getAllByTestId(BAND)).toHaveLength(1);
    expect(screen.getByTestId(IDS.screen).contains(screen.getByTestId(BAND))).toBe(true);
    expect(screen.queryByTestId(IDS.stale)).toBeNull();
    expectNoRequestText();
  });

  it("draws no band of its own while the shell's is up (the store reads unreachable)", async () => {
    const kernel = createKernel();
    kernel.fake.connectionAnswer = { state: "unreachable", reason: "daemon_not_running" };
    kernel.tree = () => UNREACHABLE;
    await mount(kernel);
    await screen.findByTestId(IDS.error);
    await waitFor(() => expect(screen.queryAllByTestId(BAND)).toHaveLength(0));
    expect(screen.getByTestId(IDS.screen).getAttribute("data-offline")).toBe("true");
    expectNoRequestText();
  });

  it("a file read that gets no answer keeps the text and names no request", async () => {
    const kernel = await start();
    await openFile(PATH);
    kernel.file = () => UNREACHABLE;
    emit(kernel, "memory_updated");
    const note = await screen.findByTestId(IDS.fileError);
    expect(note.textContent).toContain("Couldn't read this file again");
    expect(screen.getByTestId(IDS.contents).textContent).toBe(LESSONS);
    expectNoRequestText();
  });

  it("a screen mounted again while the kernel does not answer draws the last-known tree, never the skeleton or the error card", async () => {
    const kernel = await start();
    await waitFor(() => expect(text(IDS.root)).toBe(`${DATA_DIR}/memory/`));
    const order = screen.getAllByTestId(IDS.fileButton).map((b) => b.getAttribute("data-path"));
    cleanup();

    kernel.tree = () => UNREACHABLE;
    render(<Window api={kernel.fake.bridge} registry={kernel.registry} />);
    // Drawn at once from what answered earlier: no loading state, no error card, the same files in the same order.
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
    expect(screen.queryByTestId(IDS.error)).toBeNull();
    expect(screen.getAllByTestId(IDS.fileButton).map((b) => b.getAttribute("data-path"))).toEqual(order);
    expect(text(IDS.root)).toBe(`${DATA_DIR}/memory/`);
    await waitFor(() => expect(text(IDS.subtitle)).toBe("6 files · last known"));
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
    expect(screen.queryByTestId(IDS.error)).toBeNull();
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(screen.getAllByTestId(IDS.fileButton).map((b) => b.getAttribute("data-path"))).toEqual(order);
    expect(fileButton(PATH).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getAllByTestId(BAND)).toHaveLength(1);
    expectNoRequestText();
  });

  it("a screen mounted again with the kernel back draws the held tree at once, without a last-known mark, then the new read", async () => {
    const kernel = await start();
    cleanup();
    kernel.files.set("mason/people.md", "# People\n");
    render(<Window api={kernel.fake.bridge} registry={kernel.registry} />);
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
    expect(screen.getAllByTestId(IDS.fileButton)).toHaveLength(6);
    expect(screen.getByTestId(IDS.screen).getAttribute("data-offline")).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId(IDS.fileButton)).toHaveLength(7));
    expect(text(IDS.subtitle)).toBe("7 files");
  });

  it("recovers by itself when the next event brings an answer", async () => {
    const kernel = await start();
    kernel.tree = () => UNREACHABLE;
    emit(kernel, "memory_updated");
    await waitFor(() => expect(text(IDS.subtitle)).toContain("last known"));
    kernel.tree = () => ok(treeOf(kernel.files));
    emit(kernel, "memory_updated");
    await waitFor(() => expect(text(IDS.subtitle)).toBe("6 files"));
    expect(screen.queryAllByTestId(BAND)).toHaveLength(0);
  });

  it("the editor keeps its text and turns Save off; the conflict view keeps both versions and turns its actions off", async () => {
    const kernel = await start();
    await openEditor();
    type(MINE);
    expect(enabled(IDS.save)).toBe(true);
    kernel.tree = () => UNREACHABLE;
    emit(kernel, "memory_updated");
    await waitFor(() => expect(text(IDS.subtitle)).toBe("Edit · last known"));
    expect(textarea().value).toBe(MINE);
    expect(enabled(IDS.save)).toBe(false);
    fireEvent.click(screen.getByTestId(IDS.save));
    expect(kernel.puts).toEqual([]);
    expect(enabled(IDS.cancel)).toBe(true);

    // The same draft in the conflict view, after the kernel is back and then goes away again.
    kernel.tree = () => ok(treeOf(kernel.files));
    emit(kernel, "memory_updated");
    await waitFor(() => expect(text(IDS.subtitle)).toBe("Edit"));
    kernel.files.set(PATH, DISK);
    fireEvent.click(screen.getByTestId(IDS.save));
    await screen.findByTestId(IDS.conflict);
    kernel.tree = () => UNREACHABLE;
    emit(kernel, "memory_updated");
    await waitFor(() => expect(text(IDS.subtitle)).toBe("Changed since you opened it · last known"));
    for (const id of [IDS.discard, IDS.copy, IDS.onTop]) expect(enabled(id), id).toBe(false);
    expect(screen.getByTestId(IDS.mine).textContent).toBe(MINE);
    expect(screen.getByTestId(IDS.onDisk).textContent).toBe(DISK);
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
  });
});

// ---- AC10: the keys ------------------------------------------------------------------------------------------------------

describe("the keys", () => {
  const order = ["wright/role.md", "wright/lessons.md", "mason/lessons.md", "mason/role.md", "shared/README.md", "shared/about-me.md"];

  it("J and K and the arrows move between the files in the order the tree shows them, and stop at the ends", async () => {
    await start();
    fileButton(order[0] as string).focus();
    for (const key of ["j", "ArrowDown"]) {
      fireEvent.keyDown(document.activeElement as Element, { key });
    }
    expect(document.activeElement).toBe(fileButton(order[2] as string));
    fireEvent.keyDown(document.activeElement as Element, { key: "k" });
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement as Element, { key: "k" });
    expect(document.activeElement).toBe(fileButton(order[0] as string));
    fileButton(order[5] as string).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    expect(document.activeElement).toBe(fileButton(order[5] as string));
  });

  it("J does not move focus while the owner types in the textarea, and the arrows keep scrolling a file's text", async () => {
    await start();
    await openEditor();
    textarea().focus();
    fireEvent.keyDown(textarea(), { key: "j" });
    expect(document.activeElement).toBe(textarea());
    fireEvent.click(screen.getByTestId(IDS.cancel));
    await screen.findByTestId(IDS.fileView);
    const pre = screen.getByTestId(IDS.contents);
    pre.focus();
    fireEvent.keyDown(pre, { key: "ArrowDown" });
    expect(document.activeElement).toBe(pre);
    fireEvent.keyDown(pre, { key: "j" });
    expect(document.activeElement).toBe(fileButton(order[0] as string));
  });

  it("Enter on a file button opens it (a button's own click)", async () => {
    await start();
    const button = fileButton("shared/README.md");
    button.focus();
    // jsdom does not turn Enter into a click: press it as the browser does.
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    await screen.findByTestId(IDS.fileView);
    expect(text(IDS.fileTitle)).toBe("README.md");
  });

  it("Esc from the file view returns to the tree with focus on that file's button", async () => {
    await start();
    await openFile(PATH);
    fireEvent.keyDown(document.body, { key: "Escape" });
    await screen.findByTestId(IDS.overview);
    expect(screen.queryByTestId(IDS.fileView)).toBeNull();
    expect(document.activeElement).toBe(fileButton(PATH));
  });

  it("Esc from an unchanged editor returns to the file view; from a changed one it keeps the text", async () => {
    await start();
    await openEditor();
    fireEvent.keyDown(textarea(), { key: "Escape" });
    await screen.findByTestId(IDS.fileView);
    expect(document.activeElement).toBe(screen.getByTestId(IDS.edit));
    fireEvent.click(screen.getByTestId(IDS.edit));
    await screen.findByTestId(IDS.editor);
    type(MINE);
    fireEvent.keyDown(textarea(), { key: "Escape" });
    expect(screen.getByTestId(IDS.editor)).toBeTruthy();
    expect(textarea().value).toBe(MINE);
  });

  it("Edit puts focus in the textarea", async () => {
    await start();
    await openEditor();
    expect(document.activeElement).toBe(textarea());
  });

  it("holds its keys while the ⌘K palette or a dialog is open", async () => {
    await start();
    await openFile(PATH);
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByTestId(IDS.fileView)).toBeTruthy();
    dialog.remove();
  });
});

// ---- AC10: the ⌘K commands ------------------------------------------------------------------------------------------------

describe("the ⌘K commands", () => {
  const owned = (kernel: Kernel) => kernel.registry.list().filter((c) => c.owner === MEMORY_OWNER);

  it("lists 'Open memory/<path>' for every file, group Memory, owner memory, id memory.open:<path>", async () => {
    const kernel = await start();
    expect(owned(kernel).map((c) => [c.id, c.title, c.group])).toEqual(
      ["wright/role.md", "wright/lessons.md", "mason/lessons.md", "mason/role.md", "shared/README.md", "shared/about-me.md"].map((p) => [`memory.open:${p}`, `Open memory/${p}`, "Memory"]),
    );
    expect(owned(kernel).every((c) => c.owner === "memory")).toBe(true);
  });

  it("Open memory/<path> opens that file, and Edit memory/<path> appears while a file view is open", async () => {
    const kernel = await start();
    expect(kernel.registry.get("memory.edit")).toBeUndefined();
    act(() => {
      void kernel.registry.get(`memory.open:${PATH}`)?.run();
    });
    await waitFor(() => expect(screen.getByTestId(IDS.contents)).toBeTruthy());
    expect(text(IDS.fileTitle)).toBe("lessons.md");
    expect(document.activeElement).toBe(fileButton(PATH));
    const edit = kernel.registry.get("memory.edit");
    expect(edit?.title).toBe(`Edit memory/${PATH}`);
    expect(edit?.group).toBe("Memory");
    expect(edit?.owner).toBe("memory");
    act(() => {
      void edit?.run();
    });
    await screen.findByTestId(IDS.editor);
    expect(textarea().value).toBe(LESSONS);
    // In the editor there is no file view to edit.
    expect(kernel.registry.get("memory.edit")).toBeUndefined();
    fireEvent.click(screen.getByTestId(IDS.cancel));
    await screen.findByTestId(IDS.fileView);
    expect(kernel.registry.get("memory.edit")).toBeDefined();
  });

  it("registers a command for a file that appears in a later read", async () => {
    const kernel = await start();
    kernel.files.set("mason/people.md", "# People\n");
    emit(kernel, "memory_updated");
    await waitFor(() => expect(kernel.registry.get("memory.open:mason/people.md")).toBeDefined());
  });

  it("disables both commands while the kernel is unreachable", async () => {
    const kernel = await start();
    await openFile(PATH);
    expect(kernel.registry.get(`memory.open:${PATH}`)?.enabled?.()).toBe(true);
    expect(kernel.registry.get("memory.edit")?.enabled?.()).toBe(true);
    kernel.tree = () => UNREACHABLE;
    emit(kernel, "memory_updated");
    await waitFor(() => expect(text(IDS.subtitle)).toContain("last known"));
    expect(kernel.registry.get(`memory.open:${PATH}`)?.enabled?.()).toBe(false);
    expect(kernel.registry.get("memory.edit")?.enabled?.()).toBe(false);
  });

  it("unregisters every command on unmount", async () => {
    const kernel = await start();
    await openFile(PATH);
    expect(owned(kernel).length).toBeGreaterThan(6);
    cleanup();
    expect(owned(kernel)).toEqual([]);
  });
});

// ---- AC11: live ----------------------------------------------------------------------------------------------------------------

describe("live updates", () => {
  it.each(["memory_updated", "session_status"])("a %s event reads the tree again, without a reload", async (kind) => {
    const kernel = await start();
    const before = reads(kernel, "GET /memory").length;
    kernel.files.set("mason/people.md", "# People\n");
    emit(kernel, kind);
    await waitFor(() => expect(reads(kernel, "GET /memory").length).toBeGreaterThan(before));
    await waitFor(() => expect(fileButton("mason/people.md")).toBeTruthy());
    expect(text(IDS.subtitle)).toBe("7 files");
  });

  it.each(["session_output_appended", "approval_requested", "trigger_fired"])("a %s event does not read the tree", async (kind) => {
    const kernel = await start();
    // The first frame the feed delivers makes the store live, and a change of connection reads the tree once more: let that pass.
    emit(kernel, "event_done");
    await new Promise((resolve) => setTimeout(resolve, 60));
    const before = reads(kernel, "GET /memory").length;
    emit(kernel, kind);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reads(kernel, "GET /memory")).toHaveLength(before);
  });

  it("a file view that is not being edited reads its file again", async () => {
    const kernel = await start();
    await openFile(PATH);
    const before = reads(kernel, "GET /memory/file").length;
    kernel.files.set(PATH, DISK);
    emit(kernel, "memory_updated");
    await waitFor(() => expect(screen.getByTestId(IDS.contents).textContent).toBe(DISK));
    expect(reads(kernel, "GET /memory/file").length).toBeGreaterThan(before);
    expect(text(IDS.fileVersion)).toBe(sha(DISK).slice(0, 8));
  });

  it("the editor's draft is never replaced, and its file is not read again", async () => {
    const kernel = await start();
    await openEditor();
    type(MINE);
    const before = reads(kernel, "GET /memory/file").length;
    kernel.files.set(PATH, DISK);
    emit(kernel, "memory_updated");
    emit(kernel, "session_status");
    await waitFor(() => expect(reads(kernel, "GET /memory").length).toBeGreaterThan(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(textarea().value).toBe(MINE);
    expect(reads(kernel, "GET /memory/file")).toHaveLength(before);
    // ...and the save is still checked against the version the owner opened.
    fireEvent.click(screen.getByTestId(IDS.save));
    await screen.findByTestId(IDS.conflict);
  });

  it("keeps the rows' order and keys when a read changes only a size", async () => {
    const kernel = await start();
    const before = screen.getAllByTestId(IDS.fileButton);
    kernel.files.set("wright/role.md", "# Wright\n\nLead agent, grown.\n");
    emit(kernel, "memory_updated");
    await waitFor(() => expect(fileButton("wright/role.md").querySelector(".memory-file-size")?.textContent).toBe(`${Buffer.byteLength("# Wright\n\nLead agent, grown.\n")} B`));
    // The same elements, in the same places: rows are keyed by path.
    expect(screen.getAllByTestId(IDS.fileButton)).toEqual(before);
  });
});

// ---- AC12: accessibility and untrusted text ---------------------------------------------------------------------------------------

describe("accessibility and untrusted text", () => {
  it("announces through a polite live region", async () => {
    await start();
    const live = screen.getByTestId(IDS.live);
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
  });

  it("labels the textarea and every <pre>, and the conflict band is an alert", async () => {
    const kernel = await start();
    await openFile(PATH);
    expect(screen.getByLabelText(`Contents of ${PATH}`).tagName).toBe("PRE");
    fireEvent.click(screen.getByTestId(IDS.edit));
    await screen.findByTestId(IDS.editor);
    expect(screen.getByLabelText(`Contents of ${PATH}`).tagName).toBe("TEXTAREA");
    type(MINE);
    kernel.files.set(PATH, DISK);
    fireEvent.click(screen.getByTestId(IDS.save));
    await screen.findByTestId(IDS.conflict);
    for (const pre of document.querySelectorAll("pre")) expect(pre.getAttribute("aria-label"), pre.textContent ?? "").toMatch(/\S/);
    expect(screen.getByRole("alert").textContent).toContain("changed since you opened it");
  });

  it("shows a file's text literally: markup in it is text, never an element", async () => {
    const hostile = '# Notes\n<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script>\n[link](javascript:alert(1))\n';
    await start({ [PATH]: hostile, "wright/role.md": "x" });
    await openFile(PATH);
    const pre = screen.getByTestId(IDS.contents);
    expect(pre.textContent).toBe(hostile);
    expect(pre.querySelector("img, script, a")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("writes a control character or a bidi override in a path as an escape", async () => {
    await start({ "mason/a\u001b[2Jb.md": "x", "mason/c‮d.md": "y" });
    const labels = screen.getAllByTestId(IDS.fileButton).map((b) => b.getAttribute("aria-label"));
    expect(labels.join("|")).toContain("a\\x1b[2Jb.md");
    expect(labels.join("|")).toContain("c\\u202ed.md");
    expect(document.body.textContent).not.toContain("\u001b");
    expect(document.body.textContent).not.toContain("‮");
  });

  it("an empty file says so", async () => {
    await start({ [PATH]: "", "wright/role.md": "x" });
    await openFile(PATH);
    expect(screen.getByTestId(IDS.contents).textContent).toBe("");
    expect(screen.getByTestId(IDS.fileView).textContent).toContain("This file is empty.");
  });
});
