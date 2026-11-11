// @vitest-environment jsdom
// Settings → Workspaces (phase 8 item 18c; the app side of AC1, AC3, AC4, AC5 and AC6) against a scripted bridge
// (`fake-bridge.ts`, with the folder picker `chooseFolder` and `homeDir` added): the pure readers (`parseWorkspaces`,
// `stateWords`, `lastUsedLabel`, `plainSentence`, `withGone`); the table of repo, path from `~` and last used; Missing
// and Can't be read in words; Add folder… through the picker, with the kernel's note or refusal shown in plain words;
// remove with Undo in place (and Undo's honest limit); the loading, empty, error and unknown states; no read or write
// while offline; kernel text shown literally; and no text input. The kernel's routes are covered by
// `kernel/test/console-workspaces.test.ts`, the built app by `e2e/settings-workspaces.spec.ts`.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiRequest, ApiResult, SavedWorkspace, StudioBridge } from "../../api/contract";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { WORKSPACES_TEST_IDS as IDS, WorkspacesSection, lastUsedLabel, parseWorkspaces, plainSentence, stateWords, withGone } from "./WorkspacesSection";
import type { WorkspaceRow } from "./WorkspacesSection";

afterEach(() => {
  cleanup();
});

const HOME = "/Users/owner";
const PROTECTED_WHY = "macOS blocks the kernel, which runs in the background, from reading anything there (D31)";
const protectedRefusal = (path: string): string =>
  `${path} is inside a macOS-protected folder (~/Documents, ~/Desktop, ~/Downloads, ~/Library/Mobile Documents), so it can't be used: ${PROTECTED_WHY}; use a copy of the repo outside those folders`;
const noRemoteNote = (path: string): string => `${path} has no GitHub remote, so it won't be matched to a repo; it is saved, but a lookup by repo won't offer it`;

const minutesAgo = (n: number): string => new Date(Date.now() - n * 60_000).toISOString();
const ws = (id: number, path: string, repo: string | null, state: SavedWorkspace["state"] = "ready", lastUsed = minutesAgo(id)): SavedWorkspace => ({
  id,
  path,
  repo,
  added_at: lastUsed,
  last_used_at: lastUsed,
  state,
});
const refused = (status: number, body: { readonly error: string } & Record<string, unknown>): ApiResult<unknown> => ({ ok: false, status, body });
const UNREACHABLE: ApiResult<unknown> = { ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } };

type Answer = ApiResult<unknown> | Promise<ApiResult<unknown>>;

/** A kernel holding a saved list, answering the three routes the way `kernel/src/console/workspaces.ts` does. */
interface Kernel {
  readonly fake: FakeBridge;
  readonly api: StudioBridge;
  list: SavedWorkspace[];
  nextId: number;
  /** What `GET /workspaces` answers; default the list. */
  read: () => Answer;
  /** What `POST /workspaces` answers for a path; default: save it as a ready `o/r` checkout. */
  save: (path: string) => Answer;
  /** What the folder picker answers next. */
  pick: () => Promise<string | null>;
  picks: number;
}

