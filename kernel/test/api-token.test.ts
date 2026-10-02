// The API token (item 08, AC1) and the Keychain writer it uses. Never the
// real Keychain: every exec and reader is a fake.
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { API_TOKEN_KEYCHAIN_ACCOUNT, API_TOKEN_KEYCHAIN_SERVICE, ApiTokenError, ensureApiToken } from "../src/api/index.js";
import { KeychainError, securityCliKeychain, securityCliKeychainWriter } from "../src/auth/index.js";
import type { ExecFileSyncLike, ExecOptions, KeychainReader, KeychainWriter } from "../src/auth/index.js";

const EXISTING = "a".repeat(64);
const FIXED_BYTES = Buffer.alloc(32, 0xab);
const GENERATED = "ab".repeat(32);

/** An in-memory Keychain: `add` refuses an existing item, like `security` without `-U`. */
function memoryKeychain(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const reads: string[] = [];
  const adds: [string, string, string][] = [];
  const reader: KeychainReader = {
    read(service) {
      reads.push(service);
      return items.get(service);
    },
  };
  const writer: KeychainWriter = {
    add(service, account, secret) {
      adds.push([service, account, secret]);
      if (items.has(service)) throw new KeychainError(service, 45, null, "write");
      items.set(service, secret);
    },
  };
  return { items, reads, adds, reader, writer };
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw");
}

