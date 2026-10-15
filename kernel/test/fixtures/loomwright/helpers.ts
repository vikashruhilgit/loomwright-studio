// Loomwright install fixtures for the adapter and session tests: a contract
// modelled on the real 17.2.0 `capabilities.json` (a subset of its entries,
// every field shape kept), its variants, and writers for a fake install and a
// fake `installed_plugins.json`. Every path is under the caller's temp dir:
// no test reads the real `~/.claude/plugins/installed_plugins.json`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

/** The contract fixtures by name. */
export const CONTRACT_FIXTURES = {
  /** Valid, host switch `LOOMWRIGHT_HOST_MODE` / `LOOMWRIGHT_HOST_STATE_DIR` (17.2.0). */
  valid: "capabilities.json",
  /** Valid, host switch renamed to `TEST_HOST_FLAG` / `TEST_HOST_STATE` (version `17.2.0-renamed-test`). */
  renamedHostSwitch: "capabilities-renamed-host-switch.json",
  /** Valid, no `host_switch` (hypothetical version `17.1.0-test`; every real contract so far has one): readable, but `requireHostSwitch` refuses it. */
  noHostSwitch: "capabilities-no-host-switch.json",
} as const;

export type ContractFixture = keyof typeof CONTRACT_FIXTURES;

/** The path of a contract fixture file. */
export function contractFixturePath(name: ContractFixture = "valid"): string {
  return join(FIXTURE_DIR, CONTRACT_FIXTURES[name]);
}

/** A fresh, mutable parse of a contract fixture. */
export function fixtureContract(name: ContractFixture = "valid"): Record<string, unknown> {
  return JSON.parse(readFileSync(contractFixturePath(name), "utf8")) as Record<string, unknown>;
}

/**
 * Write a Loomwright install at `dir` (a `.claude-plugin/plugin.json`, as a
 * real install has) and its `capabilities.json`: a fixture by name, a
 * contract object, raw text (written as is), or `null` for none (like the real
 * 17.0.0 install, which shipped without one). Returns `dir`.
 */
export function writeLoomwrightInstall(dir: string, contract: ContractFixture | Record<string, unknown> | { readonly raw: string } | null = "valid"): string {
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), '{"name":"loomwright"}\n');
  if (contract === null) return dir;
  const text =
    typeof contract === "string"
      ? readFileSync(contractFixturePath(contract), "utf8")
      : "raw" in contract && typeof contract.raw === "string"
        ? contract.raw
        : `${JSON.stringify(contract, null, 2)}\n`;
  writeFileSync(join(dir, "capabilities.json"), text);
  return dir;
}

/** One `installed_plugins.json` entry, as Claude Code writes it (extra fields allowed). */
export interface InstalledPluginEntry {
  readonly scope: string;
  readonly installPath: string;
  readonly version: string;
  readonly projectPath?: string;
  readonly [field: string]: unknown;
}

/** A user-scope entry with the fields Claude Code records. */
export function userEntry(installPath: string, version: string): InstalledPluginEntry {
  return { scope: "user", installPath, version, installedAt: "2026-09-05T04:28:46.239Z", lastUpdated: "2026-10-14T09:03:28.683Z", gitCommitSha: "0".repeat(40) };
}

/** Write an `installed_plugins.json` (version 2, as observed) with these `plugins`. Returns `file`. */
export function writeInstalledPlugins(file: string, plugins: Readonly<Record<string, readonly InstalledPluginEntry[]>>): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 2, plugins }, null, 2)}\n`);
  return file;
}
