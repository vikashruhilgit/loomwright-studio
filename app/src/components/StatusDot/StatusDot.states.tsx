// Every StatusDot state its README and preview.html show, for unit tests and
// the component gallery. Contained and static: no portal, overlay or timer
// (the working dot's breathing is CSS and stops under reduced motion).
import type { ReactElement } from "react";
import { StatusDot } from "./StatusDot";

const row = { display: "flex", gap: "var(--space-6)", alignItems: "center", flexWrap: "wrap" } as const;

export const states: ReadonlyArray<{ readonly id: string; readonly title: string; readonly render: () => ReactElement }> = [
  {
    id: "kernel-states",
    title: "The four kernel states",
    render: () => (
      <div style={row}>
        <StatusDot state="idle" />
        <StatusDot state="working" meta="2 sessions" />
        <StatusDot state="waiting" meta="3" />
        <StatusDot state="paused" meta="resets Thu 06:00" />
      </div>
    ),
  },
  {
    id: "outcomes",
    title: "Verified outcomes",
    render: () => (
      <div style={row}>
        <StatusDot state="ok" label="CI green" verified={{ at: "14:02" }} />
        <StatusDot state="failed" label="killed" />
        <StatusDot state="failed" label="denied" />
      </div>
    ),
  },
  {
    id: "guess",
    title: "Unverified ok is a guess: no dot",
    render: () => (
      <div style={row}>
        <StatusDot state="ok" label="probably merged" />
      </div>
    ),
  },
  {
    id: "dot-only",
    title: "Dot only, word as aria-label (menu bar)",
    render: () => (
      <div style={row}>
        <StatusDot state="idle" hideLabel />
        <StatusDot state="working" hideLabel />
        <StatusDot state="waiting" hideLabel meta="3" />
        <StatusDot state="paused" hideLabel />
      </div>
    ),
  },
];
