// The Loomwright adapter (D32): the contract reader, the active-install
// resolver over `installed_plugins.json`, the adapter status, the
// `kernel_loomwright_capabilities` tool (also reached through the kernel MCP
// server) and the manifest summary. Every install and every
// `installed_plugins.json` is a fixture under a temp dir: no test reads the
// real `~/.claude/plugins/installed_plugins.json`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import type { ContributedToolContext } from "../src/features/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel } from "../src/kernel.js";
import {
  LOOMWRIGHT_ADAPTER_STATUS_REASONS,
  LOOMWRIGHT_CONTRACT_ERROR_REASONS,
  LoomwrightContractError,
  MANIFEST_TRUNCATED_MARKER,
  MAX_CONTRACT_BYTES,
  MIN_CONTRACT_SCHEMA_VERSION,
  capabilitiesTool,
  defaultInstalledPluginsPath,
  loomwrightAdapterStatus,
  loomwrightCapabilities,
  loomwrightContribution,
  loomwrightManifestSummary,
  readLoomwrightContract,
  requireHostSwitch,
  resolveLoomwrightInstall,
  versionWatchDueWork,
} from "../src/loomwright/index.js";
import type { LoomwrightContract } from "../src/loomwright/index.js";
import { hostSwitchNameProblem } from "../src/loomwright/contract.js";
import type { Store } from "../src/store/index.js";
import { contributedToolHandler } from "../src/tools/server.js";
import type { KernelToolResult } from "../src/tools/server.js";
import { fixtureContract, userEntry, writeInstalledPlugins, writeLoomwrightInstall } from "./fixtures/loomwright/helpers.js";
import type { InstalledPluginEntry } from "./fixtures/loomwright/helpers.js";
import { fakeSessions, startParams, stubProvider } from "./session-fakes.js";

let tmp: string;
let n = 0;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-loomwright-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

/** Every reason a test below saw thrown (the closed-enumeration pin at the end of the file). */
const seenReasons = new Set<string>();

function refusal(fn: () => unknown): LoomwrightContractError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(LoomwrightContractError);
    const e = err as LoomwrightContractError;
    expect(e.code).toBe("loomwright_contract_error");
    seenReasons.add(e.reason);
    return e;
  }
  throw new Error("expected a LoomwrightContractError");
}

/** A fresh install dir under `tmp` with `contract` (see `writeLoomwrightInstall`). */
function install(contract: Parameters<typeof writeLoomwrightInstall>[1] = "valid", name = `install-${n++}`): string {
  return writeLoomwrightInstall(join(tmp, name), contract);
}

/** The valid fixture with `edit` applied. */
function edited(edit: (c: Record<string, unknown>) => void): Record<string, unknown> {
  const c = fixtureContract();
  edit(c);
  return c;
}

/** The parsed valid fixture, written out by hand from `capabilities.json`. */
function expectedFixtureContract(): LoomwrightContract {
  const raw = fixtureContract() as {
    commands: { name: string; description: string }[];
    host_switch: { effect: string };
  };
  return {
    plugin_name: "loomwright",
    plugin_version: "17.2.0",
    contract_schema_version: 1,
    agents: [
      { name: "loomwright:code-reviewer", description: null },
      { name: "loomwright:rubric-grader", description: null },
      { name: "loomwright:worker", description: null },
    ],
    commands: raw.commands.map((c) => ({ name: c.name, description: c.description })),
    skills: [
      { name: "agent-output", description: null },
      { name: "error-handling", description: null },
      { name: "unit-testing", description: null },
    ],
    result_schemas: [
      { name: "AUTOMATE_RUN", schema_version: 1 },
      { name: "CODE_REVIEW_RESULT", schema_version: 3 },
      { name: "WORKER_RESULT", schema_version: 2 },
    ],
    hooks: [
      { event: "Notification", host_mode: "redirects" },
      { event: "PostToolUse", host_mode: "redirects" },
      { event: "PostToolUse", host_mode: "redirects" },
      { event: "PreToolUse", host_mode: "unaffected" },
      { event: "SessionStart", host_mode: "skips" },
      { event: "Stop", host_mode: "unaffected" },
    ],
    host_switch: { env: "LOOMWRIGHT_HOST_MODE", state_dir_env: "LOOMWRIGHT_HOST_STATE_DIR", effect: raw.host_switch.effect },
  };
}

// ---- The contract reader ----------------------------------------------------

