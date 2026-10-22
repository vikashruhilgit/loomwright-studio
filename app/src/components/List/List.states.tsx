// Every List state its README and preview.html show, for unit tests and the
// component gallery. Contained and static: no portal, overlay or timer. Crew
// avatars are token-coloured placeholder circles: the Avatar component is a
// separate item and is never imported here. No dollar figures: limits are
// tokens and sessions on the subscription build.
import type { ReactElement } from "react";
import { CREW_EMPTY_TEXT, List, type ListCrewItem, type ListDataItem, type ListNavItem } from "./List";

const glyph = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function ChatIcon() {
  return (
    <svg {...glyph}>
      <path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12Z" />
    </svg>
  );
}
function TeamIcon() {
  return (
    <svg {...glyph}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20a6 6 0 0 1 12 0M15 19a4.5 4.5 0 0 1 7 0" />
    </svg>
  );
}
function ApprovalsIcon() {
  return (
    <svg {...glyph}>
      <path d="M4 6h16M4 12h10M4 18h7" />
    </svg>
  );
}
function SessionsIcon() {
  return (
    <svg {...glyph}>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M7 20h10M8 9l3 3-3 3M13 15h3" />
    </svg>
  );
}

function AvatarPlaceholder({ hue, name }: { readonly hue: string; readonly name: string }) {
  return (
    <span
      role="img"
      aria-label={name}
      style={{ display: "block", width: "24px", height: "24px", borderRadius: "var(--radius-full)", background: `var(${hue})` }}
    />
  );
}

export const navItems: readonly ListNavItem[] = [
  { kind: "nav", key: "chat", label: "Chat", icon: <ChatIcon />, kbd: "⌘1" },
  { kind: "nav", key: "team", label: "Team", icon: <TeamIcon />, kbd: "⌘2" },
  { kind: "nav", key: "approvals", label: "Approvals", icon: <ApprovalsIcon />, count: { value: 3, label: "3 pending" } },
  { kind: "nav", key: "sessions", label: "Sessions", icon: <SessionsIcon />, kbd: "⌘4" },
];

export const crewItems: readonly ListCrewItem[] = [
  {
    kind: "crew",
    key: "mason",
    name: "Mason",
    avatar: <AvatarPlaceholder hue="--crew-teal" name="Mason · waiting on you" />,
    unread: true,
    time: "14:08",
    lastLine: "Waiting on you · post review on PR 412",
  },
  {
    kind: "crew",
    key: "ada",
    name: "Ada",
    avatar: <AvatarPlaceholder hue="--crew-berry" name="Ada · idle" />,
    time: "09:41",
    lastLine: "Opened a worktree for the docs fix",
  },
];

export const dataItems: readonly ListDataItem[] = [
  { kind: "data", key: "s1", status: "working", subject: "Mason · review PR 412", meta: "running 4m 12s · 14.2k tokens", aside: "Sonnet 5" },
  { kind: "data", key: "s2", status: "working", subject: "Wright · triage comments on PR 398", meta: "running 0m 41s · 3.1k tokens", aside: "Opus 5.5" },
  { kind: "data", key: "s3", status: "waiting", subject: "Ada · post review on PR 405", meta: "waiting on you · approval pending", aside: "Sonnet 5" },
  {
    kind: "data",
    key: "s4",
    status: "ok",
    statusLabel: "done",
    verified: { at: "14:02" },
    subject: "Mason · review PR 401",
    meta: "done 14:02 · 22.8k tokens",
    aside: "Sonnet 5",
  },
  { kind: "data", key: "s5", status: "failed", statusLabel: "killed", subject: "Ada · rebase docs branch", meta: "killed 13:20 · 6.4k tokens", aside: "Sonnet 5" },
];

const frame = { width: "240px", padding: "var(--space-3) var(--space-2)", background: "var(--sidebar)" } as const;
const main = { width: "460px", padding: "var(--space-2) var(--space-3)", background: "var(--ground)" } as const;

export const states: ReadonlyArray<{ readonly id: string; readonly title: string; readonly render: () => ReactElement }> = [
  {
    id: "sidebar",
    title: "Sidebar navigation rows with a selected row, kbd shortcuts and the count pill",
    render: () => (
      <div style={frame}>
        <List label="Screens" items={navItems} defaultSelectedKey="sessions" />
      </div>
    ),
  },
  {
    id: "crew",
    title: "Crew rows: avatar, name with unread dot, time and last line",
    render: () => (
      <div style={frame}>
        <List label="Crew" heading="Crew" items={crewItems} />
      </div>
    ),
  },
  {
    id: "crew-empty",
    title: "Empty Crew group",
    render: () => (
      <div style={frame}>
        <List label="Crew" heading="Crew" items={[]} emptyText={CREW_EMPTY_TEXT} />
      </div>
    ),
  },
  {
    id: "data",
    title: "Data rows: a session list with a selected row",
    render: () => (
      <div style={main}>
        <List label="Sessions" items={dataItems} defaultSelectedKey="s1" />
      </div>
    ),
  },
  {
    id: "loading",
    title: "Loading: skeleton rows at the real row heights",
    render: () => (
      <div style={{ display: "flex", gap: "var(--space-6)", alignItems: "flex-start" }}>
        <div style={frame}>
          <List label="Screens" items={[]} loading skeletonKind="nav" skeletonRows={4} />
          <List label="Crew" heading="Crew" items={[]} loading skeletonKind="crew" skeletonRows={2} />
        </div>
        <div style={main}>
          <List label="Sessions" items={[]} loading skeletonKind="data" skeletonRows={3} />
        </div>
      </div>
    ),
  },
];
