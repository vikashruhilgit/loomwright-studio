// Unit tests for kernel/src/auth/. No test here reads the real Keychain, calls
// the SDK or a model: every Keychain read goes through an injected stub, and the
// `security` wrapper is exercised with an injected exec function.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_KEY_KEYCHAIN_SERVICE,
  AuthProviderError,
  CREDENTIAL_ENV_PREFIX,
  CREDENTIAL_ENV_VARS,
  KeychainError,
  SECURITY_BIN,
  availableProviderIds,
  checkAuthHealth,
  createApiKeyProvider,
  isCredentialEnvVar,
  isPlausibleApiKey,
  isWholeToken,
  parseTokenCreatedAt,
  readProviderMetadata,
  recordTokenCreated,
  securityCliKeychain,
  selectAuthProvider,
  stripCredentialEnv,
} from "../src/auth/index.js";
import type { AuthHealth, AuthProvider, ExecFileSyncLike, KeychainReader } from "../src/auth/index.js";
// Tests may import the subscription provider directly; src/ must not (D29).
import {
  SUBSCRIPTION_KEYCHAIN_SERVICE,
  createSubscriptionTokenProvider,
} from "../src/auth/subscription-token.js";
import { Store } from "../src/store/index.js";

const PREFIX = "sk-ant-oat01-";
/** A fake whole token: right prefix, 103 characters, no whitespace. Never real-looking. */
const WHOLE_TOKEN = PREFIX + "x".repeat(90);
/** The 2026-09-30 failure: right prefix, cut off at 59 characters. */
const CUT_OFF_TOKEN = PREFIX + "x".repeat(59 - PREFIX.length);
const FAKE_API_KEY = "fake-api-key-" + "y".repeat(40);
const DAY_MS = 86_400_000;

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));
const AUTH_DIR = join(SRC_DIR, "auth");

function stubKeychain(items: Record<string, string>): KeychainReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    read(service: string): string | undefined {
      reads.push(service);
      return Object.hasOwn(items, service) ? items[service] : undefined;
    },
  };
}

function throwingKeychain(): KeychainReader {
  // A real failure path: the wrapper over an exec whose error carries the token.
  return securityCliKeychain(() => {
    throw Object.assign(new Error(`Command failed\n${WHOLE_TOKEN}`), {
      status: 1,
      signal: null,
      stdout: WHOLE_TOKEN + "\n",
      stderr: `security: something went wrong near ${WHOLE_TOKEN}`,
    });
  });
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw");
}

/**
 * The CLI's OAuth and bridge endpoint switches (F04-1), pinned by a LITERAL list
 * so deleting a name from `CREDENTIAL_ENV_VARS` fails a test.
 */
const OAUTH_ENDPOINT_SWITCHES = [
  "USE_LOCAL_OAUTH",
  "USE_STAGING_OAUTH",
  "CLAUDE_LOCAL_OAUTH_API_BASE",
  "CLAUDE_LOCAL_OAUTH_APPS_BASE",
  "CLAUDE_LOCAL_OAUTH_CONSOLE_BASE",
  "CLAUDE_BRIDGE_BASE_URL",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR",
  "CLAUDE_BRIDGE_SESSION_INGRESS_URL",
  "CLAUDE_REMOTE_TOOLS_BRIDGE_URL",
  "CLAUDE_CODE_GB_BASE_URL",
] as const;

/**
 * The CLI's API endpoint switch, pinned by a LITERAL list for the same reason:
 * it can send the credential to a host other than Anthropic's.
 */
const API_ENDPOINT_SWITCHES = ["CLAUDE_CODE_API_BASE_URL"] as const;

/** Every endpoint switch a child env must never carry. */
const ENDPOINT_SWITCHES = [...OAUTH_ENDPOINT_SWITCHES, ...API_ENDPOINT_SWITCHES] as const;

const PARENT_ENV = {
  PATH: "/usr/bin:/bin",
  HOME: "/Users/someone",
  LANG: "en_GB.UTF-8",
  ANTHROPIC_API_KEY: "stray-api-key",
  ANTHROPIC_AUTH_TOKEN: "stray-auth-token",
  ANTHROPIC_BASE_URL: "https://elsewhere.invalid",
  AWS_BEARER_TOKEN_BEDROCK: "stray-bedrock-bearer",
  CLAUDE_CODE_USE_BEDROCK: "1",
  CLAUDE_CODE_OAUTH_TOKEN: "stray-oauth-token",
  CLAUDE_CONFIG_DIR: "/Users/someone/.claude",
  CLAUDE_CODE_USE_NATIVE_FILE_SEARCH: "1",
  AWS_ACCESS_KEY_ID: "akid",
  USE_LOCAL_OAUTH: "1",
  USE_STAGING_OAUTH: "1",
  CLAUDE_LOCAL_OAUTH_API_BASE: "https://stray-api.invalid",
  CLAUDE_LOCAL_OAUTH_APPS_BASE: "https://stray-apps.invalid",
  CLAUDE_LOCAL_OAUTH_CONSOLE_BASE: "https://stray-console.invalid",
  CLAUDE_BRIDGE_BASE_URL: "https://stray-bridge.invalid",
  CLAUDE_SECURESTORAGE_CONFIG_DIR: "/tmp/stray-secure-storage",
  CLAUDE_BRIDGE_SESSION_INGRESS_URL: "https://stray-ingress.invalid",
  CLAUDE_REMOTE_TOOLS_BRIDGE_URL: "https://stray-tools.invalid",
  CLAUDE_CODE_GB_BASE_URL: "https://stray-gb.invalid",
  CLAUDE_CODE_API_BASE_URL: "https://stray-api-base.invalid",
  UNSET_VALUE: undefined,
} as const;

/** Names in a child env that the strip rule treats as credentials. */
function credentialNames(env: Record<string, string>): string[] {
  return Object.keys(env).filter(isCredentialEnvVar).sort();
}

