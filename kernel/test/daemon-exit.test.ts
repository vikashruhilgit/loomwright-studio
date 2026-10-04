// The daemon's exit decisions (H01): under launchd a start failure a retry
// can't fix exits 0 (not restarted), anything else exits 1 (restarted at most
// once a minute); by hand every failure exits 1, as before. Every exit writes
// one stderr line naming the cause. daemon.ts starts the kernel when imported,
// so the unit tests import daemon-exit.ts only, and the end-to-end checks run
// the BUILT daemon against a held store lock or a bad argument: neither gets
// as far as a Keychain read.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiTokenError } from "../src/api/token.js";
import { KeychainError } from "../src/auth/keychain.js";
import { AuthProviderError } from "../src/auth/types.js";
import { DAEMON_NAME, DaemonArgumentError, parseArgs, startFailureExit, startFailureKind, stopFailureExit, underLaunchd } from "../src/daemon-exit.js";
import { LAUNCHD_ARGUMENT, THROTTLE_INTERVAL_SECONDS } from "../src/service/index.js";
import { Store, StoreLockedError } from "../src/store/index.js";
import { buildKernel } from "./crash-helpers.js";

const locked = new StoreLockedError("/data", 4242);
const keychain = new KeychainError("loomwright-studio-api", 36, null);
const unavailable = new AuthProviderError("unavailable", "subscription-token", 'auth provider "subscription-token" is not available in this build');
const missing = new AuthProviderError("missing", "api-key", "no API key in the Keychain");
const invalidShape = new AuthProviderError("invalid_shape", "api-key", "the stored API key has the wrong shape");

/** `parseArgs`'s error for `args`. */
function argumentError(args: readonly string[]): unknown {
  try {
    parseArgs(args);
  } catch (err) {
    return err;
  }
  return undefined;
}

describe("parseArgs", () => {
  it("accepts --auth-provider <id> and --launchd (no value)", () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs([LAUNCHD_ARGUMENT])).toEqual({});
    expect(parseArgs(["--auth-provider", "api-key", "--launchd"])).toEqual({ authProviderId: "api-key" });
    expect(LAUNCHD_ARGUMENT).toBe("--launchd");
  });

  it("a bad argument throws DaemonArgumentError", () => {
    for (const [args, message] of [
      [["--bogus"], "unknown argument: --bogus"],
      [["--launchd", "--bogus"], "unknown argument: --bogus"],
      [["--auth-provider"], "--auth-provider needs a value"],
      [["--auth-provider", ""], "--auth-provider needs a value"],
    ] as const) {
      const err = argumentError(args);
      expect(err).toBeInstanceOf(DaemonArgumentError);
      expect((err as Error).message).toBe(message);
    }
  });

  it("underLaunchd reads the flag whether or not the arguments parse", () => {
    expect(underLaunchd(["--launchd", "--bogus"])).toBe(true);
    expect(underLaunchd(["--auth-provider", "api-key"])).toBe(false);
  });
});

describe("startFailureKind", () => {
  it("permanent only for the allowlist: the store lock, a bad argument, an auth provider not in this build", () => {
    expect(startFailureKind(locked)).toBe("permanent");
    expect(startFailureKind(argumentError(["--bogus"]))).toBe("permanent");
    expect(startFailureKind(unavailable)).toBe("permanent");
  });

  it("everything else is transient: Keychain, API token, other auth provider codes, a plain Error, a non-Error", () => {
    for (const err of [keychain, new ApiTokenError("bad token"), missing, invalidShape, new Error("SQLITE_CANTOPEN"), "a string"]) {
      expect(startFailureKind(err)).toBe("transient");
    }
  });
});