function createKernel(list: SavedWorkspace[] = [], options: { readonly picker?: boolean } = {}): Kernel {
  const fake = fakeBridge();
  const upsert = (path: string, repo: string | null): SavedWorkspace => {
    const now = new Date().toISOString();
    const held = kernel.list.find((w) => w.path === path);
    const saved: SavedWorkspace = held === undefined ? { id: kernel.nextId++, path, repo, added_at: now, last_used_at: now, state: "ready" } : { ...held, repo, last_used_at: now };
    kernel.list = [saved, ...kernel.list.filter((w) => w.path !== path)];
    return saved;
  };
  const api: StudioBridge = {
    ...fake.bridge,
    homeDir: async () => HOME,
    ...(options.picker === false
      ? {}
      : {
          chooseFolder: async () => {
            kernel.picks += 1;
            return kernel.pick();
          },
        }),
  };
  const kernel: Kernel = {
    fake,
    api,
    list,
    nextId: 100,
    picks: 0,
    read: () => ok({ workspaces: kernel.list }),
    save: (path) => {
      const repo = path.includes("no-remote") ? null : "o/r";
      const saved = upsert(path, repo);
      return ok({ workspace: saved, note: repo === null ? noRemoteNote(path) : null });
    },
    pick: async () => `${HOME}/code/new-checkout`,
  };
  fake.route("GET /workspaces", () => kernel.read());
  fake.route("POST /workspaces", (req: ApiRequest) => kernel.save(String((req.body as { path?: unknown }).path)));
  fake.route("POST /workspaces/:id/remove", (req: ApiRequest) => {
    const id = Number(req.params?.id);
    if (!kernel.list.some((w) => w.id === id)) return refused(404, { error: "not_found", message: `no saved workspace "${id}"` });
    kernel.list = kernel.list.filter((w) => w.id !== id);
    return ok({ removed: id });
  });
  return kernel;
}

const rows = (): HTMLElement[] => screen.queryAllByTestId(IDS.row);
const rowFor = (id: number): HTMLElement => {
  const found = rows().find((r) => r.dataset.id === String(id));
  if (found === undefined) throw new Error(`no row ${id}`);
  return found;
};
const cell = (id: number, testId: string): string => within(rowFor(id)).getByTestId(testId).textContent ?? "";
const notice = (): string => screen.getByTestId(IDS.notice).textContent ?? "";

function mount(kernel: Kernel, offline = false) {
  return render(<WorkspacesSection api={kernel.api} offline={offline} />);
}

/** Mount and wait for the list (and the home folder, so paths read from `~`). */
async function mountListed(kernel: Kernel): Promise<void> {
  mount(kernel);
  await waitFor(() => expect(screen.queryByTestId(IDS.loading)).toBeNull());
  if (kernel.list.length > 0) await waitFor(() => expect(screen.getAllByTestId(IDS.path)[0]?.textContent).toMatch(/^~/));
}

// ---- The pure readers -----------------------------------------------------------------------------------------------

describe("parseWorkspaces", () => {
  it("keeps the contract's fields of each row, made inert, and drops a row that is not the shape", () => {
    const parsed = parseWorkspaces({
      workspaces: [ws(1, "/Users/owner/code/a", "o/r"), { id: "2", path: "/x" }, { id: 3, path: "" }, { id: 4, path: "/y", repo: 5 }, ws(5, "/Users/owner/code/b‮", null, "missing")],
      extra: "sk-ant-oat01-NOT-A-TOKEN",
    });
    expect(parsed?.map((r) => r.id)).toEqual([1, 5]);
    expect(parsed?.[0]).toMatchObject({ path: "/Users/owner/code/a", repo: "o/r", state: "ready" });
    expect(parsed?.[1]?.repo).toBeNull();
    expect(parsed?.[1]?.path).not.toContain("‮");
  });

  it.each([["null", null], ["no list", {}], ["a list that is not an array", { workspaces: "x" }], ["an array body", []]] as const)("is undefined for %s", (_n, body) => {
    expect(parseWorkspaces(body)).toBeUndefined();
  });
});

