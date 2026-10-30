// The GitHub App's key encoding, JWT, installation-token holder and the client's
// method-resolving provider (GitHub App 2, subtask 1: AC2 client half, AC3,
// AC4, AC11 token holder, AC12 client and holder paths).
//
// Every test injects `fetch` and a fake Keychain: none reaches the network or
// the real Keychain. The fake GitHub verifies the JWT the way GitHub does (the
// signature against the App's public key, `iat` not after its clock, `exp` after
// it, a lifetime of at most 10 minutes) and answers an installation token with
// its permissions and an hour's life. Every secret string (the `pem`, its
// encoding, each JWT and each installation token) is a needle on every result.
import { createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { WRITE_ARG } from "../src/auth/keychain.js";
import type { KeychainReader } from "../src/auth/keychain.js";
import {
  GITHUB_APP_ID_SERVICE,
  GITHUB_APP_INSTALLATION_SERVICE,
  GITHUB_APP_JWT_LIFETIME_SECONDS,
  GITHUB_APP_JWT_SKEW_SECONDS,
  GITHUB_APP_KEY_SERVICE,
  GITHUB_APP_SLUG_SERVICE,
  GITHUB_APP_TOKEN_RENEW_MS,
  createGitHubAppTokens,
  decodeAppKey,
  encodeAppKey,
  githubAppTokens,
  signAppJwt,
} from "../src/integrations/github/app-token.js";
import type { GitHubAppTokens } from "../src/integrations/github/app-token.js";
import { GITHUB_KEYCHAIN_SERVICE, createGitHubClient, resolveGitHubTokenProvider } from "../src/integrations/github/client.js";

const APP_ID = 987654;
const INSTALLATION = 4242;
const START = Date.parse("2026-10-30T12:00:00.000Z");
const HOUR = 3_600_000;
const PAT = "github_pat_11PATPATPAT0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd";

const rsa = (): { publicKey: string; privateKey: string } =>
  generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs1", format: "pem" } });
const KEY = rsa();
const OTHER_KEY = rsa();
const EC = generateKeyPairSync("ec", { namedCurve: "prime256v1", publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });

const ENCODED = encodeAppKey(KEY.privateKey) ?? "";

const b64json = (s: string): Record<string, unknown> => JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Record<string, unknown>;

interface Env {
  /** The test's clock (ours) in ms. */
  nowMs: number;
  /** How far our clock is ahead of GitHub's, in ms. */
  skewMs: number;
  keychain: Map<string, string>;
  reads: string[];
  throwOnRead: boolean;
  /** Every request the fake GitHub saw. */
  calls: Array<{ method: string; path: string; authorization: string | null }>;
  jwts: string[];
  /** Every installation token the fake GitHub issued, in order. */
  tokens: string[];
  /** The issued tokens GitHub still recognises (revoking one removes it here). */
  valid: Set<string>;
  /** The next mint answers this status instead of 201, when set. */
  mintStatus: number | undefined;
  /** Mints that must hold until released (to test sharing). */
  hold: Promise<void> | undefined;
  /** The permissions a mint reports. */
  permissions: Record<string, string>;
  /** The public key the fake GitHub verifies a JWT against. */
  publicKey: string;
  /** The Keychain reader. */
  reader: KeychainReader;
  fetch: typeof fetch;
  now: () => Date;
  tokens_: GitHubAppTokens;
}

function seed(env: Env, over: Record<string, string> = {}): void {
  env.keychain.set(GITHUB_APP_ID_SERVICE, String(APP_ID));
  env.keychain.set(GITHUB_APP_SLUG_SERVICE, "studio-reader");
  env.keychain.set(GITHUB_APP_INSTALLATION_SERVICE, String(INSTALLATION));
  env.keychain.set(GITHUB_APP_KEY_SERVICE, ENCODED);
  for (const [k, v] of Object.entries(over)) env.keychain.set(k, v);
}

function makeEnv(): Env {
  const env = {
    nowMs: START,
    skewMs: 0,
    keychain: new Map<string, string>(),
    reads: [] as string[],
    throwOnRead: false,
    calls: [] as Env["calls"],
    jwts: [] as string[],
    tokens: [] as string[],
    valid: new Set<string>(),
    mintStatus: undefined as number | undefined,
    hold: undefined as Promise<void> | undefined,
    permissions: { metadata: "read", contents: "read", pull_requests: "read" } as Record<string, string>,
    publicKey: KEY.publicKey,
  } as unknown as Env;
  env.reader = {
    read(service: string): string | undefined {
      env.reads.push(service);
      if (env.throwOnRead) throw new Error(`security said ${ENCODED} ${KEY.privateKey}`);
      return env.keychain.get(service);
    },
  };
  env.now = () => new Date(env.nowMs);
  const ghNowMs = (): number => env.nowMs - env.skewMs;
  const json = (body: unknown, status: number): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  env.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const authorization = new Headers(init?.headers).get("authorization");
    env.calls.push({ method: init?.method ?? "GET", path: url.pathname, authorization });
    const mint = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
    if (init?.method === "POST" && mint !== null) {
      const jwt = (authorization ?? "").replace(/^Bearer /, "");
      env.jwts.push(jwt);
      if (env.hold !== undefined) await env.hold;
      if (env.mintStatus !== undefined) return json({ message: "no" }, env.mintStatus);
      // GitHub's check of the App JWT.
      const [h, c, sig] = jwt.split(".");
      const header = b64json(h ?? "");
      const claims = b64json(c ?? "");
      const verified = createVerify("RSA-SHA256")
        .update(`${h}.${c}`)
        .verify(env.publicKey, Buffer.from(sig ?? "", "base64url"));
      const seconds = Math.floor(ghNowMs() / 1000);
      const good =
        verified &&
        header["alg"] === "RS256" &&
        claims["iss"] === String(APP_ID) &&
        typeof claims["iat"] === "number" &&
        typeof claims["exp"] === "number" &&
        claims["iat"] <= seconds &&
        claims["exp"] > seconds &&
        claims["exp"] - claims["iat"] <= 600;
      if (!good) return json({ message: "A JSON web token could not be decoded" }, 401);
      const token = `ghs_${String(env.tokens.length + 1).padStart(36, "x")}`;
      env.tokens.push(token);
      env.valid.add(token);
      return json({ token, expires_at: new Date(ghNowMs() + HOUR).toISOString(), permissions: env.permissions, repository_selection: "selected" }, 201);
    }
    if (url.pathname === "/installation/repositories") {
      if (![...env.valid].some((t) => authorization === `Bearer ${t}`)) return json({ message: "Bad credentials" }, 401);
      return json({ total_count: 1, repositories: [{ full_name: "o/r", private: true }] }, 200);
    }
    return json({ message: "Not Found" }, 404);
  }) as typeof fetch;

  env.tokens_ = createGitHubAppTokens({ keychain: env.reader, fetch: env.fetch, now: env.now });
  return env;
}