describe("readLoomwrightContract", () => {
  it("parses the fixture contract into exactly the fields the adapter reads", () => {
    const dir = install();
    const contract = readLoomwrightContract(dir);
    const expected = expectedFixtureContract();
    // The fixture's hooks, in file order (checked against the file, so a fixture edit fails here first).
    const rawHooks = (fixtureContract().hooks as { event: string; host_mode: string }[]).map((h) => ({ event: h.event, host_mode: h.host_mode }));
    expect(rawHooks).toEqual(expected.hooks);
    const rawSchemas = (fixtureContract().result_schemas as { name: string; schema_version: number }[]).map((s) => ({ name: s.name, schema_version: s.schema_version }));
    expect(rawSchemas).toEqual(expected.result_schemas);
    expect(contract).toEqual(expected);
    expect(Object.keys(contract)).toEqual([
      "plugin_name",
      "plugin_version",
      "contract_schema_version",
      "agents",
      "commands",
      "skills",
      "result_schemas",
      "hooks",
      "host_switch",
    ]);
    expect(MIN_CONTRACT_SCHEMA_VERSION).toBe(1);
  });

  it("drops unknown fields at every level, never an error (AC4)", () => {
    const dir = install(
      edited((c) => {
        c.future_top_level = { nested: "x" };
        c.another_unknown = [1, 2, 3];
        (c.agents as Record<string, unknown>[])[0]!.future_agent_field = "x";
        (c.commands as Record<string, unknown>[])[0]!.future_command_field = "x";
        (c.skills as Record<string, unknown>[])[0]!.future_skill_field = "x";
        (c.result_schemas as Record<string, unknown>[])[0]!.future_schema_field = "x";
        (c.hooks as Record<string, unknown>[])[0]!.future_hook_field = "x";
        (c.host_switch as Record<string, unknown>).future_switch_field = "x";
      }),
    );
    const contract = readLoomwrightContract(dir);
    expect(contract).toEqual(readLoomwrightContract(install()));
    const text = JSON.stringify(contract);
    for (const dropped of ["future_", "another_unknown", "generated_by", "runtime_agent_type", "result_block", '"tools"', '"model"', '"script"', '"scripts"', '"matcher"', '"writes"', '"blocking"', '"source"', '"type"']) {
      expect(text, dropped).not.toContain(dropped);
    }
  });

  it("a missing capabilities.json is contract_missing, naming the install path (a 17.0.0-style install)", () => {
    const dir = install(null);
    const err = refusal(() => readLoomwrightContract(dir));
    expect(err.reason).toBe("contract_missing");
    expect(err.path).toBe(dir);
    expect(err.message).toBe(`Loomwright at ${dir}: capabilities.json missing`);
    // A dir that does not exist at all, or a file where the install dir should be.
    expect(refusal(() => readLoomwrightContract(join(tmp, "nowhere"))).reason).toBe("contract_missing");
    writeFileSync(join(tmp, "a-file"), "x");
    expect(refusal(() => readLoomwrightContract(join(tmp, "a-file"))).reason).toBe("contract_missing");
  });

  it("an unreadable capabilities.json (a directory, or over 4 MiB) is contract_unreadable; exactly 4 MiB is read", () => {
    const dir = install(null);
    mkdirSync(join(dir, "capabilities.json"));
    const asDir = refusal(() => readLoomwrightContract(dir));
    expect(asDir.reason).toBe("contract_unreadable");
    expect(asDir.message).toMatch(/^Loomwright at .*: capabilities\.json unreadable \(EISDIR\)$/);

    expect(MAX_CONTRACT_BYTES).toBe(4 * 1024 * 1024);
    const valid = `${JSON.stringify(fixtureContract())}`;
    const exact = install({ raw: valid + " ".repeat(MAX_CONTRACT_BYTES - Buffer.byteLength(valid)) });
    expect(readLoomwrightContract(exact).plugin_version).toBe("17.2.0");
    const over = install({ raw: valid + " ".repeat(MAX_CONTRACT_BYTES - Buffer.byteLength(valid) + 1) });
    const big = refusal(() => readLoomwrightContract(over));
    expect(big.reason).toBe("contract_unreadable");
    expect(big.message).toContain(`over ${MAX_CONTRACT_BYTES} bytes`);
  });

  it("a contract that is not JSON is contract_not_json (AC3)", () => {
    for (const raw of ["{not json", "", "{\"plugin_name\": \"loomwright\",}"]) {
      const err = refusal(() => readLoomwrightContract(install({ raw })));
      expect(err.reason, raw).toBe("contract_not_json");
      expect(err.message).toMatch(/capabilities\.json is not JSON$/);
    }
  });

  it("contract_schema_version below 1 is contract_schema_too_old; a newer version is read (AC3)", () => {
    for (const version of [0, -1]) {
      const err = refusal(() => readLoomwrightContract(install(edited((c) => void (c.contract_schema_version = version)))));
      expect(err.reason).toBe("contract_schema_too_old");
      expect(err.message).toContain(`contract_schema_version ${version} is below the minimum 1`);
    }
    // The schema version is checked first: an old contract may differ in every other field.
    expect(refusal(() => readLoomwrightContract(install({ contract_schema_version: 0 }))).reason).toBe("contract_schema_too_old");
    expect(readLoomwrightContract(install(edited((c) => void (c.contract_schema_version = 2)))).contract_schema_version).toBe(2);
  });

  it("a missing or mistyped required field is contract_invalid, naming the field (AC3)", () => {
    const cases: readonly [string, (c: Record<string, unknown>) => void][] = [
      ["plugin_version", (c) => delete c.plugin_version],
      ["plugin_version", (c) => void (c.plugin_version = "")],
      ["plugin_version", (c) => void (c.plugin_version = 17)],
      ["plugin_name", (c) => void (c.plugin_name = "loomwright-lanes")],
      ["plugin_name", (c) => delete c.plugin_name],
      ["contract_schema_version", (c) => delete c.contract_schema_version],
      ["contract_schema_version", (c) => void (c.contract_schema_version = "1")],
      ["contract_schema_version", (c) => void (c.contract_schema_version = 1.5)],
      ["agents", (c) => delete c.agents],
      ["commands", (c) => void (c.commands = {})],
      ["skills", (c) => void (c.skills = "agent-output")],
      ["result_schemas", (c) => delete c.result_schemas],
      ["hooks", (c) => void (c.hooks = null)],
      ["agents[1].name", (c) => void ((c.agents as Record<string, unknown>[])[1]!.name = "")],
      ["commands[0].name", (c) => delete (c.commands as Record<string, unknown>[])[0]!.name],
      ["skills[2].name", (c) => void ((c.skills as unknown[])[2] = "unit-testing")],
      ["result_schemas[0].name", (c) => void ((c.result_schemas as Record<string, unknown>[])[0]!.name = 7)],
      ["hooks[0].event", (c) => delete (c.hooks as Record<string, unknown>[])[0]!.event],
      ["hooks[3].host_mode", (c) => void ((c.hooks as Record<string, unknown>[])[3]!.host_mode = null)],
      ["host_switch", (c) => void (c.host_switch = "LOOMWRIGHT_HOST_MODE")],
      ["host_switch.env", (c) => void ((c.host_switch as Record<string, unknown>).env = "loomwright_host_mode")],
      ["host_switch.env", (c) => delete (c.host_switch as Record<string, unknown>).env],
      ["host_switch.env", (c) => void ((c.host_switch as Record<string, unknown>).env = "HOST MODE")],
      ["host_switch.state_dir_env", (c) => void ((c.host_switch as Record<string, unknown>).state_dir_env = "1DIR")],
      ["host_switch.state_dir_env", (c) => void ((c.host_switch as Record<string, unknown>).state_dir_env = "LOOMWRIGHT_HOST_MODE")],
      ["host_switch.effect", (c) => delete (c.host_switch as Record<string, unknown>).effect],
    ];
    for (const [field, edit] of cases) {
      const dir = install(edited(edit));
      const err = refusal(() => readLoomwrightContract(dir));
      expect(err.reason, field).toBe("contract_invalid");
      expect(err.path).toBe(dir);
      expect(err.message, field).toMatch(new RegExp(`^Loomwright at .*: capabilities\\.json invalid: ${field.replace(/[[\].]/g, "\\$&")} `));
    }
    for (const raw of ["[]", "null", '"loomwright"', "17"]) {
      const err = refusal(() => readLoomwrightContract(install({ raw })));
      expect(err.reason, raw).toBe("contract_invalid");
      expect(err.message).toContain("not a JSON object");
    }
  });

  it("a host switch naming a credential, billing-routing, process-control or kernel-set session variable is contract_invalid, naming the field and why (invariant 3)", () => {
    const credential = ["CLAUDE_CODE_USE_BEDROCK", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN"];
    const processControl = [
      // Exact names: paths, shell startup and behaviour, locale/terminal, the CLI's shell hooks.
      "PATH", "HOME", "SHELL", "USER", "TMPDIR", "CDPATH",
      "BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "PS4", "IFS", "PROMPT_COMMAND", "ZDOTDIR", "GLOBIGNORE",
      "LANG", "TZ", "TERM",
      "CLAUDE_ENV_FILE", "CLAUDE_CODE_SHELL", "CLAUDE_CODE_SHELL_PREFIX",
      // Prefixes: loaders, interpreters, bash functions, git, config/TLS/locale dirs, the CLI's namespace.
      "NODE_OPTIONS", "NODE_PATH", "DYLD_INSERT_LIBRARIES", "LD_PRELOAD",
      "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PERL5LIB", "PERL5OPT", "RUBYOPT", "RUBYLIB", "NPM_CONFIG_PREFIX",
      "BASH_FUNC_X",
      "GIT_EXEC_PATH", "GIT_DIR", "GIT_SSH_COMMAND",
      "XDG_CONFIG_HOME", "SSL_CERT_DIR", "LC_ALL",
      "CLAUDE_CODE_USE_NATIVE_FILE_SEARCH",
      // Suffix: every proxy variable.
      "HTTPS_PROXY", "HTTP_PROXY", "FTP_PROXY", "SOCKS_PROXY", "NO_PROXY", "ALL_PROXY",
    ];
    for (const [names, why] of [
      [credential, "a credential or billing-routing variable the kernel strips"],
      [processControl, "a process-control variable"],
      // The kernel's own session variables (TOOL_DEFERRAL_OFF): its value would silently replace the switch's.
      [["ENABLE_TOOL_SEARCH"], "a variable the kernel sets in every session's environment"],
    ] as const) {
      for (const name of names) {
        for (const field of ["env", "state_dir_env"] as const) {
          const dir = install(edited((c) => void ((c.host_switch as Record<string, unknown>)[field] = name)));
          const err = refusal(() => readLoomwrightContract(dir));
          expect(err.reason, `${field}=${name}`).toBe("contract_invalid");
          expect(err.message).toContain(`capabilities.json invalid: host_switch.${field} must not name ${name}: ${why}`);
        }
      }
    }
  });

  it("hostSwitchNameProblem needs no LOOMWRIGHT_ prefix: the renamed fixture's names, and lookalikes of refused names, are accepted", () => {
    for (const name of ["LOOMWRIGHT_HOST_MODE", "LOOMWRIGHT_HOST_STATE_DIR", "TEST_HOST_FLAG", "TEST_HOST_STATE", "PATHFINDER_MODE", "HOMEBREW_STATE", "PROXY_MODE", "ENVIRONMENT_FLAG", "TERMINUS_STATE", "GITHUB_HOST_FLAG"]) {
      expect(hostSwitchNameProblem(name), name).toBeUndefined();
    }
    expect(requireHostSwitch(readLoomwrightContract(install("renamedHostSwitch")), "x")).toMatchObject({ env: "TEST_HOST_FLAG", state_dir_env: "TEST_HOST_STATE" });
  });

  it("optional fields: a non-string description and a missing or non-integer schema_version read as null; a description is one line", () => {
    const contract = readLoomwrightContract(
      install(
        edited((c) => {
          (c.agents as Record<string, unknown>[])[0]!.description = "Reviews\n  the   diff.\t";
          (c.agents as Record<string, unknown>[])[1]!.description = 42;
          (c.commands as Record<string, unknown>[])[0]!.description = "   ";
          delete (c.result_schemas as Record<string, unknown>[])[0]!.schema_version;
          (c.result_schemas as Record<string, unknown>[])[1]!.schema_version = "1";
        }),
      ),
    );
    expect(contract.agents.slice(0, 2)).toEqual([
      { name: "loomwright:code-reviewer", description: "Reviews the diff." },
      { name: "loomwright:rubric-grader", description: null },
    ]);
    expect(contract.commands[0]?.description).toBeNull();
    expect(contract.result_schemas.slice(0, 2).map((s) => s.schema_version)).toEqual([null, null]);
  });

  it("no host_switch is a valid contract (host_switch: null); requireHostSwitch refuses it with no_host_switch", () => {
    const dir = install("noHostSwitch");
    const contract = readLoomwrightContract(dir);
    expect(contract.host_switch).toBeNull();
    expect(contract.plugin_version).toBe("17.1.0-test");
    const err = refusal(() => requireHostSwitch(contract, dir));
    expect(err.reason).toBe("no_host_switch");
    expect(err.path).toBe(dir);
    expect(err.message).toContain(dir);
    expect(err.message).toContain("no host_switch");
    // An explicit null is no host switch too.
    expect(readLoomwrightContract(install(edited((c) => void (c.host_switch = null)))).host_switch).toBeNull();

    const renamed = readLoomwrightContract(install("renamedHostSwitch"));
    expect(requireHostSwitch(renamed, dir)).toEqual({ env: "TEST_HOST_FLAG", state_dir_env: "TEST_HOST_STATE", effect: expect.any(String) });
    expect(requireHostSwitch(readLoomwrightContract(install()), dir)).toMatchObject({ env: "LOOMWRIGHT_HOST_MODE", state_dir_env: "LOOMWRIGHT_HOST_STATE_DIR" });
  });
});

// ---- The active install -----------------------------------------------------

describe("resolveLoomwrightInstall", () => {
  const pluginsFile = (): string => join(tmp, "claude", "plugins", "installed_plugins.json");

  /** A fake plugin cache holding the given version folders, each a valid install. */
  function cache(...versions: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const v of versions) out[v] = install("valid", join("cache", "atelier", "loomwright", v));
    return out;
  }

  it("defaultInstalledPluginsPath is ~/.claude/plugins/installed_plugins.json", () => {
    expect(defaultInstalledPluginsPath("/Users/someone")).toBe("/Users/someone/.claude/plugins/installed_plugins.json");
  });

  it("loads the user-scope entry's installPath, never a newer cache folder (D32, AC1)", () => {
    const dirs = cache("17.2.0", "99.0.0");
    writeInstalledPlugins(pluginsFile(), { "loomwright@atelier": [userEntry(dirs["17.2.0"] as string, "17.2.0")] });
    const resolved = resolveLoomwrightInstall({ installedPluginsPath: pluginsFile() });
    expect(resolved).toEqual({ installPath: dirs["17.2.0"], contract: readLoomwrightContract(dirs["17.2.0"] as string), source: "installed_plugins", scope: "user" });
  });

  it("a non-empty configured path wins, resolved to absolute, and needs only a valid contract", () => {
    const dir = install("valid", "configured");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(tmp);
    const resolved = resolveLoomwrightInstall({ configured: "configured", installedPluginsPath: join(tmp, "missing.json") });
    cwd.mockRestore();
    expect(resolved).toMatchObject({ installPath: dir, source: "configured", scope: null });
    expect(resolved.contract.plugin_version).toBe("17.2.0");
    // An empty configured path is not configured.
    const dirs = cache("17.2.0");
    writeInstalledPlugins(pluginsFile(), { "loomwright@atelier": [userEntry(dirs["17.2.0"] as string, "17.2.0")] });
    expect(resolveLoomwrightInstall({ configured: "", installedPluginsPath: pluginsFile() }).source).toBe("installed_plugins");
  });

  it("a configured path with a bad contract is an error, never a fallback to installed_plugins.json", () => {
    const dirs = cache("17.2.0");
    writeInstalledPlugins(pluginsFile(), { "loomwright@atelier": [userEntry(dirs["17.2.0"] as string, "17.2.0")] });
    const bad = install(null, "configured-17.0.0");
    const err = refusal(() => resolveLoomwrightInstall({ configured: bad, installedPluginsPath: pluginsFile() }));
    expect(err.reason).toBe("contract_missing");
    expect(err.path).toBe(bad);
    const invalid = install(edited((c) => delete c.plugin_version), "configured-invalid");
    expect(refusal(() => resolveLoomwrightInstall({ configured: invalid, installedPluginsPath: pluginsFile() })).reason).toBe("contract_invalid");
  });

  it("installed_plugins.json missing is installed_plugins_missing, naming the file", () => {
    const err = refusal(() => resolveLoomwrightInstall({ installedPluginsPath: pluginsFile() }));
    expect(err.reason).toBe("installed_plugins_missing");
    expect(err.path).toBe(pluginsFile());
    expect(err.message).toContain(pluginsFile());
  });

  it("an installed_plugins.json it cannot read, or an entry shape it does not know, is installed_plugins_unreadable (fail closed)", () => {
    const dir = cache("17.2.0")["17.2.0"] as string;
    const file = pluginsFile();
    const raws: readonly [string, string, string][] = [
      ["not JSON", "{nope", "not JSON"],
      ["no plugins", JSON.stringify({ version: 2 }), "no plugins object"],
      ["plugins is an array", JSON.stringify({ version: 2, plugins: [] }), "no plugins object"],
      ["top level is an array", "[]", "no plugins object"],
    ];
    for (const [label, text, says] of raws) {
      mkdirSync(join(tmp, "claude", "plugins"), { recursive: true });
      writeFileSync(file, text);
      const err = refusal(() => resolveLoomwrightInstall({ installedPluginsPath: file }));
      expect(err.reason, label).toBe("installed_plugins_unreadable");
      expect(err.message, label).toBe(`${file}: ${says}`);
    }
    const entries: readonly [string, unknown, string][] = [
      ["not an array", { scope: "user", installPath: dir, version: "17.2.0" }, 'plugins["loomwright@atelier"] is not an array'],
      ["entry not an object", ["user"], 'plugins["loomwright@atelier"] [0] is not an object'],
      ["no scope", [{ installPath: dir, version: "17.2.0" }], "[0].scope is not a string"],
      ["no installPath", [{ scope: "user", version: "17.2.0" }], "[0].installPath is not an absolute path"],
      ["relative installPath", [{ scope: "user", installPath: "cache/17.2.0", version: "17.2.0" }], "[0].installPath is not an absolute path"],
      ["no version", [{ scope: "user", installPath: dir }], "[0].version is not a string"],
      ["unknown scope", [{ scope: "managed", installPath: dir, version: "17.2.0" }], '[0] has an unknown scope "managed"'],
      ["project without projectPath", [userEntry(dir, "17.2.0"), { scope: "project", installPath: dir, version: "17.2.0" }], "[1] (scope project) has no string projectPath"],
      ["local with a non-string projectPath", [{ scope: "local", installPath: dir, version: "17.2.0", projectPath: 1 }], "[0] (scope local) has no string projectPath"],
    ];
    for (const [label, value, says] of entries) {
      writeFileSync(file, JSON.stringify({ version: 2, plugins: { "loomwright@atelier": value } }));
      const err = refusal(() => resolveLoomwrightInstall({ installedPluginsPath: file, projectPath: tmp }));
      expect(err.reason, label).toBe("installed_plugins_unreadable");
      expect(err.path).toBe(file);
      expect(err.message, label).toContain(says);
      expect(err.message, label).toContain('plugins["loomwright@atelier"]');
    }
    // Another plugin's malformed entry is not the adapter's business.
    writeFileSync(file, JSON.stringify({ version: 2, plugins: { "other@atelier": "garbage", "loomwright@atelier": [userEntry(dir, "17.2.0")] } }));
    expect(resolveLoomwrightInstall({ installedPluginsPath: file }).installPath).toBe(dir);
  });

  it("an installed_plugins.json over 4 MiB, or a directory, is installed_plugins_unreadable", () => {
    const file = pluginsFile();
    mkdirSync(join(tmp, "claude", "plugins"), { recursive: true });
    writeFileSync(file, " ".repeat(4 * 1024 * 1024 + 1));
    expect(refusal(() => resolveLoomwrightInstall({ installedPluginsPath: file })).message).toContain("over 4194304 bytes");
    rmSync(file);
    mkdirSync(file);
    expect(refusal(() => resolveLoomwrightInstall({ installedPluginsPath: file })).reason).toBe("installed_plugins_unreadable");
  });

  it("only loomwright@<marketplace> keys are candidates: loomwright-lanes@atelier never is", () => {
    const dirs = cache("17.2.0", "0.3.0");
    const lanes = userEntry(dirs["0.3.0"] as string, "0.3.0");
    writeInstalledPlugins(pluginsFile(), { "loomwright-lanes@atelier": [lanes], loomwright: [lanes], "loomwright@a@b": [lanes], "xloomwright@atelier": [lanes] });
    const none = refusal(() => resolveLoomwrightInstall({ installedPluginsPath: pluginsFile() }));
    expect(none.reason).toBe("not_installed");
    expect(none.path).toBe(pluginsFile());
    expect(none.message).toContain(pluginsFile());
    // With the real key too: the real one, and no ambiguity.
    writeInstalledPlugins(pluginsFile(), { "loomwright-lanes@atelier": [lanes], "loomwright@atelier": [userEntry(dirs["17.2.0"] as string, "17.2.0")] });
    expect(resolveLoomwrightInstall({ installedPluginsPath: pluginsFile() }).installPath).toBe(dirs["17.2.0"]);
    // Any marketplace name counts.
    writeInstalledPlugins(pluginsFile(), { "loomwright@my-fork": [userEntry(dirs["17.2.0"] as string, "17.2.0")] });
    expect(resolveLoomwrightInstall({ installedPluginsPath: pluginsFile() }).installPath).toBe(dirs["17.2.0"]);
  });

  it("scope precedence is Claude Code's: local over project over user, for the session's project only", () => {
    const repo = join(tmp, "repo");
    mkdirSync(repo);
    const dirs = cache("1.0.0", "2.0.0", "3.0.0");
    const user = userEntry(dirs["1.0.0"] as string, "1.0.0");
    const project: InstalledPluginEntry = { scope: "project", installPath: dirs["2.0.0"] as string, version: "2.0.0", projectPath: repo };
    const local: InstalledPluginEntry = { scope: "local", installPath: dirs["3.0.0"] as string, version: "3.0.0", projectPath: repo };
    const file = pluginsFile();
    const pick = (entries: InstalledPluginEntry[], projectPath?: string) => {
      writeInstalledPlugins(file, { "loomwright@atelier": entries });
      const r = resolveLoomwrightInstall({ installedPluginsPath: file, projectPath });
      return [r.scope, relative(tmp, r.installPath)];
    };
    const at = (v: string) => relative(tmp, dirs[v] as string);
    // Every order in the file gives the same answer.
    expect(pick([user, project, local], repo)).toEqual(["local", at("3.0.0")]);
    expect(pick([local, project, user], repo)).toEqual(["local", at("3.0.0")]);
    expect(pick([project, user], repo)).toEqual(["project", at("2.0.0")]);
    expect(pick([user, project], `${repo}/.`)).toEqual(["project", at("2.0.0")]);
    expect(pick([local, user], repo)).toEqual(["local", at("3.0.0")]);
    // Another project's entries do not apply; with no project (the /status view) only user scope does.
    expect(pick([user, project, local], join(tmp, "other-repo"))).toEqual(["user", at("1.0.0")]);
    expect(pick([user, project, local])).toEqual(["user", at("1.0.0")]);
    // Only another project's entry: nothing applies.
    writeInstalledPlugins(file, { "loomwright@atelier": [project] });
    expect(refusal(() => resolveLoomwrightInstall({ installedPluginsPath: file, projectPath: join(tmp, "other-repo") })).reason).toBe("not_installed");
  });

  it("two candidates at the winning scope are ambiguous_install, naming every candidate; never a guess", () => {
    const dirs = cache("17.2.0", "17.0.2", "3.0.0");
    const file = pluginsFile();
    writeInstalledPlugins(file, {
      "loomwright@atelier": [userEntry(dirs["17.2.0"] as string, "17.2.0")],
      "loomwright@my-fork": [userEntry(dirs["17.0.2"] as string, "17.0.2")],
    });
    const err = refusal(() => resolveLoomwrightInstall({ installedPluginsPath: file }));
    expect(err.reason).toBe("ambiguous_install");
    expect(err.path).toBe(file);
    expect(err.message).toContain(`loomwright@atelier user ${dirs["17.2.0"]}`);
    expect(err.message).toContain(`loomwright@my-fork user ${dirs["17.0.2"]}`);
    // Two entries under one key at the same scope are just as ambiguous.
    writeInstalledPlugins(file, { "loomwright@atelier": [userEntry(dirs["17.2.0"] as string, "17.2.0"), userEntry(dirs["17.0.2"] as string, "17.0.2")] });
    expect(refusal(() => resolveLoomwrightInstall({ installedPluginsPath: file })).reason).toBe("ambiguous_install");
    // Ambiguity below the winning scope does not matter.
    const repo = join(tmp, "repo");
    writeInstalledPlugins(file, {
      "loomwright@atelier": [userEntry(dirs["17.2.0"] as string, "17.2.0"), { scope: "local", installPath: dirs["3.0.0"] as string, version: "3.0.0", projectPath: repo }],
      "loomwright@my-fork": [userEntry(dirs["17.0.2"] as string, "17.0.2")],
    });
    expect(resolveLoomwrightInstall({ installedPluginsPath: file, projectPath: repo }).installPath).toBe(dirs["3.0.0"]);
  });

  it("a winner whose installPath is not a directory is install_path_invalid", () => {
    const file = pluginsFile();
    const gone = join(tmp, "cache", "atelier", "loomwright", "17.2.0");
    writeInstalledPlugins(file, { "loomwright@atelier": [userEntry(gone, "17.2.0")] });
    const err = refusal(() => resolveLoomwrightInstall({ installedPluginsPath: file }));
    expect(err.reason).toBe("install_path_invalid");
    expect(err.path).toBe(gone);
    expect(err.message).toContain(gone);
    expect(err.message).toContain(file);
  });

  it("the active install's own contract or none: a 17.0.0-style active install is contract_missing even when another cached version has one", () => {
    const dirs = cache("17.2.0");
    const active = install(null, join("cache", "atelier", "loomwright", "17.0.0"));
    writeInstalledPlugins(pluginsFile(), { "loomwright@atelier": [userEntry(active, "17.0.0")] });
    const err = refusal(() => resolveLoomwrightInstall({ installedPluginsPath: pluginsFile() }));
    expect(err.reason).toBe("contract_missing");
    expect(err.path).toBe(active);
    expect(err.message).toBe(`Loomwright at ${active}: capabilities.json missing`);
    expect(err.message).not.toContain(dirs["17.2.0"]);
  });
});