// ---------------------------------------------------------------------------
// Store helpers: every store test gets its own mkdtemp data dir.
// ---------------------------------------------------------------------------

let tmp: string;
const stores: Store[] = [];

function openStore(): Store {
  const store = new Store({ dataDir: tmp });
  stores.push(store);
  return store;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-auth-"));
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// AC1: the interface
// ---------------------------------------------------------------------------

describe("AuthProvider (AC1)", () => {
  it.each([
    ["subscription-token", () => createSubscriptionTokenProvider({ keychain: stubKeychain({}) })],
    ["api-key", () => createApiKeyProvider({ keychain: stubKeychain({}) })],
  ])("%s exposes id, account, buildEnv and health", (id, make) => {
    const provider: AuthProvider = make();
    expect(provider.id).toBe(id);
    expect(provider.account).toBe(id);
    expect(typeof provider.buildEnv).toBe("function");
    expect(typeof provider.health).toBe("function");
  });

  it("health() variants are exactly ok, missing, invalid_shape, expiring(days) and error(reason)", () => {
    // A compile-time exhaustiveness check over the union, plus a runtime sample.
    const label = (h: AuthHealth): string => {
      switch (h.status) {
        case "ok":
        case "missing":
        case "invalid_shape":
          return h.status;
        case "expiring":
          return `expiring(${h.days})`;
        case "error":
          return `error(${h.reason})`;
        default: {
          const never: never = h;
          return never;
        }
      }
    };
    expect(label({ status: "expiring", days: 3 })).toBe("expiring(3)");
    expect(label({ status: "error", reason: "keychain_unreadable" })).toBe("error(keychain_unreadable)");
    expect(createSubscriptionTokenProvider({ keychain: stubKeychain({}) }).health()).toEqual({
      status: "missing",
    });
  });

  it("the account label comes from recorded metadata and is never the secret", () => {
    const store = openStore();
    recordTokenCreated(store, "subscription-token", "owner-personal", "2026-09-30T10:00:00Z");
    const provider = createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN }),
      store,
    });
    expect(provider.account).toBe("owner-personal");
    expect(readProviderMetadata(store, "subscription-token")).toMatchObject({
      id: "subscription-token",
      account: "owner-personal",
      token_created_at: "2026-09-30T10:00:00.000Z",
    });
  });

  it("recordTokenCreated rejects an unparseable date", () => {
    const store = openStore();
    expect(() => recordTokenCreated(store, "subscription-token", "a", "not a date")).toThrow(RangeError);
    expect(readProviderMetadata(store, "subscription-token")).toBeUndefined();
  });

  describe("strict creation dates (one parser for writer and reader)", () => {
    const AT = new Date("2030-01-15T23:30:00.000Z");

    it.each([
      ["9999", "a bare year"],
      ["12345", "a bare number"],
      ["2030-02-30T00:00:00Z", "a day that does not exist"],
      ["2030-01-01T24:00:00Z", "hour 24"],
      ["2030-01-15", "a date without a time"],
      ["2030-01-15T10:00:00", "a time without Z"],
      ["2030-01-15T10:00:00+00:00", "an offset instead of Z"],
      ["+012345-01-01T00:00:00.000Z", "an extended year (what the old writer stored for 12345)"],
      ["2030-01-15T23:30:00.001Z", "one millisecond after now"],
      ["2031-01-01T00:00:00Z", "a future date"],
    ])("recordTokenCreated refuses %j (%s) and writes nothing", (raw) => {
      const store = openStore();
      expect(parseTokenCreatedAt(raw, AT)).toBeNull();
      expect(() => recordTokenCreated(store, "subscription-token", "a", raw, AT)).toThrow(RangeError);
      expect(readProviderMetadata(store, "subscription-token")).toBeUndefined();
    });

    it.each([
      ["2029-02-28T10:00:00Z", "2029-02-28T10:00:00.000Z"],
      ["2028-02-29T10:00:00.250Z", "2028-02-29T10:00:00.250Z"],
      ["2030-01-15T23:30:00.000Z", "2030-01-15T23:30:00.000Z"],
    ])("recordTokenCreated accepts %j (with or without millis, up to now) and stores %j", (raw, stored) => {
      const store = openStore();
      recordTokenCreated(store, "subscription-token", "a", raw, AT);
      expect(readProviderMetadata(store, "subscription-token")?.token_created_at).toBe(stored);
      expect(parseTokenCreatedAt(stored, AT)).toBe(Date.parse(raw));
    });

    it("an invalid writer clock refuses every date", () => {
      const store = openStore();
      expect(() => recordTokenCreated(store, "subscription-token", "a", "2029-02-28T10:00:00Z", new Date(Number.NaN))).toThrow(
        RangeError,
      );
      expect(readProviderMetadata(store, "subscription-token")).toBeUndefined();
    });

    it("defaults the writer clock to the current time", () => {
      const store = openStore();
      const future = new Date(Date.now() + 10 * DAY_MS).toISOString();
      expect(() => recordTokenCreated(store, "subscription-token", "a", future)).toThrow(RangeError);
      recordTokenCreated(store, "subscription-token", "a", "2026-09-30T10:00:00Z");
      expect(readProviderMetadata(store, "subscription-token")?.token_created_at).toBe("2026-09-30T10:00:00.000Z");
    });
  });
});

// ---------------------------------------------------------------------------
// The Keychain module
// ---------------------------------------------------------------------------