/** Every secret the tests know of, as of now. */
const secretsOf = (env: Env): string[] => [KEY.privateKey, ENCODED, ...env.jwts, ...env.tokens].filter((s) => s.length > 0);

function expectNoSecret(value: unknown, secrets: readonly string[], what = "value"): void {
  const text = `${JSON.stringify(value)}\n${inspect(value, { depth: 10 })}`;
  for (const s of secrets) expect(text.includes(s), `${what} contains a secret`).toBe(false);
}

// ---------------------------------------------------------------------------
// The constants
// ---------------------------------------------------------------------------

describe("the App's Keychain items and constants", () => {
  it("names the four items, and none collides with the PAT's", () => {
    expect([GITHUB_APP_ID_SERVICE, GITHUB_APP_SLUG_SERVICE, GITHUB_APP_INSTALLATION_SERVICE, GITHUB_APP_KEY_SERVICE]).toEqual([
      "loomwright-studio-github-app-id",
      "loomwright-studio-github-app-slug",
      "loomwright-studio-github-app-installation",
      "loomwright-studio-github-app-key",
    ]);
    const all = [GITHUB_KEYCHAIN_SERVICE, GITHUB_APP_ID_SERVICE, GITHUB_APP_SLUG_SERVICE, GITHUB_APP_INSTALLATION_SERVICE, GITHUB_APP_KEY_SERVICE];
    expect(new Set(all).size).toBe(5);
    for (const s of all) expect(WRITE_ARG.test(s)).toBe(true);
  });

  it("skew is 60 seconds, the JWT's life is 600 and a token is renewed with 5 minutes left", () => {
    expect(GITHUB_APP_JWT_SKEW_SECONDS).toBe(60);
    expect(GITHUB_APP_JWT_LIFETIME_SECONDS).toBe(600);
    expect(GITHUB_APP_TOKEN_RENEW_MS).toBe(5 * 60_000);
  });
});

// ---------------------------------------------------------------------------
// The key encoding
// ---------------------------------------------------------------------------

