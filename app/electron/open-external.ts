// The open-external allowlist: the ONE decision about which addresses the app
// may hand to the system browser (`shell.openExternal`). It is a pure function
// so the main process's handler stays thin and every off-list form is pinned
// by `open-external.test.ts`. The window itself still denies every new window
// and navigation (`lockDown` in `main.ts`); this is the only way out, and it
// answers yes to exactly three forms:
//
//   1. the kernel's GitHub App start page: `http://127.0.0.1:<its current port>/connectors/github/app/start?state=<state>`
//   2. `https://github.com/settings/installations`
//   3. `https://github.com/settings/apps/<slug>`, where `<slug>` matches `^[a-z0-9][a-z0-9-]*$`
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

/** True when `url` is one of the three addresses the app may open in the system browser, given the kernel's current port. */
export function isAllowedExternal(url: unknown, kernelPort: number): boolean {
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
  if (parsed.protocol === "https:") return isGitHubPage(parsed);
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

/** The two GitHub pages: https, `github.com` on its default port, no query. */
function isGitHubPage(parsed: URL): boolean {
  if (parsed.hostname !== GITHUB_HOST || parsed.port !== "" || parsed.search !== "") return false;
  if (parsed.pathname === INSTALLATIONS_PATH) return true;
  return parsed.pathname.startsWith(APP_PAGE_PREFIX) && SLUG.test(parsed.pathname.slice(APP_PAGE_PREFIX.length));
}
