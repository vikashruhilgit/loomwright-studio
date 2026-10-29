// @vitest-environment jsdom
// The Connect GitHub sheet (phase 6 item 11, AC2, AC3, AC4, AC8 and AC13): one
// POST through the bridge with the pasted token, the field empty before that
// request resolves, the connecting phase, the inline refusals, the keyboard,
// and the secrecy pin: the token string is in no store snapshot, console call,
// page text, input value, URL or React hook state, on success and on each
// refusal, in connect mode and in replace mode.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "../../api/contract";
import { ok } from "../../store/fake-bridge";
import { liveStoreFor } from "../../store/react";
import { INTEGRATIONS_TEST_IDS as IDS } from "./model";
import { TOKEN, UNREACHABLE, connector, createKernel, deferred, mountScreen, refused, requests, startScreen } from "./test-support";
import type { Kernel, Setup } from "./test-support";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Mode = "connect" | "replace";

const field = (): HTMLInputElement => screen.getByTestId(IDS.sheetToken) as HTMLInputElement;
const connectButton = (): HTMLButtonElement => screen.getByTestId(IDS.sheetConnect) as HTMLButtonElement;
const rowWords = (): string | null => screen.getByTestId(IDS.listMeta).textContent;
const paste = (value: string): void => void fireEvent.change(field(), { target: { value } });
const declareBox = (): HTMLInputElement => screen.getByTestId(IDS.sheetDeclare) as HTMLInputElement;
/** Tick the owner's confirmation (idempotent): Connect needs it as well as a token. */
const tick = (): void => {
  if (!declareBox().checked) fireEvent.click(declareBox());
};

/** The screen with the sheet open: no token (connect mode) or a connected one (replace mode). */
async function openSheet(mode: Mode, setup: Setup = {}): Promise<Kernel> {
  const kernel = await startScreen(mode === "connect" ? { connectors: () => ok({ connectors: [] }), ...setup } : setup);
  const opener = screen.getByTestId(mode === "connect" ? IDS.emptyConnect : IDS.replace);
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByTestId(IDS.sheet).getAttribute("data-mode")).toBe(mode);
  return kernel;
}

const writeScoped: ApiResult<unknown> = refused(422, {
  error: "token_write_scoped",
  message: "this token can write: pull_requests",
  connector: {},
  write_permissions: [{ permission: "pull_requests", level: "write" }],
});
const invalid: ApiResult<unknown> = refused(422, { error: "token_invalid", message: "GitHub did not accept the token", connector: {} });
// The kernel's message names the API field; the sheet shows its own copy, which points at the confirmation box.
const permissionsUnknown: ApiResult<unknown> = refused(422, {
  error: "token_permissions_unknown",
  message: "GitHub did not report this token's permissions; confirm they are all Read (declared_read_only: true) to connect it",
  connector: {},
});

// ---- The secrecy detector -------------------------------------------------------------------------

const SKIPPED_KEYS = new Set(["_owner", "_debugOwner", "_debugStack", "_debugTask", "_debugInfo", "return", "child", "sibling", "alternate", "stateNode"]);

/** Whether `needle` is in any string reachable from `value` (own keys, Maps and Sets included; DOM nodes, functions and the fiber tree are not walked). */
function reaches(value: unknown, needle: string, seen: WeakSet<object> = new WeakSet(), depth = 0): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (typeof value !== "object" || value === null || depth > 14) return false;
  if (typeof Node !== "undefined" && value instanceof Node) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (value instanceof Map) return [...value].some((entry) => reaches(entry, needle, seen, depth + 1));
  if (value instanceof Set) return [...value].some((item) => reaches(item, needle, seen, depth + 1));
  return Object.entries(value).some(([key, item]) => !SKIPPED_KEYS.has(key) && reaches(item, needle, seen, depth + 1));
}

function fiberOf(element: Element): unknown {
  const key = Object.keys(element).find((k) => k.startsWith("__reactFiber$"));
  return key === undefined ? undefined : (element as unknown as Record<string, unknown>)[key];
}

