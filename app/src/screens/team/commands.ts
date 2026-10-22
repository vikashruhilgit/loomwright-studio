// Team's ⌘K commands (AC8): owner `team`, ids prefixed `team.`. Registered
// while the Team screen is mounted and unregistered on unmount (the shell
// renders only the current screen), through the registry's own unregister.
// Each command calls the same handler as its button, so both reach the same
// route. A command that cannot run now is absent (Wright has no rename, off
// or on: the kernel refuses them `reserved`) or `enabled: () => false` (on for
// an active member, off for one already off). Team never registers "Message
// <agent>": that is Chat's (item 13); its thread command opens `#/chat`.
import { useEffect, useRef } from "react";
import type { RosterEntry } from "../../api/contract";
import type { Command, CommandRegistry } from "../../commands/registry";
import { isWright, orderRoster } from "./model";

/** The registry owner every Team command is registered under. */
export const TEAM_OWNER = "team";

/** The palette group Team's commands appear under. */
export const TEAM_GROUP = "Team";

/** What each command does: the same handlers the screen's buttons call. */
export interface TeamCommandHandlers {
  readonly newCrewMember: () => void;
  readonly rename: (agent: RosterEntry) => void;
  readonly setField: (agent: RosterEntry) => void;
  readonly turn: (agent: RosterEntry, to: "on" | "off") => void | Promise<void>;
  readonly openThread: (agent: RosterEntry) => void;
}

/** Team's commands for `agents`: New crew member, then each agent's Rename, Set a field, Turn on, Turn off and Open thread. */
export function teamCommands(agents: readonly RosterEntry[], handlers: TeamCommandHandlers): Command[] {
  const commands: Command[] = [
    { id: "team.new-crew-member", title: "New crew member", group: TEAM_GROUP, keywords: ["create", "agent", "charter"], run: () => handlers.newCrewMember() },
  ];
  for (const agent of orderRoster(agents)) {
    const name = agent.display_name;
    const lead = isWright(agent);
    if (!lead) {
      commands.push({ id: `team.rename.${agent.id}`, title: `Rename ${name}`, group: TEAM_GROUP, keywords: [agent.id], run: () => handlers.rename(agent) });
    }
    commands.push({ id: `team.set.${agent.id}`, title: `Set a field of ${name}`, group: TEAM_GROUP, keywords: [agent.id, "model", "effort", "limit"], run: () => handlers.setField(agent) });
    if (!lead) {
      commands.push({
        id: `team.on.${agent.id}`,
        title: `Turn on ${name}`,
        group: TEAM_GROUP,
        keywords: [agent.id],
        enabled: () => agent.status === "off",
        run: () => handlers.turn(agent, "on"),
      });
      commands.push({
        id: `team.off.${agent.id}`,
        title: `Turn off ${name}`,
        group: TEAM_GROUP,
        keywords: [agent.id],
        enabled: () => agent.status === "active",
        run: () => handlers.turn(agent, "off"),
      });
    }
    commands.push({ id: `team.thread.${agent.id}`, title: `Open thread with ${name}`, group: TEAM_GROUP, keywords: [agent.id, "chat"], run: () => handlers.openThread(agent) });
  }
  return commands;
}

/** What changes a command's id, title or `enabled`: re-register only then. */
function rosterKey(agents: readonly RosterEntry[]): string {
  return JSON.stringify(agents.map((a) => [a.id, a.display_name, a.status]));
}

/**
 * Register Team's commands with `registry` for the caller's lifetime, and
 * again (old ones first unregistered) whenever an agent's id, name or status
 * changes. The handlers are read through a ref, so a new closure each render
 * never re-registers.
 */
export function useTeamCommands(registry: CommandRegistry, agents: readonly RosterEntry[], handlers: TeamCommandHandlers): void {
  const latest = useRef({ agents, handlers });
  latest.current = { agents, handlers };
  const key = rosterKey(agents);
  useEffect(() => {
    const forward: TeamCommandHandlers = {
      newCrewMember: () => latest.current.handlers.newCrewMember(),
      rename: (agent) => latest.current.handlers.rename(agent),
      setField: (agent) => latest.current.handlers.setField(agent),
      turn: (agent, to) => latest.current.handlers.turn(agent, to),
      openThread: (agent) => latest.current.handlers.openThread(agent),
    };
    return registry.register(TEAM_OWNER, teamCommands(latest.current.agents, forward));
  }, [registry, key]);
}