describe("securityCliKeychain", () => {
  it("runs /usr/bin/security with an argument array and no shell", () => {
    const calls: Array<{ file: string; args: readonly string[]; options: unknown }> = [];
    const exec: ExecFileSyncLike = (file, args, options) => {
      calls.push({ file, args, options });
      return `${WHOLE_TOKEN}\n`;
    };
    expect(securityCliKeychain(exec).read("some-service")).toBe(WHOLE_TOKEN);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.file).toBe("/usr/bin/security");
    expect(SECURITY_BIN).toBe("/usr/bin/security");
    expect(call?.args).toEqual(["find-generic-password", "-s", "some-service", "-w"]);
    expect(call?.options).toMatchObject({ encoding: "utf8", timeout: 10_000 });
    expect(call?.options).not.toHaveProperty("shell");
  });

  it("reads both Keychain items through the same binary", () => {
    const services: string[] = [];
    const exec: ExecFileSyncLike = (file, args) => {
      expect(file).toBe("/usr/bin/security");
      services.push(args[2] ?? "");
      return args[2] === API_KEY_KEYCHAIN_SERVICE ? `${FAKE_API_KEY}\n` : `${WHOLE_TOKEN}\n`;
    };
    const keychain = securityCliKeychain(exec);
    createSubscriptionTokenProvider({ keychain }).buildEnv({});
    createApiKeyProvider({ keychain }).buildEnv({});
    expect(services).toEqual([SUBSCRIPTION_KEYCHAIN_SERVICE, API_KEY_KEYCHAIN_SERVICE]);
    expect(services).toEqual(["loomwright-studio-oauth", "loomwright-studio-api-key"]);
  });

  it("strips exactly one trailing newline and nothing else", () => {
    const read = (out: string): string | undefined => securityCliKeychain(() => out).read("s");
    expect(read("abc\n")).toBe("abc");
    expect(read("abc")).toBe("abc");
    expect(read("abc\n\n")).toBe("abc\n");
    expect(read(" abc \n")).toBe(" abc ");
  });

  it("maps exit status 44 (item not found) to undefined", () => {
    const exec: ExecFileSyncLike = () => {
      throw Object.assign(new Error("not found"), { status: 44, signal: null });
    };
    expect(securityCliKeychain(exec).read("missing-service")).toBeUndefined();
  });

  it("wraps any other failure in a KeychainError naming only service and status", () => {
    const err = catchError(() => throwingKeychain().read("svc"));
    expect(err).toBeInstanceOf(KeychainError);
    const ke = err as KeychainError;
    expect(ke.service).toBe("svc");
    expect(ke.exitStatus).toBe(1);
    expect(ke.message).toBe('Keychain read of service "svc" failed (/usr/bin/security exit status 1)');
    expect(ke.cause).toBeUndefined();
    expect(inspect(ke)).not.toContain(PREFIX);
    expect(Object.values(ke).join(" ")).not.toContain(PREFIX);
  });

  it("reports a timeout by signal", () => {
    const exec: ExecFileSyncLike = () => {
      throw Object.assign(new Error("timed out"), { status: null, signal: "SIGTERM" });
    };
    const err = catchError(() => securityCliKeychain(exec).read("svc"));
    expect(err).toBeInstanceOf(KeychainError);
    expect((err as Error).message).toContain("terminated by SIGTERM");
  });
});

// ---------------------------------------------------------------------------
// AC2 / AC5: credential stripping
// ---------------------------------------------------------------------------

describe("stripCredentialEnv", () => {
  it("is a frozen list", () => {
    expect(Object.isFrozen(CREDENTIAL_ENV_VARS)).toBe(true);
    expect(CREDENTIAL_ENV_PREFIX).toBe("ANTHROPIC_");
  });

  it.each(CREDENTIAL_ENV_VARS.map((name) => [name]))("removes %s", (name) => {
    const out = stripCredentialEnv({ [name]: "secret-value", PATH: "/bin" });
    expect(out).toEqual({ PATH: "/bin" });
  });

  it.each(OAUTH_ENDPOINT_SWITCHES.map((name) => [name]))("removes the OAuth/bridge endpoint switch %s", (name) => {
    expect(isCredentialEnvVar(name)).toBe(true);
    expect(stripCredentialEnv({ [name]: "v", PATH: "/bin" })).toEqual({ PATH: "/bin" });
  });

  it.each(API_ENDPOINT_SWITCHES.map((name) => [name]))("removes the API endpoint switch %s", (name) => {
    expect(isCredentialEnvVar(name)).toBe(true);
    expect(stripCredentialEnv({ [name]: "v", PATH: "/bin" })).toEqual({ PATH: "/bin" });
  });

  it.each([
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_BEDROCK_BASE_URL",
    "ANTHROPIC_FOUNDRY_API_KEY",
    "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
    "ANTHROPIC_AWS_API_KEY",
    "ANTHROPIC_IDENTITY_TOKEN",
    "ANTHROPIC_IDENTITY_TOKEN_FILE",
    "ANTHROPIC_FEDERATION_RULE_ID",
    "ANTHROPIC_SERVICE_ACCOUNT_ID",
    "ANTHROPIC_PROFILE",
    "ANTHROPIC_CONFIG_DIR",
    "ANTHROPIC_ORGANIZATION_ID",
    "ANTHROPIC_WORKSPACE_ID",
    "ANTHROPIC_CUSTOM_HEADERS",
    "ANTHROPIC_MODEL",
  ])("removes every ANTHROPIC_* variable: %s", (name) => {
    expect(stripCredentialEnv({ [name]: "v", HOME: "/h" })).toEqual({ HOME: "/h" });
  });

  it("keeps PATH, HOME, feature flags and generic cloud credentials", () => {
    const out = stripCredentialEnv(PARENT_ENV);
    expect(out).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/Users/someone",
      LANG: "en_GB.UTF-8",
      CLAUDE_CODE_USE_NATIVE_FILE_SEARCH: "1",
      AWS_ACCESS_KEY_ID: "akid",
    });
  });

  it("returns a new object and never mutates its input", () => {
    const input: Record<string, string | undefined> = { ...PARENT_ENV };
    const before = { ...input };
    const out = stripCredentialEnv(input);
    expect(out).not.toBe(input);
    expect(input).toEqual(before);
  });
});

