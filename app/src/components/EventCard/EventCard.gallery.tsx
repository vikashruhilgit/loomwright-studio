// EventCard gallery: every README / preview.html state with canned data, for
// the conversation evidence page (subtask 4). Never imported by App.tsx.
import type { ReactElement } from "react";
import { EventCard, type EventCardApprovalProps } from "./EventCard";

const noop = () => undefined;
const XSS = "<img src=x onerror=alert(1)>";

const approval: EventCardApprovalProps = {
  variant: "approval",
  approval: {
    id: "ap-412",
    requestingAgent: "mason",
    title: "Post review on loomwright #412",
    summary: "A review that requests changes: 1 blocking, 2 nits.",
    reason: "Playbook approval level: ask before posting each review.",
  },
  threadAgent: "mason",
  onAllowOnce: noop,
  onAlways: noop,
  onDeny: noop,
  onFullPayload: noop,
};

export const galleryStates: readonly { id: string; title: string; element: ReactElement }[] = [
  {
    id: "session-started",
    title: "Event · session started",
    element: <EventCard variant="event" event={{ kind: "session", before: "Session started · review PR #401 · playbook ", subject: "Review PRs where I'm requested", time: "13:40", target: "session:401" }} onOpen={noop} />,
  },
  {
    id: "session-killed",
    title: "Event · session killed",
    element: <EventCard variant="event" event={{ kind: "session", before: "Session killed · ", subject: "review PR #398", after: " · by you", time: "13:52", target: "session:398" }} onOpen={noop} />,
  },
  {
    id: "memory-updated",
    title: "Event · memory updated (path in mono)",
    element: <EventCard variant="event" event={{ kind: "memory", before: "Updated ", subject: "memory/mason/lessons.md", after: ': "command hooks block via decision, not ok"', time: "14:02", target: "file:memory/mason/lessons.md" }} onOpen={noop} />,
  },
  {
    id: "playbook-created",
    title: "Event · playbook created",
    element: <EventCard variant="event" event={{ kind: "playbook", before: "Created playbook ", subject: "Review PRs where I'm requested", after: " · runs as Mason", time: "14:07", target: "playbook:review-prs" }} onOpen={noop} />,
  },
  {
    id: "agent-renamed",
    title: "Event · agent renamed",
    element: <EventCard variant="event" event={{ kind: "agent", before: "Renamed builder to ", subject: "Mason", time: "14:10", target: "agent:mason" }} onOpen={noop} />,
  },
  {
    id: "approval-decided",
    title: "Event · approval decided",
    element: <EventCard variant="event" event={{ kind: "approval", before: "You allowed once · ", subject: "Post review on loomwright #409", time: "14:15", target: "approval:ap-409" }} onOpen={noop} />,
  },
  {
    id: "hook-verified",
    title: "Event · hook applied and verified",
    element: <EventCard variant="event" event={{ kind: "hook", before: "Hook applied and verified · ", subject: ".claude/settings.json", after: " · SubagentStop", time: "14:21", target: "file:.claude/settings.json" }} onOpen={noop} />,
  },
  {
    id: "approval-inline",
    title: "Inline approval · waiting on you",
    element: <EventCard {...approval} />,
  },
  {
    id: "approval-other-agent",
    title: "Inline approval · another agent's (renders nothing)",
    element: <EventCard {...approval} threadAgent="wright" />,
  },
  {
    id: "untrusted-text",
    title: "Untrusted text stays inert",
    element: (
      <>
        <EventCard variant="event" event={{ kind: "session", before: `${XSS} `, subject: XSS, time: "15:00", target: "session:x" }} onOpen={noop} />
        <EventCard {...approval} approval={{ ...approval.approval, id: "ap-x", title: XSS, summary: XSS, reason: XSS }} />
      </>
    ),
  },
];