describe("startFailureExit", () => {
  it("by hand: every start failure exits 1 with today's line", () => {
    for (const err of [locked, keychain, unavailable, argumentError(["--bogus"])]) {
      expect(startFailureExit(err, false)).toEqual({ status: 1, line: `${DAEMON_NAME}: failed to start: ${(err as Error).message}` });
    }
  });

  it("under launchd: a permanent failure exits 0 (not restarted) with one line naming the cause", () => {
    expect(startFailureExit(locked, true)).toEqual({
      status: 0,
      line: `${DAEMON_NAME}: failed to start (not restarting: another kernel holds the store lock): Studio data dir /data is locked: held by pid 4242 (as last recorded; may be stale)`,
    });
    expect(startFailureExit(argumentError(["--bogus"]), true)).toEqual({
      status: 0,
      line: `${DAEMON_NAME}: failed to start (not restarting: bad argument): unknown argument: --bogus`,
    });
    expect(startFailureExit(unavailable, true)).toEqual({
      status: 0,
      line: `${DAEMON_NAME}: failed to start (not restarting: auth provider not in this build): auth provider "subscription-token" is not available in this build`,
    });
  });

  it("under launchd: a transient failure exits 1 (restarted, throttled) with one line naming the cause and the rate", () => {
    expect(startFailureExit(keychain, true)).toEqual({
      status: 1,
      line: `${DAEMON_NAME}: failed to start (launchd restarts it at most once every 60 s): ${keychain.message}`,
    });
    expect(THROTTLE_INTERVAL_SECONDS).toBe(60);
    for (const err of [missing, invalidShape, new ApiTokenError("bad token"), new Error("first\nsecond")]) {
      const exit = startFailureExit(err, true);
      expect(exit.status).toBe(1);
      expect(exit.line).not.toContain("\n");
    }
  });
});

describe("stopFailureExit (a graceful stop whose teardown threw)", () => {
  const err = new Error("store close failed\nstack");

  it("by hand: exit 1 with today's line", () => {
    expect(stopFailureExit(err, "SIGTERM", false)).toEqual({ status: 1, line: `${DAEMON_NAME}: error while stopping on SIGTERM: store close failed` });
  });

  it("under launchd: exit 0, so the requested stop never starts a restart loop, and the error is logged", () => {
    expect(stopFailureExit(err, "SIGTERM", true)).toEqual({
      status: 0,
      line: `${DAEMON_NAME}: error while stopping on SIGTERM (not restarting): store close failed`,
    });
    expect(stopFailureExit(err, "SIGINT", true).status).toBe(0);
  });
});

describe("the built daemon (end to end, no Keychain)", () => {
  let build: { root: string; outDir: string };
  let tmp: string;
  let dataDir: string;

  beforeAll(() => {
    build = buildKernel();
  }, 120_000);

  afterAll(() => {
    rmSync(build.root, { recursive: true, force: true });
  });

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "studio-daemon-exit-"));
    dataDir = join(tmp, "data");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function daemon(args: readonly string[]): { status: number | null; stderr: string } {
    const r = spawnSync(process.execPath, [join(build.outDir, "daemon.js"), ...args], {
      env: { STUDIO_DATA_DIR: dataDir, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      encoding: "utf8",
      timeout: 30_000,
    });
    return { status: r.status, stderr: r.stderr };
  }

  it("the store lock held by another kernel: exit 0 under launchd, 1 by hand, one stderr line each", () => {
    // The lock is taken before any Keychain read, so this never reaches the Keychain.
    const holder = new Store({ dataDir });
    try {
      const launchd = daemon([LAUNCHD_ARGUMENT]);
      expect(launchd.status).toBe(0);
      expect(launchd.stderr).toMatch(new RegExp(`^${DAEMON_NAME}: failed to start \\(not restarting: another kernel holds the store lock\\): .*is locked.*\\n$`));
      const byHand = daemon([]);
      expect(byHand.status).toBe(1);
      expect(byHand.stderr).toMatch(new RegExp(`^${DAEMON_NAME}: failed to start: .*is locked.*\\n$`));
    } finally {
      holder.close();
    }
  });

  it("a bad argument with --launchd: exit 0 and one stderr line", () => {
    const r = daemon([LAUNCHD_ARGUMENT, "--bogus"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe(`${DAEMON_NAME}: failed to start (not restarting: bad argument): unknown argument: --bogus\n`);
  });
});
