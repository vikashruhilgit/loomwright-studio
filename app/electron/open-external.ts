// The open-external allowlist: the ONE decision about which addresses the app
// may hand to the system browser (`shell.openExternal`). It is a pure function
// so the main process's handler stays thin and every off-list form is pinned
// by `open-external.test.ts`. The window itself still denies every new window
// and navigation (`lockDown` in `main.ts`); this is the only way out, and it
// answers yes to exactly these forms:
//
//   1. the kernel's GitHub App start page: `http://127.0.0.1:<its current port>/connectors/github/app/start?state=<state>`
//   2. `https://github.com/settings/installations`
//   3. `https://github.com/settings/apps/<slug>`, where `<slug>` matches `^[a-z0-9][a-z0-9-]*$`
//   4. `https://github.com/<owner>/<repo>/settings`, where owner and repo each match a strict GitHub name pattern
//   5. exactly `https://github.com/settings/billing/plans`
//   6. a URL the kernel itself answered (`rememberKernelUrl`): an MCP connect's `authorize_url` while its
//      window is live, or the App upgrade `url`; an https string byte-equal to the remembered one
//
// The address is untrusted text (it comes from the renderer, which renders
// untrusted text), so it is parsed here and must also be byte-for-byte what
// the parser would write back: a spelling the parser would rewrite (a case
// change, a stripped default port, a resolved `..`, a dropped tab) is refused,
// never normalised into an allowed address.
import { API_HOST } from "./kernel-connection";

