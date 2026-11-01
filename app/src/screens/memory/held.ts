// What Memory keeps outside the screen component, so it survives a remount and reaches the title bar.
//
// - The last tree that answered and the last `data_dir`: component state dies when the owner leaves Memory, so a
//   screen mounted while the kernel does not answer would otherwise find nothing to draw. `MemoryScreen` seeds its
//   state from here and writes here on every read that answered; the tree is shown as last known until a newer
//   read replaces it.
// - The count line: `ScreenDefinition.Subtitle` is a prop-less component the shell draws in the title bar, so the
//   text cannot be handed down as a prop. The screen writes it here and `useMemorySubtitle` (read by the title
//   bar's `MemorySubtitle`) returns it, re-rendering on every change.
//
// Plain module state, in memory only (invariant 8: memory itself stays the files on disk). Tests call
// `resetHeldMemory()` so nothing leaks between them.
import { useSyncExternalStore } from "react";
import type { MemoryTreeResponse } from "../../api/contract";

interface HeldMemory {
  readonly tree: MemoryTreeResponse | undefined;
  readonly dataDir: string | undefined;
  readonly subtitle: string;
}

const EMPTY: HeldMemory = { tree: undefined, dataDir: undefined, subtitle: "" };

let held: HeldMemory = EMPTY;
const listeners = new Set<() => void>();

function update(next: Partial<HeldMemory>): void {
  const merged = { ...held, ...next };
  if (merged.tree === held.tree && merged.dataDir === held.dataDir && merged.subtitle === held.subtitle) return;
  held = merged;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The last tree the kernel answered with, or `undefined` before the first answer of this session. */
export const heldTree = (): MemoryTreeResponse | undefined => held.tree;

/** The last `data_dir` Settings answered with. */
export const heldDataDir = (): string | undefined => held.dataDir;

export const holdTree = (tree: MemoryTreeResponse): void => update({ tree });

export const holdDataDir = (dataDir: string): void => update({ dataDir });

/** The count line now ("14 files", "14 files · last known", "Edit"); `""` when the screen has none to show. */
export const setMemorySubtitle = (subtitle: string): void => update({ subtitle });

/** The count line for the title bar: re-reads on every change. */
export function useMemorySubtitle(): string {
  return useSyncExternalStore(subscribe, () => held.subtitle);
}

/** Forget everything held (tests; the app never calls it). */
export function resetHeldMemory(): void {
  update(EMPTY);
}