/** Every hook state and prop on the fiber chain from `element` up to the root. */
function fiberChainReaches(element: Element, needle: string): boolean {
  let fiber = fiberOf(element) as { memoizedState?: unknown; memoizedProps?: unknown; return?: unknown } | undefined;
  if (fiber === undefined) throw new Error("no React fiber on the element");
  let steps = 0;
  while (fiber !== undefined && fiber !== null) {
    if (reaches(fiber.memoizedState, needle) || reaches(fiber.memoizedProps, needle)) return true;
    fiber = fiber.return as typeof fiber;
    steps += 1;
    if (steps > 200) throw new Error("fiber chain did not end");
  }
  return false;
}

function mapReplacer(_key: string, value: unknown): unknown {
  return value instanceof Map ? [...value] : value instanceof Set ? [...value] : value;
}

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

/** A console method spied and silenced, with the arguments of every call. */
interface ConsoleSpy {
  readonly calls: () => readonly (readonly unknown[])[];
}

function spyOnConsole(): ConsoleSpy[] {
  return CONSOLE_METHODS.map((method) => {
    const spy = vi.spyOn(console, method).mockImplementation(() => undefined);
    return { calls: () => spy.mock.calls as unknown as (readonly unknown[])[] };
  });
}

/** Every place the token must not be, checked from `element` (still in the DOM). */
function expectNoToken(kernel: Kernel, spies: ConsoleSpy[], element: Element): void {
  expect(JSON.stringify(liveStoreFor(kernel.fake.bridge).getSnapshot(), mapReplacer)).not.toContain(TOKEN);
  expect(reaches(liveStoreFor(kernel.fake.bridge).getSnapshot(), TOKEN)).toBe(false);
  for (const spy of spies) expect(JSON.stringify(spy.calls().map((args) => args.map((a) => (a instanceof Error ? a.message : String(a)))))).not.toContain(TOKEN);
  expect(document.body.textContent).not.toContain(TOKEN);
  expect(document.body.innerHTML).not.toContain(TOKEN);
  for (const input of Array.from(document.querySelectorAll("input"))) expect(input.value).not.toContain(TOKEN);
  expect(window.location.href).not.toContain(TOKEN);
  expect(fiberChainReaches(element, TOKEN)).toBe(false);
}

describe("the secrecy detector itself", () => {
  it("finds a token held in React state, a prop, a Map and a nested object, and not one that is absent", () => {
    function Leaky() {
      const [held, setHeld] = useState("");
      return <input data-testid="leaky" onChange={(e) => setHeld(e.target.value)} defaultValue="" data-held={held.length} />;
    }
    render(<Leaky />);
    const input = screen.getByTestId("leaky") as HTMLInputElement;
    expect(fiberChainReaches(input, TOKEN)).toBe(false);
    fireEvent.change(input, { target: { value: TOKEN } });
    expect(fiberChainReaches(input, TOKEN)).toBe(true);
    expect(reaches(new Map([["k", { deep: [TOKEN] }]]), TOKEN)).toBe(true);
    expect(reaches({ a: { b: "nothing" } }, TOKEN)).toBe(false);
  });
});

// ---- AC2: connect posts through the bridge ----------------------------------------------------------------------------