/** The kernel's setup start page: the only kernel address the channel opens. */
export const APP_START_PATH = "/connectors/github/app/start";
const GITHUB_HOST = "github.com";
const INSTALLATIONS_PATH = "/settings/installations";
const APP_PAGE_PREFIX = "/settings/apps/";
/** A GitHub App slug: lowercase letters, digits and hyphens, not starting with a hyphen. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const BILLING_PLANS_PATH = "/settings/billing/plans";
const REPO_SETTINGS_SUFFIX = "/settings";
/** A GitHub account name: 1 to 39 letters, digits and single hyphens, not starting or ending with a hyphen. */
const OWNER = /^(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
/** A GitHub repo name: 1 to 100 letters, digits, `.`, `_` and `-`. */
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
/** `github.com/settings/...` is GitHub's own account area, never an owner. */
const RESERVED_OWNER = "settings";
/** The MCP kinds whose connect window the kernel opens (`McpConnectionKind`); the app does not import the kernel. */
const MCP_KINDS: ReadonlySet<string> = new Set(["jira", "clickup"]);
const MCP_CONNECT_PATH = "/connectors/mcp/:kind/connect";
const MCP_CANCEL_PATH = "/connectors/mcp/:kind/connect/cancel";
const MCP_DISCONNECT_PATH = "/connectors/mcp/:kind/disconnect";
const UPGRADE_PATH = "/connectors/github/app/upgrade";

/** The addresses the kernel itself answered: one live MCP authorize URL per kind, and the App upgrade URL. */
export interface KernelUrls {
  readonly mcp: Readonly<Record<string, { readonly url: string; readonly expiresAt: number }>>;
  readonly upgrade: string | null;
}

/** Nothing remembered. */
export const NO_KERNEL_URLS: KernelUrls = { mcp: {}, upgrade: null };

/**
 * True when `url` parses, is https with no userinfo and no fragment, and is the parser's own spelling.
 * The one shape a kernel-answered address must have, checked both when it is remembered and when it is opened.
 */
function isPlainHttps(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || url.includes("#")) return false;
  return parsed.href === url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Records what the kernel answered to `request`, returning the next state (pure; `before` is never changed).
 * It reads the answer and never alters it, and it is total over untrusted input:
 *   - `POST /connectors/mcp/:kind/connect`, answered ok with an `authorize_url` and an `expires_at`, replaces
 *     that kind's entry (the next connect drops the last); an ok answer that is not usable drops it;
 *   - the same kind's cancel, or its disconnect, drops its entry;
 *   - `GET /connectors/github/app/upgrade`, answered ok, remembers the non-null `url` (a null drops it).
 * Any other request, and any answer that is not ok, leaves the state as it was (bar dropping what has expired by `now`).
 */
export function rememberKernelUrl(before: KernelUrls, request: unknown, result: unknown, now: number): KernelUrls {
  const current = withoutExpired(before, now);
  if (!isRecord(request) || typeof request.method !== "string" || typeof request.path !== "string") return current;
  const kind = isRecord(request.params) ? request.params.kind : undefined;
  const mcpKind = typeof kind === "string" && MCP_KINDS.has(kind) ? kind : undefined;
  const answered = isRecord(result) && result.ok === true && typeof result.status === "number" && result.status >= 200 && result.status < 300;
  const body = answered && isRecord(result) && isRecord(result.body) ? result.body : undefined;

  if (request.method === "POST" && mcpKind !== undefined) {
    if (request.path === MCP_CANCEL_PATH || request.path === MCP_DISCONNECT_PATH) return withoutMcp(current, mcpKind);
    if (request.path === MCP_CONNECT_PATH && answered) {
      const url = body?.authorize_url;
      const expiresAt = typeof body?.expires_at === "string" ? Date.parse(body.expires_at) : Number.NaN;
      if (typeof url !== "string" || !isPlainHttps(url) || !Number.isFinite(expiresAt)) return withoutMcp(current, mcpKind);
      return { ...current, mcp: { ...current.mcp, [mcpKind]: { url, expiresAt } } };
    }
    return current;
  }
  if (request.method === "GET" && request.path === UPGRADE_PATH && answered) {
    const url = body?.url;
    return { ...current, upgrade: typeof url === "string" && isPlainHttps(url) ? url : null };
  }
  return current;
}

function withoutExpired(current: KernelUrls, now: number): KernelUrls {
  const live = Object.entries(current.mcp).filter(([, entry]) => now < entry.expiresAt);
  return live.length === Object.keys(current.mcp).length ? current : { ...current, mcp: Object.fromEntries(live) };
}

function withoutMcp(current: KernelUrls, kind: string): KernelUrls {
  if (!(kind in current.mcp)) return current;
  const { [kind]: _dropped, ...rest } = current.mcp;
  return { ...current, mcp: rest };
}

/** True when `url` is exactly a live remembered kernel answer: an MCP authorize URL before its `expires_at`, or the upgrade URL. */
function isKernelAnswered(url: string, kernel: KernelUrls, now: number): boolean {
  if (!isPlainHttps(url)) return false;
  if (kernel.upgrade === url) return true;
  return Object.values(kernel.mcp).some((entry) => entry.url === url && now < entry.expiresAt);
}

/**
 * True when `url` is one of the addresses the app may open in the system browser, given the kernel's current port
 * and (optionally) the addresses the kernel answered, judged at `now`.
 */
export function isAllowedExternal(url: unknown, kernelPort: number, kernel: KernelUrls = NO_KERNEL_URLS, now: number = Date.now()): boolean {
  if (typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // No userinfo and no fragment, whichever form follows (`hash` is "" for a bare trailing `#`, so
  // look at the text); and the spelling is the parser's own.
  if (parsed.username !== "" || parsed.password !== "" || url.includes("#")) return false;
  if (parsed.href !== url) return false;

  if (parsed.protocol === "http:") return isKernelStart(parsed, kernelPort);
  if (parsed.protocol === "https:") return isGitHubPage(parsed) || isKernelAnswered(url, kernel, now);
  return false;
}

/** The kernel's start page: loopback host, the kernel's current port, the start path, a lone `state` query. */
function isKernelStart(parsed: URL, kernelPort: number): boolean {
  if (!Number.isInteger(kernelPort) || kernelPort < 1 || kernelPort > 65_535) return false;
  if (parsed.hostname !== API_HOST) return false;
  if (Number(parsed.port === "" ? 80 : parsed.port) !== kernelPort) return false;
  if (parsed.pathname !== APP_START_PATH) return false;
  const query = [...parsed.searchParams.entries()];
  return query.length === 1 && query[0]?.[0] === "state" && query[0][1] !== "";
}

/** The fixed GitHub pages: https, `github.com` on its default port, no query. */
function isGitHubPage(parsed: URL): boolean {
  if (parsed.hostname !== GITHUB_HOST || parsed.port !== "" || parsed.search !== "") return false;
  if (parsed.pathname === INSTALLATIONS_PATH || parsed.pathname === BILLING_PLANS_PATH) return true;
  if (parsed.pathname.startsWith(APP_PAGE_PREFIX) && SLUG.test(parsed.pathname.slice(APP_PAGE_PREFIX.length))) return true;
  return isRepoSettings(parsed.pathname);
}

/** `/<owner>/<repo>/settings`: exactly three segments, the last `settings`, owner and repo each a strict name. */
function isRepoSettings(pathname: string): boolean {
  if (!pathname.endsWith(REPO_SETTINGS_SUFFIX)) return false;
  const [empty, owner, repo, last, ...more] = pathname.split("/");
  if (empty !== "" || more.length > 0 || last !== "settings" || owner === undefined || repo === undefined) return false;
  if (owner === RESERVED_OWNER || !OWNER.test(owner)) return false;
  return repo !== "." && repo !== ".." && REPO.test(repo);
}
