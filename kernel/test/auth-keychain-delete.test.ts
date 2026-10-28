// The Keychain deleter (phase 6, item 03): `security delete-generic-password`
// over an injected exec, so no test touches the real Keychain.
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { KeychainError, SECURITY_BIN, securityCliKeychainDeleter } from "../src/auth/index.js";
import type { ExecFileSyncLike, KeychainDeleter } from "../src/auth/index.js";

const SECRET_IN_OUTPUT = "github_pat_11SECRETSECRETSECRET";

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw");
}

/** An exec that fails the way `execFileSync` does, its error carrying output that holds a secret. */
function failingExec(status: number | null, signal: string | null = null): ExecFileSyncLike {
  return () => {
    throw Object.assign(new Error(`Command failed: ${SECRET_IN_OUTPUT}`), {
      status,
      signal,
      stdout: `password: "${SECRET_IN_OUTPUT}"`,
      stderr: SECRET_IN_OUTPUT,
    });
  };
}

describe("securityCliKeychainDeleter", () => {
  it("runs /usr/bin/security delete-generic-password -s <service> with an argument array, no stdin and no shell", () => {
    const calls: Array<{ file: string; args: readonly string[]; options: unknown }> = [];
    const exec: ExecFileSyncLike = (file, args, options) => {
      calls.push({ file, args, options });
      return 'keychain: "/Users/x/Library/Keychains/login.keychain-db"\n';
    };
    const deleter: KeychainDeleter = securityCliKeychainDeleter(exec);
    expect(deleter.delete("loomwright-studio-github")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe(SECURITY_BIN);
    expect(calls[0]?.file).toBe("/usr/bin/security");
    expect(calls[0]?.args).toEqual(["delete-generic-password", "-s", "loomwright-studio-github"]);
    expect(calls[0]?.options).toEqual({ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
    expect(calls[0]?.options).not.toHaveProperty("shell");
    expect(calls[0]?.options).not.toHaveProperty("input");
  });

  it("exit 44 is already gone: false, not an error", () => {
    expect(securityCliKeychainDeleter(failingExec(44)).delete("loomwright-studio-github")).toBe(false);
  });

  it("any other exit throws a KeychainError (operation delete) naming only service and status", () => {
    const err = catchError(() => securityCliKeychainDeleter(failingExec(1)).delete("svc"));
    expect(err).toBeInstanceOf(KeychainError);
    const ke = err as KeychainError;
    expect(ke.operation).toBe("delete");
    expect(ke.service).toBe("svc");
    expect(ke.exitStatus).toBe(1);
    expect(ke.message).toBe('Keychain delete of service "svc" failed (/usr/bin/security exit status 1)');
    expect(ke.cause).toBeUndefined();
    expect(inspect(ke)).not.toContain(SECRET_IN_OUTPUT);
    expect(JSON.stringify(Object.values(ke))).not.toContain(SECRET_IN_OUTPUT);
  });

  it("a timeout is reported by signal", () => {
    const err = catchError(() => securityCliKeychainDeleter(failingExec(null, "SIGTERM")).delete("svc"));
    expect(err).toBeInstanceOf(KeychainError);
    expect((err as KeychainError).message).toBe('Keychain delete of service "svc" failed (/usr/bin/security terminated by SIGTERM)');
    expect((err as KeychainError).operation).toBe("delete");
  });

  it.each(["", "-s", "has space", "new\nline", 'quo"te', "back\\slash"])("refuses the service %j before anything runs", (service) => {
    let ran = false;
    const exec: ExecFileSyncLike = () => {
      ran = true;
      return "";
    };
    const err = catchError(() => securityCliKeychainDeleter(exec).delete(service));
    expect(err).toBeInstanceOf(RangeError);
    expect((err as Error).message).toBe("Keychain delete refused: the service has a character security cannot take");
    expect(ran).toBe(false);
  });

  it("a non-object throw still maps to a KeychainError with unknown status", () => {
    const exec: ExecFileSyncLike = () => {
      throw SECRET_IN_OUTPUT;
    };
    const err = catchError(() => securityCliKeychainDeleter(exec).delete("svc"));
    expect(err).toBeInstanceOf(KeychainError);
    expect((err as KeychainError).exitStatus).toBeNull();
    expect(inspect(err)).not.toContain(SECRET_IN_OUTPUT);
  });
});