// ---- The adapter status -------------------------------------------------------

describe("loomwrightAdapterStatus", () => {
  it("ok: the install path, version, schema version and whether it has a host switch; read fresh on every call", () => {
    const file = join(tmp, "installed_plugins.json");
    const a = install("valid", "a");
    const b = install("noHostSwitch", "b");
    writeInstalledPlugins(file, { "loomwright@atelier": [userEntry(a, "17.2.0")] });
    expect(loomwrightAdapterStatus({ installedPluginsPath: file })).toEqual({
      status: "ok",
      install_path: a,
      plugin_version: "17.2.0",
      contract_schema_version: 1,
      host_switch: true,
    });
    writeInstalledPlugins(file, { "loomwright@atelier": [userEntry(b, "17.1.0-test")] });
    expect(loomwrightAdapterStatus({ installedPluginsPath: file })).toEqual({
      status: "ok",
      install_path: b,
      plugin_version: "17.1.0-test",
      contract_schema_version: 1,
      host_switch: false,
    });
    expect(loomwrightAdapterStatus({ configured: a, installedPluginsPath: join(tmp, "missing.json") })).toMatchObject({ status: "ok", install_path: a });
  });

  it("an error is reported, never thrown: the reason, the path and the message", () => {
    const file = join(tmp, "installed_plugins.json");
    expect(loomwrightAdapterStatus({ installedPluginsPath: file })).toEqual({
      status: "error",
      reason: "installed_plugins_missing",
      path: file,
      message: `${file} is missing, and no Loomwright path is configured`,
    });
    const bad = install(null);
    expect(loomwrightAdapterStatus({ configured: bad })).toEqual({
      status: "error",
      reason: "contract_missing",
      path: bad,
      message: `Loomwright at ${bad}: capabilities.json missing`,
    });
    // The user-scope view: a project entry never applies here.
    writeInstalledPlugins(file, { "loomwright@atelier": [{ scope: "project", installPath: install(), version: "17.2.0", projectPath: tmp }] });
    expect(loomwrightAdapterStatus({ installedPluginsPath: file })).toMatchObject({ status: "error", reason: "not_installed" });
  });

  it("an unexpected throw is status_threw with a clipped message, never a throw", () => {
    const status = loomwrightAdapterStatus({ installedPluginsPath: 42 as unknown as string });
    expect(status).toMatchObject({ status: "error", reason: "status_threw", path: "" });
    expect(status.status === "error" && status.message.length).toBeGreaterThan(0);
    expect(status.status === "error" && status.message.length <= 500).toBe(true);
  });
});