describe("subscription-token provider (AC2)", () => {
  it("builds an env whose only credential is CLAUDE_CODE_OAUTH_TOKEN", () => {
    const keychain = stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN });
    const parent = { ...PARENT_ENV };
    const env = createSubscriptionTokenProvider({ keychain }).buildEnv(parent);
    expect(credentialNames(env)).toEqual(["CLAUDE_CODE_OAUTH_TOKEN"]);
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBe(WHOLE_TOKEN);
    for (const stray of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "AWS_BEARER_TOKEN_BEDROCK",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CONFIG_DIR",
    ]) {
      expect(env).not.toHaveProperty(stray);
    }
    for (const name of ENDPOINT_SWITCHES) {
      expect(parent).toHaveProperty(name);
      expect(env).not.toHaveProperty(name);
    }
    expect(Object.values(env)).not.toContain("stray-api-key");
    expect(Object.values(env)).not.toContain("stray-oauth-token");
    expect(env["PATH"]).toBe("/usr/bin:/bin");
    expect(env["HOME"]).toBe("/Users/someone");
    // The parent env is untouched.
    expect(parent).toEqual(PARENT_ENV);
    expect(keychain.reads).toEqual(["loomwright-studio-oauth"]);
  });

  it("reads the Keychain on every call and never caches the token on the provider", () => {
    const keychain = stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN });
    const provider = createSubscriptionTokenProvider({ keychain });
    provider.buildEnv({});
    provider.buildEnv({});
    provider.health();
    expect(keychain.reads).toHaveLength(3);
    expect(inspect(provider, { depth: 5, getters: true })).not.toContain(PREFIX);
    expect(JSON.stringify(provider)).not.toContain(PREFIX);
  });

  it("fails closed with code missing when the Keychain item is absent", () => {
    const err = catchError(() => createSubscriptionTokenProvider({ keychain: stubKeychain({}) }).buildEnv({}));
    expect(err).toBeInstanceOf(AuthProviderError);
    expect((err as AuthProviderError).code).toBe("missing");
    expect((err as AuthProviderError).providerId).toBe("subscription-token");
  });

  it("fails closed with code invalid_shape for a cut-off token", () => {
    const keychain = stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: CUT_OFF_TOKEN });
    const err = catchError(() => createSubscriptionTokenProvider({ keychain }).buildEnv(PARENT_ENV));
    expect(err).toBeInstanceOf(AuthProviderError);
    expect((err as AuthProviderError).code).toBe("invalid_shape");
  });
});

describe("api-key provider (AC5, stubbed Keychain only)", () => {
  it("builds an env whose only credential is ANTHROPIC_API_KEY, with no CLAUDE_CODE_OAUTH_TOKEN", () => {
    const keychain = stubKeychain({ [API_KEY_KEYCHAIN_SERVICE]: FAKE_API_KEY });
    const env = createApiKeyProvider({ keychain }).buildEnv(PARENT_ENV);
    expect(credentialNames(env)).toEqual(["ANTHROPIC_API_KEY"]);
    expect(env["ANTHROPIC_API_KEY"]).toBe(FAKE_API_KEY);
    expect(env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(env).not.toHaveProperty("AWS_BEARER_TOKEN_BEDROCK");
    expect(env).not.toHaveProperty("CLAUDE_CODE_USE_BEDROCK");
    for (const name of ENDPOINT_SWITCHES) {
      expect(PARENT_ENV).toHaveProperty(name);
      expect(env).not.toHaveProperty(name);
    }
    expect(env["PATH"]).toBe("/usr/bin:/bin");
    expect(keychain.reads).toEqual(["loomwright-studio-api-key"]);
  });

  it("health: missing, invalid_shape for empty or whitespace, otherwise ok and never expiring", () => {
    const health = (items: Record<string, string>): AuthHealth =>
      createApiKeyProvider({ keychain: stubKeychain(items) }).health();
    expect(health({})).toEqual({ status: "missing" });
    expect(health({ [API_KEY_KEYCHAIN_SERVICE]: "" })).toEqual({ status: "invalid_shape" });
    expect(health({ [API_KEY_KEYCHAIN_SERVICE]: "abc def" })).toEqual({ status: "invalid_shape" });
    expect(health({ [API_KEY_KEYCHAIN_SERVICE]: FAKE_API_KEY })).toEqual({ status: "ok" });
  });

  it("api-key health ignores any recorded creation date", () => {
    const store = openStore();
    recordTokenCreated(store, "api-key", "work", "2000-01-01T00:00:00Z");
    const provider = createApiKeyProvider({
      keychain: stubKeychain({ [API_KEY_KEYCHAIN_SERVICE]: FAKE_API_KEY }),
      store,
    });
    expect(provider.health()).toEqual({ status: "ok" });
    expect(provider.account).toBe("work");
  });

  it("fails closed on a missing or malformed key", () => {
    const missing = catchError(() => createApiKeyProvider({ keychain: stubKeychain({}) }).buildEnv({}));
    expect((missing as AuthProviderError).code).toBe("missing");
    const bad = catchError(() =>
      createApiKeyProvider({ keychain: stubKeychain({ [API_KEY_KEYCHAIN_SERVICE]: " " }) }).buildEnv({}),
    );
    expect((bad as AuthProviderError).code).toBe("invalid_shape");
  });
});

// ---------------------------------------------------------------------------
// AC3: the shape check
// ---------------------------------------------------------------------------

describe("isWholeToken (AC3)", () => {
  it("accepts a whole token", () => {
    expect(WHOLE_TOKEN.length).toBeGreaterThan(80);
    expect(isWholeToken(WHOLE_TOKEN)).toBe(true);
    expect(isWholeToken(PREFIX + "x".repeat(81 - PREFIX.length))).toBe(true);
  });

  it.each([
    ["the 59-character cut-off of 2026-09-30", CUT_OFF_TOKEN],
    ["exactly 80 characters", PREFIX + "x".repeat(80 - PREFIX.length)],
    ["an inner space", PREFIX + "x".repeat(40) + " " + "x".repeat(40)],
    ["a leftover trailing newline", WHOLE_TOKEN + "\n"],
    ["a tab", WHOLE_TOKEN + "\t"],
    ["the wrong prefix", "sk-ant-api03-" + "x".repeat(90)],
    ["an empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(isWholeToken(value)).toBe(false);
  });

  it("the cut-off token is 59 characters and health() reports invalid_shape", () => {
    expect(CUT_OFF_TOKEN).toHaveLength(59);
    const provider = createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: CUT_OFF_TOKEN }),
    });
    expect(provider.health()).toEqual({ status: "invalid_shape" });
  });

  it("a token with a leftover newline from the Keychain reports invalid_shape", () => {
    // security -w adds one newline (stripped); a second one is the stored value's.
    const keychain = securityCliKeychain(() => `${WHOLE_TOKEN}\n\n`);
    expect(createSubscriptionTokenProvider({ keychain }).health()).toEqual({ status: "invalid_shape" });
  });

  it("isPlausibleApiKey: non-empty, no whitespace", () => {
    expect(isPlausibleApiKey(FAKE_API_KEY)).toBe(true);
    expect(isPlausibleApiKey("")).toBe(false);
    expect(isPlausibleApiKey("a\nb")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC4: expiry and the notify event
// ---------------------------------------------------------------------------

describe("expiry (AC4)", () => {
  const NOW = new Date("2030-01-15T23:30:00.000Z");
  const createdDaysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY_MS).toISOString();

  function subscription(store: Store, createdAt: string | undefined, now: Date = NOW): AuthProvider {
    if (createdAt !== undefined) recordTokenCreated(store, "subscription-token", "owner", createdAt, now);
    return createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN }),
      store,
      now: () => now,
    });
  }

  it("no recorded creation date: expiry unknown, ok", () => {
    expect(subscription(openStore(), undefined).health()).toEqual({ status: "ok" });
  });

  it("no store at all: ok", () => {
    const provider = createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN }),
    });
    expect(provider.health()).toEqual({ status: "ok" });
  });

  it.each([
    [0, { status: "ok" }],
    [335, { status: "ok" }],
    [336, { status: "expiring", days: 29 }],
    [340, { status: "expiring", days: 25 }],
    [365, { status: "expiring", days: 0 }],
    [400, { status: "expiring", days: -35 }],
  ])("created %i days ago -> %o", (age, expected) => {
    expect(subscription(openStore(), createdDaysAgo(age)).health()).toEqual(expected);
  });

  it("floors partial days", () => {
    // 25.5 days left -> 25.
    const created = new Date(NOW.getTime() - 339.5 * DAY_MS).toISOString();
    expect(subscription(openStore(), created).health()).toEqual({ status: "expiring", days: 25 });
  });

  it("missing and invalid_shape take precedence over expiring", () => {
    const store = openStore();
    recordTokenCreated(store, "subscription-token", "owner", createdDaysAgo(360), NOW);
    const make = (items: Record<string, string>): AuthProvider =>
      createSubscriptionTokenProvider({ keychain: stubKeychain(items), store, now: () => NOW });
    expect(make({}).health()).toEqual({ status: "missing" });
    expect(make({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: CUT_OFF_TOKEN }).health()).toEqual({
      status: "invalid_shape",
    });
  });
});

