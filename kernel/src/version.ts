import { readFileSync } from "node:fs";

/**
 * The kernel's version, read from `kernel/package.json` at runtime.
 *
 * Both `src/version.ts` (tests) and `dist/version.js` (built daemon) sit one
 * directory below `kernel/`, so the same relative URL resolves in both.
 */
export function kernelVersion(): string {
  const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const pkg: unknown = JSON.parse(raw);
  if (
    typeof pkg !== "object" ||
    pkg === null ||
    !("version" in pkg) ||
    typeof pkg.version !== "string"
  ) {
    throw new Error("kernel package.json has no string version");
  }
  return pkg.version;
}