describe("ensureApiToken", () => {
  it("returns an existing item without writing", () => {
    const k = memoryKeychain({ [API_TOKEN_KEYCHAIN_SERVICE]: EXISTING });
    expect(ensureApiToken(k.reader, k.writer)).toBe(EXISTING);
    expect(k.adds).toEqual([]);
    expect(k.reads).toEqual(["loomwright-studio-api"]);
  });

  it("generates 64 hex chars when absent, adds it under the fixed account and returns the read-back", () => {
    const k = memoryKeychain();
    const token = ensureApiToken(k.reader, k.writer, () => FIXED_BYTES);
    expect(token).toBe(GENERATED);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(k.adds).toEqual([[API_TOKEN_KEYCHAIN_SERVICE, API_TOKEN_KEYCHAIN_ACCOUNT, GENERATED]]);
    expect(API_TOKEN_KEYCHAIN_ACCOUNT).toBe("loomwright-studio");
    // Read, add, read back.
    expect(k.reads).toEqual([API_TOKEN_KEYCHAIN_SERVICE, API_TOKEN_KEYCHAIN_SERVICE]);
  });

  it("uses real randomness by default (two first starts never share a token)", () => {
    const k1 = memoryKeychain();
    const k2 = memoryKeychain();
    const a = ensureApiToken(k1.reader, k1.writer);
    const b = ensureApiToken(k2.reader, k2.writer);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("returns what the Keychain holds when another process created the item first (the add fails, the read-back wins)", () => {
    let reads = 0;
    const reader: KeychainReader = { read: () => (reads++ === 0 ? undefined : EXISTING) };
    const writer: KeychainWriter = {
      add: () => {
        throw new KeychainError(API_TOKEN_KEYCHAIN_SERVICE, 45, null, "write");
      },
    };
    expect(ensureApiToken(reader, writer, () => FIXED_BYTES)).toBe(EXISTING);
  });

  it("throws when an exec that exits 0 created nothing (the read-back is the only proof)", () => {
    const reader: KeychainReader = { read: () => undefined };
    // A writer whose `security -i` "succeeded" but wrote nothing.
    const writer = securityCliKeychainWriter(() => "");
    const err = catchError(() => ensureApiToken(reader, writer, () => FIXED_BYTES));
    expect(err).toBeInstanceOf(ApiTokenError);
    expect((err as Error).message).toBe('Keychain item "loomwright-studio-api" is still absent after adding it');
    expect(inspect(err)).not.toContain(GENERATED);
  });

  it("rethrows the add's KeychainError when the item is still absent", () => {
    const reader: KeychainReader = { read: () => undefined };
    const writer = securityCliKeychainWriter(() => {
      throw Object.assign(new Error(`stderr mentions ${GENERATED}`), { status: 1, signal: null, stderr: GENERATED });
    });
    const err = catchError(() => ensureApiToken(reader, writer, () => FIXED_BYTES));
    expect(err).toBeInstanceOf(KeychainError);
    expect((err as Error).message).toBe('Keychain write of service "loomwright-studio-api" failed (/usr/bin/security exit status 1)');
    expect(inspect(err)).not.toContain(GENERATED);
  });

  it("refuses a stored item that is not a kernel token, without echoing it", () => {
    const k = memoryKeychain({ [API_TOKEN_KEYCHAIN_SERVICE]: "short-secret" });
    const err = catchError(() => ensureApiToken(k.reader, k.writer));
    expect(err).toBeInstanceOf(ApiTokenError);
    expect((err as Error).message).not.toContain("short-secret");
    expect(k.adds).toEqual([]);
  });
});

describe("securityCliKeychainWriter", () => {
  it("runs /usr/bin/security with argv [-i] only and passes the command, secret included, only on stdin", () => {
    const calls: { file: string; args: readonly string[]; options: ExecOptions }[] = [];
    const exec: ExecFileSyncLike = (file, args, options) => {
      calls.push({ file, args, options });
      return "";
    };
    securityCliKeychainWriter(exec).add("svc", "acct", GENERATED);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.file).toBe("/usr/bin/security");
    expect(call?.args).toEqual(["-i"]);
    expect(call?.args.join(" ")).not.toContain(GENERATED);
    expect(call?.options.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(call?.options.input).toBe(`add-generic-password -a acct -s svc -w ${GENERATED}\n`);
    // Never overwrites an existing item.
    expect(call?.options.input).not.toMatch(/(^|\s)-U(\s|$)/);
    expect(call?.options).not.toHaveProperty("shell");
  });

  const refused: [string, string, string, string][] = [
    ["a space in the secret", "svc", "acct", "ab cd"],
    ["a newline in the secret", "svc", "acct", "ab\nadd-generic-password -s x -w y"],
    ["a double quote", "svc", 'ac"ct', GENERATED],
    ["a single quote", "s'vc", "acct", GENERATED],
    ["a backslash", "svc", "acct", "ab\\cd"],
    ["a leading dash", "svc", "-U", GENERATED],
    ["an empty value", "", "acct", GENERATED],
  ];
  for (const [name, service, account, secret] of refused) {
    it(`refuses ${name} before running anything`, () => {
      let ran = false;
      const writer = securityCliKeychainWriter(() => {
        ran = true;
        return "";
      });
      const err = catchError(() => writer.add(service, account, secret));
      expect(err).toBeInstanceOf(RangeError);
      expect(ran).toBe(false);
      if (secret !== GENERATED) expect((err as Error).message).not.toContain(secret);
    });
  }

  it("wraps a failure in a KeychainError that says write and carries neither the secret nor stdin", () => {
    const exec: ExecFileSyncLike = (_f, _a, options) => {
      throw Object.assign(new Error(`failed: ${options.input ?? ""}`), {
        status: 1,
        signal: null,
        stdout: options.input,
        stderr: GENERATED,
      });
    };
    const err = catchError(() => securityCliKeychainWriter(exec).add("svc", "acct", GENERATED));
    expect(err).toBeInstanceOf(KeychainError);
    const ke = err as KeychainError;
    expect(ke.message).toBe('Keychain write of service "svc" failed (/usr/bin/security exit status 1)');
    expect(ke.operation).toBe("write");
    expect(ke.cause).toBeUndefined();
    expect(inspect(ke)).not.toContain(GENERATED);
    expect(inspect(ke)).not.toContain("add-generic-password");
  });

  it("reports a timeout of the write by signal", () => {
    const exec: ExecFileSyncLike = () => {
      throw Object.assign(new Error("timed out"), { status: null, signal: "SIGTERM" });
    };
    const err = catchError(() => securityCliKeychainWriter(exec).add("svc", "acct", GENERATED));
    expect((err as Error).message).toBe('Keychain write of service "svc" failed (/usr/bin/security terminated by SIGTERM)');
  });

  it("leaves the read path's message unchanged (auth.test.ts pins it too)", () => {
    const exec: ExecFileSyncLike = () => {
      throw Object.assign(new Error("boom"), { status: 1, signal: null });
    };
    const err = catchError(() => securityCliKeychain(exec).read("svc"));
    expect((err as Error).message).toBe('Keychain read of service "svc" failed (/usr/bin/security exit status 1)');
    expect((err as KeychainError).operation).toBe("read");
  });

  it("does not pass input or a piped stdin on the read path", () => {
    let options: ExecOptions | undefined;
    securityCliKeychain((_f, _a, o) => {
      options = o;
      return "x\n";
    }).read("svc");
    expect(options?.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(options).not.toHaveProperty("input");
  });
});
