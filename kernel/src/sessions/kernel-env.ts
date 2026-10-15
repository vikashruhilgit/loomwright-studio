// The variables the kernel itself sets in every session's environment, apart
// from the auth provider's and the Loomwright host switch's. Dependency-free:
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

/** Every name the kernel sets in every session's environment. A contract may never name one. */
const KERNEL_SESSION_ENV_NAMES: ReadonlySet<string> = new Set(Object.keys(TOOL_DEFERRAL_OFF));

/** Whether the kernel sets `name` in every session's environment. */
export function isKernelSessionEnvVar(name: string): boolean {
  return KERNEL_SESSION_ENV_NAMES.has(name);
}
