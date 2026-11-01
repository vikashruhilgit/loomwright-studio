// The menu-bar glyph pin: a template image (black with alpha, nothing else),
// the ribbon's opening left clear, each state telling itself apart by shape,
// strength or motion (never colour), and reduce motion giving a still frame.
import { describe, expect, it } from "vitest";
import { BREATH_MS, GLYPH_POINTS, GLYPH_SCALE, glyphBitmap, isAnimated } from "./tray-glyph";
import type { GlyphState } from "./tray-glyph";

const STATES: readonly GlyphState[] = ["idle", "working", "waiting", "paused", "killed"];
const SIZE = GLYPH_POINTS * GLYPH_SCALE;

const alpha = (state: GlyphState, x: number, y: number, timeMs = 0, still = false): number =>
  glyphBitmap(state, timeMs, still).buffer[(y * SIZE + x) * 4 + 3]!;
const total = (state: GlyphState, timeMs = 0, still = false): number => {
  const { buffer } = glyphBitmap(state, timeMs, still);
  let sum = 0;
  for (let i = 3; i < buffer.length; i += 4) sum += buffer[i]!;
  return sum;
};

describe("the menu-bar glyph", () => {
  it("is an 18pt glyph at 2x: a 36 x 36 BGRA bitmap", () => {
    for (const state of STATES) expect(glyphBitmap(state).buffer).toHaveLength(SIZE * SIZE * 4);
  });

  it("is a template image: every pixel is black, only its alpha varies", () => {
    for (const state of STATES) {
      const { buffer } = glyphBitmap(state, 1234);
      for (let i = 0; i < buffer.length; i += 4) expect([buffer[i], buffer[i + 1], buffer[i + 2]]).toEqual([0, 0, 0]);
      expect(total(state, 1234)).toBeGreaterThan(0);
    }
  });

  it("leaves its corners and the ribbon's opening clear", () => {
    expect(alpha("idle", 0, 0)).toBe(0);
    expect(alpha("idle", SIZE - 1, SIZE - 1)).toBe(0);
    expect(alpha("idle", 18, 19)).toBe(0);
  });

  it("marks paused and killed inside the opening, where idle is clear", () => {
    expect(alpha("paused", 15, 20)).toBeGreaterThan(128);
    expect(alpha("killed", 17, 18)).toBeGreaterThan(128);
  });

  it("moves only while working or waiting", () => {
    expect(STATES.filter(isAnimated)).toEqual(["working", "waiting"]);
    expect(glyphBitmap("working", 0).buffer.equals(glyphBitmap("working", 900).buffer)).toBe(false);
    expect(glyphBitmap("idle", 0).buffer.equals(glyphBitmap("idle", 900).buffer)).toBe(true);
  });

  it("breathes while waiting: faint at the start of a breath, full at its middle", () => {
    expect(total("waiting", BREATH_MS / 2)).toBeGreaterThan(total("waiting", 0) * 2);
    expect(total("waiting", BREATH_MS / 2)).toBeGreaterThan(total("idle"));
  });

  it("draws one fixed frame under reduce motion: waiting at full strength, working's rays where they start", () => {
    expect(glyphBitmap("waiting", 300, true).buffer.equals(glyphBitmap("waiting", BREATH_MS / 2).buffer)).toBe(true);
    expect(glyphBitmap("working", 300, true).buffer.equals(glyphBitmap("working", 0).buffer)).toBe(true);
  });

  it("carries light on the working ribbon: brighter than the ribbon at rest", () => {
    expect(total("working", 500)).toBeGreaterThan(total("idle"));
  });
});