// ---------------------------------------------------------------------------
// H02: health() is total and reads one clock
// ---------------------------------------------------------------------------

describe("health() is total (H02)", () => {
  const NOW = new Date("2030-01-15T23:30:00.000Z");
  const STUB_MESSAGE = "stub keychain failure detail";

  /** A Keychain stub whose read throws `err`. Never the real Keychain. */
  function failingKeychain(err: Error): KeychainReader {
    return {
      read(): string | undefined {
        throw err;
      },
    };
  }

  const keychainFailures: [string, () => Error][] = [
    ["KeychainError", () => new KeychainError(SUBSCRIPTION_KEYCHAIN_SERVICE, 1, null)],
    ["plain Error", () => new Error(STUB_MESSAGE)],
  ];

  it.each(keychainFailures)("subscription-token: a Keychain %s is error(keychain_unreadable), never a throw", (_, make) => {
    const err = make();
    const provider = createSubscriptionTokenProvider({ keychain: failingKeychain(err), now: () => NOW });
    let health: AuthHealth | undefined;
    expect(() => {
      health = provider.health();
    }).not.toThrow();
    expect(health).toEqual({ status: "error", reason: "keychain_unreadable" });
    // The variant carries a reason only, never the error's message.
    expect(JSON.stringify(health)).not.toContain(err.message);
  });

  it.each(keychainFailures)("api-key: a Keychain %s is error(keychain_unreadable), never a throw", (_, make) => {
    const err = make();
    const provider = createApiKeyProvider({ keychain: failingKeychain(err) });
    let health: AuthHealth | undefined;
    expect(() => {
      health = provider.health();
    }).not.toThrow();
    expect(health).toEqual({ status: "error", reason: "keychain_unreadable" });
    // The variant carries a reason only, never the error's message.
    expect(JSON.stringify(health)).not.toContain(err.message);
  });

  /** A subscription provider over a store whose row holds `createdAt` verbatim. */
  function withRawCreatedAt(createdAt: string, now: () => Date = () => NOW): AuthProvider {
    const store = openStore();
    // Written by hand: `recordTokenCreated` refuses an unparseable date, but the
    // column has no CHECK, so the reader must not trust it.
    store
      .prepare("INSERT INTO auth_providers (id, account, token_created_at) VALUES ('subscription-token', 'owner', ?)")
      .run(createdAt);
    return createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN }),
      store,
      now,
    });
  }

  it.each(["not-a-date", "", "2030-13-45T99:99:99Z"])(
    "an unparseable token_created_at (%j) is error(token_created_at_unreadable), never ok",
    (raw) => {
      expect(withRawCreatedAt(raw).health()).toEqual({ status: "error", reason: "token_created_at_unreadable" });
    },
  );

  it.each([
    "9999",
    "12345",
    "2030-02-30T00:00:00Z",
    // What the old, looser writer stored for "9999" and "12345".
    "9999-01-01T00:00:00.000Z",
    "+012345-01-01T00:00:00.000Z",
    // After the instant the check runs at (NOW is 2030-01-15T23:30:00.000Z).
    "2030-01-16T00:00:00Z",
  ])("an implausible token_created_at (%j) is error(token_created_at_unreadable), never ok and never a throw", (raw) => {
    let health: AuthHealth | undefined;
    expect(() => {
      health = withRawCreatedAt(raw).health();
    }).not.toThrow();
    expect(health).toEqual({ status: "error", reason: "token_created_at_unreadable" });
  });

  it("a creation date after the provider clock but not after `at` is judged at `at`", () => {
    const provider = withRawCreatedAt("2030-01-16T00:00:00Z");
    expect(provider.health()).toEqual({ status: "error", reason: "token_created_at_unreadable" });
    expect(provider.health(new Date("2030-01-16T00:00:00Z"))).toEqual({ status: "ok" });
  });

  it.each([
    ["2029-02-10T23:30:00Z", { status: "expiring", days: 26 }],
    ["2029-02-10T23:30:00.000Z", { status: "expiring", days: 26 }],
    ["2030-01-15T23:30:00.000Z", { status: "ok" }],
  ])("a valid stored token_created_at (%j) still reads as %o", (raw, expected) => {
    expect(withRawCreatedAt(raw).health()).toEqual(expected);
  });

  it("a metadata read that throws is error(token_created_at_unreadable)", () => {
    const store = openStore();
    const provider = createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN }),
      store,
      now: () => NOW,
    });
    store.close();
    expect(provider.health()).toEqual({ status: "error", reason: "token_created_at_unreadable" });
  });

  it("an invalid provider clock is error(clock_unreadable)", () => {
    const created = new Date(NOW.getTime() - 100 * DAY_MS).toISOString();
    expect(withRawCreatedAt(created, () => new Date(Number.NaN)).health()).toEqual({
      status: "error",
      reason: "clock_unreadable",
    });
  });

  it("an invalid `at` is error(clock_unreadable)", () => {
    const created = new Date(NOW.getTime() - 100 * DAY_MS).toISOString();
    expect(withRawCreatedAt(created).health(new Date(Number.NaN))).toEqual({
      status: "error",
      reason: "clock_unreadable",
    });
  });

  it("a provider clock that throws is error(clock_unreadable), never a throw", () => {
    const provider = createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN }),
      now: () => {
        throw new Error("clock broke");
      },
    });
    expect(provider.health()).toEqual({ status: "error", reason: "clock_unreadable" });
  });

  it("the clock is checked before the date: an invalid clock with no recorded date is still clock_unreadable", () => {
    const provider = createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN }),
      now: () => new Date(Number.NaN),
    });
    expect(provider.health()).toEqual({ status: "error", reason: "clock_unreadable" });
    expect(withRawCreatedAt("not-a-date", () => new Date(Number.NaN)).health()).toEqual({
      status: "error",
      reason: "clock_unreadable",
    });
  });

  it("Keychain checks come before the clock", () => {
    const provider = createSubscriptionTokenProvider({ keychain: stubKeychain({}), now: () => new Date(Number.NaN) });
    expect(provider.health()).toEqual({ status: "missing" });
  });

  it("the api-key provider ignores the clock", () => {
    const provider = createApiKeyProvider({
      keychain: stubKeychain({ [API_KEY_KEYCHAIN_SERVICE]: FAKE_API_KEY }),
      now: () => new Date(Number.NaN),
    });
    expect(provider.health(new Date(Number.NaN))).toEqual({ status: "ok" });
  });

  it("one clock: health(at) uses `at`, not deps.now", () => {
    const created = new Date(NOW.getTime() - 340 * DAY_MS).toISOString();
    // The provider's own clock is far away (just after creation: ok).
    const provider = withRawCreatedAt(created, () => new Date(Date.parse(created) + DAY_MS));
    expect(provider.health()).toEqual({ status: "ok" });
    expect(provider.health(NOW)).toEqual({ status: "expiring", days: 25 });
  });
});

