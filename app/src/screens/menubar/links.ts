// Where a notification link lands (item 17). The main process sends only
// `notification/<id>` or `invalid-link` (`./state.ts`); for a notification the
// host reads `GET /notifications/:id` and this module maps the answer to an
// app route through a closed list. The answer is untrusted: every field is
// shape-checked, and anything the list does not name opens nothing.
//
// - `kernel:approval` whose title is the kernel's `Approval <id>: <action>`
//   (`kernel/src/approvals/store.ts`) -> `#/approvals/<id>`. The contract
//   carries no approval reference on a notification, so the id comes from the
//   kernel-authored title, and only for this source: agents can only post
//   `agent:<name>` sources (`kernel/src/notifications/tool.ts`), so an agent
//   cannot forge an approval link. Pinned by `./kernel-mirror.test.ts`.
// - `agent:<name>` -> that agent's thread (`#/chat` for Wright).
// - `trigger:<id>` -> `#/chat`, Wright's thread, where playbook cards appear
//   (the detail's `trigger` names no owning agent).
// - any other `kernel:<reason>` -> the app opens where it is, no toast.
// - a 404, a failed read, or any other shape -> one toast, nothing else.
//
// Plain functions: no component, no DOM access.
import type { ApiResult } from "../../api/contract";
import { threadHash } from "../chat/model";

/** The kernel's source for an approval's notification (`recordNotification` in `kernel/src/approvals/store.ts`). */
export const APPROVAL_SOURCE = "kernel:approval";

/** The kernel's approval-notification title, `Approval ${id}: ${action}`, anchored. */
export const APPROVAL_TITLE = /^Approval ([1-9][0-9]{0,15}): /;

const TRIGGER_SOURCE = /^trigger:[1-9][0-9]{0,15}$/;
const AGENT_PREFIX = "agent:";
const KERNEL_PREFIX = "kernel:";

/** The one toast a link that opens nothing shows. */
export const LINK_NOTHING_TITLE = "That notification link points to nothing Studio can open";

/** The route that opens approval `id` selected (`ApprovalsScreen`'s `#/approvals/<id>`). */
export function approvalHash(id: number): string {
  return `#/approvals/${id}`;
}

export type LinkTarget =
  /** Navigate the window to `hash`. */
  | { readonly kind: "open"; readonly hash: string }
  /** The window opens where it is; no toast. */
  | { readonly kind: "stay" }
  /** One toast, nothing else. */
  | { readonly kind: "nothing" };

const NOTHING: LinkTarget = Object.freeze({ kind: "nothing" });
const STAY: LinkTarget = Object.freeze({ kind: "stay" });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The approval id in a `kernel:approval` notification's title, or `undefined`. */
export function approvalIdFromTitle(title: string): number | undefined {
  const match = APPROVAL_TITLE.exec(title);
  const id = match === null ? Number.NaN : Number(match[1]);
  return Number.isSafeInteger(id) ? id : undefined;
}

/** Where `GET /notifications/:id`'s answer lands. `undefined` is a read that never reached the kernel. */
export function linkTarget(result: ApiResult<unknown> | undefined): LinkTarget {
  if (result === undefined || !result.ok) return NOTHING;
  const notification = isRecord(result.body) ? result.body.notification : undefined;
  if (!isRecord(notification)) return NOTHING;
  const { source, title } = notification;
  if (typeof source !== "string") return NOTHING;

  if (source === APPROVAL_SOURCE) {
    const id = typeof title === "string" ? approvalIdFromTitle(title) : undefined;
    return id === undefined ? NOTHING : { kind: "open", hash: approvalHash(id) };
  }
  if (source.startsWith(AGENT_PREFIX)) {
    const agent = source.slice(AGENT_PREFIX.length);
    return agent === "" ? NOTHING : { kind: "open", hash: threadHash(agent) };
  }
  if (TRIGGER_SOURCE.test(source)) return { kind: "open", hash: "#/chat" };
  if (source.startsWith(KERNEL_PREFIX) && source.length > KERNEL_PREFIX.length) return STAY;
  return NOTHING;
}
