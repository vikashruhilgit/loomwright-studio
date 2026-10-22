// The ⌘K commands Chat registers (from the always-mounted Crew section, so
// they exist on every screen). Every id starts `chat.` and is built from a
// kernel id, so two commands never share one (the registry throws if they do).
//
// Titles carry kernel text (a slug, a trigger's text, a notification's title):
// the palette renders a title as a text child, and nothing here acts on it.
import type { NotificationRow, PlaybookListing, RosterEntry, StudioBridge, Trigger } from "../../api/contract";
import type { Command } from "../../commands/registry";
import { WRIGHT, inFlightGuard, navigate, requestComposerFocus, specialists, threadHash, write } from "./model";
import type { InFlightGuard } from "./model";

/** How many recent notifications get a command. */
export const NOTIFICATION_COMMANDS = 20;

export const PRIORITIES = ["high", "normal", "low"] as const;

export interface ChatCommandSources {
  readonly api: StudioBridge;
  readonly roster: readonly RosterEntry[] | undefined;
  readonly playbooks: readonly PlaybookListing[] | undefined;
  readonly triggers: readonly Trigger[] | undefined;
  readonly notifications: readonly NotificationRow[] | undefined;
  /** Where a command's refusal is shown (the Crew section's status line). */
  readonly onNotice: (text: string) => void;
}

/** The thread a notification opens: `agent:<x>` for a roster `x`, else Wright's. */
export function notificationThread(source: string, roster: readonly RosterEntry[] | undefined): string {
  const agent = /^agent:(.+)$/.exec(source)?.[1];
  if (agent !== undefined && (roster ?? []).some((a) => a.id === agent)) return threadHash(agent);
  return threadHash(WRIGHT);
}

function ask(id: string, title: string, agent: string): Command {
  return {
    id,
    title,
    group: "Agents",
    run: () => {
      navigate(threadHash(agent));
      requestComposerFocus(agent);
    },
  };
}

/**
 * One in-flight guard per write command id, kept across rebuilds (the list is
 * rebuilt on every data change): running "Run pb-3" twice before the first
 * answers posts once, since the kernel would queue two runs.
 */
const commandGuards = new Map<string, InFlightGuard>();

function guarded(id: string, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    let guard = commandGuards.get(id);
    if (guard === undefined) {
      guard = inFlightGuard();
      commandGuards.set(id, guard);
    }
    await guard.run(fn);
  };
}

export function buildChatCommands(sources: ChatCommandSources): Command[] {
  const { api, roster, playbooks, triggers, notifications, onNotice } = sources;
  const say = (label: string) => (outcome: { readonly ok: boolean; readonly text?: string }) => {
    onNotice(outcome.ok ? `${label}: done.` : `${label}: ${outcome.text ?? "refused"}`);
  };
  const commands: Command[] = [ask("chat.ask.wright", "Ask Wright", WRIGHT)];
  for (const agent of specialists(roster)) commands.push(ask(`chat.ask.${agent.id}`, `Ask ${agent.display_name}`, agent.id));

  for (const playbook of playbooks ?? []) {
    const params = { id: playbook.id };
    const changed = ["playbooks", "triggers", "messages"] as const;
    commands.push({
      id: `chat.playbook.${playbook.id}.run`,
      title: `Run ${playbook.slug}`,
      group: "Playbooks",
      run: guarded(`chat.playbook.${playbook.id}.run`, async () => say(`Run ${playbook.slug}`)(await write(api, "/playbooks/:id/run", params, undefined, changed))),
    });
    commands.push({
      id: `chat.playbook.${playbook.id}.off`,
      title: `Turn off ${playbook.slug}`,
      group: "Playbooks",
      run: guarded(`chat.playbook.${playbook.id}.off`, async () => say(`Turn off ${playbook.slug}`)(await write(api, "/playbooks/:id/off", params, undefined, changed))),
    });
    for (const priority of PRIORITIES) {
      commands.push({
        id: `chat.playbook.${playbook.id}.priority.${priority}`,
        title: `Set ${playbook.slug} priority ${priority}`,
        group: "Playbooks",
        run: guarded(`chat.playbook.${playbook.id}.priority.${priority}`, async () =>
          say(`Set ${playbook.slug} priority ${priority}`)(await write(api, "/playbooks/:id/set", params, { field: "priority", value: priority }, changed)),
        ),
      });
    }
  }

  for (const trigger of triggers ?? []) {
    const params = { id: trigger.id };
    const title = `${trigger.enabled ? "Turn off" : "Turn on"} trigger ${trigger.id}: ${trigger.text}`;
    commands.push({
      id: `chat.trigger.${trigger.id}.${trigger.enabled ? "off" : "on"}`,
      title,
      group: "Playbooks",
      // Keyed by the trigger, not the direction: an on and an off in flight together must not race.
      run: guarded(`chat.trigger.${trigger.id}`, async () => {
        const outcome = trigger.enabled
          ? await write(api, "/triggers/:id/off", params, undefined, ["triggers", "playbooks"])
          : await write(api, "/triggers/:id/on", params, {}, ["triggers", "playbooks"]);
        // A past `once` trigger needs the owner's confirmation, which a palette command cannot ask: its card can.
        if (!outcome.ok && outcome.code === "needs_confirmation") onNotice(`${title}: ${outcome.text} Confirm it from the trigger's card in Chat.`);
        else say(title)(outcome);
      }),
    });
  }

  const recent = [...(notifications ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, NOTIFICATION_COMMANDS);
  for (const notification of recent) {
    commands.push({
      id: `chat.notification.${notification.id}`,
      title: notification.title,
      group: "Notifications",
      // Only navigates: a notification never acts.
      run: () => navigate(notificationThread(notification.source, roster)),
    });
  }
  return commands;
}
