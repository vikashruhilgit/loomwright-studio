// Memory's ⌘K commands (phase 7 item 06, AC10): owner `memory`, group "Memory". They are
// registered while the Memory screen is mounted and unregistered when it unmounts (the shell
// renders only the current screen), through the unregister the registry's `register` returns;
// each one calls the handler its control calls, so both reach the same code.
//
//   memory.open:<path>   "Open memory/<path>", one per file in the tree (the mockup's "One per memory file").
//   memory.edit          "Edit memory/<path>", while a file view is open (the mockup's "On a file").
//
// Both are disabled while the kernel is unreachable: opening a file reads it and Edit opens a
// save against it. The palette reads `enabled` when it opens, so the flags and handlers come in
// as functions the screen refreshes every render; the registration is rebuilt only when the set
// of commands changes (a signature of the paths and the open file), never on every render.
// Titles carry file paths the kernel sent: the palette renders a title as a text child.
import { useEffect, useRef } from "react";
import type { Command, CommandRegistry } from "../../commands/registry";
import { printable } from "../approvals/printable";

/** The registry owner every Memory command is registered under. */
export const MEMORY_OWNER = "memory";

/** The palette group Memory's commands appear under. */
export const MEMORY_GROUP = "Memory";

/** The id of the Edit command. */
export const MEMORY_EDIT_COMMAND = "memory.edit";

/** The id of the command that opens `path`. */
export function memoryOpenCommandId(path: string): string {
  return `memory.open:${path}`;
}

/** What the commands are built from, read when the palette asks. */
export interface MemoryCommandSources {
  /** Every file in the tree, in the order it shows them. */
  readonly files: readonly string[];
  /** The file whose view is open (not its editor or the conflict view): Edit applies to it. */
  readonly viewing: string | undefined;
  /** The kernel cannot be asked: both commands are disabled. */
  readonly offline: boolean;
}

/** What each command does: the same handlers the screen's controls call. */
export interface MemoryCommandHandlers {
  readonly open: (path: string) => void;
  readonly edit: () => void;
}

/** Memory's commands over `sources` and `handlers` (both read when a command is asked, never captured). */
export function memoryCommands(sources: () => MemoryCommandSources, handlers: () => MemoryCommandHandlers): Command[] {
  const initial = sources();
  const commands: Command[] = initial.files.map((path) => ({
    id: memoryOpenCommandId(path),
    title: `Open memory/${printable(path)}`,
    group: MEMORY_GROUP,
    keywords: ["memory", "file", "markdown", ...printable(path).split("/")],
    enabled: () => !sources().offline && sources().files.includes(path),
    run: () => handlers().open(path),
  }));
  const viewing = initial.viewing;
  if (viewing !== undefined) {
    commands.push({
      id: MEMORY_EDIT_COMMAND,
      title: `Edit memory/${printable(viewing)}`,
      group: MEMORY_GROUP,
      keywords: ["memory", "change", "write", "markdown"],
      enabled: () => !sources().offline && sources().viewing === viewing,
      run: () => handlers().edit(),
    });
  }
  return commands;
}

/** The set a registration was built for: when it is the same, the registration stands. */
export function memoryCommandSignature(sources: MemoryCommandSources): string {
  return JSON.stringify([sources.files, sources.viewing ?? null]);
}

/** Register Memory's commands with `registry` for the caller's lifetime, rebuilt only when the set of commands changes. */
export function useMemoryCommands(registry: CommandRegistry, sources: MemoryCommandSources, handlers: MemoryCommandHandlers): void {
  const latest = useRef({ sources, handlers });
  latest.current = { sources, handlers };
  const signature = memoryCommandSignature(sources);
  // The registration is keyed by `signature` alone: `latest` carries everything else. `register` returns the
  // unregister for exactly these commands, so the cleanup is that function (the registry has no unregister-by-owner).
  useEffect(() => {
    const unregister = registry.register(MEMORY_OWNER, memoryCommands(() => latest.current.sources, () => latest.current.handlers));
    return () => unregister();
  }, [registry, signature]);
}
