// The ⌘K palette's command registry. Each screen registers its own commands
// from its own module, so no later item edits a shared list. Phase 5 item 11
// builds the palette and the keyboard map over this registry.
//
// Mechanism only: the registry holds what owners register and nothing else.
// Two owners of one command id are refused (a throw naming both), never
// silently overridden, as the kernel refuses colliding contributions.

export interface Command {
  /** Unique across every owner, e.g. `approvals.approve-once`. */
  readonly id: string;
  /** What the palette shows. */
  readonly title: string;
  /** The palette's group heading, e.g. `Screens`. */
  readonly group: string;
  /** Display only, e.g. `⌘3`; item 11's keyboard map binds keys. */
  readonly shortcut?: string;
  /** Extra words the palette matches on. */
  readonly keywords?: readonly string[];
  /** Whether the command can run now (default: always). */
  readonly enabled?: () => boolean;
  readonly run: () => void | Promise<void>;
}

/** A registered command, with the owner that registered it. */
export interface RegisteredCommand extends Command {
  readonly owner: string;
}

export class CommandCollisionError extends Error {
  constructor(id: string, first: string, second: string) {
    super(`command ${JSON.stringify(id)} is registered by both ${first} and ${second}`);
    this.name = "CommandCollisionError";
  }
}

export interface CommandRegistry {
  /** Registers `commands` for `owner` (all or none); returns the unregister for exactly these. */
  register(owner: string, commands: readonly Command[]): () => void;
  /** Every registered command, in registration order. */
  list(): readonly RegisteredCommand[];
  get(id: string): RegisteredCommand | undefined;
  /** Called after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, RegisteredCommand>();
  const listeners = new Set<() => void>();
  let snapshot: readonly RegisteredCommand[] = [];
  const changed = (): void => {
    snapshot = [...commands.values()];
    for (const listener of [...listeners]) listener();
  };

  return {
    register(owner, list) {
      const seen = new Set<string>();
      for (const command of list) {
        if (command.id === "") throw new TypeError(`${owner} registered a command with an empty id`);
        const existing = commands.get(command.id);
        if (existing !== undefined) throw new CommandCollisionError(command.id, existing.owner, owner);
        if (seen.has(command.id)) throw new CommandCollisionError(command.id, owner, owner);
        seen.add(command.id);
      }
      const added = list.map((command) => ({ ...command, owner }));
      for (const command of added) commands.set(command.id, command);
      changed();
      return () => {
        let removed = false;
        for (const command of added) {
          if (commands.get(command.id) === command) {
            commands.delete(command.id);
            removed = true;
          }
        }
        if (removed) changed();
      };
    },
    list: () => snapshot,
    get: (id) => commands.get(id),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's one registry. */
export const commandRegistry: CommandRegistry = createCommandRegistry();