describe("the words", () => {
  it("says a state in words, never claiming ready for anything else", () => {
    expect(stateWords("ready")).toBeUndefined();
    expect(stateWords("missing")).toBe("Missing");
    expect(stateWords("unreadable")).toBe("Can't be read");
    expect(stateWords("gone_fishing")).toBe("gone_fishing");
    expect(stateWords("")).toBe("Unknown");
  });

  it("last used reads 'Today, HH:MM' today and 'D Mon' on another day; a time that does not parse as it came", () => {
    const now = new Date(2026, 10, 11, 15, 0);
    expect(lastUsedLabel(new Date(2026, 10, 11, 9, 40).toISOString(), now)).toBe("Today, 09:40");
    expect(lastUsedLabel(new Date(2026, 9, 2, 9, 40).toISOString(), now)).toBe("2 Oct");
    expect(lastUsedLabel("not a time", now)).toBe("not a time");
  });

  it("a kernel sentence reads its leading path from ~ and ends with a full stop", () => {
    expect(plainSentence(noRemoteNote(`${HOME}/code/x`), [`${HOME}/code/x`], HOME)).toBe(
      "~/code/x has no GitHub remote, so it won't be matched to a repo; it is saved, but a lookup by repo won't offer it.",
    );
    expect(plainSentence("Done.", [], HOME)).toBe("Done.");
    expect(plainSentence(`${HOME}/a x`, [`${HOME}/a`], undefined)).toBe(`${HOME}/a x.`);
    expect(plainSentence("a\u0007b", [], HOME)).not.toContain("\u0007");
  });

  it("puts a removed row back at its place in the list", () => {
    const row = (id: number): WorkspaceRow => ({ id, path: `/p${id}`, repo: null, lastUsedAt: "", state: "ready" });
    const gone = new Map([[2, { row: row(2), index: 1 }]]);
    expect(withGone([row(1), row(3)], gone).map((s) => `${s.kind}:${s.row.id}`)).toEqual(["row:1", "gone:2", "row:3"]);
    expect(withGone([], gone).map((s) => `${s.kind}:${s.row.id}`)).toEqual(["gone:2"]);
  });
});

// ---- AC1: the list ----------------------------------------------------------------------------------------------------

