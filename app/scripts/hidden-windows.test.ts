// The e2e harness pin: every e2e spec starts Electron through
// app/e2e/electron-harness.ts, which keeps each window hidden. A spec that
// calls `electron.launch` or builds its own `new BrowserWindow` fails here,
// because its window would show and take focus on every local run; the fix
// is `launchApp` or `launchGallery` from the harness.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const E2E_DIR = fileURLToPath(new URL("../e2e/", import.meta.url));
const HARNESS = "electron-harness.ts";
const LAUNCHES = /electron\.launch\s*\(|new\s+BrowserWindow\s*\(/;
// Comments may name the calls; code (template strings included) may not.
const COMMENTS = /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm;

function sources(): string[] {
  return readdirSync(E2E_DIR, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts") && path !== HARNESS)
    .sort();
}

describe("the e2e harness", () => {
  it("is the only e2e file that launches Electron or builds a window", () => {
    const offenders = sources().filter((path) =>
      LAUNCHES.test(readFileSync(join(E2E_DIR, path), "utf8").replace(COMMENTS, "")),
    );
    expect(offenders).toEqual([]);
  });

  it("builds its gallery window hidden", () => {
    const harness = readFileSync(join(E2E_DIR, HARNESS), "utf8");
    expect(harness).toMatch(/new BrowserWindow\(\{[^}]*show: false/s);
  });
});
