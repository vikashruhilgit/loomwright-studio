// WCAG 2.1 AA for the Budget & audit screen's text and control colours (AC8): the token
// pairs `budget.css`, the Badge, the Button and the select field put together, computed from
// `src/styles/tokens.css` in the light and the dark theme. Text needs 4.5:1; the meters and
// the focus ring are non-text and need 3:1. The evidence README
// (`docs/evidence/phase-7-polish/budget/README.md`) records these same pairs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TOKENS = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
const SCREEN_CSS = readFileSync(new URL("./budget.css", import.meta.url), "utf8");

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
  ["ink", "surface", "table text, the inspector's figures, the event cards"],
  ["ink", "ground", "the screen's titles and the figures on the page ground"],
  ["ink-secondary", "surface", "the event kind, the cache-read note, the empty-state copy"],
  ["ink-secondary", "ground", "the crumb and the empty-state copy on the page ground"],
  ["ink-tertiary", "surface", "captions, section labels, table headers, 'no limit set'"],
  ["ink-tertiary", "ground", "the summary line, captions on the page ground, 'last known'"],
  ["ink-secondary", "attention-soft", "the waiting row's captions"],
  ["ink", "attention-soft", "the waiting row's figures"],
  ["attention", "attention-soft", "the waiting-on-you band, the 'at limit' and 'warning' badges"],
  ["ok", "ok-soft", "the 'allowed' badge"],
  ["danger", "danger-soft", "the 'rejected' badge, a refresh notice"],
  ["danger", "surface", "the route-failure card's heading"],
  ["ink-secondary", "surface-sunken", "a cap status the screen has no label for (neutral badge)"],
  ["accent", "accent-soft", "the 'filtered' badge"],
  ["ink", "surface-sunken", "the route-failure detail and the select fields"],
  ["on-accent", "accent", "the primary button's label (Ask Wright)"],
  ["accent", "surface", "the ghost buttons' hover and the focus-adjacent text"],
];

/** Non-text parts: the meters against their track, and the focus ring against the surface. */
const NON_TEXT: readonly (readonly [string, string, string])[] = [
  ["accent", "surface-sunken", "a meter's bar against its track"],
  ["attention", "surface-sunken", "a full meter (at limit) against its track"],
  ["focus", "surface", "the focus ring"],
];

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
    const missing = [...used].filter((name) => !light.has(name));
    expect(missing).toEqual([]);
  });
});