// ---- The tool and the manifest ------------------------------------------------

/** The fixture contract's capabilities, written out by hand. */
function expectedCapabilities(installPath: string) {
  const c = expectedFixtureContract();
  return {
    install_path: installPath,
    plugin_version: "17.2.0",
    contract_schema_version: 1,
    agents: c.agents,
    commands: c.commands,
    skills: c.skills,
    result_schemas: c.result_schemas,
    hooks_by_host_mode: { redirects: 3, skips: 1, unaffected: 2 },
    host_switch: { env: "LOOMWRIGHT_HOST_MODE", state_dir_env: "LOOMWRIGHT_HOST_STATE_DIR" },
  };
}

/** No hook script, scripts, writes or matcher, no generated_by, no host-switch effect, no path but the install's. */
function expectOnlyInstallPath(text: string, installPath: string): void {
  for (const leak of ['"script"', '"scripts"', '"writes"', '"matcher"', '"generated_by"', '"effect"', '"hooks"', "scripts/", ".supervisor", "settings.local.json", "build-capabilities"]) {
    expect(text, leak).not.toContain(leak);
  }
  expect(text.split(installPath).join("<install>")).not.toMatch(/\/[A-Za-z0-9._-]+\//);
}

describe("loomwrightCapabilities and kernel_loomwright_capabilities (AC8)", () => {
  it("returns exactly the version, schema, names with one-liners, result schemas, hook counts by host_mode and host-switch names", () => {
    const dir = install();
    const caps = loomwrightCapabilities(readLoomwrightContract(dir), dir);
    const expected = expectedCapabilities(dir);
    expect(caps).toEqual(expected);
    expect(Object.keys(caps)).toEqual([
      "install_path",
      "plugin_version",
      "contract_schema_version",
      "agents",
      "commands",
      "skills",
      "result_schemas",
      "hooks_by_host_mode",
      "host_switch",
    ]);
    // Commands carry their description; agents and skills have none in the contract (null).
    expect(caps.commands.every((c) => typeof c.description === "string")).toBe(true);
    expect(caps.agents.every((a) => a.description === null)).toBe(true);
    expectOnlyInstallPath(JSON.stringify(caps), dir);
  });

  it("no host switch ⇒ host_switch null; a __proto__ host mode is a key, never a prototype", () => {
    const dir = install(edited((c) => {
      delete c.host_switch;
      (c.hooks as Record<string, unknown>[]).push({ event: "Stop", host_mode: "__proto__" });
    }));
    const caps = loomwrightCapabilities(readLoomwrightContract(dir), dir);
    expect(caps.host_switch).toBeNull();
    expect(Object.getPrototypeOf(caps.hooks_by_host_mode)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(caps.hooks_by_host_mode))).toEqual(JSON.parse('{"__proto__":1,"redirects":3,"skips":1,"unaffected":2}'));
  });

  it("is loomwrightContribution's one tool: kernel_ name, empty shape, one-line description", () => {
    expect(loomwrightContribution.name).toBe("loomwright");
    expect(loomwrightContribution.tools).toEqual([capabilitiesTool]);
    expect(capabilitiesTool.name).toBe("kernel_loomwright_capabilities");
    expect(capabilitiesTool.shape).toEqual({});
    expect(capabilitiesTool.description).not.toMatch(/\n/);
    expect(SHIPPED_CONTRIBUTIONS[0]).toBe(loomwrightContribution);
  });

  it("the loomwright contribution registers its one tool and the version watcher's due work, and nothing else (no route, subcommand or handler)", () => {
    const merged = mergeContributions([loomwrightContribution], PHASE1_RESERVED);
    expect(merged.tools.map((t) => t.name)).toEqual(["kernel_loomwright_capabilities"]);
    expect(merged.routes).toEqual([]);
    expect(merged.subcommands).toEqual([]);
    expect(merged.handlers).toEqual({});
    expect(merged.dueWork.map((d) => d.owner)).toEqual(["loomwright"]);
    expect(merged.dueWork[0]?.run).toBe(versionWatchDueWork);
    expect(Object.keys(loomwrightContribution)).toEqual(["name", "tools", "dueWork"]);
  });

  it("reads the calling session's own install; no row or no recorded install, or a contract gone since, is an isError result", async () => {
    const dir = install();
    const other = install("renamedHostSwitch");
    const rows: Record<number, { loomwright_path: string | null }> = { 1: { loomwright_path: dir }, 2: { loomwright_path: other }, 3: { loomwright_path: null } };
    const ctx = (sessionId: number) => ({
      store: {} as Store,
      sessions: {
        getSession: (id: number) => rows[id] as ReturnType<ContributedToolContext["sessions"]["getSession"]>,
        stopSession: async () => "stopped" as const,
      } as unknown as ContributedToolContext["sessions"],
      sessionId,
    });
    const call = (sessionId: number): Promise<KernelToolResult> => contributedToolHandler(capabilitiesTool, ctx(sessionId))({});

    const one = await call(1);
    expect(one.isError).toBeUndefined();
    expect(JSON.parse(one.content[0]?.text ?? "null")).toEqual(expectedCapabilities(dir));
    const two = JSON.parse((await call(2)).content[0]?.text ?? "null") as { install_path: string; plugin_version: string };
    expect([two.install_path, two.plugin_version]).toEqual([other, "17.2.0-renamed-test"]);

    for (const id of [3, 99]) {
      expect(await call(id)).toEqual({
        content: [{ type: "text", text: `kernel_loomwright_capabilities: session ${id} has no recorded Loomwright install` }],
        isError: true,
      });
    }
    rmSync(join(dir, "capabilities.json"));
    expect(await call(1)).toEqual({ content: [{ type: "text", text: `Loomwright at ${dir}: capabilities.json missing` }], isError: true });
  });

  it("is reached through the kernel MCP server of a launched session, for that session's install", async () => {
    const pluginDir = install();
    const fakes = fakeSessions();
    const items = new Map<string, string>();
    const keychain: KeychainReader = { read: (service) => items.get(service) };
    const writer: KeychainWriter = { add: (service, _account, secret) => void items.set(service, secret) };
    let kernel: Kernel | undefined;
    try {
      kernel = await startKernel(
        { dataDir: join(tmp, "data"), env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: pluginDir, stopGraceMs: 10 } },
        {
          keychain,
          keychainWriter: writer,
          sessionDeps: fakes.deps,
          selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
          availableProviderIds: async () => ["api-key"],
        },
      );
      const { id: sessionId } = await kernel.sessions.startSession(startParams(tmp));
      await vi.waitFor(() => expect(fakes.calls).toHaveLength(1));
      const server = (fakes.calls[0]?.options.mcpServers as Record<string, { instance: unknown }> | undefined)?.kernel;
      const tools = (server?.instance as { _registeredTools: Record<string, { handler(args: unknown, extra: unknown): Promise<KernelToolResult> }> })._registeredTools;
      const result = await tools.kernel_loomwright_capabilities?.handler({}, {});
      expect(result?.isError).toBeUndefined();
      expect(kernel.sessions.getSession(sessionId)?.loomwright_path).toBe(pluginDir);
      const text = result?.content[0]?.text ?? "null";
      expect(JSON.parse(text)).toEqual(expectedCapabilities(pluginDir));
      expectOnlyInstallPath(text, pluginDir);
    } finally {
      await kernel?.stop();
    }
  });
});