type EventRow = { id: number; at: string; kind: string; actor: string | null; payload_json: string | null };

function notifyRows(store: Store): EventRow[] {
  return store
    .prepare<[], EventRow>("SELECT id, at, kind, actor, payload_json FROM events WHERE kind = 'notify' ORDER BY id")
    .all();
}

describe("checkAuthHealth (AC4 notify event)", () => {
  const NOW = new Date("2030-01-15T23:30:00.000Z");
  const created = new Date(NOW.getTime() - 340 * DAY_MS).toISOString();

  it("appends one notify event with the documented payload when expiring", () => {
    const store = openStore();
    recordTokenCreated(store, "subscription-token", "owner-personal", created, NOW);
    const provider = createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN }),
      store,
      now: () => NOW,
    });
    expect(checkAuthHealth(store, provider, () => NOW)).toEqual({ status: "expiring", days: 25 });
    const rows = notifyRows(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "notify", actor: "kernel", at: "2030-01-15T23:30:00.000Z" });
    expect(JSON.parse(rows[0]?.payload_json ?? "null")).toEqual({
      reason: "auth_token_expiring",
      provider: "subscription-token",
      account: "owner-personal",
      days: 25,
    });
  });

  it("writes once per provider per UTC day of the injected clock", () => {
    const store = openStore();
    recordTokenCreated(store, "subscription-token", "owner", created, NOW);
    let now = NOW;
    const provider = createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN }),
      store,
      now: () => now,
    });
    checkAuthHealth(store, provider, () => now);
    now = new Date("2030-01-15T23:59:59.999Z");
    checkAuthHealth(store, provider, () => now);
    expect(notifyRows(store)).toHaveLength(1);

    // The next UTC day notifies again.
    now = new Date("2030-01-16T00:00:00.000Z");
    expect(checkAuthHealth(store, provider, () => now)).toEqual({ status: "expiring", days: 24 });
    const rows = notifyRows(store);
    expect(rows.map((r) => r.at)).toEqual(["2030-01-15T23:30:00.000Z", "2030-01-16T00:00:00.000Z"]);
  });

  it("dedupes per provider: another provider expiring the same day gets its own row", () => {
    const store = openStore();
    const fake = (id: string): AuthProvider => ({
      id,
      account: id,
      buildEnv: () => ({}),
      health: () => ({ status: "expiring", days: 5 }),
    });
    checkAuthHealth(store, fake("one"), () => NOW);
    checkAuthHealth(store, fake("two"), () => NOW);
    checkAuthHealth(store, fake("one"), () => NOW);
    const providers = notifyRows(store).map((r) => (JSON.parse(r.payload_json ?? "{}") as { provider: string }).provider);
    expect(providers).toEqual(["one", "two"]);
  });

  it("writes nothing for ok, missing or invalid_shape", () => {
    const store = openStore();
    for (const health of [{ status: "ok" }, { status: "missing" }, { status: "invalid_shape" }] as const) {
      const provider: AuthProvider = { id: "p", account: "p", buildEnv: () => ({}), health: () => health };
      expect(checkAuthHealth(store, provider, () => NOW)).toEqual(health);
    }
    expect(store.prepare("SELECT count(*) FROM events").pluck().get()).toBe(0);
  });

  it("writes nothing for an error health and returns it unchanged", () => {
    const store = openStore();
    const health = { status: "error", reason: "keychain_unreadable" } as const;
    const provider: AuthProvider = { id: "p", account: "p", buildEnv: () => ({}), health: () => health };
    expect(checkAuthHealth(store, provider, () => NOW)).toEqual(health);
    expect(store.prepare("SELECT count(*) FROM events").pluck().get()).toBe(0);
  });

  it("one clock: the day count comes from the injected instant even when the provider's deps.now disagrees", () => {
    const store = openStore();
    recordTokenCreated(store, "subscription-token", "owner", created, NOW);
    const provider = createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN }),
      store,
      // Just after creation: on its own clock the provider would say ok.
      now: () => new Date(Date.parse(created) + DAY_MS),
    });
    expect(checkAuthHealth(store, provider, () => NOW)).toEqual({ status: "expiring", days: 25 });
    expect(notifyRows(store).map((r) => r.at)).toEqual(["2030-01-15T23:30:00.000Z"]);
  });

  it("passes its instant to provider.health", () => {
    const store = openStore();
    const seen: (Date | undefined)[] = [];
    const provider: AuthProvider = {
      id: "p",
      account: "p",
      buildEnv: () => ({}),
      health: (at?: Date) => {
        seen.push(at);
        return { status: "ok" };
      },
    };
    checkAuthHealth(store, provider, () => NOW);
    expect(seen).toEqual([NOW]);
  });

  it("an invalid instant is error(clock_unreadable) with no row, even from a provider that ignores `at`", () => {
    const store = openStore();
    let asked = 0;
    const provider: AuthProvider = {
      id: "p",
      account: "p",
      buildEnv: () => ({}),
      health: () => {
        asked += 1;
        return { status: "expiring", days: 5 };
      },
    };
    expect(checkAuthHealth(store, provider, () => new Date(Number.NaN))).toEqual({
      status: "error",
      reason: "clock_unreadable",
    });
    expect(asked).toBe(0);
    expect(notifyRows(store)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC3: the token never leaks
// ---------------------------------------------------------------------------

describe("secret hygiene (AC3)", () => {
  it("no console output, error, events row or provider dump contains the token prefix", () => {
    const captured: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug", "trace"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        captured.push(args.map((a) => inspect(a)).join(" "));
      });
    }
    const capture = (chunk: unknown): boolean => {
      captured.push(typeof chunk === "string" ? chunk : inspect(chunk));
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);

    const errors: unknown[] = [];
    const attempt = (fn: () => unknown): void => {
      try {
        captured.push(inspect(fn()));
      } catch (err) {
        errors.push(err);
      }
    };

    const store = openStore();
    const now = new Date("2030-01-15T12:00:00.000Z");
    recordTokenCreated(store, "subscription-token", "owner", new Date(now.getTime() - 350 * DAY_MS).toISOString(), now);

    const whole = createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN }),
      store,
      now: () => now,
    });
    const cutOff = createSubscriptionTokenProvider({
      keychain: stubKeychain({ [SUBSCRIPTION_KEYCHAIN_SERVICE]: CUT_OFF_TOKEN }),
    });
    const broken = createSubscriptionTokenProvider({ keychain: throwingKeychain() });
    const brokenApi = createApiKeyProvider({ keychain: throwingKeychain() });
    const apiWithToken = createApiKeyProvider({
      keychain: stubKeychain({ [API_KEY_KEYCHAIN_SERVICE]: WHOLE_TOKEN + " " }),
    });

    // Success path: the env legitimately carries the token; it is returned, not logged.
    const env = whole.buildEnv(PARENT_ENV);
    expect(env["CLAUDE_CODE_OAUTH_TOKEN"]).toBe(WHOLE_TOKEN);
    attempt(() => whole.health());
    attempt(() => checkAuthHealth(store, whole, () => now));
    attempt(() => cutOff.health());
    attempt(() => cutOff.buildEnv(PARENT_ENV));
    attempt(() => broken.health());
    attempt(() => broken.buildEnv(PARENT_ENV));
    attempt(() => brokenApi.health());
    attempt(() => brokenApi.buildEnv(PARENT_ENV));
    attempt(() => apiWithToken.buildEnv(PARENT_ENV));
    attempt(() => apiWithToken.health());

    vi.restoreAllMocks();

    // health() is total (H02): a broken Keychain is a typed value, not a throw.
    // Its returned value still reaches the haystack through `attempt`.
    expect(broken.health()).toEqual({ status: "error", reason: "keychain_unreadable" });
    expect(brokenApi.health()).toEqual({ status: "error", reason: "keychain_unreadable" });
    // cutOff, broken, brokenApi and apiWithToken buildEnv still throw.
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors.some((e) => e instanceof KeychainError)).toBe(true);
    expect(errors.some((e) => e instanceof AuthProviderError && e.code === "invalid_shape")).toBe(true);

    const haystack: string[] = [...captured];
    for (const err of errors) {
      haystack.push(String(err), (err as Error).message, inspect(err, { depth: 5, showHidden: true }));
      haystack.push(JSON.stringify(err));
    }
    const rows = store.prepare("SELECT * FROM events").all();
    expect(rows).toHaveLength(1);
    haystack.push(JSON.stringify(rows));
    haystack.push(JSON.stringify(store.prepare("SELECT * FROM auth_providers").all()));
    for (const provider of [whole, cutOff, broken, brokenApi, apiWithToken]) {
      haystack.push(inspect(provider, { depth: 5, getters: true, showHidden: true }), JSON.stringify(provider));
    }

    const leaks = haystack.filter((s) => s.includes(PREFIX));
    expect(leaks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC6 (source side): the registry
// ---------------------------------------------------------------------------

describe("registry", () => {
  it("offers both providers in the personal build (source)", async () => {
    expect(await availableProviderIds()).toEqual(["api-key", "subscription-token"]);
  });

  it("selects each provider by id with the given deps", async () => {
    const keychain = stubKeychain({
      [SUBSCRIPTION_KEYCHAIN_SERVICE]: WHOLE_TOKEN,
      [API_KEY_KEYCHAIN_SERVICE]: FAKE_API_KEY,
    });
    const sub = await selectAuthProvider("subscription-token", { keychain });
    expect(sub.id).toBe("subscription-token");
    expect(credentialNames(sub.buildEnv(PARENT_ENV))).toEqual(["CLAUDE_CODE_OAUTH_TOKEN"]);
    const api = await selectAuthProvider("api-key", { keychain });
    expect(credentialNames(api.buildEnv(PARENT_ENV))).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("refuses an unknown id with code unavailable", async () => {
    const err: unknown = await selectAuthProvider("bedrock").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthProviderError);
    expect((err as AuthProviderError).code).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// AC6 / AC7 source guards
// ---------------------------------------------------------------------------

/**
 * Split TypeScript source into string literals and the remaining code, with
 * comments dropped. Dependency-free and deliberately simple: quote, apostrophe
 * and backtick spans are literals (a template's `${}` parts are kept inside its
 * span, which is conservative for a "must not contain" check).
 */
function scanSource(src: string): { code: string; literals: string[] } {
  const literals: string[] = [];
  let code = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i] ?? "";
    const n = src[i + 1] ?? "";
    if (c === "/" && n === "/") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      code += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let lit = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") {
          lit += (src[j] ?? "") + (src[j + 1] ?? "");
          j += 2;
          continue;
        }
        lit += src[j] ?? "";
        j++;
      }
      literals.push(lit);
      code += c + c;
      i = j + 1;
      continue;
    }
    code += c;
    i++;
  }
  return { code, literals };
}

function tsFilesUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, encoding: "utf8" }) as string[])
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dir, f))
    .sort();
}

