// @vitest-environment jsdom
// `formatHomePath` (AC5) and `useHomeDir` (AC8): a path reads `~/…` under the owner's home folder, and
// stays in full whenever the home folder is unknown or the path is not inside it.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StudioBridge } from "../api/contract";
import { fakeBridge } from "../store/fake-bridge";
import { formatHomePath } from "./home-path";
import { useHomeDir } from "./useHomeDir";

afterEach(cleanup);

describe("formatHomePath", () => {
  it("reads a path under home as ~/…", () => {
    expect(formatHomePath("/Users/o/work/repo", "/Users/o")).toBe("~/work/repo");
    expect(formatHomePath("/Users/o/x", "/Users/o")).toBe("~/x");
  });

  it("reads home itself as ~", () => {
    expect(formatHomePath("/Users/o", "/Users/o")).toBe("~");
  });

  it("reads a path outside home in full", () => {
    expect(formatHomePath("/var/log/kernel.log", "/Users/o")).toBe("/var/log/kernel.log");
    expect(formatHomePath("/Users", "/Users/o")).toBe("/Users");
  });

  it("does not shorten a path that only starts with the home folder's name", () => {
    expect(formatHomePath("/Users/o2/x", "/Users/o")).toBe("/Users/o2/x");
    expect(formatHomePath("/Users/other", "/Users/o")).toBe("/Users/other");
  });

  it("tolerates a trailing slash on home", () => {
    expect(formatHomePath("/Users/o/work", "/Users/o/")).toBe("~/work");
    expect(formatHomePath("/Users/o", "/Users/o/")).toBe("~");
    expect(formatHomePath("/Users/o2/x", "/Users/o/")).toBe("/Users/o2/x");
  });

  it("returns the path unchanged for an empty or missing home", () => {
    expect(formatHomePath("/Users/o/work", "")).toBe("/Users/o/work");
    expect(formatHomePath("/Users/o/work", undefined)).toBe("/Users/o/work");
    expect(formatHomePath("/Users/o/work", "/")).toBe("/Users/o/work");
    expect(formatHomePath("", "")).toBe("");
  });
});

describe("useHomeDir", () => {
  const settle = () => act(async () => undefined);
  const withHome = (homeDir: StudioBridge["homeDir"]): StudioBridge => ({ ...fakeBridge().bridge, homeDir });

  it("answers the bridge's home folder once it resolves", async () => {
    const api = withHome(async () => "/Users/o");
    const { result } = renderHook(() => useHomeDir(api));
    expect(result.current).toBeUndefined();
    await settle();
    expect(result.current).toBe("/Users/o");
  });

  it("answers undefined when the bridge has no homeDir member", async () => {
    const api = fakeBridge().bridge;
    expect(api.homeDir).toBeUndefined();
    const { result } = renderHook(() => useHomeDir(api));
    await settle();
    expect(result.current).toBeUndefined();
  });

  it("answers undefined when the call rejects or throws", async () => {
    const rejecting = withHome(() => Promise.reject(new Error("refused")));
    const throwing = withHome(() => {
      throw new Error("refused");
    });
    for (const api of [rejecting, throwing]) {
      const { result } = renderHook(() => useHomeDir(api));
      await settle();
      expect(result.current).toBeUndefined();
    }
  });

  it("answers undefined for an answer that is not a non-empty string", async () => {
    for (const answer of ["", undefined, 7]) {
      const api = withHome((async () => answer) as unknown as StudioBridge["homeDir"]);
      const { result } = renderHook(() => useHomeDir(api));
      await settle();
      expect(result.current).toBeUndefined();
    }
  });
});