describe("connecting", () => {
  it("opens as the mockup's sheet: a labelled dialog, a password field with focus, and Connect off until something is pasted", async () => {
    await openSheet("connect");
    const sheet = screen.getByRole("dialog", { name: "Connect GitHub" });
    expect(within(sheet).getByLabelText("Token")).toBe(field());
    expect(field().type).toBe("password");
    expect(field().getAttribute("autocomplete")).toBe("off");
    expect(document.activeElement).toBe(field());
    expect(connectButton().disabled).toBe(true);
    paste("github_pat_x");
    // A token alone is not enough: the owner's confirmation is required too.
    expect(connectButton().disabled).toBe(true);
    tick();
    expect(connectButton().disabled).toBe(false);
    paste("   ");
    expect(connectButton().disabled).toBe(true);
  });

  it("asks for the owner's confirmation, unticked on open, labelled with the mockup's words and a caption that it is their word", async () => {
    await openSheet("connect");
    const box = within(screen.getByRole("dialog", { name: "Connect GitHub" })).getByLabelText("This is a fine-grained token, and every permission I gave it is Read");
    expect(box).toBe(declareBox());
    expect(declareBox().type).toBe("checkbox");
    expect(declareBox().checked).toBe(false);
    const hint = document.getElementById(declareBox().getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toBe("GitHub doesn't tell Studio what a fine-grained token can do, so Studio keeps this as your word, never as checked.");
  });

  it("Connect needs both: unticking turns it off again, and ⏎ with the box unticked sends nothing and keeps what was pasted", async () => {
    const kernel = await openSheet("connect");
    paste(TOKEN);
    fireEvent.keyDown(field(), { key: "Enter" });
    fireEvent.submit(field().closest("form") as HTMLFormElement);
    expect(requests(kernel, "POST /connectors/github/token")).toHaveLength(0);
    expect(field().value).toBe(TOKEN);
    tick();
    expect(connectButton().disabled).toBe(false);
    fireEvent.click(declareBox());
    expect(declareBox().checked).toBe(false);
    expect(connectButton().disabled).toBe(true);
    fireEvent.click(connectButton());
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(requests(kernel, "POST /connectors/github/token")).toHaveLength(0);
    expect(field().value).toBe(TOKEN);
  });

  it("the box is locked while the kernel checks, and stays ticked through a refusal so a retry needs only a new paste", async () => {
    const answer = deferred<ApiResult<unknown>>();
    const kernel = await openSheet("connect", { token: () => answer.promise });
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());
    expect(declareBox().disabled).toBe(true);
    expect(declareBox().checked).toBe(true);
    await act(async () => answer.resolve(invalid));
    await screen.findByTestId(IDS.sheetError);
    expect(declareBox().disabled).toBe(false);
    expect(declareBox().checked).toBe(true);
    expect(connectButton().disabled).toBe(true);
    paste(TOKEN);
    expect(connectButton().disabled).toBe(false);
    expect(requests(kernel, "POST /connectors/github/token")).toHaveLength(1);
  });

  it("a new sheet starts unticked again", async () => {
    await openSheet("connect");
    tick();
    fireEvent.click(screen.getByTestId(IDS.sheetCancel));
    expect(screen.queryByTestId(IDS.sheet)).toBeNull();
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    expect(declareBox().checked).toBe(false);
  });

  it("shows the token page as text to copy, not a link (the main process denies every window open)", async () => {
    await openSheet("connect");
    expect(screen.getByTestId(IDS.sheetPage).textContent).toContain("github.com/settings/personal-access-tokens/new");
    expect(within(screen.getByTestId(IDS.sheet)).queryByRole("link")).toBeNull();
  });

  it("Connect posts exactly one {method, path, body: {token}}, with the field empty and disabled before it resolves", async () => {
    const answer = deferred<ApiResult<unknown>>();
    const kernel = await openSheet("connect", { token: () => answer.promise });
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());

    // The request is out and unanswered.
    expect(requests(kernel, "POST /connectors/github/token")).toEqual([{ method: "POST", path: "/connectors/github/token", body: { token: TOKEN, declared_read_only: true } }]);
    expect(field().value).toBe("");
    expect(field().disabled).toBe(true);
    expect(field().getAttribute("placeholder")).toBe("Checking with GitHub…");
    expect(screen.getByTestId(IDS.sheetStatus).textContent).toBe("Checking with GitHub…");
    expect(connectButton().getAttribute("aria-busy")).toBe("true");
    expect(connectButton().textContent).toBe("Connecting");
    expect(rowWords()).toBe("connecting · checking the token with GitHub");

    await act(async () => answer.resolve(ok({ connector: connector("connected") })));
    await waitFor(() => expect(screen.queryByTestId(IDS.sheet)).toBeNull());
    expect(requests(kernel, "POST /connectors/github/token")).toHaveLength(1);
  });

  it("⏎ in the field connects, once, the same as the button", async () => {
    const answer = deferred<ApiResult<unknown>>();
    const kernel = await openSheet("connect", { token: () => answer.promise });
    paste(TOKEN);
    tick();
    fireEvent.keyDown(field(), { key: "Enter" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(requests(kernel, "POST /connectors/github/token")).toEqual([{ method: "POST", path: "/connectors/github/token", body: { token: TOKEN, declared_read_only: true } }]);
    expect(field().value).toBe("");
    await act(async () => answer.resolve(ok({ connector: connector("connected") })));
  });

  it("an empty or whitespace-only field sends nothing", async () => {
    const kernel = await openSheet("connect");
    tick();
    fireEvent.keyDown(field(), { key: "Enter" });
    paste("   ");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(requests(kernel, "POST /connectors/github/token")).toHaveLength(0);
    expect(field().value).toBe("");
  });

  it("the kernel's yes closes the sheet, re-reads GET /connectors and puts focus on the connector row", async () => {
    const kernel = await openSheet("connect");
    kernel.token = () => {
      kernel.connectors = () => ok({ connectors: [connector("connected")] });
      return ok({ connector: connector("connected") });
    };
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());
    await waitFor(() => expect(screen.queryByTestId(IDS.sheet)).toBeNull());
    await waitFor(() => expect(rowWords()).toBe("connected · octo-owner"));
    expect(requests(kernel, "GET /connectors").length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId(IDS.listRow)));
  });

  it("closing the sheet while the kernel checks leaves the check to finish: the row is still re-read", async () => {
    const answer = deferred<ApiResult<unknown>>();
    const kernel = await openSheet("replace", { token: () => answer.promise });
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());
    // Cancel holds focus while the field is disabled, and is not disabled itself.
    expect(document.activeElement).toBe(screen.getByTestId(IDS.sheetCancel));
    fireEvent.click(screen.getByTestId(IDS.sheetCancel));
    expect(screen.queryByTestId(IDS.sheet)).toBeNull();
    expect(rowWords()).toBe("connected · octo-owner");
    const before = requests(kernel, "GET /connectors").length;
    kernel.connectors = () => ok({ connectors: [connector("connected", { account_login: "later-owner" })] });
    await act(async () => answer.resolve(ok({ connector: connector("connected") })));
    await waitFor(() => expect(requests(kernel, "GET /connectors").length).toBeGreaterThan(before));
    await waitFor(() => expect(rowWords()).toBe("connected · later-owner"));
  });

  it("one token check at a time: after Cancel, neither the buttons nor ⌘K open a second sheet until the first is answered", async () => {
    const answer = deferred<ApiResult<unknown>>();
    const kernel = await openSheet("replace", { token: () => answer.promise });
    const spies = spyOnConsole();
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());
    fireEvent.click(screen.getByTestId(IDS.sheetCancel));
    expect(screen.queryByTestId(IDS.sheet)).toBeNull();

    // The Replace button, the Connect GitHub command and Disconnect all refuse, with a notice that says why.
    fireEvent.click(screen.getByTestId(IDS.replace));
    expect(screen.queryByTestId(IDS.sheet)).toBeNull();
    expect(screen.getByTestId(IDS.notice).textContent).toContain("still checking");
    act(() => void kernel.registry.get("integrations.connect-github")?.run());
    act(() => void kernel.registry.get("integrations.disconnect-github")?.run());
    expect(screen.queryByTestId(IDS.sheet)).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(requests(kernel, "POST /connectors/github/token")).toEqual([{ method: "POST", path: "/connectors/github/token", body: { token: TOKEN, declared_read_only: true } }]);

    // Once the kernel answers, the notice goes and a new sheet opens (still empty: the first token never came back).
    await act(async () => answer.resolve(ok({ connector: connector("connected") })));
    await waitFor(() => expect(screen.queryByTestId(IDS.notice)).toBeNull());
    fireEvent.click(screen.getByTestId(IDS.replace));
    expect(field().value).toBe("");
    expect(requests(kernel, "POST /connectors/github/token")).toHaveLength(1);
    expectNoToken(kernel, spies, screen.getByTestId(IDS.screen));
  });
});

