// Playbooks' ⌘K commands (phase 7 item 04, AC10): owner `playbooks`, every id
// prefixed `playbooks.`. They are registered while the Playbooks screen is mounted
// and unregistered when it unmounts (the shell renders only the current screen),
// through the registry's own unregister. Each one calls the handler its button calls.
//
// The set follows the data: one "Open <name>" per playbook, and six more while a
// playbook's own view is open. So the registration is rebuilt when that set changes
// (a signature of the ids and names), never on every render; `enabled` and `run`
// read the latest flags and handlers through a ref, so they are never stale.
//
// No command turns a playbook on or sends a message: Turn on is the owner's approval,
// and Run now and Turn off are already Chat's (`chat.playbook.<id>.run` / `.off`).
// The Live command only opens the card's confirm (it sends nothing itself), the hand-off
// to Wright fills the composer and sends nothing, and Draft is a policy Set of `mode`
// (the same write the Edit view's Draft sends at once), not a turn-on.
// Titles carry kernel text (a playbook's name): the palette renders a title as a text child.
import { useEffect, useRef } from "react";
import type { PlaybookListing } from "../../api/contract";
import type { Command, CommandRegistry } from "../../commands/registry";
import { ASK_DRY_RUN_ENABLE_LABEL, liveChoosable, safe } from "./model";

/** The registry owner every Playbooks command is registered under. */
export const PLAYBOOKS_OWNER = "playbooks";

/** The palette group Playbooks' commands appear under. */
export const PLAYBOOKS_GROUP = "Playbooks";

/** The ids this screen registers (the per-playbook ones are `playbooks.open.<id>`). */
export const PLAYBOOKS_COMMANDS = {
  askWright: "playbooks.ask-wright",
  open: (id: number): string => `playbooks.open.${id}`,
  editEnglish: "playbooks.edit-english",
  editFields: "playbooks.edit-fields",
  history: "playbooks.history",
  modeLive: "playbooks.mode-live",
  modeDraft: "playbooks.mode-draft",
  askDryRunEnable: "playbooks.ask-dry-run-enable",
} as const;

/** What each command does: the same handlers the screen's buttons call. */
export interface PlaybooksCommandHandlers {
  readonly askWright: () => void;
  readonly open: (playbook: PlaybookListing) => void;
  readonly editInEnglish: (playbook: PlaybookListing) => void;
  readonly editFields: (playbook: PlaybookListing) => void;
  readonly showHistory: (playbook: PlaybookListing) => void;
  /** Show the card and open its Live confirm; sends nothing. */
  readonly askLive: (playbook: PlaybookListing) => void;
  /** Send `mode draft` at once. */
  readonly setModeDraft: (playbook: PlaybookListing) => void;
  /** Put the dry-run-and-enable line in Wright's composer and open his thread; sends nothing. */
  readonly askDryRunEnable: (playbook: PlaybookListing) => void;
}

/** What the commands are built from, read when the palette asks. */
export interface PlaybooksCommandSources {
  readonly playbooks: readonly PlaybookListing[];
  /** The playbook whose detail, edit or history view is showing. */
  readonly current: PlaybookListing | undefined;
  /** The kernel cannot be asked: the commands that need it are disabled. */
  readonly offline: boolean;
}

/** Playbooks' commands over `sources` and `handlers` (both read when a command is asked, never captured). */
export function playbooksCommands(sources: () => PlaybooksCommandSources, handlers: () => PlaybooksCommandHandlers): Command[] {
  const initial = sources();
  const commands: Command[] = [
    {
      id: PLAYBOOKS_COMMANDS.askWright,
      title: "Ask Wright for a playbook",
      group: PLAYBOOKS_GROUP,
      keywords: ["chat", "new", "write"],
      enabled: () => !sources().offline,
      run: () => handlers().askWright(),
    },
  ];
  for (const playbook of initial.playbooks) {
    commands.push({
      id: PLAYBOOKS_COMMANDS.open(playbook.id),
      title: `Open ${safe(playbook.name)}`,
      group: PLAYBOOKS_GROUP,
      keywords: [safe(playbook.slug), "playbook"],
      run: () => {
        const latest = sources().playbooks.find((p) => p.id === playbook.id);
        if (latest !== undefined) handlers().open(latest);
      },
    });
  }
  const current = initial.current;
  if (current !== undefined) {
    const name = safe(current.name);
    const ofCurrent = (act: (playbook: PlaybookListing) => void) => () => {
      const latest = sources().current;
      if (latest !== undefined && latest.id === current.id) act(latest);
    };
    commands.push(
      {
        id: PLAYBOOKS_COMMANDS.editEnglish,
        title: `Edit “${name}” in English`,
        group: PLAYBOOKS_GROUP,
        keywords: ["chat", "wright", "change"],
        enabled: () => !sources().offline,
        run: ofCurrent((p) => handlers().editInEnglish(p)),
      },
      {
        id: PLAYBOOKS_COMMANDS.editFields,
        title: `Edit fields of “${name}”`,
        group: PLAYBOOKS_GROUP,
        keywords: ["policy", "priority", "model", "dedupe"],
        run: ofCurrent((p) => handlers().editFields(p)),
      },
      {
        id: PLAYBOOKS_COMMANDS.history,
        title: `Version history of “${name}”`,
        group: PLAYBOOKS_GROUP,
        keywords: ["versions", "changes"],
        run: ofCurrent((p) => handlers().showHistory(p)),
      },
      {
        id: PLAYBOOKS_COMMANDS.modeLive,
        title: `Set “${name}” to live mode`,
        group: PLAYBOOKS_GROUP,
        keywords: ["mode", "live", "outward"],
        enabled: () => {
          const latest = sources().current;
          return !sources().offline && latest !== undefined && latest.id === current.id && liveChoosable(latest);
        },
        run: ofCurrent((p) => handlers().askLive(p)),
      },
      {
        id: PLAYBOOKS_COMMANDS.modeDraft,
        title: `Set “${name}” to draft mode`,
        group: PLAYBOOKS_GROUP,
        keywords: ["mode", "draft", "recorded"],
        enabled: () => {
          const latest = sources().current;
          return !sources().offline && latest !== undefined && latest.id === current.id && latest.mode === "live";
        },
        run: ofCurrent((p) => handlers().setModeDraft(p)),
      },
      {
        id: PLAYBOOKS_COMMANDS.askDryRunEnable,
        title: `${ASK_DRY_RUN_ENABLE_LABEL} for “${name}”`,
        group: PLAYBOOKS_GROUP,
        keywords: ["wright", "chat", "dry run", "enable"],
        enabled: () => !sources().offline,
        run: ofCurrent((p) => handlers().askDryRunEnable(p)),
      },
    );
  }
  return commands;
}

/** The set a registration was built for: when it is the same, the registration stands. */
export function commandSignature(sources: PlaybooksCommandSources): string {
  return JSON.stringify([sources.playbooks.map((p) => [p.id, p.name, p.slug]), sources.current === undefined ? null : [sources.current.id, sources.current.name]]);
}

/** Register Playbooks' commands with `registry` for the caller's lifetime, rebuilt only when the set of commands changes. */
export function usePlaybooksCommands(registry: CommandRegistry, sources: PlaybooksCommandSources, handlers: PlaybooksCommandHandlers): void {
  const latest = useRef({ sources, handlers });
  latest.current = { sources, handlers };
  const signature = commandSignature(sources);
  // The registration is keyed by `signature` alone: `latest` carries everything else.
  useEffect(() => registry.register(PLAYBOOKS_OWNER, playbooksCommands(() => latest.current.sources, () => latest.current.handlers)), [registry, signature]);
}
