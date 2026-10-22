// Every Toast and Band state its README and preview.html show, for unit tests
// and the component gallery. Contained and static: auto-dismiss is off
// (`duration={null}`), and the fixed ToastStack renders inside a frame with
// `position: relative; transform: translateZ(0)`, which contains its fixed
// children, so nothing escapes onto the page.
import type { ReactElement } from "react";
import { Band, Toast, ToastStack, type ToastItem } from "./Toast";

const noop = () => {};

const column = { display: "flex", flexDirection: "column", gap: "var(--space-2)", alignItems: "flex-start" } as const;
const frame = { position: "relative", transform: "translateZ(0)", width: "400px", height: "260px" } as const;

const stacked: ReadonlyArray<ToastItem> = [
  { id: "t1", status: { state: "failed", label: "denied" }, title: "Denied.", body: "Ada won't post on PR 401." },
  { id: "t2", status: { state: "idle", label: "stopped" }, title: "Session stopped.", body: "The task stays and can be resumed." },
  { id: "t3", status: { state: "ok", label: "allowed", verified: { at: "14:02" } }, title: "Allowed once.", body: "Mason posts the review now." },
  { id: "t4", status: { state: "waiting" }, title: "Ada is waiting on you.", body: "Post review on PR 405?", action: { label: "Review", onAction: noop } },
  {
    id: "t5",
    status: { state: "ok", label: "enabled", verified: { at: "14:03" } },
    title: "Playbook enabled.",
    body: "Mason picks up PR 412 in the next poll.",
    action: { label: "View", onAction: noop },
  },
];

export const states: ReadonlyArray<{ readonly id: string; readonly title: string; readonly render: () => ReactElement }> = [
  {
    id: "toasts",
    title: "Toasts: with an action, and plain",
    render: () => (
      <div style={column}>
        <Toast
          duration={null}
          status={{ state: "ok", label: "enabled", verified: { at: "14:03" } }}
          title="Playbook enabled."
          body="Mason picks up PR 412 in the next poll."
          action={{ label: "View", onAction: noop }}
          onDismiss={noop}
        />
        <Toast
          duration={null}
          status={{ state: "waiting" }}
          title="Ada is waiting on you."
          body="Post review on PR 405?"
          action={{ label: "Review", onAction: noop }}
          onDismiss={noop}
        />
        <Toast duration={null} status={{ state: "failed", label: "killed" }} title="Session killed." body="Its task is parked." onDismiss={noop} />
      </div>
    ),
  },
  {
    id: "stack",
    title: "Stack: at most three, older ones collapsed",
    render: () => (
      <div style={frame}>
        <ToastStack toasts={stacked} duration={null} onDismiss={noop} />
      </div>
    ),
  },
  {
    id: "band-danger",
    title: "Band, danger: kernel unreachable",
    render: () => (
      <Band tone="danger" action={{ label: "Kernel log", onAction: noop }}>
        Couldn't reach the kernel. It may be restarting; this window reconnects on its own.
      </Band>
    ),
  },
  {
    id: "band-parked",
    title: "Band, parked: paused at cap",
    render: () => (
      <Band tone="parked" action={{ label: "Show parked", onAction: noop }}>
        Paused at cap. 4 tasks parked until the weekly limit resets Thu 06:00.
      </Band>
    ),
  },
  {
    id: "band-attention",
    title: "Band, attention: approvals waiting",
    render: () => (
      <Band tone="attention" action={{ label: "Open Approvals", onAction: noop }}>
        3 approvals waiting on you.
      </Band>
    ),
  },
];
