// Public surface of the kernel tools (item 07): the in-process SDK MCP server
// a session's brain uses as its levers (docs/ARCHITECTURE.md §Kernel tools).
export {
  KERNEL_MCP_SERVER_NAME,
  KERNEL_TOOL_NAMES,
  createKernelMcpServer,
  kernelToolDefinitions,
  kernelToolFullNames,
  kernelToolHandlers,
  kernelStepKey,
} from "./server.js";
export type { KernelToolContext, KernelToolHandler, KernelToolName, KernelToolResult } from "./server.js";
export { AGENT_DIR_PATTERN, HandoffPathError, UNASSIGNED_AGENT_DIR, handoffPath, renderHandoff, writeFileAtomic } from "./handoff.js";
export type { HandoffRef } from "./handoff.js";