// ---- AC4: refusals inline -----------------------------------------------------------------------------------------------

describe("refusals", () => {
  it("token_write_scoped: the sheet stays open, the field is empty, and the alert names each write permission and the fix", async () => {
    const kernel = await openSheet("connect", {
      token: () =>
        refused(422, {
          error: "token_write_scoped",
          message: "write",
          connector: {},
          write_permissions: [
            { permission: "pull_requests", level: "write" },
            { permission: "contents", level: "write" },
          ],
        }),
    });
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toBe(screen.getByTestId(IDS.sheetError));
    expect(within(alert).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Pull requests: write → set to Read-only", "Contents: write → set to Read-only"]);
    expect(alert.textContent).toContain("edit the token");
    expect(alert.textContent).toContain("paste it here again");
    expect(screen.getByTestId(IDS.sheet)).toBeTruthy();
    expect(field().value).toBe("");
    expect(field().disabled).toBe(false);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(field().getAttribute("placeholder")).toBe("Paste the changed or new token");
    await waitFor(() => expect(document.activeElement).toBe(field()));
    expect(requests(kernel, "POST /connectors/github/token")).toHaveLength(1);
    // Still not connected: the row did not move.
    expect(rowWords()).toBe("not connected");
  });

  it("token_invalid: the mockup's invalid copy, with the field empty", async () => {
    await openSheet("connect", { token: () => invalid });
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());
    const alert = await screen.findByTestId(IDS.sheetError);
    expect(alert.textContent).toContain("GitHub didn't accept this token.");
    expect(alert.textContent).toContain("github_pat_");
    expect(within(alert).queryByRole("listitem")).toBeNull();
    expect(field().value).toBe("");
  });

  it("token_permissions_unknown: the sheet's own copy, not the kernel's message, with the field empty", async () => {
    await openSheet("connect", { token: () => permissionsUnknown });
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toBe(screen.getByTestId(IDS.sheetError));
    expect(alert.textContent).toBe("GitHub doesn't report what this token can do. Tick the box that says every permission you gave it is Read, then connect again.");
    expect(alert.textContent).not.toContain("declared_read_only");
    expect(alert.textContent).not.toContain("OPEN_QUESTIONS");
    expect(within(alert).queryByRole("listitem")).toBeNull();
    expect(field().value).toBe("");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(rowWords()).toBe("not connected");
  });

  it("any other refusal shows the kernel's message as text", async () => {
    await openSheet("connect", { token: () => refused(429, { error: "rate_limited", message: "GitHub is rate limiting; try again in a minute", resets_at: "2026-10-28T12:00:00.000Z" }) });
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());
    expect((await screen.findByTestId(IDS.sheetError)).textContent).toBe("GitHub is rate limiting; try again in a minute");
  });

  it("an unreachable kernel is said in the bridge's words, not as a refusal of the token", async () => {
    await openSheet("connect", { token: () => UNREACHABLE });
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());
    expect((await screen.findByTestId(IDS.sheetError)).textContent).toBe("Couldn't reach the kernel (daemon_not_running).");
  });

  it("the owner can paste again after a refusal, and the next yes closes the sheet", async () => {
    const kernel = await openSheet("connect", { token: () => invalid });
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());
    await screen.findByTestId(IDS.sheetError);
    kernel.token = () => ok({ connector: connector("connected") });
    paste(TOKEN);
    tick();
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(screen.queryByTestId(IDS.sheet)).toBeNull());
    expect(requests(kernel, "POST /connectors/github/token")).toHaveLength(2);
  });

  it("a refusal in the list row's words: back from 'connecting' to what it was", async () => {
    await openSheet("connect", { token: () => invalid });
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());
    await screen.findByTestId(IDS.sheetError);
    expect(rowWords()).toBe("not connected");
  });
});

