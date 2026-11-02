// The last `ok` Tasks board, kept across a remount (phase 7 item 23). The shell mounts only the current
// screen, so leaving Tasks and coming back while the kernel is down starts a screen with `data === undefined`:
// its first read answers status 0 and it would say "Couldn't load tasks" over a board it held a moment ago.
// This module remembers the last board per bridge (a window has one), so the new mount starts from it
// (`TasksScreen.tsx`) and the title line marks it "last known" while the kernel does not answer.
//
// It only seeds the screen's data; a mount still reads, and an answered read replaces the board. A bridge
// that never answered has nothing here, so it shows the error card as before. Modelled on
// `../settings/lastKnown.ts`; no React and no subscription, because the screen writes its own title line.
import type { StudioBridge, TasksResponse } from "../../api/contract";

/** The map's key for a bridge: the bridge itself, so one window never reads another's board. */
const keyOf = (api: StudioBridge): object => api;

let boards = new WeakMap<object, TasksResponse>();

/** The last `ok` board read through `api`, or `undefined` when none was. */
export function getLastBoard(api: StudioBridge): TasksResponse | undefined {
  return boards.get(keyOf(api));
}

/** Remember `board` as the last `ok` one read through `api`. */
export function setLastBoard(api: StudioBridge, board: TasksResponse): void {
  boards.set(keyOf(api), board);
}

/** Forget every remembered board. For a test that reuses a bridge; the app never calls it. */
export function resetLastBoards(): void {
  boards = new WeakMap();
}
