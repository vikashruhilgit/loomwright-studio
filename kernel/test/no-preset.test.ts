// Nothing is preinstalled (invariant 1, D22; phase 6 item 10, AC7). The kernel
// ships mechanism only: a fresh data dir holds no playbook, no crew member and
// no charter file beyond Wright's own, and the only code that creates a
// playbook or a crew member runs on a request (a tool call, a route, the apply
// of an approved held call). Wright's first-run guidance holds no playbook or
// charter literal either: it tells Wright to propose, it does not carry one.
//
// (a) boots the shipped kernel over the fake sessions (no network, no real SDK,
// no real process) and counts what a fresh store holds. (b) reads the source.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel, KernelDeps } from "../src/kernel.js";
import { count } from "./loop-helpers.js";
import { stubNotifierContributions } from "./notifier-stub.js";
import { fakeSessions, makePluginDir, stubProvider } from "./session-fakes.js";

const SRC = new URL("../src/", import.meta.url).pathname;
const TEMPLATES = new URL("../src/brain/templates.ts", import.meta.url);

/**
 * The only files that call `createPlaybook(` / `createAgent(` (each runs on a
 * request): the owner's roster route, Wright's held `kernel_agent_create`
 * apply, and Wright's `kernel_playbook_create` tool.
 */
const CALL_SITES: Record<string, readonly string[]> = {
  createPlaybook: ["playbooks/drafts.ts"],
  createAgent: ["agents/charter-tools.ts", "agents/roster.ts"],
};

let tmp: string;
const kernels: Kernel[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-nopreset-"));
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  rmSync(tmp, { recursive: true, force: true });
});

function memoryKeychain() {
  const items = new Map<string, string>();
  const reader: KeychainReader = { read: (service) => items.get(service) };
  const writer: KeychainWriter = {
    add(service, _account, secret) {
      if (items.has(service)) throw new KeychainError(service, 45, null, "write");
      items.set(service, secret);
    },
  };
  return { reader, writer };
}

/** Every `.ts` file under `dir`, as a path relative to `SRC`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(relative(SRC, full));
  }
  return out.sort();
}

/** The code lines of a file that call `name(` (not its definition, not a comment). */
function callsOf(name: string, text: string): string[] {
  const call = new RegExp(`\\b${name}\\(`);
  return text.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return false;
    if (/\bfunction\s/.test(trimmed)) return false;
    return call.test(trimmed);
  });
}

describe("a fresh kernel holds nothing preinstalled (AC7a)", () => {
  it("starts with zero playbooks, zero crew rows and no charter file but Wright's", async () => {
    const keychain = memoryKeychain();
    const fakes = fakeSessions();
    const deps: KernelDeps = {
      keychain: keychain.reader,
      keychainWriter: keychain.writer,
      sessionDeps: fakes.deps,
      selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
      availableProviderIds: async () => ["api-key"],
      loopDeps: { tickMs: 10 },
    };
    const dataDir = join(tmp, "data");
    const kernel = await startKernel(
      { dataDir, env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: makePluginDir(tmp), stopGraceMs: 10 }, contributions: stubNotifierContributions() },
      deps,
    );
    kernels.push(kernel);

    expect(count(kernel.store, "SELECT count(*) FROM playbooks")).toBe(0);
    expect(count(kernel.store, "SELECT count(*) FROM agents")).toBe(0);
    const configDir = join(dataDir, "config", "agents");
    const files = existsSync(configDir) ? readdirSync(configDir).filter((f) => f.endsWith(".json")) : [];
    expect(files.filter((f) => f !== "wright.json")).toEqual([]);
  });
});

describe("only a request creates a playbook or a crew member (AC7b)", () => {
  it("createPlaybook( and createAgent( are called only from the allowlisted request sites", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(20);
    for (const [name, allowed] of Object.entries(CALL_SITES)) {
      const callers = files.filter((f) => callsOf(name, readFileSync(join(SRC, f), "utf8")).length > 0);
      // Non-vacuity: the scan does see every allowlisted site, so an empty result means nothing.
      expect(callers, name).toEqual([...allowed].sort());
    }
  });

  it("Wright's first-run guidance carries no charter or playbook literal", () => {
    const text = readFileSync(TEMPLATES, "utf8");
    expect(text).not.toMatch(/github\.pulls/);
    expect(text).not.toMatch(/"kind"\s*:\s*"poll"/);
    expect(text).not.toMatch(/\b(?:interval_seconds|dedupe_key|reachable_repos)\b/);
    expect(text).not.toMatch(/"?\bnever"?\s*[:=]\s*[[{]/);
    expect(text).not.toMatch(/"?\bconnectors"?\s*[:=]\s*[[{]/);
  });
});