describe("the list (AC1)", () => {
  it("shows each saved workspace's repo, path from ~ and last used, most recently used first as the kernel sent them", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/studio-sandbox`, "o/r", "ready", minutesAgo(1)), ws(2, `${HOME}/src/old`, "o/s", "ready", new Date(2026, 9, 2, 10, 0).toISOString())]);
    await mountListed(kernel);
    const table = screen.getByTestId(IDS.table);
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Repo", "Path", "Last used", "Remove"]);
    expect(rows().map((r) => r.dataset.id)).toEqual(["1", "2"]);
    expect(cell(1, IDS.repo)).toBe("o/r");
    expect(cell(1, IDS.path)).toBe("~/code/studio-sandbox");
    expect(cell(1, IDS.used)).toMatch(/^Today, \d{2}:\d{2}$/);
    expect(cell(2, IDS.used)).toBe("2 Oct");
    expect(within(rowFor(1)).queryByTestId(IDS.state)).toBeNull();
    expect(kernel.fake.requestsTo("GET /workspaces").map((r) => r.req)).toEqual([{ method: "GET", path: "/workspaces" }]);
  });

  it("a row with no GitHub remote says so in the repo column", async () => {
    await mountListed(createKernel([ws(1, `${HOME}/code/x`, null)]));
    expect(cell(1, IDS.repo)).toBe("No GitHub remote");
  });

  it("each remove icon is a named button with its tooltip, and there is no text input", async () => {
    const { container } = mount(createKernel([ws(1, `${HOME}/code/x`, "o/r")]));
    await screen.findAllByTestId(IDS.row);
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove ~/code/x" })).toBeTruthy());
    const button = screen.getByRole("button", { name: "Remove ~/code/x" });
    expect(button.querySelector(".settings-ws-tip")?.textContent).toBe("Remove ~/code/x");
    expect(button.querySelector(".settings-ws-tip")?.getAttribute("aria-hidden")).toBe("true");
    fireEvent.keyDown(button, { key: "Escape" });
    expect(button.dataset.tipHidden).toBe("true");
    fireEvent.blur(button);
    expect(button.dataset.tipHidden).toBeUndefined();
    expect(container.querySelectorAll("input, textarea, select, [contenteditable]:not([contenteditable='false'])")).toHaveLength(0);
  });

  it("shows kernel text literally, never as markup", async () => {
    const { container } = mount(createKernel([ws(1, "/tmp/<img src=x onerror=alert(1)>", "<b>o</b>/r")]));
    await screen.findAllByTestId(IDS.row);
    expect(cell(1, IDS.repo)).toBe("<b>o</b>/r");
    expect(container.querySelector("img, b")).toBeNull();
  });
});

// ---- AC4: missing and unreadable --------------------------------------------------------------------------------------

describe("a folder that moved or can't be read (AC4)", () => {
  it("labels a missing row 'Missing' and an unreadable one 'Can't be read', in words, and explains both", async () => {
    await mountListed(createKernel([ws(1, `${HOME}/code/moved`, "o/r", "missing"), ws(2, `${HOME}/code/locked`, "o/r", "unreadable"), ws(3, `${HOME}/code/fine`, "o/r", "ready")]));
    expect(cell(1, IDS.state)).toContain("Missing");
    expect(cell(2, IDS.state)).toContain("Can't be read");
    expect(within(rowFor(3)).queryByTestId(IDS.state)).toBeNull();
    expect(rowFor(1).dataset.state).toBe("missing");
    expect(screen.getByText(/^Missing: the folder or its \.git was moved, renamed or deleted\./)).toBeTruthy();
  });
});

// ---- Add folder… (AC5, AC6) -------------------------------------------------------------------------------------------

describe("Add folder…", () => {
  it("opens the picker, saves the chosen path and puts the saved row first", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/a`, "o/r")]);
    await mountListed(kernel);
    fireEvent.click(screen.getByTestId(IDS.add));
    await waitFor(() => expect(rows().map((r) => r.dataset.id)).toEqual(["100", "1"]));
    expect(kernel.picks).toBe(1);
    expect(kernel.fake.requestsTo("POST /workspaces").map((r) => r.req.body)).toEqual([{ path: `${HOME}/code/new-checkout` }]);
    expect(cell(100, IDS.path)).toBe("~/code/new-checkout");
    expect(screen.queryByTestId(IDS.notice)).toBeNull();
    expect(screen.getByTestId(IDS.live).textContent).toBe("Saved ~/code/new-checkout.");
    await waitFor(() => expect(kernel.fake.requestsTo("GET /workspaces")).toHaveLength(2));
  });

  it("AC5: a folder with no GitHub remote is saved and the kernel's note is shown in plain words", async () => {
    const kernel = createKernel();
    kernel.pick = async () => `${HOME}/code/no-remote`;
    await mountListed(kernel);
    fireEvent.click(screen.getByTestId(IDS.add));
    await waitFor(() => expect(screen.getByTestId(IDS.notice)).toBeTruthy());
    expect(notice()).toBe("~/code/no-remote has no GitHub remote, so it won't be matched to a repo; it is saved, but a lookup by repo won't offer it.");
    expect(screen.getByTestId(IDS.notice).dataset.tone).toBe("attention");
    expect(cell(100, IDS.repo)).toBe("No GitHub remote");
  });

  it("AC6: a protected folder's refusal is shown in plain words, and the list is unchanged", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/a`, "o/r")]);
    const chosen = `${HOME}/Documents/work/studio-sandbox`;
    kernel.pick = async () => chosen;
    kernel.save = () => refused(400, { error: "protected_folder", message: protectedRefusal(chosen) });
    await mountListed(kernel);
    fireEvent.click(screen.getByTestId(IDS.add));
    await waitFor(() => expect(screen.getByTestId(IDS.notice)).toBeTruthy());
    expect(notice()).toBe(
      `Not saved: ~/Documents/work/studio-sandbox. ~/Documents/work/studio-sandbox is inside a macOS-protected folder (~/Documents, ~/Desktop, ~/Downloads, ~/Library/Mobile Documents), so it can't be used: ${PROTECTED_WHY}; use a copy of the repo outside those folders.`,
    );
    expect(screen.getByTestId(IDS.notice).dataset.tone).toBe("attention");
    expect(rows().map((r) => r.dataset.id)).toEqual(["1"]);
    expect(kernel.fake.requestsTo("GET /workspaces")).toHaveLength(1);
  });

  it("AC6: a folder that is not a git checkout is refused in plain words", async () => {
    const kernel = createKernel();
    kernel.pick = async () => `${HOME}/notes`;
    kernel.save = () => refused(400, { error: "not_checkout", message: `${HOME}/notes can't be saved: it is not a git checkout (no .git)` });
    await mountListed(kernel);
    fireEvent.click(screen.getByTestId(IDS.add));
    await waitFor(() => expect(notice()).toBe("Not saved: ~/notes. ~/notes can't be saved: it is not a git checkout (no .git)."));
    expect(screen.getByTestId(IDS.empty)).toBeTruthy();
  });

  it("a cancelled picker sends nothing and says nothing", async () => {
    const kernel = createKernel();
    kernel.pick = async () => null;
    await mountListed(kernel);
    fireEvent.click(screen.getByTestId(IDS.add));
    await waitFor(() => expect(kernel.picks).toBe(1));
    await waitFor(() => expect(screen.getByTestId(IDS.add).getAttribute("aria-busy")).toBeNull());
    expect(kernel.fake.requestsTo("POST /workspaces")).toHaveLength(0);
    expect(screen.queryByTestId(IDS.notice)).toBeNull();
  });

  it("a picker that can't open says so; a save the kernel did not answer says nothing was changed", async () => {
    const kernel = createKernel();
    kernel.pick = async () => {
      throw new Error("Error invoking remote method 'studio:choose-folder'");
    };
    await mountListed(kernel);
    fireEvent.click(screen.getByTestId(IDS.add));
    await waitFor(() => expect(notice()).toBe("Couldn't open the folder picker. Nothing was changed."));
    kernel.pick = async () => `${HOME}/code/x`;
    kernel.save = () => UNREACHABLE;
    fireEvent.click(screen.getByTestId(IDS.add));
    await waitFor(() => expect(notice()).toBe("Not saved: ~/code/x: the kernel could not be reached. Nothing was changed."));
    kernel.save = () => refused(500, { error: "store_unreadable" });
    fireEvent.click(screen.getByTestId(IDS.add));
    await waitFor(() => expect(notice()).toBe("Not saved: ~/code/x: POST /workspaces · 500 · store_unreadable."));
    expect(screen.getByTestId(IDS.notice).dataset.tone).toBe("danger");
  });

  it("a bridge with no folder picker offers no Add folder", async () => {
    await mountListed(createKernel([], { picker: false }));
    expect(screen.getByTestId(IDS.empty)).toBeTruthy();
    expect(screen.queryByTestId(IDS.add)).toBeNull();
  });
});

