// The open-external allowlist (AC8): only the listed address forms may reach the
// system browser (three fixed forms, two policy-card GitHub pages and an address the
// kernel itself answered); every other spelling is refused.
import { describe, expect, it } from "vitest";
import { NO_KERNEL_URLS, isAllowedExternal, rememberKernelUrl } from "./open-external";
import type { KernelUrls } from "./open-external";

const PORT = 45_123;
const START = `http://127.0.0.1:${PORT}/connectors/github/app/start?state=s3cr3t-state_1`;

describe("the allowed forms", () => {
  it("allows the kernel's start page on the kernel's current port with a lone state query", () => {
    expect(isAllowedExternal(START, PORT)).toBe(true);
  });

  it("allows the GitHub installations page", () => {
    expect(isAllowedExternal("https://github.com/settings/installations", PORT)).toBe(true);
  });

  it("allows a GitHub App page for a well-formed slug", () => {
    expect(isAllowedExternal("https://github.com/settings/apps/loomwright-studio", PORT)).toBe(true);
    expect(isAllowedExternal("https://github.com/settings/apps/a", PORT)).toBe(true);
    expect(isAllowedExternal("https://github.com/settings/apps/0app-1", PORT)).toBe(true);
  });
});

describe("the kernel's start page, refused", () => {
  const refused: [string, string][] = [
    ["another port", `http://127.0.0.1:${PORT + 1}/connectors/github/app/start?state=a`],
    ["no port (the default 80)", "http://127.0.0.1/connectors/github/app/start?state=a"],
    ["localhost instead of 127.0.0.1", `http://localhost:${PORT}/connectors/github/app/start?state=a`],
    ["another host", `http://example.com:${PORT}/connectors/github/app/start?state=a`],
    ["IPv6 loopback", `http://[::1]:${PORT}/connectors/github/app/start?state=a`],
    ["https on the loopback host", `https://127.0.0.1:${PORT}/connectors/github/app/start?state=a`],
    ["another path", `http://127.0.0.1:${PORT}/connectors/github/app/setup?state=a`],
    ["a path prefix", `http://127.0.0.1:${PORT}/connectors/github/app/start/extra?state=a`],
    ["a path suffix on the name", `http://127.0.0.1:${PORT}/connectors/github/app/start2?state=a`],
    ["the root path", `http://127.0.0.1:${PORT}/?state=a`],
    ["a resolved dot segment", `http://127.0.0.1:${PORT}/connectors/github/app/../app/start?state=a`],
    ["no query", `http://127.0.0.1:${PORT}/connectors/github/app/start`],
    ["an empty state", `http://127.0.0.1:${PORT}/connectors/github/app/start?state=`],
    ["a query other than state", `http://127.0.0.1:${PORT}/connectors/github/app/start?code=a`],
    ["state and another key", `http://127.0.0.1:${PORT}/connectors/github/app/start?state=a&next=%2F`],
    ["state twice", `http://127.0.0.1:${PORT}/connectors/github/app/start?state=a&state=b`],
    ["userinfo", `http://user:pass@127.0.0.1:${PORT}/connectors/github/app/start?state=a`],
    ["userinfo naming another host", `http://127.0.0.1:${PORT}@example.com/connectors/github/app/start?state=a`],
    ["a fragment", `${START}#frag`],
    ["an empty fragment", `${START}#`],
    ["an upper-case scheme spelling", START.replace("http:", "HTTP:")],
    ["a backslash path", `http://127.0.0.1:${PORT}\\connectors\\github\\app\\start?state=a`],
    ["a leading space", ` ${START}`],
    ["a trailing newline", `${START}\n`],
    ["an embedded tab", START.replace("github", "git\thub")],
  ];
  it.each(refused)("refuses %s", (_name, url) => {
    expect(isAllowedExternal(url, PORT)).toBe(false);
  });

  it("refuses when the kernel's port is not a valid port", () => {
    for (const port of [0, -1, 65_536, 1.5, Number.NaN]) {
      expect(isAllowedExternal(`http://127.0.0.1:${port}/connectors/github/app/start?state=a`, port)).toBe(false);
    }
  });

  it("follows the kernel's current port, not an earlier one", () => {
    expect(isAllowedExternal(START, PORT)).toBe(true);
    expect(isAllowedExternal(START, 1)).toBe(false);
  });
});

