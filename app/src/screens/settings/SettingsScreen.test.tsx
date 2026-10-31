// @vitest-environment jsdom
// The Settings screen (phase 7 item 08, AC2, AC3, AC4 to AC9) against a scripted bridge
// (`fake-bridge.ts`, whose `prefs` member stands in for the main process): the states (loading,
// populated, expiring, missing, a route failure, unreachable with and without data), the
// provider's facts and the three terminal commands, no secret anywhere (a body's extra field is
// never shown nor kept), no input and no sign-in control, the app's own preferences (launch at
// login read from the OS, notifications, theme, Reveal), the kernel unreachable, the live
// refetch, untrusted text shown literally and the ⌘K commands. The real kernel's route is covered
// by `kernel/test/gui-settings.test.ts`; the main process by `electron/settings.test.ts`; the
// built app by `e2e/settings.spec.ts`.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiRequest, ApiResult, AppPreferences, AuthHealth, StatusBody } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { SETUP_STEPS } from "../../shell/KernelStates";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { liveStoreFor } from "../../store/react";
import { SETTINGS_OWNER } from "./commands";
import { SETTINGS_TEST_IDS as IDS } from "./model";
import { SettingsScreen } from "./SettingsScreen";

afterEach(() => {
  cleanup();
  window.location.hash = "";
  vi.restoreAllMocks();
});

// ---- A scripted kernel --------------------------------------------------------------------------------------

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
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** Slightly less than `n` days ago, so the whole days left are exactly 365 - n however long the test takes to run. */
const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000 + 3_600_000).toISOString();

/** A token that must appear nowhere: the test plants it where a careless screen would show or keep it. */
const SECRET = "sk-ant-oat01-NOT-A-REAL-TOKEN-0123456789abcdef";

interface Body {
  readonly health?: AuthHealth;
  readonly created?: string | null;
  readonly account?: string | null;
  readonly dataDir?: string;
  readonly notifier?: string;
  readonly loomwright?: unknown;
  /** Extra fields a kernel might add, at the top and in the provider. */
  readonly extra?: Record<string, unknown>;
}

function settingsBody(o: Body = {}): Record<string, unknown> {
  return {
    provider: {
      id: "subscription-token",
      account: o.account === undefined ? "personal subscription" : o.account,
      health: o.health ?? { status: "ok" },
      token_created_at: o.created === undefined ? daysAgo(100) : o.created,
      ...o.extra,
    },
    data_dir: o.dataDir ?? "/Users/owner/.loomwright-studio",
    notifier: o.notifier ?? "osascript",
    loomwright: o.loomwright ?? { status: "ok", install_path: "/Users/owner/.claude/plugins/loomwright", plugin_version: "17.22.0", contract_schema_version: 1, host_switch: true },
    ...o.extra,
  };
}

type Answer = ApiResult<unknown> | Promise<ApiResult<unknown>>;

interface Kernel {
  readonly fake: FakeBridge;
  readonly registry: CommandRegistry;
  settings: (req: ApiRequest) => Answer;
}

function createKernel(settings: Kernel["settings"] = () => ok(settingsBody())): Kernel {
  const fake = fakeBridge();
  const kernel: Kernel = { fake, registry: createCommandRegistry(), settings };
  fake.route("GET /status", () => ok(STATUS));
  fake.route("GET /settings", (req) => kernel.settings(req));
  return kernel;
}

/** Render the screen over `kernel` and wait until the settings' first answer (or failure) and the preferences are on it. */
async function mount(kernel: Kernel): Promise<void> {
  render(<SettingsScreen api={kernel.fake.bridge} registry={kernel.registry} />);
  await waitFor(() => expect(screen.queryByTestId(IDS.loading)).toBeNull());
  if (kernel.fake.bridge.prefs !== undefined) await waitFor(() => expect((screen.getByTestId(IDS.login) as HTMLButtonElement).disabled).toBe(false));
}

async function start(settings?: Kernel["settings"]): Promise<Kernel> {
  const kernel = createKernel(settings);
  await mount(kernel);
  return kernel;
}

let nextEventId = 1;
/** A feed event of `kind` (the screen follows `kind`, and a notify's payload reason). */
function emit(kernel: Kernel, kind: string, payload: unknown = {}): void {
  const id = nextEventId;
  nextEventId += 1;
  act(() => kernel.fake.emit({ type: "event", id, at: new Date(id * 1000).toISOString(), kind, session_id: null, task_id: null, payload }));
}

const reads = (kernel: Kernel): ApiRequest[] => kernel.fake.requestsTo("GET /settings").map((r) => r.req);
const text = (testId: string): string => screen.getByTestId(testId).textContent ?? "";
const button = (testId: string): HTMLButtonElement => screen.getByTestId(testId) as HTMLButtonElement;
const SWITCHES = [IDS.login, IDS.notifications] as const;

