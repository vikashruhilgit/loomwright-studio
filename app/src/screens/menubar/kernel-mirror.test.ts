// The menu bar's mirror of kernel facts the contract does not carry. Each is
// read from the kernel's own source, so a kernel change the app does not
// follow fails here instead of a notification link opening the wrong thing:
//
// - the approval notification's source and title template
//   (`recordNotification` in `kernel/src/approvals/store.ts`): the app reads
//   the approval id from that title, because `GET /notifications/:id`
//   carries no approval reference (a finding in the evidence README);
// - the notification link prefix (`DEEP_LINK_PREFIX` in
//   `kernel/src/notifications/record.ts`), which `parseDeepLink` accepts;
// - that an agent's notification is always an `agent:` source
//   (`kernel/src/notifications/tool.ts`), so no agent can post a
//   `kernel:approval` notification whose title the app would trust;
// - the closed set of delivery statuses (`NOTIFICATION_STATUSES` in
//   `kernel/src/notifications/record.ts`), each of which the panel's Recent
//   list gives its own dot (`DELIVERY_DOTS`).
import { describe, expect, it } from "vitest";
import { APPROVAL_SOURCE, approvalHash, approvalIdFromTitle, linkTarget } from "./links";
import { DELIVERY_DOTS } from "./MenubarPanel";
import { DEEP_LINK_PREFIX, parseDeepLink } from "./state";

// The kernel's files are read from disk (`process.getBuiltinModule`: the
// renderer's tsconfig has no Node types), as in the approvals mirror.
interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
}
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): NodeFs } }).process.getBuiltinModule("node:fs");
const here = (import.meta as unknown as { dirname: string }).dirname;
const KERNEL = `${here}/../../../../kernel/src`;
const approvalsStore = nodeFs.readFileSync(`${KERNEL}/approvals/store.ts`, "utf8");
const notificationRecord = nodeFs.readFileSync(`${KERNEL}/notifications/record.ts`, "utf8");
const notificationTool = nodeFs.readFileSync(`${KERNEL}/notifications/tool.ts`, "utf8");

/** The approval notification the kernel records: `{ source: "…", title: clip(`…`, 199), …}`. */
const APPROVAL_NOTIFICATION = /recordNotification\(\s*store,\s*\{\s*source: "([^"]+)",\s*title: clip\(`([^`]*)`, 199\),/;

function kernelApprovalNotification(): { readonly source: string; readonly template: string } {
  const match = APPROVAL_NOTIFICATION.exec(approvalsStore);
  expect(match, "kernel/src/approvals/store.ts records the approval's notification").not.toBeNull();
  return { source: match?.[1] ?? "", template: match?.[2] ?? "" };
}

/** The kernel's template with `${id}` and `${action}` filled in, as the kernel would. */
function fill(template: string, id: number, action: string): string {
  return template.replaceAll("${id}", String(id)).replaceAll("${action}", action);
}

describe("the kernel mirror", () => {
  it("the approval notification's source is the one the app trusts", () => {
    expect(kernelApprovalNotification().source).toBe(APPROVAL_SOURCE);
  });

  it("the approval notification's title is `Approval ${id}: ${action}`, and the app reads its id back", () => {
    const { template } = kernelApprovalNotification();
    expect(template).toBe("Approval ${id}: ${action}");
    for (const [id, action] of [
      [7, "Bash"],
      [1234567, "kernel_agent_create"],
      [42, "Approval 9: a lookalike inside the action"],
    ] as const) {
      expect(approvalIdFromTitle(fill(template, id, action))).toBe(id);
      const answer = { ok: true as const, status: 200, body: { notification: { source: APPROVAL_SOURCE, title: fill(template, id, action) } } };
      expect(linkTarget(answer)).toEqual({ kind: "open", hash: approvalHash(id) });
    }
  });

  it("the link prefix is the kernel's, and a link it builds parses", () => {
    const kernel = /export const DEEP_LINK_PREFIX = "([^"]+)";/.exec(notificationRecord)?.[1];
    expect(kernel).toBe(DEEP_LINK_PREFIX);
    expect(parseDeepLink(`${kernel ?? ""}7`)).toEqual({ kind: "notification", id: 7 });
  });

  it("the Recent list's delivery statuses are exactly the kernel's closed set", () => {
    const list = /export const NOTIFICATION_STATUSES = \[([^\]]*)\] as const;/.exec(notificationRecord)?.[1];
    expect(list, "kernel/src/notifications/record.ts declares NOTIFICATION_STATUSES").toBeDefined();
    const kernel = [...(list ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(kernel.length).toBeGreaterThan(0);
    expect(Object.keys(DELIVERY_DOTS).sort()).toEqual(kernel);
  });

  it("an agent's notification is always an `agent:` source", () => {
    expect(notificationTool).toMatch(/const source = `agent:\$\{/);
    expect(notificationTool).not.toMatch(/kernel:approval/);
  });
});