// ---- AC3 and AC13: the token is in no store, console line, text, URL or hook state ------------------------------

describe("secrecy", () => {
  const outcomes: readonly [string, ApiResult<unknown> | "ok"][] = [
    ["a success", "ok"],
    ["token_invalid", invalid],
    ["token_write_scoped", writeScoped],
    ["token_permissions_unknown", permissionsUnknown],
  ];

  describe.each<Mode>(["connect", "replace"])("in %s mode", (mode) => {
    beforeEach(() => {
      window.history.replaceState(null, "", "/");
    });

    it.each(outcomes)("after %s the token is nowhere, in flight or answered", async (_name, outcome) => {
      const spies = spyOnConsole();
      const answer = deferred<ApiResult<unknown>>();
      const kernel = await openSheet(mode, { token: () => answer.promise });
      const input = field();
      paste(TOKEN);
      tick();
      // Typing it is the one moment the field holds it.
      expect(input.value).toBe(TOKEN);
      fireEvent.click(connectButton());

      // The positive control: the bridge did get it, so the checks below could have found it.
      expect(JSON.stringify(requests(kernel, "POST /connectors/github/token"))).toContain(TOKEN);
      expectNoToken(kernel, spies, input);

      if (outcome === "ok") kernel.connectors = () => ok({ connectors: [connector("connected")] });
      await act(async () => answer.resolve(outcome === "ok" ? ok({ connector: connector("connected") }) : outcome));
      if (outcome === "ok") {
        await waitFor(() => expect(screen.queryByTestId(IDS.sheet)).toBeNull());
        await waitFor(() => expect(rowWords()).toContain("connected"));
        expectNoToken(kernel, spies, screen.getByTestId(IDS.screen));
      } else {
        await screen.findByTestId(IDS.sheetError);
        expect(input.value).toBe("");
        expectNoToken(kernel, spies, field());
      }
      // The refetch after the answer went through the same store.
      expectNoToken(kernel, spies, screen.getByTestId(IDS.screen));
    });
  });

  it("a refusal's error text is the kernel's, never built from the pasted value", async () => {
    await openSheet("connect", { token: () => refused(400, { error: "invalid_body", message: 'needs {"token": "<a GitHub token>"}' }) });
    paste(TOKEN);
    tick();
    fireEvent.click(connectButton());
    const alert = await screen.findByTestId(IDS.sheetError);
    expect(alert.textContent).toBe('needs {"token": "<a GitHub token>"}');
    expect(alert.textContent).not.toContain(TOKEN);
  });

  it("the field is uncontrolled: the screen never renders the value back, and the DOM value is the only copy until Connect", async () => {
    await openSheet("connect");
    paste(TOKEN);
    tick();
    expect(field().value).toBe(TOKEN);
    expect(field().getAttribute("value")).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(fiberChainReaches(field(), TOKEN)).toBe(false);
  });
});

