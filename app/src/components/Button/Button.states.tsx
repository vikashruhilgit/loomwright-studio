// Every Button state its README and preview.html show, for unit tests and the
// component gallery. Contained and static: no portal, overlay or timer.
import type { ReactElement } from "react";
import { Button } from "./Button";

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

const row = { display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" } as const;

export const states: ReadonlyArray<{ readonly id: string; readonly title: string; readonly render: () => ReactElement }> = [
  {
    id: "variants",
    title: "Variants, standalone (32px)",
    render: () => (
      <div style={row}>
        <Button variant="primary" kbd="⏎">
          Enable playbook
        </Button>
        <Button variant="secondary">Edit in English</Button>
        <Button variant="ghost" icon={<PlusIcon />}>
          New agent
        </Button>
        <Button variant="danger" kbd="⌘⇧K">
          Kill
        </Button>
      </div>
    ),
  },
  {
    id: "row-size",
    title: "Inside a row (28px)",
    render: () => (
      <div style={row}>
        <Button variant="primary" size="row" kbd="A">
          Allow once
        </Button>
        <Button variant="secondary" size="row" kbd="⇧A">
          Always for this playbook
        </Button>
        <Button variant="ghost" size="row" kbd="D">
          Deny
        </Button>
      </div>
    ),
  },
  {
    id: "loading",
    title: "Loading",
    render: () => (
      <div style={row}>
        <Button variant="primary" size="row" loading>
          Dry-running…
        </Button>
        <Button variant="secondary" icon={<PlusIcon />} loading>
          New agent
        </Button>
      </div>
    ),
  },
  {
    id: "disabled",
    title: "Disabled",
    render: () => (
      <div style={row}>
        <Button variant="secondary" size="row" disabled>
          Stop
        </Button>
        <Button variant="primary" disabled>
          Enable playbook
        </Button>
      </div>
    ),
  },
];
