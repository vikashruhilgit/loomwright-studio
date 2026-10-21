// The app-side half of the contract's checks. The kernel-side pin (methods and
// paths against a literal list, and against the routes the kernel serves) is
// `kernel/test/console-contract.test.ts`.
import { describe, expect, it } from "vitest";
import { CONTRACT_ROUTES } from "./contract";

describe("CONTRACT_ROUTES", () => {
  it("lists each route once", () => {
    const keys = CONTRACT_ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("holds only GET and POST routes on absolute paths, with `:param` segments", () => {
    for (const route of CONTRACT_ROUTES) {
      expect(["GET", "POST"]).toContain(route.method);
      expect(route.path).toMatch(/^(\/(:?[a-z][a-z0-9-]*))+$/);
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(CONTRACT_ROUTES)).toBe(true);
  });
});
