// Every Badge-family state its README and preview.html show, for unit tests
// and the component gallery. Contained and static: no portal, overlay or timer.
// The agent chip's avatar is a token-coloured placeholder circle: the Avatar
// component is a separate item and is never imported here.
import type { ReactElement } from "react";
import { Badge, Chip, CountPill, Kbd, Mono } from "./Badge";

const glyph = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function CheckIcon() {
  return (
    <svg {...glyph}>
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg {...glyph}>
      <path d="M9 5v14M15 5v14" />
    </svg>
  );
}

function AvatarPlaceholder() {
  return (
    <span
      role="img"
      aria-label="Mason · idle"
      style={{ display: "block", width: "14px", height: "14px", borderRadius: "var(--radius-full)", background: "var(--crew-teal)" }}
    />
  );
}

const row = { display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" } as const;

export const states: ReadonlyArray<{ readonly id: string; readonly title: string; readonly render: () => ReactElement }> = [
  {
    id: "semantic",
    title: "Semantic tones",
    render: () => (
      <div style={row}>
        <Badge tone="ok" icon={<CheckIcon />}>
          CI green
        </Badge>
        <Badge tone="ok">merged</Badge>
        <Badge tone="attention">waiting on you</Badge>
        <Badge tone="attention">1/2 approvals</Badge>
        <Badge tone="danger">denied</Badge>
        <Badge tone="danger">over budget</Badge>
        <Badge tone="parked" icon={<PauseIcon />}>
          paused at cap
        </Badge>
        <Badge tone="accent">working</Badge>
      </div>
    ),
  },
  {
    id: "neutral",
    title: "Neutral",
    render: () => (
      <div style={row}>
        <Badge>draft</Badge>
        <Badge>Sonnet 5</Badge>
      </div>
    ),
  },
  {
    id: "count-pill",
    title: "Count pill",
    render: () => (
      <div style={row}>
        <span>
          Approvals <CountPill count={3} aria-label="3 pending" />
        </span>
        <span>
          Approvals <CountPill count={12} aria-label="12 pending" />
        </span>
      </div>
    ),
  },
  {
    id: "chips",
    title: "Chips: agent and linked PR",
    render: () => (
      <div style={row}>
        <Chip avatar={<AvatarPlaceholder />}>Mason</Chip>
        <Chip>vikashruhilgit/loomwright PR 412</Chip>
      </div>
    ),
  },
  {
    id: "kbd-mono",
    title: "Kbd and mono",
    render: () => (
      <div style={row}>
        <Mono>{"{pr.head_sha}"}</Mono>
        <span>
          <Kbd>⌘</Kbd> <Kbd>K</Kbd>
        </span>
        <Kbd>⇧A</Kbd>
      </div>
    ),
  },
];
