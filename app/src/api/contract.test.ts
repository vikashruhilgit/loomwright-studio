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

  it("holds only GET, POST and PUT routes on absolute paths, with `:param` segments", () => {
    for (const route of CONTRACT_ROUTES) {
      expect(["GET", "POST", "PUT"]).toContain(route.method);
      // A static segment is kebab-case; a `:param` may use `_` (the kernel declares `:run_id`).
      expect(route.path).toMatch(/^(\/(:[a-z][a-z0-9_]*|[a-z][a-z0-9-]*))+$/);
    }
  });

  it("holds a PUT only on the memory write and the two Settings auth writes (D42)", () => {
    const puts = CONTRACT_ROUTES.filter((r) => r.method === "PUT");
    expect(puts.map((r) => `${r.method} ${r.path} ${r.origin}`)).toEqual(["PUT /memory/file p7-item-06", "PUT /settings/auth-provider d42", "PUT /settings/api-key d42"]);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(CONTRACT_ROUTES)).toBe(true);
  });
});
