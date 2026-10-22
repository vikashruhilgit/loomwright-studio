// Every Card state its README and preview.html show, for unit tests and the
// component gallery. Contained and static: no portal, overlay or timer.
// Avatars are token-coloured placeholder circles: the Avatar component is a
// separate item and is never imported here. Budgets are tokens, never dollars.
import type { ReactElement } from "react";
import { Chip } from "../Badge/Badge";
import { AgentCard, CardGrid, TaskCard } from "./Card";

function AvatarPlaceholder({ hue, name }: { readonly hue: string; readonly name: string }) {
  return (
    <span
      role="img"
      aria-label={name}
      style={{ display: "block", width: "36px", height: "36px", borderRadius: "var(--radius-full)", background: `var(${hue})` }}
    />
  );
}

const grid = { maxWidth: "820px" } as const;

export const states: ReadonlyArray<{ readonly id: string; readonly title: string; readonly render: () => ReactElement }> = [
  {
    id: "agent-cards",
    title: "Agent cards from the Team screen: working, waiting on you and idle",
    render: () => (
      <div style={grid}>
        <CardGrid label="Team">
          <AgentCard
            avatar={<AvatarPlaceholder hue="--accent" name="Wright · working" />}
            name="Wright"
            role="Lead · plans, delegates, writes playbooks"
            task="Triaging comments on PR 398"
            taskState="working"
            budget={{ used: 142_000, limit: 375_000, period: "today" }}
            model="Opus 5.5"
          />
          <AgentCard
            avatar={<AvatarPlaceholder hue="--crew-teal" name="Mason · waiting on you" />}
            name="Mason"
            role="Reviewer · comments only, can't push"
            task="Waiting on you · post review on PR 412"
            taskState="waiting"
            budget={{ used: 98_000, limit: 160_000, period: "today" }}
            model="Sonnet 5"
          />
          <AgentCard
            avatar={<AvatarPlaceholder hue="--crew-berry" name="Ada · idle" />}
            name="Ada"
            role="Builder · writes in worktrees only"
            task="idle · last ran 09:41"
            taskState="idle"
            budget={{ used: 9_000, limit: 225_000, period: "today" }}
            model="Sonnet 5"
          />
        </CardGrid>
      </div>
    ),
  },
  {
    id: "agent-limits",
    title: "Budget at 80% or more turns the meter attention; a long name and role clamp",
    render: () => (
      <div style={grid}>
        <CardGrid label="Team">
          <AgentCard
            avatar={<AvatarPlaceholder hue="--crew-olive" name="Quill · working" />}
            name="Quill"
            role="Docs writer · edits docs only, can't push"
            task="Rewriting the setup guide"
            taskState="working"
            budget={{ used: 182_000, limit: 210_000, period: "today" }}
            model="Sonnet 5"
          />
          <AgentCard
            avatar={<AvatarPlaceholder hue="--crew-sky" name="Wren · paused at cap" />}
            name="Wren the release-notes specialist for every repository"
            role="Release notes · reads merged PRs, drafts notes, never publishes, never tags, never pushes to any branch"
            task="Paused at cap until the budget resets tomorrow at 06:00, with three merged PRs still waiting for notes"
            taskState="paused"
            budget={{ used: 250_000, limit: 250_000, period: "today" }}
            model="Sonnet 5"
          />
        </CardGrid>
      </div>
    ),
  },
  {
    id: "task-card",
    title: "Task card: subject, linked chips and a state line of verified facts",
    render: () => (
      <div style={grid}>
        <CardGrid label="Board">
          <TaskCard
            subject="Review the onboarding flow"
            chips={
              <>
                <Chip>loomwright PR 412</Chip>
                <Chip>STU-118</Chip>
              </>
            }
            facts={[{ label: "1/2 approvals" }, { label: "CI green", tone: "ok" }, { label: "waiting on Mason", tone: "attention" }]}
          />
          <TaskCard subject="Draft the release notes" facts={[{ label: "not started" }]} />
        </CardGrid>
      </div>
    ),
  },
];