// ---- The states ---------------------------------------------------------------------------------------------

describe("the states", () => {
  it("loading: skeleton rows for the auth provider and the kernel while the answer is held, the app's own settings already there", async () => {
    let release: (value: ApiResult<unknown>) => void = () => undefined;
    const held = new Promise<ApiResult<unknown>>((resolve) => {
      release = resolve;
    });
    const kernel = createKernel(() => held);
    render(<SettingsScreen api={kernel.fake.bridge} registry={kernel.registry} />);
    const loading = await screen.findByTestId(IDS.loading);
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.querySelectorAll(".settings-skel")).toHaveLength(2);
    expect(within(loading).getByRole("status").textContent).toBe("Loading the auth provider");
    expect(screen.getByTestId(`${IDS.loading}-kernel`).querySelectorAll(".settings-skel")).toHaveLength(1);
    expect(screen.queryByTestId(IDS.auth)).toBeNull();
    // The app's own settings do not wait for the kernel.
    await waitFor(() => expect(button(IDS.login).disabled).toBe(false));
    release(ok(settingsBody()));
    await screen.findByTestId(IDS.auth);
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
  });

  it("populated: the provider, account, health, token created and life, the commands, the kernel and the app's own settings; no h1 of its own", async () => {
    await start();
    expect(document.querySelector("h1")).toBeNull();
    expect(text(IDS.provider)).toBe("subscription-token");
    expect(text(IDS.account)).toBe("personal subscription");
    expect(text(IDS.health)).toBe("ok");
    expect(text(IDS.tokenCreated)).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(text(IDS.tokenLife)).toMatch(/^365 days · 265 days left · ends \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(screen.queryByTestId(IDS.renewSoon)).toBeNull();
    expect(text(IDS.token)).toBe("Kept in the Keychain as loomwright-studio-oauth. The value is never shown, and this app has no field for it.");
    expect(text(IDS.dataDir)).toContain("/Users/owner/.loomwright-studio");
    expect(text(IDS.notifier)).toBe("osascript" + "terminal-notifier if installed, else osascript, else none");
    expect(text(IDS.loomwright)).toBe("/Users/owner/.claude/plugins/loomwright");
    expect(screen.queryByTestId(IDS.band)).toBeNull();
    for (const name of ["Auth provider", "Change it in your terminal", "Kernel", "This app"]) expect(screen.getByRole("region", { name }), name).toBeTruthy();
    expect(screen.getAllByText("read-only")).toHaveLength(2);
    expect(screen.getByText("Kept in the app's own settings, not in the kernel")).toBeTruthy();
  });

  it("waiting on you (expiring): an attention band as a status naming the days, a renew soon badge and the days left beside the dot", async () => {
    await start(() => ok(settingsBody({ health: { status: "expiring", days: 18 }, created: daysAgo(347) })));
    const band = screen.getByTestId(IDS.band);
    expect(band.getAttribute("role")).toBe("status");
    expect(band.getAttribute("data-tone")).toBe("attention");
    expect(band.textContent).toMatch(/^The subscription token expires in 18 days, on \d{1,2} [A-Z][a-z]{2} \d{4}\. Create a new one with the commands below, or sessions stop with failed:auth\.$/);
    expect(text(IDS.health)).toBe("expiring18 days left");
    expect(text(IDS.renewSoon)).toBe("renew soon");
    expect(text(IDS.tokenLife)).toContain("18 days left");
  });

  it("empty (missing): a danger band as an alert, no token rows, 'Expected in' the Keychain, and the set-up heading over the three commands", async () => {
    await start(() => ok(settingsBody({ health: { status: "missing" }, created: null })));
    const band = screen.getByTestId(IDS.band);
    expect(band.getAttribute("role")).toBe("alert");
    expect(band.getAttribute("data-tone")).toBe("danger");
    expect(band.textContent).toBe("There is no token in the Keychain. Without one the crew can't start sessions.");
    expect(text(IDS.health)).toBe("missingno token in the Keychain item");
    expect(screen.queryByTestId(IDS.tokenCreated)).toBeNull();
    expect(screen.queryByTestId(IDS.tokenLife)).toBeNull();
    expect(text(IDS.token)).toMatch(/^Expected in the Keychain as loomwright-studio-oauth\./);
    expect(screen.getByRole("region", { name: "Set it up in your terminal" })).toBeTruthy();
    expect(screen.getAllByTestId(IDS.command)).toHaveLength(3);
  });

  it("an ok token with no recorded creation date says so, and has no life to count", async () => {
    await start(() => ok(settingsBody({ created: null })));
    expect(text(IDS.tokenCreated)).toContain("not recorded");
    expect(screen.queryByTestId(IDS.tokenLife)).toBeNull();
  });

  it("an error health shows its reason beside a danger dot, with no band", async () => {
    await start(() => ok(settingsBody({ health: { status: "error", reason: "keychain_unreadable" } })));
    expect(text(IDS.health)).toBe("errorkeychain_unreadable");
    expect(screen.queryByTestId(IDS.band)).toBeNull();
  });

  it("a Loomwright that is not usable shows its reason, not a path", async () => {
    await start(() => ok(settingsBody({ loomwright: { status: "error", reason: "not_found", path: "/p", message: "no install" } })));
    expect(text(IDS.loomwright)).toBe("errornot_found");
  });

  it("a route failure with no data: a card naming the settings request and its status, distinct from the band; the commands and kernel sections are left out; Try again reads once more", async () => {
    const kernel = await start(() => refused(500, { error: "store_unreadable" }));
    const card = await screen.findByTestId(IDS.error);
    expect(card.getAttribute("role")).toBe("alert");
    expect(within(card).getByRole("heading", { level: 3 }).textContent).toBe("Couldn't load the auth provider");
    expect(card.textContent).toContain("settings request failed (500)");
    expect(text(IDS.errorDetail)).toBe("GET /settings · 500 · store_unreadable");
    expect(screen.queryByTestId(IDS.commands)).toBeNull();
    expect(screen.queryByTestId(IDS.kernel)).toBeNull();
    expect(screen.queryByTestId(IDS.dataDir)).toBeNull();
    // The app's own settings still work.
    expect(button(IDS.login).disabled).toBe(false);
    kernel.settings = () => ok(settingsBody());
    fireEvent.click(screen.getByTestId(IDS.retry));
    await screen.findByTestId(IDS.auth);
    expect(screen.queryByTestId(IDS.error)).toBeNull();
    expect(screen.getByTestId(IDS.commands)).toBeTruthy();
  });

  it("an answer that is not the contract's shape is a failure card, never a throw", async () => {
    await start(() => ok({ nonsense: true }));
    expect(text(IDS.errorDetail)).toBe("GET /settings · the settings answer was not understood");
  });

  it("with data held, a later failure shows a notice and keeps the rows", async () => {
    const kernel = await start();
    kernel.settings = () => refused(500, { error: "store_unreadable" });
    emit(kernel, "auth_token_expiring");
    const notice = await screen.findByTestId(IDS.notice);
    expect(notice.textContent).toBe("Couldn't refresh the settings: GET /settings · 500 · store_unreadable. What is shown is the last read.");
    expect(text(IDS.provider)).toBe("subscription-token");
    expect(screen.queryByTestId(IDS.error)).toBeNull();
  });

  it("with no data at all and the kernel unreachable it says the status is unknown, never a health", async () => {
    await start(() => UNREACHABLE);
    expect(await screen.findByTestId(IDS.unknown)).toBeTruthy();
    expect(screen.queryByTestId(IDS.health)).toBeNull();
    expect(screen.queryByTestId(IDS.error)).toBeNull();
    expect(screen.queryByTestId(IDS.kernel)).toBeNull();
    expect(button(IDS.login).disabled).toBe(false);
  });
});