// ---- AC3: remove and Undo ---------------------------------------------------------------------------------------------

describe("remove and Undo (AC3)", () => {
  it("forgets only that row, shows it removed in place with Undo focused, and says the folder and crew settings are untouched", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/a`, "o/r"), ws(2, `${HOME}/code/b`, "o/r"), ws(3, `${HOME}/code/c`, "o/s")]);
    await mountListed(kernel);
    fireEvent.click(screen.getByRole("button", { name: "Remove ~/code/b" }));
    const gone = await screen.findByTestId(IDS.gone);
    expect(kernel.fake.requestsTo("POST /workspaces/:id/remove").map((r) => r.req.params)).toEqual([{ id: 2 }]);
    expect(gone.textContent).toBe(
      "Removed ~/code/b from your saved workspaces. The folder is still on disk, and no crew member's settings change. Undo saves it again, as used now. Undo",
    );
    // In place: between the two rows it was between, after the list is read again.
    await waitFor(() => expect(kernel.fake.requestsTo("GET /workspaces")).toHaveLength(2));
    const order = Array.from(screen.getByTestId(IDS.table).querySelectorAll("tbody tr")).map((tr) => `${tr.getAttribute("data-testid")}:${tr.getAttribute("data-id")}`);
    expect(order).toEqual([`${IDS.row}:1`, `${IDS.gone}:2`, `${IDS.row}:3`]);
    expect(document.activeElement).toBe(within(gone).getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId(IDS.live).textContent).toBe("Removed ~/code/b.");
  });

  it("Undo saves the same path again: the row is back (used now, with the kernel's new id) and its remove icon has focus", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/a`, "o/r"), ws(2, `${HOME}/code/b`, "o/r")]);
    await mountListed(kernel);
    fireEvent.click(screen.getByRole("button", { name: "Remove ~/code/b" }));
    fireEvent.click(await screen.findByTestId(IDS.undo));
    await waitFor(() => expect(screen.queryByTestId(IDS.gone)).toBeNull());
    expect(kernel.fake.requestsTo("POST /workspaces").map((r) => r.req.body)).toEqual([{ path: `${HOME}/code/b` }]);
    expect(rows().map((r) => r.dataset.id)).toEqual(["100", "1"]);
    expect(cell(100, IDS.used)).toMatch(/^Today, /);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove ~/code/b" })));
    expect(screen.getByTestId(IDS.live).textContent).toBe("~/code/b is back in your saved workspaces.");
  });

  it("a double-click on remove or Undo sends one request each, never a second that would read as a failure", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/a`, "o/r")]);
    await mountListed(kernel);
    const remove = screen.getByRole("button", { name: "Remove ~/code/a" });
    fireEvent.click(remove);
    fireEvent.click(remove);
    const undoButton = await screen.findByTestId(IDS.undo);
    expect(kernel.fake.requestsTo("POST /workspaces/:id/remove")).toHaveLength(1);
    expect(screen.queryByTestId(IDS.notice)).toBeNull();
    fireEvent.click(undoButton);
    fireEvent.click(undoButton);
    await waitFor(() => expect(screen.queryByTestId(IDS.gone)).toBeNull());
    expect(kernel.fake.requestsTo("POST /workspaces")).toHaveLength(1);
  });

  it("an Undo the kernel refuses keeps the removed row and says why", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/a`, "o/r")]);
    await mountListed(kernel);
    fireEvent.click(screen.getByRole("button", { name: "Remove ~/code/a" }));
    kernel.save = (path) => refused(400, { error: "not_checkout", message: `${path} can't be saved: it does not exist` });
    fireEvent.click(await screen.findByTestId(IDS.undo));
    await waitFor(() => expect(notice()).toBe("Couldn't put back ~/code/a. ~/code/a can't be saved: it does not exist."));
    expect(screen.getByTestId(IDS.gone)).toBeTruthy();
  });

  it("a remove the kernel refuses keeps the row and says why", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/a`, "o/r")]);
    await mountListed(kernel);
    kernel.list = [];
    fireEvent.click(screen.getByRole("button", { name: "Remove ~/code/a" }));
    await waitFor(() => expect(notice()).toBe('Couldn\'t remove ~/code/a: POST /workspaces/1/remove · 404 · no saved workspace "1".'));
    expect(rows().map((r) => r.dataset.id)).toEqual(["1"]);
    expect(screen.queryByTestId(IDS.gone)).toBeNull();
  });
});

// ---- The states -------------------------------------------------------------------------------------------------------

describe("the states", () => {
  it("loading: skeleton rows while the read is held, then the list", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/a`, "o/r")]);
    let release: (a: ApiResult<unknown>) => void = () => undefined;
    kernel.read = () => new Promise((resolve) => (release = resolve));
    mount(kernel);
    const loading = await screen.findByTestId(IDS.loading);
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(within(loading).getByRole("status").textContent).toBe("Loading your saved workspaces");
    expect(screen.queryByTestId(IDS.add)).toBeNull();
    await act(async () => release(ok({ workspaces: kernel.list })));
    await screen.findByTestId(IDS.row);
  });

  it("empty: says there are none yet, with Add folder…", async () => {
    await mountListed(createKernel());
    expect(screen.getByTestId(IDS.empty).textContent).toBe("No saved workspaces yet. Add folder… saves one.");
    expect(screen.getByTestId(IDS.add).textContent).toBe("Add folder…");
  });

  it("error: a card naming the request, nothing changed, and Try again reads once more", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/a`, "o/r")]);
    kernel.read = () => refused(500, { error: "store_unreadable" });
    mount(kernel);
    const card = await screen.findByTestId(IDS.error);
    expect(card.getAttribute("role")).toBe("alert");
    expect(within(card).getByRole("heading").textContent).toBe("Couldn't read your saved workspaces");
    expect(screen.getByTestId(IDS.errorDetail).textContent).toBe("GET /workspaces · 500 · store_unreadable");
    expect(screen.queryByTestId(IDS.add)).toBeNull();
    kernel.read = () => ok({ workspaces: kernel.list });
    fireEvent.click(screen.getByTestId(IDS.retry));
    await screen.findByTestId(IDS.row);
    expect(screen.queryByTestId(IDS.error)).toBeNull();
  });

  it("an answer that is not the contract's shape is the error card, never a throw", async () => {
    const kernel = createKernel();
    kernel.read = () => ok({ rows: [] });
    mount(kernel);
    expect((await screen.findByTestId(IDS.errorDetail)).textContent).toBe("GET /workspaces · the answer is not a list of saved workspaces");
  });

  it("with the list held, a later failed read keeps the rows and says what is shown is the last read", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/a`, "o/r")]);
    await mountListed(kernel);
    kernel.read = () => refused(503, { error: "busy" });
    kernel.save = () => ok({ workspace: ws(1, `${HOME}/code/a`, "o/r"), note: null });
    fireEvent.click(screen.getByTestId(IDS.add));
    await screen.findByText(/^Couldn't refresh your saved workspaces: GET \/workspaces · 503 · busy\. What is shown is the last read\.$/);
    expect(rows().map((r) => r.dataset.id)).toEqual(["1"]);
  });

  it("offline with nothing held: unknown until the kernel answers, and no read is sent", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/a`, "o/r")]);
    mount(kernel, true);
    expect((await screen.findByTestId(IDS.unknown)).textContent).toBe("Unknown until the kernel answers.");
    expect(kernel.fake.requestsTo("GET /workspaces")).toHaveLength(0);
  });

  it("an unreachable read with nothing held says unknown, not loading", async () => {
    const kernel = createKernel();
    kernel.read = () => UNREACHABLE;
    mount(kernel);
    await screen.findByTestId(IDS.unknown);
  });

  it("going offline keeps the list and disables Add, remove and Undo; coming back reads again", async () => {
    const kernel = createKernel([ws(1, `${HOME}/code/a`, "o/r"), ws(2, `${HOME}/code/b`, "o/r")]);
    const view = mount(kernel);
    await screen.findAllByTestId(IDS.row);
    fireEvent.click(screen.getAllByTestId(IDS.remove)[1] as HTMLElement);
    await screen.findByTestId(IDS.undo);
    view.rerender(<WorkspacesSection api={kernel.api} offline />);
    expect(rows().map((r) => r.dataset.id)).toEqual(["1"]);
    expect((screen.getByTestId(IDS.add) as HTMLButtonElement).disabled).toBe(true);
    for (const b of screen.getAllByTestId(IDS.remove)) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(IDS.undo) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId(IDS.add));
    expect(kernel.picks).toBe(0);
    const before = kernel.fake.requestsTo("GET /workspaces").length;
    view.rerender(<WorkspacesSection api={kernel.api} offline={false} />);
    await waitFor(() => expect(kernel.fake.requestsTo("GET /workspaces").length).toBe(before + 1));
  });
});
