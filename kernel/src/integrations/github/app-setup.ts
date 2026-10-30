// The GitHub App connect's setup flow (D36): the one setup window, its
// single-use `state`s, the manifest page, the manifest conversion and the five
// routes that drive a `GitHubAppPort`. Specified in
// `docs/architecture/github-app-setup.md`.
//
//   POST /connectors/github/app/setup           (API token) open the one window: {setup_url, expires_at}
//   POST /connectors/github/app/setup/cancel    (API token) close it: {cancelled}
//   GET  /connectors/github/app/start?state=    (no token)  the page that posts the manifest to github.com
//   GET  /connectors/github/app/return?code=&state=
//                                               (no token)  GitHub's redirect_url: convert the code, store the App,
//                                                           redirect to the App's install page
//   GET  /connectors/github/app/installed?installation_id=&setup_action=&state=
//                                               (no token)  GitHub's setup_url: record the installation, show "Done"
//
// The window lives in memory only: at most one is open, it lives 10 minutes
// (`GITHUB_APP_SETUP_WINDOW_MS`), opening a new one closes the old, cancel
// closes it, and a restart loses it. Every `state` GitHub carries (the create
// one on `/return`, the install one on `/installed`) is single-use, at least
// 128 random bits and compared in constant time; a wrong one is refused and
// leaves the window as it was, so a local process cannot end a setup by
// guessing. The start `state` (in `setup_url`) opens the start page and stays
// valid for reloads until the return arrives, because the app's "Open GitHub
// again" reopens the same `setup_url`; each load mints a fresh create `state`
// for GitHub, replacing the previous one.
//
// A refusal is one fixed page per reason and one `connector_status` event; no
// page, event or answer echoes the query string, the code, a `state`, the
// `pem`, the `client_secret` or a token. The conversion is the one non-GET call
// this file makes, through an injected `fetch`; the port does the storing.
//
// The `studio` CLI loads it, so it imports only types, the feature seam and
// its siblings: never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../../features/contribution.js";
import { NO_REF, appendEvent } from "../../loop/internal.js";
import { GITHUB_APP_SETUP_REFUSALS } from "../types.js";
import type { GitHubAppConversion, GitHubAppPort, GitHubAppPortError, GitHubAppPortResult, GitHubAppSetupRefusal } from "../types.js";
import { GITHUB_API_VERSION } from "./client.js";
import { githubConnectorRow } from "./connector.js";

/** How long one setup window lives: 10 minutes from the clock at the moment it opens. */
export const GITHUB_APP_SETUP_WINDOW_MS = 10 * 60 * 1000;

/** The conversion call's host, method and path shape: constants, so a test can pin the one request this file sends. */
export const GITHUB_APP_CONVERSION_HOST = "api.github.com";
export const GITHUB_APP_CONVERSION_METHOD = "POST";
export const githubAppConversionPath = (code: string): string => `/app-manifests/${code}/conversions`;

/** The owner routes and the three browser routes (the browser paths are `UNAUTHENTICATED_ROUTE_PATHS`). */
const SETUP_PATH = "/connectors/github/app/setup";
const CANCEL_PATH = "/connectors/github/app/setup/cancel";
const START_PATH = "/connectors/github/app/start";
const RETURN_PATH = "/connectors/github/app/return";
const INSTALLED_PATH = "/connectors/github/app/installed";

/** Where the manifest is posted; GitHub redirects the owner back to the manifest's `redirect_url` after Create. */
const GITHUB_WEB_ORIGIN = "https://github.com";
const MANIFEST_HOMEPAGE = "https://github.com/vikashruhilgit/loomwright-studio";

/** A conversion code: short, `[A-Za-z0-9_-]`. Checked before any call. */
const CODE = /^[A-Za-z0-9_-]{1,100}$/;
/** An installation id: a positive integer in digits. */
const INSTALLATION_ID = /^[1-9][0-9]{0,14}$/;
/** An App slug, as GitHub makes it (used to build the install page's address). */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/;

/** The conversion's body is a few KB; anything past this is not GitHub's answer. */
const MAX_CONVERSION_BYTES = 256 * 1024;
const CONVERSION_TIMEOUT_MS = 15_000;

/** The HTTP status each refusal answers (the table in `docs/architecture/github-app-setup.md`). */
export const GITHUB_APP_SETUP_STATUS: Readonly<Record<GitHubAppSetupRefusal, number>> = Object.freeze({
  setup_not_open: 400,
  state_mismatch: 400,
  setup_expired: 400,
  conversion_failed: 502,
  install_failed: 502,
  token_write_scoped: 422,
});

