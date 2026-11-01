// WCAG 2.1 AA for the Keyboard map's text colours: the token pairs `keymap.css` puts together, computed from
// `src/styles/tokens.css` in the light and the dark theme (text needs 4.5:1; the focus ring is non-text and
// needs 3:1). The stylesheet must also take every colour from a token: a literal colour would not follow the
// theme and is the one way these pairs could stay green while the screen fails AA.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TOKENS = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
const SCREEN_CSS = readFileSync(new URL("./keymap.css", import.meta.url), "utf8");

/** The custom properties of the block that starts at `marker`, up to its closing brace. */
function block(marker: string): Map<string, string> {
  const start = TOKENS.indexOf(marker);
  if (start < 0) throw new Error(`no ${marker} in tokens.css`);
  const body = TOKENS.slice(TOKENS.indexOf("{", start) + 1, TOKENS.indexOf("}", start));
  return new Map([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
}

const light = block(":root {");
const dark = new Map([...light, ...block(':root[data-theme="dark"]')]);

function hex(theme: Map<string, string>, name: string): string {
  let value = theme.get(name);
  while (value !== undefined && value.startsWith("var(")) value = theme.get(value.slice(6, -1));
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--${name} is not a 6-digit hex: ${String(value)}`);
  return value;
}

function luminance(color: string): number {
  const channel = (i: number): number => {
    const c = parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground token, background token, where it is used]. */
const TEXT: readonly (readonly [string, string, string])[] = [
  ["ink", "ground", "the table cells"],
  ["ink-secondary", "ground", "the intro line"],
  ["ink-tertiary", "ground", "the crumb, the section labels, the table headers, the captions and 'none'"],
  ["ink-secondary", "surface-sunken", "a key chip"],
];

const NON_TEXT: readonly (readonly [string, string, string])[] = [["focus", "ground", "the focus ring"]];

describe("contrast (WCAG 2.1 AA)", () => {
  for (const [name, theme] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it.each(TEXT)(`${name}: %s on %s is at least 4.5:1 (%s)`, (fg, bg) => {
      expect(ratio(hex(theme, fg), hex(theme, bg))).toBeGreaterThanOrEqual(4.5);
    });
    it.each(NON_TEXT)(`${name}: %s against %s is at least 3:1 (%s)`, (fg, bg) => {
      expect(ratio(hex(theme, fg), hex(theme, bg))).toBeGreaterThanOrEqual(3);
    });
  }

  it("the stylesheet names only tokens that exist", () => {
    const used = new Set([...SCREEN_CSS.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1] as string));
    expect([...used].filter((name) => !light.has(name))).toEqual([]);
  });

  it("the stylesheet holds no literal colour", () => {
    const code = SCREEN_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|color)a?\(/gi) ?? []).toEqual([]);
  });
});
