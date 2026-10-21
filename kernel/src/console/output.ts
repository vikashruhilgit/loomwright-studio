// The console's session-output part (phase 5 item 03): the bounded log of
// what each session said and did (`session_output`, migration 16), and the
// session output routes. Empty until item 03 fills it in; today
// `recordSessionOutput` is a no-op the kernel already calls for every SDK
// message (`SessionManagerOptions.onOutput`, wired in `kernel.ts`).
//
// Type-only imports of the SDK and the store: the `studio` CLI loads this
// module through the feature registry.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Store } from "../store/store.js";
import { emptyConsolePart } from "./types.js";
import type { ConsolePart } from "./types.js";

/**
 * Every `session_output.kind`, closed in code (migration 16 has no SQL
 * CHECK): a later item adds a kind here, never in SQL. The app's contract
 * (`app/src/api/contract.ts`) mirrors it as a union.
 */
export const SESSION_OUTPUT_KINDS = Object.freeze(["assistant_text", "tool_call", "tool_decision", "tool_result", "result", "system"] as const);
export type SessionOutputKind = (typeof SESSION_OUTPUT_KINDS)[number];

export function isSessionOutputKind(value: unknown): value is SessionOutputKind {
  return typeof value === "string" && (SESSION_OUTPUT_KINDS as readonly string[]).includes(value);
}

/**
 * Record one SDK message of session `sessionId` into `session_output`. A
 * no-op until item 03 fills it in: it reads nothing and writes nothing. The
 * session manager calls it for every message as its `onOutput` observer, so a
 * throw here is recorded as an `observer_error` event and never breaks the
 * session.
 */
export function recordSessionOutput(store: Store, sessionId: number, message: SDKMessage): void {
  void store;
  void sessionId;
  void message;
}

export const outputPart: ConsolePart = emptyConsolePart("output");