describe("loomwrightManifestSummary (AC8)", () => {
  it("a header line, then agents, commands, skills and result schemas: names with their one-liners", () => {
    const contract = readLoomwrightContract(install());
    const raw = fixtureContract() as { commands: { name: string; description: string }[] };
    expect(loomwrightManifestSummary(contract).split("\n")).toEqual([
      "Loomwright 17.2.0 (contract 1)",
      "Agents: loomwright:code-reviewer; loomwright:rubric-grader; loomwright:worker",
      `Commands: ${raw.commands.map((c) => `${c.name} — ${c.description}`).join("; ")}`,
      "Skills: agent-output; error-handling; unit-testing",
      "Result schemas: AUTOMATE_RUN; CODE_REVIEW_RESULT; WORKER_RESULT",
    ]);
    const empty = { ...contract, agents: [], commands: [], skills: [], result_schemas: [] };
    expect(loomwrightManifestSummary(empty).split("\n").slice(1)).toEqual(["Agents: (none)", "Commands: (none)", "Skills: (none)", "Result schemas: (none)"]);
    // A name or description can never add a line.
    const sneaky = { ...contract, agents: [{ name: "a\nInjected: line", description: "b\n\nc" }] };
    expect(loomwrightManifestSummary(sneaky).split("\n")[1]).toBe("Agents: a Injected: line — b c");
  });

  it("is bounded to 4000 characters by default, ending in (truncated) when cut; an explicit maxChars bounds it too", () => {
    const contract = readLoomwrightContract(install());
    const big = {
      ...contract,
      commands: Array.from({ length: 500 }, (_, i) => ({ name: `command-${i}`, description: `Does thing number ${i} in a long sentence.` })),
    };
    const summary = loomwrightManifestSummary(big);
    expect(summary.length).toBeLessThanOrEqual(4000);
    expect(summary.length).toBeGreaterThan(3900);
    expect(summary.endsWith(MANIFEST_TRUNCATED_MARKER)).toBe(true);
    expect(summary.endsWith("(truncated)")).toBe(true);
    expect(summary.startsWith("Loomwright 17.2.0 (contract 1)\nAgents: ")).toBe(true);
    const small = loomwrightManifestSummary(big, { maxChars: 200 });
    expect(small.length).toBeLessThanOrEqual(200);
    expect(small.endsWith("(truncated)")).toBe(true);
    // Not cut when it fits: no marker.
    expect(loomwrightManifestSummary(contract)).not.toContain("(truncated)");
    // Never half a surrogate pair at the cut.
    const emoji = { ...contract, agents: Array.from({ length: 200 }, () => ({ name: "🧵", description: null })) };
    for (let max = 40; max < 60; max++) {
      const cut = loomwrightManifestSummary(emoji, { maxChars: max });
      expect(cut.length).toBeLessThanOrEqual(max);
      expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
    for (const bad of [0, 5, 1.5, Number.NaN]) expect(() => loomwrightManifestSummary(contract, { maxChars: bad })).toThrow(RangeError);
  });
});

// ---- The closed enumeration ---------------------------------------------------

describe("LoomwrightContractErrorReason (closed enumeration)", () => {
  it("every reason was thrown by a test above, and the status reasons are those plus status_threw", () => {
    expect([...seenReasons].sort()).toEqual([...LOOMWRIGHT_CONTRACT_ERROR_REASONS].sort());
    expect(LOOMWRIGHT_CONTRACT_ERROR_REASONS).toEqual([
      "contract_missing",
      "contract_unreadable",
      "contract_not_json",
      "contract_invalid",
      "contract_schema_too_old",
      "no_host_switch",
      "installed_plugins_missing",
      "installed_plugins_unreadable",
      "not_installed",
      "ambiguous_install",
      "install_path_invalid",
    ]);
    expect(LOOMWRIGHT_ADAPTER_STATUS_REASONS).toEqual([...LOOMWRIGHT_CONTRACT_ERROR_REASONS, "status_threw"]);
  });
});
