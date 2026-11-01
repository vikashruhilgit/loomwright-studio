// @vitest-environment jsdom
// What Memory keeps outside the screen (`held.ts`): the last tree and `data_dir` that answered, and the count line
// the title bar reads. Module state, so every test starts from `resetHeldMemory()`.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryTreeResponse } from "../../api/contract";
import { heldDataDir, heldTree, holdDataDir, holdTree, resetHeldMemory, setMemorySubtitle, useMemorySubtitle } from "./held";

afterEach(() => {
  cleanup();
  resetHeldMemory();
});

const TREE: MemoryTreeResponse = { agents: [{ agent: "mason", files: [{ path: "mason/lessons.md", size: 10, modified: "2026-10-30T09:00:00.000Z" }] }], shared: [] };

describe("the held tree and data folder", () => {
  it("hold nothing before the first answer", () => {
    expect(heldTree()).toBeUndefined();
    expect(heldDataDir()).toBeUndefined();
  });

  it("keep the last tree and data folder that answered", () => {
    holdTree(TREE);
    holdDataDir("/Users/me/.loomwright-studio");
    expect(heldTree()).toBe(TREE);
    expect(heldDataDir()).toBe("/Users/me/.loomwright-studio");
    const next: MemoryTreeResponse = { agents: [], shared: [{ path: "shared/README.md", size: 1, modified: "2026-10-30T09:00:00.000Z" }] };
    holdTree(next);
    expect(heldTree()).toBe(next);
  });

  it("resetHeldMemory forgets them and the count line", () => {
    holdTree(TREE);
    holdDataDir("/data");
    setMemorySubtitle("1 file");
    resetHeldMemory();
    expect(heldTree()).toBeUndefined();
    expect(heldDataDir()).toBeUndefined();
    const { result } = renderHook(() => useMemorySubtitle());
    expect(result.current).toBe("");
  });
});

describe("the count line", () => {
  it("is empty until the screen sets one", () => {
    const { result } = renderHook(() => useMemorySubtitle());
    expect(result.current).toBe("");
  });

  it("re-renders a reader on every change, and not when the text is the same", () => {
    const renders = vi.fn();
    const { result } = renderHook(() => {
      const line = useMemorySubtitle();
      renders(line);
      return line;
    });
    act(() => setMemorySubtitle("14 files"));
    expect(result.current).toBe("14 files");
    act(() => setMemorySubtitle("14 files · last known"));
    expect(result.current).toBe("14 files · last known");
    const before = renders.mock.calls.length;
    act(() => setMemorySubtitle("14 files · last known"));
    expect(renders.mock.calls.length).toBe(before);
  });

  it("reaches a reader that mounts after it was set (a remount keeps no stale line only because the screen clears it)", () => {
    setMemorySubtitle("Edit");
    const { result } = renderHook(() => useMemorySubtitle());
    expect(result.current).toBe("Edit");
    act(() => setMemorySubtitle(""));
    expect(result.current).toBe("");
  });

  it("stops notifying a reader once it unmounts", () => {
    const renders = vi.fn();
    const { unmount } = renderHook(() => {
      renders();
      return useMemorySubtitle();
    });
    unmount();
    const before = renders.mock.calls.length;
    act(() => setMemorySubtitle("3 files"));
    expect(renders.mock.calls.length).toBe(before);
  });
});