/** The fixed page text of each refusal: a heading and one sentence, never anything from the request. */
const REFUSAL_PAGES: Readonly<Record<GitHubAppSetupRefusal, { readonly heading: string; readonly text: string }>> = Object.freeze({
  setup_not_open: { heading: "No setup is open", text: "Studio is not waiting for GitHub right now. Return to Studio and start the setup again." },
  state_mismatch: { heading: "This link is not valid", text: "Studio did not recognise this link, or it was already used. Return to Studio and start the setup again." },
  setup_expired: { heading: "Setup timed out", text: "The setup window closed before GitHub came back. Return to Studio and set up again." },
  conversion_failed: { heading: "GitHub did not hand the App over", text: "Studio could not finish creating the App. Return to Studio and set up again." },
  install_failed: { heading: "Setup did not finish", text: "Studio could not record the App or its installation. Return to Studio and set up again." },
  token_write_scoped: {
    heading: "The App can write",
    text: "GitHub reports a write permission for this App, and Studio stays read-only, so it removed the App's key. Return to Studio and set up again.",
  },
});

/** What `createGitHubAppSetup` takes: the port, and (for tests) the `fetch` and its timeout. */
export interface GitHubAppSetupDeps {
  readonly port: GitHubAppPort;
  /** Default the global `fetch`, read at call time. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

/** The five routes, sharing one setup window. */
export interface GitHubAppSetup {
  readonly routes: readonly ContributedRoute[];
}

/** The one open window. `createState` / `installState` are null until minted and after they are spent. */
interface SetupWindow {
  readonly startState: string;
  readonly expiresAtMs: number;
  // `converting`: the return spent the create state and the conversion / storing is in flight; no route takes the window until it settles.
  phase: "awaiting_create" | "converting" | "awaiting_install";
  createState: string | null;
  installState: string | null;
}

/** The conversion, parsed: only the non-secret fields and the `pem`; `client_secret` and `webhook_secret` are dropped here. */
interface Converted {
  readonly conversion: GitHubAppConversion;
  readonly pem: string;
}

/** A fresh single-use `state`: 256 random bits. */
function mintState(): string {
  return randomBytes(32).toString("base64url");
}

/** Whether `presented` is `expected`, in constant time (both hashed first, so the length is not leaked). */
function sameState(presented: string | undefined, expected: string | null): boolean {
  if (presented === undefined || expected === null) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A fixed page around a heading and a sentence (both trusted text). */
function pageHtml(heading: string, text: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(heading)}</title><body style="font-family:system-ui;margin:3rem"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(text)}</p></body>`;
}

function browserPage(status: number, html: string): ContributedRouteResponse {
  return { status, body: null, browser: { html } };
}

/** The reason a port failure is shown with: its own refusal, else (`not_implemented`) `install_failed`. */
function portReason(error: GitHubAppPortError): GitHubAppSetupRefusal {
  return isRefusal(error) ? error : "install_failed";
}

function isRefusal(error: string): error is GitHubAppSetupRefusal {
  return (GITHUB_APP_SETUP_REFUSALS as readonly string[]).includes(error);
}

/** The conversion's JSON, checked field by field into the non-secret `GitHubAppConversion` and the `pem`; `undefined` when it is off shape. */
function parseConversion(json: unknown): Converted | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const o = json as Record<string, unknown>;
  const owner = typeof o["owner"] === "object" && o["owner"] !== null ? (o["owner"] as Record<string, unknown>) : {};
  const id = o["id"];
  const slug = o["slug"];
  const name = o["name"];
  const login = owner["login"];
  const htmlUrl = o["html_url"];
  const clientId = o["client_id"];
  const pem = o["pem"];
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return undefined;
  if (typeof slug !== "string" || !SLUG.test(slug)) return undefined;
  if (typeof name !== "string" || name === "" || name.length > 200) return undefined;
  if (typeof login !== "string" || login === "" || login.length > 100) return undefined;
  if (typeof htmlUrl !== "string" || !htmlUrl.startsWith(`${GITHUB_WEB_ORIGIN}/`) || htmlUrl.length > 300) return undefined;
  if (typeof clientId !== "string" || clientId === "" || clientId.length > 100) return undefined;
  if (typeof pem !== "string" || pem === "") return undefined;
  return { conversion: { app_id: id, slug, name, owner_login: login, html_url: htmlUrl, client_id: clientId }, pem };
}

/** Build the five routes over one setup window. */
export function createGitHubAppSetup(deps: GitHubAppSetupDeps): GitHubAppSetup {
  const { port } = deps;
  const timeoutMs = deps.timeoutMs ?? CONVERSION_TIMEOUT_MS;
  // The only state this file keeps: the one window (open, or expired and not yet replaced). Memory only.
  let current: SetupWindow | undefined;

  /** The open window, else why there is none. An expired window stays until replaced or cancelled, so a reload says so again. */
  const gate = (at: Date): { readonly ok: true; readonly win: SetupWindow } | { readonly ok: false; readonly reason: GitHubAppSetupRefusal } => {
    const win = current;
    if (win === undefined) return { ok: false, reason: "setup_not_open" };
    if (at.getTime() >= win.expiresAtMs) return { ok: false, reason: "setup_expired" };
    return { ok: true, win };
  };

  const close = (win: SetupWindow): void => {
    if (current === win) current = undefined;
  };

  /** One refusal: its event, then its fixed page. Writes nothing else; the request's own data is never read here. */
  const refuse = (req: ContributedRouteRequest, reason: GitHubAppSetupRefusal): ContributedRouteResponse => {
    try {
      const row = githubConnectorRow(req.store);
      appendEvent(req.store, "connector_status", NO_REF, { connector_id: row?.id ?? null, kind: "github", status: row?.status ?? null, refused: reason }, req.now().toISOString());
    } catch {
      // A failed event write never changes the answer (the same idiom as the API's `route_failed`).
    }
    const { heading, text } = REFUSAL_PAGES[reason];
    return browserPage(GITHUB_APP_SETUP_STATUS[reason], pageHtml(heading, text));
  };

  /** Open the one window (closing any other) and answer where the app sends the owner. */
  const open = (req: ContributedRouteRequest): ContributedRouteResponse => {
    if (req.origin === undefined) return { status: 500, body: { error: "setup_unavailable", message: "the API did not report its own address, so no setup address can be built" } };
    const expiresAtMs = req.now().getTime() + GITHUB_APP_SETUP_WINDOW_MS;
    const win: SetupWindow = { startState: mintState(), expiresAtMs, phase: "awaiting_create", createState: null, installState: null };
    current = win;
    return { status: 200, body: { setup_url: `${req.origin}${START_PATH}?state=${win.startState}`, expires_at: new Date(expiresAtMs).toISOString() } };
  };

  const cancel = (req: ContributedRouteRequest): ContributedRouteResponse => {
    const was = gate(req.now());
    current = undefined;
    return { status: 200, body: { cancelled: was.ok } };
  };

  /** The start page: nothing is called on GitHub or the port; it only mints the create `state` and posts the manifest. */
  const start = (req: ContributedRouteRequest): ContributedRouteResponse => {
    const g = gate(req.now());
    if (!g.ok) return refuse(req, g.reason);
    if (g.win.phase !== "awaiting_create" || !sameState(req.query["state"], g.win.startState)) return refuse(req, "state_mismatch");
    if (req.origin === undefined) return refuse(req, "install_failed");
    const createState = mintState();
    g.win.createState = createState;
    const manifest = {
      name: `loomwright-studio-${randomBytes(3).toString("hex")}`,
      url: MANIFEST_HOMEPAGE,
      // No `hook_attributes`: GitHub refuses a loopback webhook URL even when inactive (probe p13); Studio polls.
      redirect_url: `${req.origin}${RETURN_PATH}`,
      setup_url: `${req.origin}${INSTALLED_PATH}`,
      setup_on_update: false,
      public: false,
      default_permissions: { pull_requests: "read", contents: "read", metadata: "read" },
      default_events: [],
      request_oauth_on_install: false,
    };
    const action = `${GITHUB_WEB_ORIGIN}/settings/apps/new?state=${encodeURIComponent(createState)}`;
    return browserPage(
      200,
      `<!doctype html><meta charset="utf-8"><title>Set up GitHub for Studio</title><body style="font-family:system-ui;margin:3rem">` +
        `<p>Sending you to GitHub to create Studio's GitHub App (read-only). Click Create there, then pick the repos and click Install.</p>` +
        `<form id="f" method="post" action="${escapeHtml(action)}"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">` +
        `<button type="submit">Continue to GitHub</button></form><script>document.getElementById("f").submit()</script></body>`,
    );
  };

  /** `POST /app-manifests/{code}/conversions`, parsed; `undefined` for any failure (nothing of the failure is kept). */
  const convert = async (code: string | undefined): Promise<Converted | undefined> => {
    if (code === undefined || !CODE.test(code)) return undefined;
    try {
      const doFetch = deps.fetch ?? globalThis.fetch;
      const res = await doFetch(`https://${GITHUB_APP_CONVERSION_HOST}${githubAppConversionPath(code)}`, {
        method: GITHUB_APP_CONVERSION_METHOD,
        redirect: "manual",
        headers: { accept: "application/vnd.github+json", "user-agent": "loomwright-studio", "x-github-api-version": GITHUB_API_VERSION },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 201) {
        await res.body?.cancel().catch(() => undefined);
        return undefined;
      }
      const text = await res.text();
      if (text.length > MAX_CONVERSION_BYTES) return undefined;
      return parseConversion(JSON.parse(text));
    } catch {
      return undefined;
    }
  };

  /** A port call that never throws into the route: a throw reads as `not_implemented` (shown `install_failed`). */
  const safely = async <T>(call: () => Promise<GitHubAppPortResult<T>>): Promise<GitHubAppPortResult<T>> => {
    try {
      return await call();
    } catch {
      return { ok: false, error: "not_implemented", message: "the port threw" };
    }
  };

  const handleReturn = async (req: ContributedRouteRequest): Promise<ContributedRouteResponse> => {
    const g = gate(req.now());
    if (!g.ok) return refuse(req, g.reason);
    const win = g.win;
    if (win.phase !== "awaiting_create" || !sameState(req.query["state"], win.createState)) return refuse(req, "state_mismatch");
    // Spent on first use, and the phase moved off `awaiting_create`, before anything is awaited: a replay is a mismatch and a start-page reload cannot mint a new create `state` mid-conversion.
    win.createState = null;
    win.phase = "converting";
    const converted = await convert(req.query["code"]);
    // The window may have been cancelled, replaced or have expired during the call: store nothing then.
    const after = gate(req.now());
    if (!after.ok) return refuse(req, after.reason);
    if (after.win !== win) return refuse(req, "setup_not_open");
    if (converted === undefined) {
      close(win);
      return refuse(req, "conversion_failed");
    }
    const stored = await safely(() => port.storeApp(req.store, converted.conversion, converted.pem, req.now));
    if (!stored.ok) {
      close(win);
      return refuse(req, portReason(stored.error));
    }
    // The window may have gone during the store too: no redirect then. The App it stored is left for the next setup or disconnect (removing it here could remove a replacement window's App).
    const settled = gate(req.now());
    if (!settled.ok) return refuse(req, settled.reason);
    if (settled.win !== win) return refuse(req, "setup_not_open");
    const installState = mintState();
    win.phase = "awaiting_install";
    win.installState = installState;
    return {
      status: 302,
      body: null,
      browser: { redirect: `${GITHUB_WEB_ORIGIN}/apps/${converted.conversion.slug}/installations/new?state=${encodeURIComponent(installState)}` },
    };
  };

  const handleInstalled = async (req: ContributedRouteRequest): Promise<ContributedRouteResponse> => {
    const g = gate(req.now());
    if (!g.ok) return refuse(req, g.reason);
    const win = g.win;
    if (win.phase !== "awaiting_install" || !sameState(req.query["state"], win.installState)) return refuse(req, "state_mismatch");
    win.installState = null;
    const id = req.query["installation_id"];
    if (id === undefined || !INSTALLATION_ID.test(id)) {
      close(win);
      return refuse(req, "install_failed");
    }
    const recorded = await safely(() => port.recordInstallation(req.store, Number(id), req.now));
    // A window other than this one that opened during the call (undefined when none, or when this one is still current).
    const replacement = current === win ? undefined : current;
    close(win);
    if (!recorded.ok) {
      const reason = portReason(recorded.error);
      // An App that can write is not kept: its key is removed, and the setup ends with the reason.
      // Not when a replacement window has moved past `awaiting_create` during the call: the stored App may be its own.
      if (reason === "token_write_scoped" && (replacement === undefined || replacement.phase === "awaiting_create")) await safely(() => port.removeApp(req.store, req.now));
      return refuse(req, reason);
    }
    return browserPage(200, pageHtml("Done — return to Studio", "GitHub is connected. You can close this tab."));
  };

  const routes: readonly ContributedRoute[] = Object.freeze([
    { method: "POST", path: SETUP_PATH, handler: (req) => Promise.resolve(open(req)) },
    { method: "POST", path: CANCEL_PATH, handler: (req) => Promise.resolve(cancel(req)) },
    { method: "GET", path: START_PATH, unauthenticated: true, handler: (req) => Promise.resolve(start(req)) },
    { method: "GET", path: RETURN_PATH, unauthenticated: true, handler: (req) => handleReturn(req) },
    { method: "GET", path: INSTALLED_PATH, unauthenticated: true, handler: (req) => handleInstalled(req) },
  ] satisfies ContributedRoute[]);

  return { routes };
}
