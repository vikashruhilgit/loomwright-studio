/// <reference types="node" />
// The kept formatters (2026-11-17): the same text the per-call `toLocale*` gave, and no file formats per call again.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { countText, dateText, dateTimeText, timeText } from "./format";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("kept formatters", () => {
  const at = new Date("2026-11-17T16:05:09Z");

  it("give exactly what the per-call toLocale* gave", () => {
    for (const n of [0, 7, 14208, 3_000_000]) expect(countText(n)).toBe(n.toLocaleString("en-US"));
    const clock = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
    expect(timeText(at, clock)).toBe(at.toLocaleTimeString(undefined, clock));
    expect(timeText(at, { hour: "2-digit", minute: "2-digit", hour12: false }, [])).toBe(at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
    expect(dateText(at, { month: "short", day: "numeric" })).toBe(at.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    const stamp = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false } as const;
    expect(dateTimeText(at, stamp, [])).toBe(at.toLocaleString([], stamp));
  });

  it("no app source formats per call: every toLocale*String goes through ./format.ts", () => {
    const offenders = sources(SRC)
      .filter((f) => !f.endsWith(join("components", "format.ts")))
      .filter((f) => /\.toLocale(String|DateString|TimeString)\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