describe("encodeAppKey and decodeAppKey (AC12)", () => {
  it("round-trips a PEM as unpadded base64url that the Keychain writer accepts", () => {
    expect(ENCODED).not.toBe("");
    expect(ENCODED).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(ENCODED).not.toContain("=");
    expect(WRITE_ARG.test(ENCODED)).toBe(true);
    expect(decodeAppKey(ENCODED)).toBe(KEY.privateKey);
  });

  it("a PKCS#8 key, and a PEM with CRLF line ends, round-trip too", () => {
    const pkcs8 = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;
    for (const pem of [pkcs8, KEY.privateKey.replace(/\n/g, "\r\n")]) {
      const enc = encodeAppKey(pem);
      expect(enc).toBeDefined();
      expect(WRITE_ARG.test(enc ?? "")).toBe(true);
      expect(decodeAppKey(enc ?? "")).toBe(pem);
    }
  });

  it("the encoded key starts with a letter (never `-`) for any PEM", () => {
    for (const label of ["RSA PRIVATE KEY", "PRIVATE KEY", "EC PRIVATE KEY"]) {
      expect(encodeAppKey(`-----BEGIN ${label}-----\nAAAA\n-----END ${label}-----\n`)).toMatch(/^[A-Za-z]/);
    }
  });

  it.each([
    ["an empty string", ""],
    ["plain text", "hello"],
    ["a PEM with leading whitespace", ` ${KEY.privateKey}`],
    ["a PEM with a leading newline", `\n${KEY.privateKey}`],
    ["a public key's text without BEGIN first", `x${KEY.privateKey}`],
    ["a lowercase begin", "-----begin RSA PRIVATE KEY-----"],
    ["an already-encoded key", ENCODED],
    ["a PEM over the bound", `-----BEGIN RSA PRIVATE KEY-----\n${"A".repeat(9000)}\n-----END RSA PRIVATE KEY-----\n`],
  ])("refuses %s", (_, pem) => {
    expect(encodeAppKey(pem)).toBeUndefined();
  });

  it("never throws, whatever it is given", () => {
    for (const bad of [undefined, null, 1, {}, [], Symbol("x"), () => 1, new Uint8Array(3)]) {
      expect(encodeAppKey(bad as never)).toBeUndefined();
      expect(decodeAppKey(bad as never)).toBeUndefined();
    }
  });

  it.each([
    ["padded", `${ENCODED}=`],
    ["standard base64", Buffer.from(KEY.privateKey).toString("base64")],
    ["with whitespace", `${ENCODED.slice(0, 10)} ${ENCODED.slice(10)}`],
    ["with a newline", `${ENCODED}\n`],
    ["empty", ""],
    ["not a PEM once decoded", Buffer.from("hello").toString("base64url")],
    ["a PEM-prefixed string with a different tail (non-canonical bytes)", `${ENCODED.slice(0, -2)}$$`],
  ])("decode refuses an encoding that is %s", (_, enc) => {
    expect(decodeAppKey(enc)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The JWT
// ---------------------------------------------------------------------------

describe("signAppJwt (AC4)", () => {
  const NOW = new Date(START);

  it("is an RS256 JWT: iss the App id as a string, iat 60 s before now, exp 600 s after iat, signed by the key", () => {
    const jwt = signAppJwt(APP_ID, KEY.privateKey, NOW) ?? "";
    const [h, c, sig] = jwt.split(".");
    expect(jwt.split(".")).toHaveLength(3);
    expect(b64json(h ?? "")).toEqual({ alg: "RS256", typ: "JWT" });
    const seconds = START / 1000;
    expect(b64json(c ?? "")).toEqual({ iat: seconds - 60, exp: seconds - 60 + 600, iss: String(APP_ID) });
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(KEY.publicKey, Buffer.from(sig ?? "", "base64url"))).toBe(true);
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(OTHER_KEY.publicKey, Buffer.from(sig ?? "", "base64url"))).toBe(false);
    expect(jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("takes the App id as a number or a numeric string", () => {
    const a = signAppJwt(APP_ID, KEY.privateKey, NOW) ?? "";
    const b = signAppJwt(String(APP_ID), KEY.privateKey, NOW) ?? "";
    expect(b64json(a.split(".")[1] ?? "")["iss"]).toBe(b64json(b.split(".")[1] ?? "")["iss"]);
  });

  it.each([0, 30, 59, 60])("a clock %i seconds ahead of GitHub's still gets a JWT GitHub accepts (iat <= its clock, exp > its clock, life <= 600)", async (skewSeconds) => {
    const env = makeEnv();
    seed(env);
    env.skewMs = skewSeconds * 1000;
    const res = await env.tokens_.current();
    expect(res.ok, `skew ${skewSeconds}s`).toBe(true);
  });

  it("a clock more than 60 s ahead is the case the skew does not cover: GitHub rejects it (the fake checks iat <= its clock)", async () => {
    const env = makeEnv();
    seed(env);
    env.skewMs = 61_000;
    expect(await env.tokens_.current()).toEqual({ ok: false, error: "http_error", status: 401 });
  });

  it("a clock behind GitHub's by up to 9 minutes still gets a JWT whose exp is in GitHub's future", async () => {
    const env = makeEnv();
    seed(env);
    env.skewMs = -8 * 60_000;
    expect((await env.tokens_.current()).ok).toBe(true);
  });

  it("the lifetime never exceeds GitHub's 10 minutes", () => {
    const claims = b64json((signAppJwt(APP_ID, KEY.privateKey, NOW) ?? "").split(".")[1] ?? "");
    expect((claims["exp"] as number) - (claims["iat"] as number)).toBeLessThanOrEqual(600);
  });

  it.each([
    ["a pem that is not a key", "-----BEGIN RSA PRIVATE KEY-----\nnot a key\n-----END RSA PRIVATE KEY-----\n", APP_ID, NOW],
    ["an empty pem", "", APP_ID, NOW],
    ["an EC key", EC.privateKey, APP_ID, NOW],
    ["a public key", KEY.publicKey, APP_ID, NOW],
    ["a non-numeric app id", KEY.privateKey, "abc", NOW],
    ["a zero app id", KEY.privateKey, 0, NOW],
    ["a negative app id", KEY.privateKey, -3, NOW],
    ["a fractional app id", KEY.privateKey, 1.5, NOW],
    ["an invalid date", KEY.privateKey, APP_ID, new Date(Number.NaN)],
    ["not a date", KEY.privateKey, APP_ID, "now" as never],
    ["undefined for everything", undefined as never, undefined as never, undefined as never],
  ])("is undefined, never a throw, for %s", (_, pem, appId, now) => {
    expect(signAppJwt(appId, pem, now)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The holder
// ---------------------------------------------------------------------------

describe("createGitHubAppTokens (AC3, AC11)", () => {
  let env: Env;
  beforeEach(() => {
    env = makeEnv();
    seed(env);
  });

  it("reads nothing and sends nothing when it is built", () => {
    const fresh = makeEnv();
    seed(fresh);
    expect(fresh.reads).toEqual([]);
    expect(fresh.calls).toEqual([]);
    expect(fresh.tokens_.lastMintFailure).toBeUndefined();
  });

  it("mints on the first call: POST with the JWT, returning the token, its expiry and the permissions GitHub reports", async () => {
    const res = await env.tokens_.current();
    expect(res).toEqual({
      ok: true,
      token: env.tokens[0],
      expires_at: new Date(START + HOUR).toISOString(),
      permissions: { metadata: "read", contents: "read", pull_requests: "read" },
    });
    expect(env.calls).toEqual([{ method: "POST", path: `/app/installations/${INSTALLATION}/access_tokens`, authorization: `Bearer ${env.jwts[0]}` }]);
    expect(env.tokens[0]).toMatch(/^ghs_/);
  });

  it("holds the token: a second call within life makes no request, and the Keychain key is read only to mint", async () => {
    await env.tokens_.current();
    env.reads.length = 0;
    env.nowMs += 10 * 60_000;
    const again = await env.tokens_.current();
    expect(again.ok && again.token).toBe(env.tokens[0]);
    expect(env.calls).toHaveLength(1);
    expect(env.reads).toEqual([GITHUB_APP_INSTALLATION_SERVICE]);
  });

  it("renews with 5 minutes left (AC3): not at 5 minutes and 1 ms, yes at exactly 5 minutes", async () => {
    await env.tokens_.current();
    const expiresMs = START + HOUR;
    env.nowMs = expiresMs - GITHUB_APP_TOKEN_RENEW_MS - 1;
    await env.tokens_.current();
    expect(env.calls).toHaveLength(1);
    env.nowMs = expiresMs - GITHUB_APP_TOKEN_RENEW_MS;
    const renewed = await env.tokens_.current();
    expect(env.calls).toHaveLength(2);
    expect(renewed.ok && renewed.token).toBe(env.tokens[1]);
    expect(env.tokens[1]).not.toBe(env.tokens[0]);
  });

  it("renews a token that is already expired", async () => {
    await env.tokens_.current();
    env.nowMs += 2 * HOUR;
    const res = await env.tokens_.current();
    expect(res.ok && res.token).toBe(env.tokens[1]);
  });

  it("mints again when the Keychain's installation is not the one the token was minted for", async () => {
    await env.tokens_.current();
    env.keychain.set(GITHUB_APP_INSTALLATION_SERVICE, "5555");
    await env.tokens_.current();
    expect(env.calls.map((c) => c.path)).toEqual([`/app/installations/${INSTALLATION}/access_tokens`, "/app/installations/5555/access_tokens"]);
  });

  it("concurrent calls share one mint", async () => {
    let release: () => void = () => undefined;
    env.hold = new Promise<void>((r) => (release = r));
    const all = Promise.all([env.tokens_.current(), env.tokens_.current(), env.tokens_.current()]);
    await new Promise((r) => setTimeout(r, 10));
    release();
    const results = await all;
    expect(env.calls).toHaveLength(1);
    expect(new Set(results.map((r) => (r.ok ? r.token : "x"))).size).toBe(1);
  });

  it("invalidate() forgets the token, so the next call mints", async () => {
    await env.tokens_.current();
    env.tokens_.invalidate();
    const res = await env.tokens_.current();
    expect(env.calls).toHaveLength(2);
    expect(res.ok && res.token).toBe(env.tokens[1]);
  });

  it("a mint that was in flight when invalidate() ran is returned to its caller but not kept", async () => {
    let release: () => void = () => undefined;
    env.hold = new Promise<void>((r) => (release = r));
    const pending = env.tokens_.current();
    await new Promise((r) => setTimeout(r, 10));
    env.tokens_.invalidate();
    env.hold = undefined;
    release();
    expect((await pending).ok).toBe(true);
    await env.tokens_.current();
    expect(env.calls).toHaveLength(2);
  });

  it("a 401 on mint (the key is revoked) is recorded on the holder and drops the held token", async () => {
    await env.tokens_.current();
    env.nowMs += HOUR;
    env.mintStatus = 401;
    expect(await env.tokens_.current()).toEqual({ ok: false, error: "http_error", status: 401 });
    expect(env.tokens_.lastMintFailure).toEqual({ status: 401, at: new Date(env.nowMs).toISOString() });
    // The held token is gone: a later call mints again rather than using it.
    env.mintStatus = undefined;
    const ok = await env.tokens_.current();
    expect(ok.ok && ok.token).toBe(env.tokens[1]);
    expect(env.tokens_.lastMintFailure).toBeUndefined();
  });

  it("a 404 on mint (the App was uninstalled) is recorded too; clearMintFailure() forgets it", async () => {
    env.mintStatus = 404;
    expect(await env.tokens_.current()).toEqual({ ok: false, error: "http_error", status: 404 });
    expect(env.tokens_.lastMintFailure).toMatchObject({ status: 404 });
    env.tokens_.clearMintFailure();
    expect(env.tokens_.lastMintFailure).toBeUndefined();
  });

  it("invalidate() also clears a recorded failure", async () => {
    env.mintStatus = 401;
    await env.tokens_.current();
    expect(env.tokens_.lastMintFailure).toBeDefined();
    env.tokens_.invalidate();
    expect(env.tokens_.lastMintFailure).toBeUndefined();
  });

  it.each([403, 422, 500, 502])("a %i on mint is a typed failure and is not recorded as a rejection", async (status) => {
    env.mintStatus = status;
    expect(await env.tokens_.current()).toEqual({ ok: false, error: "http_error", status });
    expect(env.tokens_.lastMintFailure).toBeUndefined();
  });

  it("a failed renewal is a typed failure, keeps the held token for the next try, and the next call mints again", async () => {
    await env.tokens_.current();
    env.nowMs = START + HOUR - GITHUB_APP_TOKEN_RENEW_MS;
    env.mintStatus = 502;
    expect(await env.tokens_.current()).toEqual({ ok: false, error: "http_error", status: 502 });
    expect(env.tokens_.lastMintFailure).toBeUndefined();
    env.mintStatus = undefined;
    const ok = await env.tokens_.current();
    expect(ok.ok && ok.token).toBe(env.tokens[1]);
  });

  it("a network error is unreachable, not recorded", async () => {
    const down = createGitHubAppTokens({
      keychain: env.reader,
      now: env.now,
      fetch: (async () => {
        throw new Error(`down ${env.jwts[0] ?? ""} ${ENCODED}`);
      }) as typeof fetch,
    });
    const res = await down.current();
    expect(res).toEqual({ ok: false, error: "unreachable" });
    expect(down.lastMintFailure).toBeUndefined();
    expectNoSecret(res, secretsOf(env));
  });

  it("a rate-limited mint is rate_limited", async () => {
    const limited = createGitHubAppTokens({
      keychain: env.reader,
      now: env.now,
      fetch: (async () => new Response("{}", { status: 429 })) as typeof fetch,
    });
    expect(await limited.current()).toEqual({ ok: false, error: "rate_limited" });
  });

  it("a mint response whose permissions are not strings is unreachable, not a throw", async () => {
    const odd = createGitHubAppTokens({
      keychain: env.reader,
      now: env.now,
      fetch: (async () => new Response(JSON.stringify({ token: "ghs_abc", expires_at: new Date(START + HOUR).toISOString(), permissions: { metadata: 1 } }), { status: 201 })) as typeof fetch,
    });
    expect(await odd.current()).toEqual({ ok: false, error: "unreachable" });
  });

  it("a mint that reports a write permission is refused write_scoped, naming the permissions, and nothing is held", async () => {
    env.permissions = { metadata: "read", pull_requests: "write" };
    const res = await env.tokens_.current();
    expect(res).toEqual({ ok: false, error: "write_scoped", write_permissions: [{ permission: "pull_requests", level: "write" }] });
    expect(JSON.stringify(res)).not.toContain(env.tokens[0] ?? "ghs_");
    expect(env.tokens_.lastMintFailure).toMatchObject({ write_permissions: [{ permission: "pull_requests", level: "write" }] });
    // Nothing was held: the next call mints again.
    env.permissions = { metadata: "read" };
    const ok = await env.tokens_.current();
    expect(ok.ok && ok.token).toBe(env.tokens[1]);
    expect(env.tokens_.lastMintFailure).toBeUndefined();
  });

  it("a renewal that turns write-scoped is refused, the held read-only token is dropped, and the failure is recorded", async () => {
    const first = await env.tokens_.current();
    expect(first.ok).toBe(true);
    env.nowMs += HOUR - 60_000;
    env.permissions = { metadata: "read", contents: "write", pull_requests: "write" };
    const res = await env.tokens_.current();
    expect(res).toEqual({
      ok: false,
      error: "write_scoped",
      write_permissions: [
        { permission: "contents", level: "write" },
        { permission: "pull_requests", level: "write" },
      ],
    });
    expect(JSON.stringify([res, env.tokens_.lastMintFailure])).not.toContain(env.tokens[1] ?? "ghs_");
    expect(env.tokens_.lastMintFailure).toBeDefined();
    // The old token is gone too: a following call mints (and is refused) again, never serves a held token.
    const again = await env.tokens_.current();
    expect(again).toMatchObject({ ok: false, error: "write_scoped" });
    expect(env.calls).toHaveLength(3);
  });

  describe("no credentials", () => {
    it.each([
      ["no installation", GITHUB_APP_INSTALLATION_SERVICE],
      ["no key", GITHUB_APP_KEY_SERVICE],
      ["no App id", GITHUB_APP_ID_SERVICE],
    ])("%s: no_credentials, and no request", async (_, service) => {
      env.keychain.delete(service);
      expect(await env.tokens_.current()).toEqual({ ok: false, error: "no_credentials" });
      expect(env.calls).toEqual([]);
    });

    it.each([
      ["an installation that is not a number", GITHUB_APP_INSTALLATION_SERVICE, "abc"],
      ["a zero installation", GITHUB_APP_INSTALLATION_SERVICE, "0"],
      ["an empty installation", GITHUB_APP_INSTALLATION_SERVICE, ""],
      ["an App id that is not a number", GITHUB_APP_ID_SERVICE, "x1"],
    ])("%s: no_credentials", async (_, service, value) => {
      env.keychain.set(service, value);
      expect(await env.tokens_.current()).toEqual({ ok: false, error: "no_credentials" });
      expect(env.calls).toEqual([]);
    });

    it.each([
      ["a key that is not base64url", "not a key!"],
      ["a key that decodes to something that is not a PEM", Buffer.from("hello").toString("base64url")],
      ["a PEM that is not a key", encodeAppKey("-----BEGIN RSA PRIVATE KEY-----\nbm90IGEga2V5\n-----END RSA PRIVATE KEY-----\n") ?? ""],
      ["an EC key", encodeAppKey(EC.privateKey) ?? ""],
    ])("%s: bad_key, and no request", async (_, value) => {
      env.keychain.set(GITHUB_APP_KEY_SERVICE, value);
      const res = await env.tokens_.current();
      expect(res).toEqual({ ok: false, error: "bad_key" });
      expect(env.calls).toEqual([]);
    });

    it("a key GitHub does not recognise (rotated) is a 401, recorded as a rejection", async () => {
      env.keychain.set(GITHUB_APP_KEY_SERVICE, encodeAppKey(OTHER_KEY.privateKey) ?? "");
      expect(await env.tokens_.current()).toEqual({ ok: false, error: "http_error", status: 401 });
      expect(env.tokens_.lastMintFailure).toMatchObject({ status: 401 });
    });

    it("a Keychain read that throws is keychain_failed, with no message and no secret", async () => {
      env.throwOnRead = true;
      const res = await env.tokens_.current();
      expect(res).toEqual({ ok: false, error: "keychain_failed" });
      expectNoSecret(res, secretsOf(env));
      expect(env.calls).toEqual([]);
    });
  });

  describe("configured()", () => {
    it("is true only with the installation and the key both present", () => {
      expect(env.tokens_.configured()).toBe(true);
      env.keychain.delete(GITHUB_APP_KEY_SERVICE);
      expect(env.tokens_.configured()).toBe(false);
      env.keychain.set(GITHUB_APP_KEY_SERVICE, ENCODED);
      env.keychain.delete(GITHUB_APP_INSTALLATION_SERVICE);
      expect(env.tokens_.configured()).toBe(false);
      env.keychain.set(GITHUB_APP_INSTALLATION_SERVICE, "1");
      env.keychain.set(GITHUB_APP_KEY_SERVICE, "");
      expect(env.tokens_.configured()).toBe(false);
    });

    it("is false, not a throw, when a Keychain read throws", () => {
      env.throwOnRead = true;
      expect(env.tokens_.configured()).toBe(false);
    });

    it("sends no request", () => {
      env.tokens_.configured();
      expect(env.calls).toEqual([]);
    });
  });

  it("never throws or rejects, whatever fails inside it, and no result, failure or property carries a secret (AC11, AC12)", async () => {
    const results: unknown[] = [];
    const secrets: string[] = [KEY.privateKey, ENCODED];
    // A fetch that throws an error carrying every secret.
    const poison = (): string => [KEY.privateKey, ENCODED, ...env.jwts, ...env.tokens].join(" ");
    const throwing = createGitHubAppTokens({
      keychain: env.reader,
      now: env.now,
      fetch: (async (_: unknown, init?: RequestInit) => {
        env.jwts.push((new Headers(init?.headers).get("authorization") ?? "").replace("Bearer ", ""));
        throw new Error(poison());
      }) as typeof fetch,
    });
    results.push(await throwing.current(), throwing.lastMintFailure, throwing.configured());
    // A clock that throws.
    const badClock = createGitHubAppTokens({
      keychain: env.reader,
      fetch: env.fetch,
      now: () => {
        throw new Error(poison());
      },
    });
    results.push(await badClock.current(), badClock.lastMintFailure);
    // A fetch that returns a response whose body throws on read.
    const badBody = createGitHubAppTokens({
      keychain: env.reader,
      now: env.now,
      fetch: (async () =>
        new Response(
          new ReadableStream({
            pull() {
              throw new Error(poison());
            },
          }),
          { status: 201 },
        )) as typeof fetch,
    });
    results.push(await badBody.current());
    // A fetch that is not a function, and a Keychain that is not one.
    results.push(await createGitHubAppTokens({ keychain: env.reader, now: env.now, fetch: 5 as never }).current());
    results.push(await createGitHubAppTokens({ keychain: {} as never }).current(), createGitHubAppTokens({ keychain: {} as never }).configured());
    // A Keychain returning non-strings.
    results.push(await createGitHubAppTokens({ keychain: { read: () => 42 as never } }).current());
    // Mint answers with secrets in the body.
    env.mintStatus = 401;
    results.push(await env.tokens_.current(), env.tokens_.lastMintFailure);
    secrets.push(...env.jwts);
    for (const r of results) expectNoSecret(r, secrets.filter((s) => s.length > 0));
    // Every failure is one of the closed values.
    for (const r of results) {
      if (typeof r === "object" && r !== null && "ok" in r && (r as { ok: boolean }).ok === false) {
        expect(["no_credentials", "keychain_failed", "bad_key", "unreachable", "rate_limited", "http_error"]).toContain((r as unknown as { error: string }).error);
        expect(Object.keys(r).every((k) => ["ok", "error", "status"].includes(k))).toBe(true);
      }
    }
  });

  it("a successful result carries the token by design, and nothing else of the secrets", async () => {
    const res = await env.tokens_.current();
    expectNoSecret(res, [KEY.privateKey, ENCODED, ...env.jwts]);
    expect(Object.keys(res).sort()).toEqual(["expires_at", "ok", "permissions", "token"]);
  });

  it("keeps the secrets out of the holder's own properties (the token is in a closure, not on the object)", async () => {
    await env.tokens_.current();
    expectNoSecret(Object.entries(Object.getOwnPropertyDescriptors(env.tokens_)).map(([k, d]) => [k, typeof d.value]), secretsOf(env));
    expectNoSecret(env.tokens_, secretsOf(env));
  });
});

describe("githubAppTokens and the source", () => {
  it("is one shipped holder with the whole surface", () => {
    for (const m of ["current", "invalidate", "configured", "clearMintFailure"] as const) expect(typeof githubAppTokens[m]).toBe("function");
    expect(githubAppTokens.lastMintFailure).toBeUndefined();
  });

  const src = readFileSync(fileURLToPath(new URL("../src/integrations/github/app-token.ts", import.meta.url)), "utf8");

  it("never logs, writes a file, or imports the SDK, the session manager or kernel.ts", () => {
    expect(src).not.toMatch(/\bconsole\./);
    expect(src).not.toMatch(/node:fs|node:child_process|writeFile|process\.stdout|process\.stderr/);
    expect(src).not.toMatch(/claude-agent-sdk|session-manager|\.\.\/\.\.\/kernel/);
    expect([...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1])).toEqual(["node:crypto", "../../auth/keychain.js", "../../auth/keychain.js", "./client.js", "./client.js"]);
  });

  it("catches every throw: the signing, the encoding, the Keychain read, the mint and the holder's methods each have a catch", () => {
    expect([...src.matchAll(/\bcatch \{/g)].length).toBeGreaterThanOrEqual(7);
    expect(src).not.toMatch(/catch \(/);
  });
});

// ---------------------------------------------------------------------------
// The client's method-resolving provider (AC2 client half, AC3, AC12)
// ---------------------------------------------------------------------------

describe("resolveGitHubTokenProvider (AC2, AC3)", () => {
  let env: Env;
  beforeEach(() => {
    env = makeEnv();
    seed(env);
  });

  it("reads nothing when it is built or when its resolver is built; only a call to the resolver reads", () => {
    const resolve = resolveGitHubTokenProvider(env.reader, env.tokens_);
    expect(env.reads).toEqual([]);
    resolve();
    expect(env.reads.length).toBeGreaterThan(0);
  });

  it("the PAT item present means method token, and the App's items are not consulted", async () => {
    env.keychain.set(GITHUB_KEYCHAIN_SERVICE, PAT);
    const resolve = resolveGitHubTokenProvider(env.reader, env.tokens_);
    const p = resolve();
    expect(p?.method).toBe("token");
    expect(await p?.token()).toBe(PAT);
    expect(p?.renew).toBeUndefined();
    expect(env.reads).toEqual([GITHUB_KEYCHAIN_SERVICE]);
    expect(env.calls).toEqual([]);
  });

  it("no PAT but the App's items present means method app, with the holder's token and a renew", async () => {
    const p = resolveGitHubTokenProvider(env.reader, env.tokens_)();
    expect(p?.method).toBe("app");
    const first = await p?.token();
    expect(first).toBe(env.tokens[0]);
    expect(await p?.token()).toBe(first);
    expect(env.calls).toHaveLength(1);
    // renew() forgets the held token and mints a new one.
    const renewed = await p?.renew?.();
    expect(renewed).toBe(env.tokens[1]);
    expect(renewed).not.toBe(first);
    expect(env.calls).toHaveLength(2);
  });

  it.each([
    ["neither credential", [] as string[]],
    ["the installation only", [GITHUB_APP_KEY_SERVICE]],
    ["the key only", [GITHUB_APP_INSTALLATION_SERVICE]],
  ])("%s: no provider", (_, removed) => {
    const e = makeEnv();
    if (removed.length > 0) {
      seed(e);
      for (const service of removed) e.keychain.delete(service);
    }
    expect(resolveGitHubTokenProvider(e.reader, e.tokens_)()).toBeUndefined();
  });

  it("a Keychain read that throws is no provider, with nothing thrown", () => {
    env.throwOnRead = true;
    expect(resolveGitHubTokenProvider(env.reader, env.tokens_)()).toBeUndefined();
  });

  it("a holder whose configured() throws is no provider", () => {
    const holder = { configured: () => { throw new Error("x"); }, current: async () => ({ ok: false as const }), invalidate: () => undefined };
    expect(resolveGitHubTokenProvider(env.reader, holder)()).toBeUndefined();
  });

  it("an app provider whose holder fails yields no token (not a throw), and no renewed token", async () => {
    env.mintStatus = 401;
    const p = resolveGitHubTokenProvider(env.reader, env.tokens_)();
    expect(await p?.token()).toBeUndefined();
    expect(await p?.renew?.()).toBeUndefined();
  });

  describe("through the client", () => {
    const client = (): ReturnType<typeof createGitHubClient> =>
      createGitHubClient({ tokenProvider: resolveGitHubTokenProvider(env.reader, env.tokens_), fetch: env.fetch, now: env.now });

    it("method app: a call mints once, then reads /installation/repositories with the installation token (AC2)", async () => {
      const gh = client();
      expect(env.reads).toEqual([]);
      const res = await gh.listReachableRepos();
      expect(res.ok && res.data).toEqual([{ full_name: "o/r", private: true }]);
      expect(env.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST /app/installations/${INSTALLATION}/access_tokens`, "GET /installation/repositories"]);
      expect(env.calls[1]?.authorization).toBe(`Bearer ${env.tokens[0]}`);
      await gh.listReachableRepos();
      expect(env.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    });

    it("a token within 5 minutes of expiry is replaced before the next call (AC3)", async () => {
      const gh = client();
      await gh.listReachableRepos();
      env.nowMs = START + HOUR - GITHUB_APP_TOKEN_RENEW_MS;
      await gh.listReachableRepos();
      expect(env.calls.map((c) => c.method)).toEqual(["POST", "GET", "POST", "GET"]);
      expect(env.calls[3]?.authorization).toBe(`Bearer ${env.tokens[1]}`);
    });

    it("a 401 re-mints once and retries once (AC3)", async () => {
      const gh = client();
      await gh.listReachableRepos();
      // GitHub revokes the held token early: it no longer recognises it.
      env.valid.clear();
      const res = await gh.listReachableRepos();
      expect(res.ok).toBe(true);
      // POST, GET, then the 401'd GET, a re-mint, and the retried GET: one re-mint, one retry.
      expect(env.calls.map((c) => c.method)).toEqual(["POST", "GET", "GET", "POST", "GET"]);
      expect(env.calls[4]?.authorization).toBe(`Bearer ${env.tokens[1]}`);
    });

    it("the method is resolved per call: adding the PAT switches the next call to it, removing it switches back", async () => {
      const gh = client();
      await gh.listReachableRepos();
      expect(env.calls[1]?.path).toBe("/installation/repositories");
      env.keychain.set(GITHUB_KEYCHAIN_SERVICE, PAT);
      await gh.listReachableRepos();
      const last = env.calls.at(-1);
      expect(last?.path).toBe("/user/repos");
      expect(last?.authorization).toBe(`Bearer ${PAT}`);
      env.keychain.delete(GITHUB_KEYCHAIN_SERVICE);
      await gh.listReachableRepos();
      expect(env.calls.at(-1)?.path).toBe("/installation/repositories");
    });

    it("no credential at all: unreachable, no request", async () => {
      env.keychain.clear();
      const gh = client();
      expect(await gh.listReachableRepos()).toEqual({ ok: false, error: "unreachable", rateLimit: null });
      expect(env.calls).toEqual([]);
    });

    it("a mint that fails makes the call unreachable, with no request but the mint and no secret in the result (AC11, AC12)", async () => {
      env.mintStatus = 500;
      const gh = client();
      const res = await gh.listOpenPulls("o/r", {});
      expect(res).toEqual({ ok: false, error: "unreachable", rateLimit: null });
      expect(env.calls.map((c) => c.method)).toEqual(["POST"]);
      expectNoSecret(res, secretsOf(env));
    });

    it("every method, whatever it is given, answers a result and never throws, with no secret in it (AC11, AC12)", async () => {
      const gh = client();
      const results = [
        await gh.getTokenInfo(),
        await gh.listReachableRepos(),
        await gh.listOpenPulls("o/r", {}),
        await gh.getPull("o/r", 1),
        await gh.getPullDiff("o/r", 1, 100),
        await gh.listPullFiles("o/r", 1),
        await gh.listPullComments("o/r", 1),
        await gh.getPull(undefined as never, NaN),
        await gh.listOpenPulls({} as never, null as never),
      ];
      for (const r of results) {
        expect(typeof r.ok).toBe("boolean");
        if (!r.ok) expectNoSecret(r, secretsOf(env));
      }
    });
  });
});
