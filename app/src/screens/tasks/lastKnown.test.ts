// The Tasks screen's last-known board store (phase 7 item 23): one board per bridge, kept across a remount.
import { afterEach, describe, expect, it } from "vitest";
import type { TasksResponse } from "../../api/contract";
import { fakeBridge } from "../../store/fake-bridge";
import { getLastBoard, resetLastBoards, setLastBoard } from "./lastKnown";

const board = (next_before: string | null = null): TasksResponse => ({ groups: [], next_before });

afterEach(() => resetLastBoards());

describe("the last-known Tasks board", () => {
  it("has nothing for a bridge that never answered", () => {
    expect(getLastBoard(fakeBridge().bridge)).toBeUndefined();
  });

  it("remembers the board set for a bridge, and the newest set wins", () => {
    const { bridge } = fakeBridge();
    const first = board("a");
    const second = board("b");
    setLastBoard(bridge, first);
    expect(getLastBoard(bridge)).toBe(first);
    setLastBoard(bridge, second);
    expect(getLastBoard(bridge)).toBe(second);
  });

  it("keeps one board per bridge: another bridge never sees it", () => {
    const a = fakeBridge().bridge;
    const b = fakeBridge().bridge;
    const mine = board("a");
    setLastBoard(a, mine);
    expect(getLastBoard(b)).toBeUndefined();
    const theirs = board("b");
    setLastBoard(b, theirs);
    expect(getLastBoard(a)).toBe(mine);
    expect(getLastBoard(b)).toBe(theirs);
  });

  it("forgets every board on reset", () => {
    const a = fakeBridge().bridge;
    const b = fakeBridge().bridge;
    setLastBoard(a, board());
    setLastBoard(b, board());
    resetLastBoards();
    expect(getLastBoard(a)).toBeUndefined();
    expect(getLastBoard(b)).toBeUndefined();
  });
});