// ---- AC8: keyboard alone ---------------------------------------------------------------------------------------------------------

describe("the sheet by keyboard", () => {
  it("Escape closes it with no request, and focus goes back to the opener", async () => {
    const kernel = await openSheet("connect");
    const opener = screen.getByTestId(IDS.emptyConnect);
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByTestId(IDS.sheet)).toBeNull();
    expect(requests(kernel, "POST /connectors/github/token")).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("Cancel closes it the same way", async () => {
    await openSheet("replace");
    const opener = screen.getByTestId(IDS.replace);
    fireEvent.click(screen.getByTestId(IDS.sheetCancel));
    expect(screen.queryByTestId(IDS.sheet)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("Tab and Shift+Tab stay inside the sheet", async () => {
    await openSheet("connect");
    // Connect is off while the field is empty or the box is unticked: the field, the confirmation, then Cancel.
    screen.getByTestId(IDS.sheetCancel).focus();
    expect(fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(field());
    expect(fireEvent.keyDown(field(), { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(screen.getByTestId(IDS.sheetCancel));
    declareBox().focus();
    expect(document.activeElement).toBe(declareBox());
    // With something pasted and the box ticked, Connect is the last stop.
    paste("github_pat_x");
    tick();
    connectButton().focus();
    fireEvent.keyDown(connectButton(), { key: "Tab" });
    expect(document.activeElement).toBe(field());
  });

  it("while the kernel is unreachable the sheet cannot be opened (the button and the command are off)", async () => {
    const kernel = createKernel({ connectors: () => UNREACHABLE });
    await mountScreen(kernel);
    expect(kernel.registry.get("integrations.connect-github")?.enabled?.()).toBe(false);
    act(() => void kernel.registry.get("integrations.connect-github")?.run());
    expect(screen.queryByTestId(IDS.sheet)).toBeNull();
  });
});

describe("the replace sheet", () => {
  it("says the current token stays in use until the new one passes the check", async () => {
    await openSheet("replace");
    expect(screen.getByRole("dialog").textContent).toContain("The current token stays in use until the new one passes the check.");
  });

  it("the connect sheet does not say so", async () => {
    await openSheet("connect");
    expect(screen.getByRole("dialog").textContent).not.toContain("stays in use");
  });
});
