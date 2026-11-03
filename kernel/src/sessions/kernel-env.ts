// The variables the kernel itself may set in a session's environment, apart
// from the auth provider's and the Loomwright host switch's: the tool deferral
// switch in every session, and the GitHub names in a live, write-granted
// session only (`github-session-auth.ts`). Dependency-free:
// the contract validator (`loomwright/contract.ts`, loaded by the `studio`
// CLI) imports it to refuse a host switch that names one of them.
import type { ChildEnv } from "../auth/types.js";

/**
 * The Agent SDK's tool deferral, turned off on every launch (a start and
 * every resume attempt). With deferral on, the bundled CLI offers MCP tools
 * only through its `ToolSearch` meta-tool, which no policy lists, so the gate
 * denies the load and the session can call none of its kernel tools. With it
 * off, every tool is offered from the start and the gate decides each call by
 * its exact name, so the policy stays exactly the user's list. Undocumented in
 * the SDK's types: probed on 0.3.284 (docs/evidence/agent-sdk-tool-loading-probe.md).
 * Spread last, after the auth env and the host switch, so a variable inherited
 * from the daemon's environment cannot turn it back on; a contract whose host
 * switch names it is refused (`isKernelSessionEnvVar`).
 */
export const TOOL_DEFERRAL_OFF: Readonly<ChildEnv> = Object.freeze({ ENABLE_TOOL_SEARCH: "false" });

/**
 * The fixed names the kernel sets in a live, write-granted session's
 * environment (phase 8 item 04), beside the `GIT_CONFIG_` family
 * (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n`, `GIT_CONFIG_VALUE_n`): `gh`'s config
 * dir, where the session's token file is read from, and the switch that stops
 * git asking for a password on a terminal. Never `GH_TOKEN`.
 */
export const GITHUB_SESSION_ENV_NAMES: readonly string[] = Object.freeze(["GH_CONFIG_DIR", "GIT_TERMINAL_PROMPT"]);

/** The prefix of the git config-from-env family the kernel sets in a live, write-granted session. */
const GIT_CONFIG_ENV_PREFIX = "GIT_CONFIG_";

/** Every name the kernel may set in a session's environment. A contract may never name one. */
const KERNEL_SESSION_ENV_NAMES: ReadonlySet<string> = new Set([...Object.keys(TOOL_DEFERRAL_OFF), ...GITHUB_SESSION_ENV_NAMES]);

/** Whether the kernel may set `name` in a session's environment (the tool deferral switch everywhere, the GitHub names in a live, write-granted session). */
export function isKernelSessionEnvVar(name: string): boolean {
  return KERNEL_SESSION_ENV_NAMES.has(name) || name.startsWith(GIT_CONFIG_ENV_PREFIX);
}