describe("source guards (AC6, AC7)", () => {
  it("the literal scanner ignores comments and finds literals", () => {
    const { literals, code } = scanSource(
      [
        "// run claude setup-token yourself",
        "/* or claude auth login */",
        'const url = "https://x.invalid/a"; // trailing',
        "const t = `claude ${'setup-token'}`;",
        "const s = 'it\\'s auth login';",
      ].join("\n"),
    );
    expect(literals).toEqual(["https://x.invalid/a", "claude ${'setup-token'}", "it\\'s auth login"]);
    expect(code).not.toContain("setup-token");
    expect(code).not.toContain("trailing");
  });

  it("no string literal under src/ contains setup-token or auth login", () => {
    const files = tsFilesUnder(SRC_DIR);
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      for (const lit of scanSource(readFileSync(file, "utf8")).literals) {
        if (/setup-token|auth login/i.test(lit)) offenders.push(`${file}: ${lit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("exactly one file under src/auth/ uses node:child_process, and it runs only /usr/bin/security", () => {
    const users = tsFilesUnder(AUTH_DIR).filter((file) =>
      scanSource(readFileSync(file, "utf8")).literals.some((l) => /child_process/.test(l)),
    );
    expect(users).toEqual([join(AUTH_DIR, "keychain.ts")]);

    const { code, literals } = scanSource(readFileSync(join(AUTH_DIR, "keychain.ts"), "utf8"));
    expect(literals.filter((l) => l.startsWith("/"))).toEqual(["/usr/bin/security"]);
    expect(code).toMatch(/\bexecFileSync\b/);
    for (const forbidden of [/\bexecSync\b/, /\bexec\s*\(\s*["'`]/, /\bspawn/, /\bfork\b/, /\bshell\b/]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  it("nothing imports the subscription provider statically", () => {
    // Only the registry may even name the module, and only as its non-literal specifier constant.
    const naming = tsFilesUnder(SRC_DIR).filter((file) =>
      scanSource(readFileSync(file, "utf8")).literals.some((l) => l.includes("subscription-token.js")),
    );
    expect(naming).toEqual([join(AUTH_DIR, "registry.ts")]);

    const registry = readFileSync(join(AUTH_DIR, "registry.ts"), "utf8");
    expect(registry).not.toMatch(/from\s+["']\.\/subscription-token/);
    expect(registry).not.toMatch(/import\(\s*["']\.\/subscription-token/);
    expect(registry).toMatch(/await import\(SUBSCRIPTION_MODULE\)/);
  });

  it("only subscription-token.ts names the subscription Keychain item", () => {
    const naming = tsFilesUnder(SRC_DIR).filter((file) =>
      readFileSync(file, "utf8").includes("loomwright-studio-oauth"),
    );
    expect(naming).toEqual([join(AUTH_DIR, "subscription-token.ts")]);
  });
});
