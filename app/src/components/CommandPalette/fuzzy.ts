// The palette's matcher and grouping (CommandPalette README: "Fuzzy match over
// labels and linked ids"). A command matches on its `title` or any of its
// `keywords` (PR numbers, ticket keys). Ranking: a title prefix is best, then a
// word start (in the title or a keyword), then an in-order subsequence. Ties
// keep registration order.
import type { RegisteredCommand } from "../../commands/registry";

/** The README's group order; any other group follows, in first-registration order. */
export const GROUP_ORDER: readonly string[] = ["Actions", "Screens", "Agents", "Playbooks", "Sessions", "Tasks"];

/** At most this many rows show per group before a "Show all" row (README **Don't**). */
export const GROUP_ROW_CAP = 8;

export const SCORE_PREFIX = 3;
export const SCORE_WORD_START = 2;
export const SCORE_SUBSEQUENCE = 1;

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** True when `query` occurs in `text` at a word start (after a non-letter, non-digit). */
function wordStart(text: string, query: string): boolean {
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + 1)) {
    if (at === 0 || !isWordChar(text[at - 1])) return true;
  }
  return false;
}

/** True when every character of `query` appears in `text`, in order. */
function subsequence(text: string, query: string): boolean {
  let at = 0;
  for (const ch of query) {
    at = text.indexOf(ch, at);
    if (at === -1) return false;
    at += ch.length;
  }
  return true;
}

/** How well `query` matches `command` (higher is better), or `undefined` for no match. An empty query matches everything at 0. */
export function fuzzyScore(query: string, command: Pick<RegisteredCommand, "title" | "keywords">): number | undefined {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const title = command.title.toLowerCase();
  const keywords = (command.keywords ?? []).map((k) => k.toLowerCase());
  if (title.startsWith(q)) return SCORE_PREFIX;
  if (wordStart(title, q) || keywords.some((k) => wordStart(k, q))) return SCORE_WORD_START;
  if (subsequence(title, q) || keywords.some((k) => subsequence(k, q))) return SCORE_SUBSEQUENCE;
  return undefined;
}

export interface CommandGroup {
  readonly name: string;
  /** Every match in this group, best first, ties in registration order. */
  readonly commands: readonly RegisteredCommand[];
}

/** The commands matching `query`, grouped in `GROUP_ORDER` (others after, in first-registration order). */
export function groupCommands(commands: readonly RegisteredCommand[], query: string): readonly CommandGroup[] {
  const scored = commands
    .map((command, index) => ({ command, index, score: fuzzyScore(query, command) }))
    .filter((s): s is { command: RegisteredCommand; index: number; score: number } => s.score !== undefined)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const firstSeen: string[] = [];
  for (const command of commands) if (!firstSeen.includes(command.group)) firstSeen.push(command.group);
  const rank = (group: string): number => {
    const known = GROUP_ORDER.indexOf(group);
    return known === -1 ? GROUP_ORDER.length + firstSeen.indexOf(group) : known;
  };

  const groups = new Map<string, RegisteredCommand[]>();
  for (const { command } of scored) {
    const list = groups.get(command.group);
    if (list === undefined) groups.set(command.group, [command]);
    else list.push(command);
  }
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([name, list]) => ({ name, commands: list }));
}