describe("the GitHub pages, refused", () => {
  const refused: [string, string][] = [
    ["a bare apps page", "https://github.com/settings/apps"],
    ["a bare apps page with a slash", "https://github.com/settings/apps/"],
    ["another settings page", "https://github.com/settings/tokens"],
    ["an installations sub-path", "https://github.com/settings/installations/123"],
    ["an installations trailing slash", "https://github.com/settings/installations/"],
    ["an installations query", "https://github.com/settings/installations?x=1"],
    ["plain http", "http://github.com/settings/installations"],
    ["another host", "https://example.com/settings/installations"],
    ["a look-alike host", "https://github.com.example.com/settings/installations"],
    ["a subdomain", "https://www.github.com/settings/installations"],
    ["a port", "https://github.com:8443/settings/installations"],
    ["userinfo", "https://user@github.com/settings/installations"],
    ["userinfo naming another host", "https://github.com@example.com/settings/installations"],
    ["a fragment", "https://github.com/settings/installations#x"],
    ["a slug with a slash", "https://github.com/settings/apps/a/b"],
    ["a slug with a dot-dot", "https://github.com/settings/apps/.."],
    ["a slug that climbs out", "https://github.com/settings/apps/../tokens"],
    ["a slug with an encoded slash", "https://github.com/settings/apps/a%2Fb"],
    ["a slug with a lower-case encoded slash", "https://github.com/settings/apps/a%2fb"],
    ["a slug with a percent escape", "https://github.com/settings/apps/%61pp"],
    ["a slug starting with a hyphen", "https://github.com/settings/apps/-app"],
    ["a slug with upper case", "https://github.com/settings/apps/App"],
    ["a slug with an underscore", "https://github.com/settings/apps/my_app"],
    ["a slug with a query", "https://github.com/settings/apps/app?x=1"],
    ["an upper-case host spelling", "https://GitHub.com/settings/apps/app"],
  ];
  it.each(refused)("refuses %s", (_name, url) => {
    expect(isAllowedExternal(url, PORT)).toBe(false);
  });
});

describe("every other scheme and every non-string", () => {
  const refused: [string, unknown][] = [
    ["javascript:", "javascript:alert(1)"],
    ["file:", "file:///etc/passwd"],
    ["data:", "data:text/html,<script>1</script>"],
    ["ftp:", "ftp://github.com/settings/installations"],
    ["a custom scheme", "loomwright-studio://chat"],
    ["a relative path", "/settings/installations"],
    ["a bare host", "github.com/settings/installations"],
    ["the empty string", ""],
    ["undefined", undefined],
    ["null", null],
    ["a number", 7],
    ["an object", { href: "https://github.com/settings/installations" }],
    ["an object with a string form", { toString: () => "https://github.com/settings/installations" }],
    ["an array of the address", ["https://github.com/settings/installations"]],
  ];
  it.each(refused)("refuses %s", (_name, url) => {
    expect(isAllowedExternal(url, PORT)).toBe(false);
  });
});

describe("the policy-card GitHub pages", () => {
  const allowed = ["https://github.com/acme/widgets/settings", "https://github.com/a/b/settings", "https://github.com/Some-Org1/my.repo_x-1/settings", "https://github.com/settings/billing/plans"];
  it.each(allowed)("allows %s", (url) => {
    expect(isAllowedExternal(url, PORT)).toBe(true);
  });

  const refused: [string, string][] = [
    ["a query on the repo settings page", "https://github.com/acme/widgets/settings?x=1"],
    ["an extra path segment after settings", "https://github.com/acme/widgets/settings/branches"],
    ["an extra segment before settings", "https://github.com/acme/widgets/extra/settings"],
    ["a trailing slash", "https://github.com/acme/widgets/settings/"],
    ["a bad owner name (leading hyphen)", "https://github.com/-acme/widgets/settings"],
    ["a bad owner name (trailing hyphen)", "https://github.com/acme-/widgets/settings"],
    ["a bad owner name (double hyphen)", "https://github.com/ac--me/widgets/settings"],
    ["a bad owner name (underscore)", "https://github.com/ac_me/widgets/settings"],
    ["an owner over 39 characters", `https://github.com/${"a".repeat(40)}/widgets/settings`],
    ["an encoded owner", "https://github.com/ac%6De/widgets/settings"],
    ["a bad repo name (space)", "https://github.com/acme/wid%20gets/settings"],
    ["a repo name of dot-dot", "https://github.com/acme/../settings"],
    ["a repo name of a single dot", "https://github.com/acme/./settings"],
    ["a repo over 100 characters", `https://github.com/acme/${"r".repeat(101)}/settings`],
    ["settings as the owner", "https://github.com/settings/widgets/settings"],
    ["no repo", "https://github.com/acme/settings"],
    ["plain http", "http://github.com/acme/widgets/settings"],
    ["another host", "https://example.com/acme/widgets/settings"],
    ["a port", "https://github.com:8443/acme/widgets/settings"],
    ["userinfo", "https://user@github.com/acme/widgets/settings"],
    ["a fragment", "https://github.com/acme/widgets/settings#x"],
    ["/settings/billing", "https://github.com/settings/billing"],
    ["/settings/billing/", "https://github.com/settings/billing/"],
    ["the billing plans page with a query", "https://github.com/settings/billing/plans?x=1"],
    ["the billing plans page with a sub-path", "https://github.com/settings/billing/plans/x"],
    ["the billing plans page in upper case", "https://github.com/settings/billing/Plans"],
    ["the billing plans page over http", "http://github.com/settings/billing/plans"],
  ];
  it.each(refused)("refuses %s", (_name, url) => {
    expect(isAllowedExternal(url, PORT)).toBe(false);
  });
});

