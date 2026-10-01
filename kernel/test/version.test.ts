import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { kernelVersion } from "../src/version.js";

describe("kernelVersion", () => {
  it("returns the version declared in kernel/package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(kernelVersion()).toBe(pkg.version);
    expect(kernelVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
