// Phase 7 item 07: the `gui` parts' shared query helpers (`src/gui/query.ts`),
// pure functions of a query-string value.
import { describe, expect, it } from "vitest";
import { limitOf, positiveIntegerOf } from "../src/gui/query.js";

describe("positiveIntegerOf", () => {
  it("reads a positive whole number written in digits", () => {
    expect(positiveIntegerOf("1")).toBe(1);
    expect(positiveIntegerOf("42")).toBe(42);
    expect(positiveIntegerOf(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each(["", "0", "00", "01", "-1", "+1", "1.5", "1.0", "1e3", " 1", "1 ", "0x10", "abc", "١٢"])("refuses %j", (raw) => {
    expect(positiveIntegerOf(raw)).toBeUndefined();
  });

  it("refuses a number past the safe integer range", () => {
    expect(positiveIntegerOf(String(Number.MAX_SAFE_INTEGER + 1))).toBeUndefined();
    expect(positiveIntegerOf("99999999999999999999")).toBeUndefined();
  });
});

describe("limitOf", () => {
  it("answers the fallback when the value is absent", () => {
    expect(limitOf(undefined, 50, 200)).toBe(50);
    expect(limitOf(undefined, 7, 90)).toBe(7);
  });

  it("accepts a whole number from 1 to the maximum, both ends included", () => {
    expect(limitOf("1", 50, 200)).toBe(1);
    expect(limitOf("200", 50, 200)).toBe(200);
    expect(limitOf("90", 7, 90)).toBe(90);
  });

  it("refuses a number over the maximum", () => {
    expect(limitOf("201", 50, 200)).toBeUndefined();
    expect(limitOf("91", 7, 90)).toBeUndefined();
    expect(limitOf("1000", 50, 200)).toBeUndefined();
  });

  it.each(["", "0", "01", "-5", "+5", "2.5", "x", "1e2"])("refuses %j", (raw) => {
    expect(limitOf(raw, 50, 200)).toBeUndefined();
  });

  it("refuses an unsafe integer even when the maximum is huge", () => {
    expect(limitOf(String(Number.MAX_SAFE_INTEGER + 1), 50, Number.MAX_VALUE)).toBeUndefined();
  });

  it("does not apply the maximum to the fallback", () => {
    expect(limitOf(undefined, 500, 200)).toBe(500);
  });
});
