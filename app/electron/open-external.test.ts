// The open-external allowlist (AC8): exactly three address forms may reach the
// system browser; every other spelling is refused.
import { describe, expect, it } from "vitest";
import { isAllowedExternal } from "./open-external";

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