describe("a kernel-answered address", () => {
  const NOW = Date.parse("2026-11-08T12:00:00.000Z");
  const FUTURE = "2026-11-08T12:10:00.000Z";
  const AUTHORIZE = "https://auth.atlassian.com/authorize?audience=api&state=abc123";
  const connect = (kind: string, url: unknown, expires: unknown = FUTURE) => ({
    request: { method: "POST", path: "/connectors/mcp/:kind/connect", params: { kind } },
    result: { ok: true, status: 200, body: { authorize_url: url, expires_at: expires } },
  });
  const remember = (state: KernelUrls, step: { request: unknown; result: unknown }, now = NOW): KernelUrls => rememberKernelUrl(state, step.request, step.result, now);
  const upgrade = (url: unknown) => ({ request: { method: "GET", path: "/connectors/github/app/upgrade" }, result: { ok: true, status: 200, body: { url } } });

  it("refuses an https address nobody remembered", () => {
    expect(isAllowedExternal(AUTHORIZE, PORT)).toBe(false);
    expect(isAllowedExternal(AUTHORIZE, PORT, NO_KERNEL_URLS, NOW)).toBe(false);
  });

  it("allows a connect's authorize_url byte-for-byte until its expires_at", () => {
    const state = remember(NO_KERNEL_URLS, connect("jira", AUTHORIZE));
    expect(isAllowedExternal(AUTHORIZE, PORT, state, NOW)).toBe(true);
    expect(isAllowedExternal(AUTHORIZE, PORT, state, Date.parse(FUTURE) - 1)).toBe(true);
    expect(isAllowedExternal(AUTHORIZE, PORT, state, Date.parse(FUTURE))).toBe(false);
    expect(isAllowedExternal(AUTHORIZE, PORT, state, Date.parse(FUTURE) + 1)).toBe(false);
  });

  it("refuses a renderer-only https address beside a remembered one, and any different spelling of it", () => {
    const state = remember(NO_KERNEL_URLS, connect("jira", AUTHORIZE));
    for (const url of ["https://example.com/", `${AUTHORIZE}&x=1`, AUTHORIZE.replace("https:", "http:"), `${AUTHORIZE}#frag`, AUTHORIZE.replace("auth.", "AUTH."), ` ${AUTHORIZE}`]) {
      expect(isAllowedExternal(url, PORT, state, NOW)).toBe(false);
    }
  });

  it("drops an expired address when the next request is remembered", () => {
    const state = remember(NO_KERNEL_URLS, connect("jira", AUTHORIZE));
    const later = remember(state, { request: { method: "GET", path: "/status" }, result: { ok: true, status: 200, body: {} } }, Date.parse(FUTURE) + 1);
    expect(later.mcp).toEqual({});
  });

  it("drops that kind's address on its cancel, whatever the cancel answered, and keeps the other kind's", () => {
    let state = remember(NO_KERNEL_URLS, connect("jira", AUTHORIZE));
    const clickup = "https://app.clickup.com/api/v2/oauth?state=zzz";
    state = remember(state, connect("clickup", clickup));
    state = remember(state, { request: { method: "POST", path: "/connectors/mcp/:kind/connect/cancel", params: { kind: "jira" } }, result: { ok: false, status: 0, connection: { state: "unreachable" } } });
    expect(isAllowedExternal(AUTHORIZE, PORT, state, NOW)).toBe(false);
    expect(isAllowedExternal(clickup, PORT, state, NOW)).toBe(true);
  });

  it("drops that kind's address on its disconnect", () => {
    let state = remember(NO_KERNEL_URLS, connect("jira", AUTHORIZE));
    state = remember(state, { request: { method: "POST", path: "/connectors/mcp/:kind/disconnect", params: { kind: "jira" } }, result: { ok: true, status: 200, body: {} } });
    expect(isAllowedExternal(AUTHORIZE, PORT, state, NOW)).toBe(false);
  });

  it("replaces a kind's address on its next connect", () => {
    const next = "https://auth.atlassian.com/authorize?state=second";
    let state = remember(NO_KERNEL_URLS, connect("jira", AUTHORIZE));
    state = remember(state, connect("jira", next));
    expect(isAllowedExternal(AUTHORIZE, PORT, state, NOW)).toBe(false);
    expect(isAllowedExternal(next, PORT, state, NOW)).toBe(true);
  });

  it("keeps a live address when a later connect is refused", () => {
    let state = remember(NO_KERNEL_URLS, connect("jira", AUTHORIZE));
    state = remember(state, { request: connect("jira", 0).request, result: { ok: false, status: 409, body: { error: "connect_in_progress", message: "x" } } });
    expect(isAllowedExternal(AUTHORIZE, PORT, state, NOW)).toBe(true);
  });

  it("remembers nothing from an answer that is not ok, not https, not plain, or has no usable expiry", () => {
    const refusedAnswer = { request: connect("jira", AUTHORIZE).request, result: { ok: false, status: 409, body: { authorize_url: AUTHORIZE, expires_at: FUTURE } } };
    expect(remember(NO_KERNEL_URLS, refusedAnswer)).toEqual(NO_KERNEL_URLS);
    for (const step of [
      connect("jira", "http://auth.example.com/authorize"),
      connect("jira", "https://user:pw@auth.example.com/authorize"),
      connect("jira", "https://auth.example.com/authorize#frag"),
      connect("jira", "https://AUTH.example.com/authorize"),
      connect("jira", 7),
      connect("jira", AUTHORIZE, "not a date"),
      connect("jira", AUTHORIZE, null),
    ]) {
      expect(remember(NO_KERNEL_URLS, step).mcp).toEqual({});
    }
  });

  it("remembers a connect only for a kind the kernel serves", () => {
    expect(remember(NO_KERNEL_URLS, connect("github", AUTHORIZE)).mcp).toEqual({});
    expect(remember(NO_KERNEL_URLS, connect("../x", AUTHORIZE)).mcp).toEqual({});
  });

  it("allows the App upgrade url while it is the latest answer, and drops it on a null", () => {
    const url = "https://github.com/apps/loomwright-studio/installations/new/permissions?target_id=42";
    let state = remember(NO_KERNEL_URLS, upgrade(url));
    expect(isAllowedExternal(url, PORT, state, NOW + 86_400_000)).toBe(true);
    expect(isAllowedExternal(`${url}&x=1`, PORT, state, NOW)).toBe(false);
    state = remember(state, upgrade(null));
    expect(isAllowedExternal(url, PORT, state, NOW)).toBe(false);
  });

  it("does not let a remembered address widen what the http form allows", () => {
    const loopback = `http://127.0.0.1:${PORT + 1}/connectors/github/app/start?state=a`;
    expect(remember(NO_KERNEL_URLS, upgrade(loopback)).upgrade).toBeNull();
    expect(isAllowedExternal(loopback, PORT, { mcp: {}, upgrade: loopback }, NOW)).toBe(false);
  });

  it("ignores a request that is not shaped like one, and never changes its input", () => {
    const state = remember(NO_KERNEL_URLS, connect("jira", AUTHORIZE));
    const before = JSON.stringify(state);
    for (const request of [undefined, null, 7, "POST", { method: 1, path: "/x" }, { method: "POST" }, [], { method: "POST", path: "/connectors/mcp/:kind/connect", params: "jira" }]) {
      expect(rememberKernelUrl(state, request, { ok: true, status: 200, body: {} }, NOW)).toEqual(state);
    }
    for (const result of [undefined, null, 7, { ok: true }, { ok: true, status: 200 }, { ok: true, status: 200, body: [] }]) {
      expect(() => rememberKernelUrl(state, connect("jira", AUTHORIZE).request, result, NOW)).not.toThrow();
    }
    expect(JSON.stringify(state)).toBe(before);
  });
});
