// Team's ⌘K commands (AC8): owner `team`, ids prefixed `team.`. Registered
// while the Team screen is mounted and unregistered on unmount (the shell
// renders only the current screen), through the registry's own unregister.
// Each command calls the same handler as its button, so both reach the same
// route. Grant GitHub and Revoke GitHub (phase 6 item 08) are registered for
// every agent, Wright included. Wright's are `enabled` by the roster: grant while
// it holds no GitHub, revoke while it does, neither while the roster did not
// report it. A crew member also has Grant GitHub write (phase 8 item 20), and
// all three are `enabled` by its known level (`githubLevel`, from its detail):
// grant (read) at None or Write, revoke at Read or Write, write at None or Read,
// none while the level is unknown. A command that cannot run now is absent (Wright has no rename, off
// or on: the kernel refuses them `reserved`) or `enabled: () => false` (on for
// an active member, off for one already off). Team never registers "Message
// <agent>": that is Chat's (item 13); its thread command opens `#/chat`.
import { useEffect, useRef } from "react";
import type { RosterEntry } from "../../api/contract";
import type { Command, CommandRegistry } from "../../commands/registry";
import type { GithubLevel } from "./Connectors";
import { githubGranted, isWright, orderRoster } from "./model";

const NO_LEVELS: GithubLevels = new Map();

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
  /** Set the agent's GitHub level: the one handler Grant GitHub (read), Revoke GitHub (none) and Grant GitHub write call. */
  readonly setGithub: (agent: RosterEntry, level: GithubLevel) => void | Promise<void>;
}

/** Each crew member's known GitHub level by id; an id with no entry, or undefined, is unknown. Wright is never in it. */
export type GithubLevels = ReadonlyMap<string, GithubLevel | undefined>;

/** Team's commands for `agents`: New crew member, then each agent's Rename, Set a field, Turn on, Turn off, the GitHub commands and Open thread. */
export function teamCommands(agents: readonly RosterEntry[], handlers: TeamCommandHandlers, levels: GithubLevels = new Map()): Command[] {
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
    // Wright's two commands follow the roster; a crew member's follow its level, and unknown enables none.
    const level = lead ? undefined : levels.get(agent.id);
    commands.push({
      id: `team.grant-github.${agent.id}`,
      title: `Grant GitHub to ${name}`,
      group: TEAM_GROUP,
      keywords: [agent.id, "connector", "access"],
      enabled: () => (lead ? githubGranted(agent) === false : level === "none" || level === "write"),
      run: () => handlers.setGithub(agent, "read"),
    });
    commands.push({
      id: `team.revoke-github.${agent.id}`,
      title: `Revoke GitHub from ${name}`,
      group: TEAM_GROUP,
      keywords: [agent.id, "connector", "access"],
      enabled: () => (lead ? githubGranted(agent) === true : level === "read" || level === "write"),
      run: () => handlers.setGithub(agent, "none"),
    });
    if (!lead) {
      commands.push({
        id: `team.github-write.${agent.id}`,
        title: `Grant GitHub write to ${name}`,
        group: TEAM_GROUP,
        keywords: [agent.id, "connector", "access", "push", "comment"],
        enabled: () => level === "none" || level === "read",
        run: () => handlers.setGithub(agent, "write"),
      });
    }
    commands.push({ id: `team.thread.${agent.id}`, title: `Open thread with ${name}`, group: TEAM_GROUP, keywords: [agent.id, "chat"], run: () => handlers.openThread(agent) });
  }
  return commands;
}

/** What changes a command's id, title or `enabled`: re-register only then. A grant change flips Grant, Revoke and Write, so `connectors` and the known level are part of it. */
function rosterKey(agents: readonly RosterEntry[], levels: GithubLevels): string {
  return JSON.stringify(agents.map((a) => [a.id, a.display_name, a.status, a.connectors ?? null, levels.get(a.id) ?? null]));
}

/**
 * Register Team's commands with `registry` for the caller's lifetime, and
 * again (old ones first unregistered) whenever an agent's id, name, status,
 * `connectors` or known GitHub level changes. The handlers are read through a ref,
 * so a new closure each render never re-registers.
 */
export function useTeamCommands(registry: CommandRegistry, agents: readonly RosterEntry[], handlers: TeamCommandHandlers, levels: GithubLevels = NO_LEVELS): void {
  const latest = useRef({ agents, handlers, levels });
  latest.current = { agents, handlers, levels };
  const key = rosterKey(agents, levels);
  useEffect(() => {
    const forward: TeamCommandHandlers = {
      newCrewMember: () => latest.current.handlers.newCrewMember(),
      rename: (agent) => latest.current.handlers.rename(agent),
      setField: (agent) => latest.current.handlers.setField(agent),
      turn: (agent, to) => latest.current.handlers.turn(agent, to),
      openThread: (agent) => latest.current.handlers.openThread(agent),
      setGithub: (agent, level) => latest.current.handlers.setGithub(agent, level),
    };
    return registry.register(TEAM_OWNER, teamCommands(latest.current.agents, forward, latest.current.levels));
  }, [registry, key]);
}