// ---- AC2: the facts, and no secret ----------------------------------------------------------------------------------

describe("the terminal commands", () => {
  it("are the three SETUP_STEPS commands, each with a named Copy button, and no `studio auth` command", async () => {
    await start();
    expect(screen.getAllByTestId(IDS.command).map((c) => c.textContent)).toEqual(SETUP_STEPS.map((s) => s.command));
    for (const step of SETUP_STEPS) expect(screen.getByRole("button", { name: `Copy command: ${step.command}` }), step.command).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/studio auth/);
    expect(screen.getByText(/Studio never asks for the token/)).toBeTruthy();
  });

  /** Stand-ins for the window's copy command and async clipboard, removed again after the test. */
  function clipboards(exec: () => boolean, write: () => Promise<void>) {
    const execCommand = vi.fn(exec);
    const writeText = vi.fn(write);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return { execCommand, writeText };
  }
  afterEach(() => {
    delete (document as { execCommand?: unknown }).execCommand;
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it("Copy selects the command's own text and runs the browser's copy, which needs no permission; it says so and puts the owner's selection back", async () => {
    let selected = "";
    const { execCommand, writeText } = clipboards(
      () => {
        selected = window.getSelection()?.toString() ?? "";
        return true;
      },
      () => Promise.resolve(),
    );
    await start();
    fireEvent.click(screen.getByRole("button", { name: `Copy command: ${SETUP_STEPS[1]?.command}` }));
    await waitFor(() => expect(screen.getAllByTestId(IDS.copied).map((c) => c.textContent)).toEqual(["", "Copied", ""]));
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(selected).toBe(SETUP_STEPS[1]?.command);
    expect(window.getSelection()?.toString()).toBe("");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("Copy falls back to the async clipboard when the window will not copy, and says when neither works", async () => {
    const { writeText } = clipboards(
      () => false,
      () => Promise.resolve(),
    );
    await start();
    fireEvent.click(screen.getByRole("button", { name: `Copy command: ${SETUP_STEPS[0]?.command}` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SETUP_STEPS[0]?.command));
    await waitFor(() => expect(screen.getAllByTestId(IDS.copied).map((c) => c.textContent)).toEqual(["Copied", "", ""]));
    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: `Copy command: ${SETUP_STEPS[2]?.command}` }));
    await waitFor(() => expect(screen.getAllByTestId(IDS.copied).map((c) => c.textContent)).toEqual(["", "", "Couldn't copy: select the command and copy it"]));
  });

  it("Copy builds no input or textarea to copy from", async () => {
    clipboards(
      () => true,
      () => Promise.resolve(),
    );
    const { container } = render(<SettingsScreen api={createKernel().fake.bridge} registry={createCommandRegistry()} />);
    await screen.findByTestId(IDS.auth);
    const added: Node[] = [];
    new MutationObserver((records) => records.forEach((r) => added.push(...r.addedNodes))).observe(document.body, { childList: true, subtree: true });
    fireEvent.click(screen.getAllByTestId(IDS.copy)[0] as HTMLElement);
    await sleep(20);
    expect(added.filter((n) => n instanceof Element && n.matches("input, textarea"))).toEqual([]);
    expect(container.querySelectorAll("input, textarea")).toHaveLength(0);
  });
});

describe("no secret", () => {
  /** Everything the screen and the renderer's live store hold, serialised: the DOM's text and markup, and the store's snapshot. */
  const everything = (kernel: Kernel): string => {
    const snapshot = liveStoreFor(kernel.fake.bridge).getSnapshot();
    return [document.body.innerHTML, document.body.textContent, JSON.stringify({ ...snapshot, resources: [...snapshot.resources] })].join("\n");
  };

  it("a body that also carries a token-shaped field shows it nowhere and keeps it nowhere", async () => {
    const kernel = await start(() => ok(settingsBody({ extra: { token: SECRET, secret: SECRET, api_key: SECRET }, notifier: "none" })));
    expect(text(IDS.provider)).toBe("subscription-token");
    expect(everything(kernel)).not.toContain(SECRET);
  });

  it("a token-shaped value inside the health or the Loomwright object is dropped too", async () => {
    const kernel = await start(() =>
      ok(settingsBody({ health: { status: "expiring", days: 9, token: SECRET } as AuthHealth, loomwright: { status: "ok", install_path: "/p", plugin_version: "1", contract_schema_version: 1, host_switch: true, token: SECRET } })),
    );
    expect(text(IDS.health)).toContain("expiring");
    expect(everything(kernel)).not.toContain(SECRET);
  });
});

// ---- AC3: no input, no sign-in --------------------------------------------------------------------------------------

describe("no sign-in and no way to type a secret", () => {
  // A control named "sign in", "log in", "login" or "claude.ai". The one control the mockup puts on this screen whose name holds
  // those letters is the "Launch at login" switch (the OS's login item), which is not a sign-in.
  const SIGN_IN = /(sign|log)[\s-]*in\b|claude\.ai/i;
  const LAUNCH_AT_LOGIN = /^Launch at login is (on|off)$/;
  const named = (role: "button" | "link" | "switch" | "menuitem" | "tab"): string[] =>
    screen
      .queryAllByRole(role)
      .map((el) => el.getAttribute("aria-label") ?? el.textContent ?? "")
      .filter((name) => SIGN_IN.test(name) && !LAUNCH_AT_LOGIN.test(name));

  const states: readonly (readonly [string, () => Kernel])[] = [
    ["populated", () => createKernel()],
    ["expiring", () => createKernel(() => ok(settingsBody({ health: { status: "expiring", days: 18 } })))],
    ["missing", () => createKernel(() => ok(settingsBody({ health: { status: "missing" }, created: null })))],
    ["invalid_shape", () => createKernel(() => ok(settingsBody({ health: { status: "invalid_shape" }, created: null })))],
    ["error health", () => createKernel(() => ok(settingsBody({ health: { status: "error", reason: "keychain_unreadable" } })))],
    ["route failure", () => createKernel(() => refused(500, { error: "store_unreadable" }))],
    ["unreachable, no data", () => createKernel(() => UNREACHABLE)],
    ["loading", () => createKernel(() => new Promise<ApiResult<unknown>>(() => undefined))],
  ];

  it.each(states)("%s: no input, no textarea, no select, nothing editable, no control or link named sign in / log in / claude.ai, no 'Claude Code'", async (_name, make) => {
    const kernel = make();
    const { container } = render(<SettingsScreen api={kernel.fake.bridge} registry={kernel.registry} />);
    await waitFor(() => expect(button(IDS.login).disabled).toBe(false));
    await act(async () => {
      await sleep(30);
    });
    expect(container.querySelectorAll("input, textarea, select, [contenteditable]:not([contenteditable='false'])")).toHaveLength(0);
    for (const role of ["button", "link", "switch", "menuitem", "tab"] as const) expect(named(role), role).toEqual([]);
    expect(container.textContent).not.toMatch(/claude code|claude\.ai/i);
    expect(container.querySelectorAll("a[href]")).toHaveLength(0);
  });
});

// ---- Untrusted text ---------------------------------------------------------------------------------------------

describe("untrusted text", () => {
  it("shows the account, the data location, the notifier and a Loomwright reason literally, never as markup", async () => {
    const markup = "<img src=x onerror=alert(1)>";
    const bold = "<b>loud</b>";
    const { container } = render(
      <SettingsScreen
        api={createKernel(() => ok(settingsBody({ account: markup, dataDir: bold, notifier: "<script>1</script>" }))).fake.bridge}
        registry={createCommandRegistry()}
      />,
    );
    await screen.findByTestId(IDS.auth);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b:not(.settings-ttext b)")).toBeNull();
    expect(text(IDS.account)).toBe(markup);
    expect(text(IDS.dataDir)).toContain(bold);
    expect(text(IDS.notifier)).toContain("<script>1</script>");
  });

  it("writes a control character or a bidi mark in a kernel string as a visible escape", async () => {
    render(<SettingsScreen api={createKernel(() => ok(settingsBody({ account: "a‮b\u001b[31mc" }))).fake.bridge} registry={createCommandRegistry()} />);
    await screen.findByTestId(IDS.auth);
    expect(text(IDS.account)).toBe("a\\u202eb\\x1b[31mc");
  });
});

// ---- AC4 to AC6: the app's own preferences ---------------------------------------------------------------------------

describe("This app", () => {
  it("launch at login shows what the OS reports, as a labelled switch; a change sends the new value and shows the OS's read-back", async () => {
    const kernel = createKernel();
    kernel.fake.prefsState = { launchAtLogin: { enabled: true, status: "enabled" }, notifications: true, theme: "system" };
    await mount(kernel);
    const login = screen.getByRole("switch", { name: "Launch at login is on" });
    expect(login.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(login);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Launch at login is off" }).getAttribute("aria-checked")).toBe("false"));
    expect(kernel.fake.prefsSets).toEqual([{ launchAtLogin: false }]);
    fireEvent.click(screen.getByRole("switch", { name: "Launch at login is off" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Launch at login is on" })).toBeTruthy());
    expect(kernel.fake.prefsSets).toEqual([{ launchAtLogin: false }, { launchAtLogin: true }]);
  });

  it("a login item that needs approval is said as such, and the switch stays off", async () => {
    const kernel = createKernel();
    kernel.fake.prefsState = { launchAtLogin: { enabled: false, status: "requires-approval" }, notifications: true, theme: "system" };
    await mount(kernel);
    expect(text(IDS.loginNote)).toContain("Needs your approval");
    expect(screen.getByRole("switch", { name: "Launch at login is off" }).getAttribute("aria-checked")).toBe("false");
  });

  it("a login item the OS will not turn on is said as refused, from the OS's own read-back", async () => {
    const kernel = createKernel();
    // The OS reads back "off" whatever is asked.
    const refuse: AppPreferences = { launchAtLogin: { enabled: false, status: "not-registered" }, notifications: true, theme: "system" };
    kernel.fake.bridge.prefs = { get: async () => refuse, set: async () => refuse, revealDataDir: async () => true };
    await mount(kernel);
    expect(text(IDS.loginNote)).toBe("Open Studio when you log in to this Mac.");
    fireEvent.click(screen.getByRole("switch", { name: "Launch at login is off" }));
    await waitFor(() => expect(text(IDS.loginNote)).toContain("macOS did not change it"));
    expect(screen.getByRole("switch", { name: "Launch at login is off" }).getAttribute("aria-checked")).toBe("false");
  });

  it("a login item macOS cannot find is said as such", async () => {
    const kernel = createKernel();
    kernel.fake.prefsState = { launchAtLogin: { enabled: false, status: "not-found" }, notifications: true, theme: "system" };
    await mount(kernel);
    expect(text(IDS.loginNote)).toContain("can't find");
  });

  it("notifications is a labelled switch that sends the new value, and its copy says only that it is the app's own preference", async () => {
    const kernel = await start();
    expect(screen.getByText("Kept as this app's own preference. The kernel's macOS notifications don't follow it yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Notifications is on" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Notifications is off" })).toBeTruthy());
    expect(kernel.fake.prefsSets).toEqual([{ notifications: false }]);
  });

  it("theme is a labelled group of three buttons with aria-pressed; a click sends the theme and the pressed one follows the read-back", async () => {
    const kernel = await start();
    const group = screen.getByRole("group", { name: "Theme" });
    expect(within(group).getAllByRole("button").map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["System", "true"],
      ["Light", "false"],
      ["Dark", "false"],
    ]);
    fireEvent.click(button(IDS.themeDark));
    await waitFor(() => expect(button(IDS.themeDark).getAttribute("aria-pressed")).toBe("true"));
    expect(button(IDS.themeSystem).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button(IDS.themeLight));
    await waitFor(() => expect(button(IDS.themeLight).getAttribute("aria-pressed")).toBe("true"));
    expect(kernel.fake.prefsSets).toEqual([{ theme: "dark" }, { theme: "light" }]);
  });

  it("Reveal in Finder calls the bridge once with no argument, so no path is ever sent", async () => {
    const reveal = vi.fn().mockResolvedValue(true);
    const kernel = createKernel();
    kernel.fake.bridge.prefs = { ...(kernel.fake.bridge.prefs as object), revealDataDir: reveal } as never;
    await mount(kernel);
    fireEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1));
    expect(reveal.mock.calls[0]).toEqual([]);
    expect(screen.queryByTestId(IDS.revealNote)).toBeNull();
  });

  it("a Reveal that could not open the folder says so", async () => {
    const kernel = await start();
    kernel.fake.revealAnswer = false;
    fireEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    expect((await screen.findByTestId(IDS.revealNote)).textContent).toBe("Couldn't open the folder");
    expect(kernel.fake.reveals).toBe(1);
    kernel.fake.revealAnswer = true;
    fireEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    await waitFor(() => expect(screen.queryByTestId(IDS.revealNote)).toBeNull());
  });

  it("a window with no preferences bridge says so and disables the controls, the kernel's rows still show", async () => {
    const kernel = createKernel();
    delete kernel.fake.bridge.prefs;
    render(<SettingsScreen api={kernel.fake.bridge} registry={kernel.registry} />);
    await screen.findByTestId(IDS.auth);
    expect(text(IDS.prefsUnavailable)).toBe("This window has no access to the app's own settings.");
    for (const id of [...SWITCHES, IDS.themeSystem, IDS.themeLight, IDS.themeDark]) expect(button(id).disabled, id).toBe(true);
    expect(button(IDS.reveal).disabled).toBe(true);
  });

  it("a preferences read that fails says so, and a change that fails does not throw", async () => {
    const kernel = createKernel();
    kernel.fake.bridge.prefs = { get: () => Promise.reject(new Error("ipc")), set: () => Promise.reject(new Error("ipc")), revealDataDir: () => Promise.reject(new Error("ipc")) };
    render(<SettingsScreen api={kernel.fake.bridge} registry={kernel.registry} />);
    expect((await screen.findByTestId(IDS.prefsError)).textContent).toBe("Couldn't read this app's settings.");
    fireEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    await waitFor(() => expect(screen.getByTestId(IDS.revealNote)).toBeTruthy());
  });

  it("one change per control at a time: a second click while the first is in flight sends nothing", async () => {
    let release: (value: AppPreferences) => void = () => undefined;
    const held = new Promise<AppPreferences>((resolve) => {
      release = resolve;
    });
    const set = vi.fn().mockReturnValue(held);
    const kernel = createKernel();
    kernel.fake.bridge.prefs = { ...(kernel.fake.bridge.prefs as object), set } as never;
    await mount(kernel);
    fireEvent.click(screen.getByRole("switch", { name: "Notifications is on" }));
    fireEvent.click(screen.getByRole("switch", { name: "Notifications is on" }));
    expect(set).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(IDS.notifications).getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      release({ launchAtLogin: { enabled: false, status: "not-registered" }, notifications: false, theme: "system" });
    });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Notifications is off" }).getAttribute("aria-busy")).toBeNull());
  });
});

// ---- AC7: the kernel unreachable -------------------------------------------------------------------------------------

describe("the kernel unreachable", () => {
  it("keeps the last data marked last known, disables Reveal, and leaves the app's own controls working; nothing throws", async () => {
    const kernel = await start();
    kernel.settings = () => UNREACHABLE;
    emit(kernel, "auth_token_expiring");
    await waitFor(() => expect(screen.getAllByTestId(IDS.lastKnown)).toHaveLength(2));
    expect(text(IDS.provider)).toBe("subscription-token");
    expect(text(IDS.health)).toBe("ok");
    expect(text(IDS.dataDir)).toContain("/Users/owner/.loomwright-studio");
    expect(screen.queryByTestId(IDS.unknown)).toBeNull();
    expect(screen.queryByTestId(IDS.error)).toBeNull();
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
    expect(button(IDS.reveal).disabled).toBe(true);
    // A click on a disabled Reveal sends nothing.
    fireEvent.click(button(IDS.reveal));
    expect(kernel.fake.reveals).toBe(0);
    // The app's own preferences do not need the kernel.
    for (const id of [...SWITCHES, IDS.themeSystem, IDS.themeLight, IDS.themeDark]) expect(button(id).disabled, id).toBe(false);
    fireEvent.click(button(IDS.themeDark));
    await waitFor(() => expect(button(IDS.themeDark).getAttribute("aria-pressed")).toBe("true"));
    expect(kernel.fake.prefsSets).toEqual([{ theme: "dark" }]);
  });

  it("recovers by itself when the next event brings an answer", async () => {
    const kernel = await start();
    kernel.settings = () => UNREACHABLE;
    emit(kernel, "auth_token_expiring");
    await waitFor(() => expect(button(IDS.reveal).disabled).toBe(true));
    kernel.settings = () => ok(settingsBody({ dataDir: "/moved" }));
    emit(kernel, "loomwright_contract_changed");
    await waitFor(() => expect(button(IDS.reveal).disabled).toBe(false));
    expect(text(IDS.dataDir)).toContain("/moved");
    expect(screen.queryAllByTestId(IDS.lastKnown)).toHaveLength(0);
  });
});

// ---- AC9: live updates ---------------------------------------------------------------------------------------------

describe("live updates", () => {
  it.each([
    ["auth_token_expiring", {}],
    ["auth_health_changed", {}],
    ["loomwright_contract_changed", {}],
    ["notify", { reason: "auth_token_expiring" }],
    ["notify", { reason: "auth_failed" }],
  ])("a %s event (%j) reads the settings again", async (kind, payload) => {
    const kernel = await start();
    const before = reads(kernel).length;
    emit(kernel, kind, payload);
    await waitFor(() => expect(reads(kernel).length).toBe(before + 1));
  });

  it("an event of another kind reads nothing", async () => {
    const kernel = await start();
    const before = reads(kernel).length;
    emit(kernel, "session_started");
    emit(kernel, "trigger_fired");
    emit(kernel, "notify", { reason: "event_failed" });
    await sleep(500);
    expect(reads(kernel)).toHaveLength(before);
  });

  it("a burst of events is throttled to a read or two", async () => {
    const kernel = await start();
    const before = reads(kernel).length;
    for (let i = 0; i < 6; i += 1) emit(kernel, "auth_token_expiring");
    await sleep(700);
    const extra = reads(kernel).length - before;
    expect(extra).toBeGreaterThanOrEqual(1);
    expect(extra).toBeLessThanOrEqual(2);
  });

  it("keeps the rows on screen, untouched, until the answer lands, then updates them in place with no loading state", async () => {
    const kernel = await start();
    const rows = screen.getAllByTestId(IDS.row);
    const dataDir = screen.getByTestId(IDS.dataDir);
    let release: (value: ApiResult<unknown>) => void = () => undefined;
    kernel.settings = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    emit(kernel, "auth_token_expiring");
    await waitFor(() => expect(reads(kernel).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
    expect(text(IDS.dataDir)).toContain("/Users/owner/.loomwright-studio");
    release(ok(settingsBody({ dataDir: "/new/place", health: { status: "expiring", days: 20 }, created: daysAgo(345) })));
    await waitFor(() => expect(text(IDS.dataDir)).toContain("/new/place"));
    expect(text(IDS.health)).toContain("expiring");
    expect(screen.getByTestId(IDS.band)).toBeTruthy();
    // The same elements, updated in place: nothing was remounted.
    expect(screen.getByTestId(IDS.dataDir)).toBe(dataDir);
    for (const row of rows) expect(row.isConnected).toBe(true);
  });
});

// ---- AC8: the keyboard and the palette -----------------------------------------------------------------------------------

describe("the keyboard", () => {
  it("every action is a real, focusable button: each Copy, Reveal, both switches and the three theme buttons", async () => {
    await start();
    const actions = [...(screen.getAllByTestId(IDS.copy) as HTMLButtonElement[]), button(IDS.reveal), ...SWITCHES.map(button), button(IDS.themeSystem), button(IDS.themeLight), button(IDS.themeDark)];
    expect(actions).toHaveLength(3 + 1 + 2 + 3);
    for (const el of actions) {
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("tabindex")).not.toBe("-1");
      expect(el.disabled).toBe(false);
      el.focus();
      expect(document.activeElement).toBe(el);
    }
  });

  it("every switch, button and status has an accessible name", async () => {
    await start();
    for (const el of screen.getAllByRole("button")) expect(el.getAttribute("aria-label") ?? el.textContent, el.outerHTML).toMatch(/\S/);
    expect(screen.getAllByRole("switch").map((s) => s.getAttribute("aria-label"))).toEqual(["Launch at login is off", "Notifications is on"]);
    // A status dot always has its word beside it.
    expect(text(IDS.health)).toMatch(/\S/);
    for (const dot of document.querySelectorAll(".settings-dot")) expect(dot.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the ⌘K commands", () => {
  const owned = (kernel: Kernel): string[] => kernel.registry.list().filter((c) => c.owner === SETTINGS_OWNER).map((c) => c.id);
  const command = (kernel: Kernel, id: string) => {
    const found = kernel.registry.get(id);
    if (found === undefined) throw new Error(`no command ${id}`);
    return found;
  };

  beforeEach(() => {
    nextEventId += 100;
  });

  it("registers the screen's commands under owner settings while mounted, titled as the mockup's palette entries, and unregisters them on unmount", async () => {
    const kernel = await start();
    expect(owned(kernel)).toEqual(["settings.theme-system", "settings.theme-light", "settings.theme-dark", "settings.reveal-data", "settings.toggle-login", "settings.toggle-notifications"]);
    expect(kernel.registry.list().map((c) => c.title)).toEqual([
      "Theme: System",
      "Theme: Light",
      "Theme: Dark",
      "Reveal the data folder in Finder",
      "Turn launch at login on",
      "Turn notifications off",
    ]);
    cleanup();
    expect(owned(kernel)).toEqual([]);
    expect(kernel.registry.list()).toEqual([]);
  });

  it("each command calls the same bridge call as its control", async () => {
    const kernel = await start();
    await act(async () => {
      await command(kernel, "settings.theme-dark").run();
    });
    await waitFor(() => expect(button(IDS.themeDark).getAttribute("aria-pressed")).toBe("true"));
    await act(async () => {
      await command(kernel, "settings.toggle-login").run();
    });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Launch at login is on" })).toBeTruthy());
    await act(async () => {
      await command(kernel, "settings.toggle-notifications").run();
    });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Notifications is off" })).toBeTruthy());
    await act(async () => {
      await command(kernel, "settings.reveal-data").run();
    });
    expect(kernel.fake.prefsSets).toEqual([{ theme: "dark" }, { launchAtLogin: true }, { notifications: false }]);
    expect(kernel.fake.reveals).toBe(1);
  });

  it("the toggles' titles name the action they would take, after each change", async () => {
    const kernel = await start();
    fireEvent.click(screen.getByRole("switch", { name: "Launch at login is off" }));
    await waitFor(() => expect(command(kernel, "settings.toggle-login").title).toBe("Turn launch at login off"));
    fireEvent.click(screen.getByRole("switch", { name: "Notifications is on" }));
    await waitFor(() => expect(command(kernel, "settings.toggle-notifications").title).toBe("Turn notifications on"));
    // Still one registration of each: a re-registration never collides or leaks.
    expect(owned(kernel)).toHaveLength(6);
  });

  it("Reveal is disabled while the kernel is unreachable, and the other commands are not", async () => {
    const kernel = await start();
    expect(command(kernel, "settings.reveal-data").enabled?.()).toBe(true);
    kernel.settings = () => UNREACHABLE;
    emit(kernel, "auth_token_expiring");
    await waitFor(() => expect(command(kernel, "settings.reveal-data").enabled?.()).toBe(false));
    for (const id of ["settings.theme-dark", "settings.toggle-login", "settings.toggle-notifications"]) expect(command(kernel, id).enabled?.(), id).toBe(true);
    await act(async () => {
      await command(kernel, "settings.reveal-data").run();
    });
    expect(kernel.fake.reveals).toBe(0);
  });

  it("with no preferences bridge no command is enabled", async () => {
    const kernel = createKernel();
    delete kernel.fake.bridge.prefs;
    render(<SettingsScreen api={kernel.fake.bridge} registry={kernel.registry} />);
    await screen.findByTestId(IDS.auth);
    for (const c of kernel.registry.list()) expect(c.enabled?.(), c.id).toBe(false);
  });
});
