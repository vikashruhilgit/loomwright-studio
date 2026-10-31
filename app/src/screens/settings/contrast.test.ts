// WCAG 2.1 AA for the Settings screen's text and control colours (AC10): the token
// pairs `settings.css`, the Badge and the Button put together, computed from
// `src/styles/tokens.css` in the light and the dark theme. Text needs 4.5:1; the
// switch's track, the status dots and the focus ring are non-text and need 3:1. The
// evidence README (`docs/evidence/phase-7-polish/settings/README.md`) records these same
// pairs. The stylesheet must also take every colour from a token: a literal colour (hex,
// `rgb()`, `hsl()` and the like, or a named one) would not follow the theme and is the one
// way this file's pairs could stay green while the screen fails AA.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TOKENS = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
const SCREEN_CSS = readFileSync(new URL("./settings.css", import.meta.url), "utf8");

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
  ["ink", "ground", "the values, the account, the Health word"],
  ["ink", "surface", "the app preferences' titles"],
  ["ink-secondary", "ground", "the commands' intro, the Reveal and Copy buttons' label, the 'status unknown' note"],
  ["ink-secondary", "surface", "an unpressed theme button, the route-failure card's text"],
  ["ink-secondary", "surface-sunken", "the neutral badges (read-only, the step numbers), the Copy button, a neutral notice"],
  ["ink-tertiary", "ground", "the row labels, the section labels, captions, 'last known'"],
  ["ink-tertiary", "surface", "the app preferences' captions"],
  ["ink", "surface-sunken", "the commands, the route-failure detail"],
  ["accent", "accent-soft", "the pressed theme button"],
  ["attention", "attention-soft", "the expiring band, the renew soon badge"],
  ["attention", "ground", "the 'expiring' Health word"],
  ["attention", "surface", "the login item's 'needs your approval' note"],
  ["danger", "danger-soft", "the missing and invalid band, a notice"],
  ["danger", "ground", "the 'missing', 'error' and 'invalid_shape' Health words, a Loomwright error, 'Couldn't open the folder'"],
  ["danger", "surface", "the route-failure card's heading"],
];

/** Non-text parts: the switch's off track against the row, the dots, and the focus ring. */
const NON_TEXT: readonly (readonly [string, string, string])[] = [
  ["border", "surface", "the switch's off track"],
  ["accent", "surface", "the switch's on track"],
  ["focus", "surface", "the focus ring on a switch or a theme button"],
  ["focus", "ground", "the focus ring on a Copy or Reveal button"],
  ["ok", "ground", "the 'ok' dot"],
  ["attention", "ground", "the 'expiring' dot"],
  ["danger", "ground", "the 'missing' and 'error' dot"],
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

  it("the stylesheet takes every colour from a token: no hex colour, no colour function, no named colour", () => {
    const css = SCREEN_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], "no hex colour").toEqual([]);
    expect(css.match(/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklch|oklab|color|color-mix)\(/g) ?? [], "no colour function").toEqual([]);
    // `transparent` on a border is not a colour choice; any other named colour is.
    const named = css.match(/(?:color|background(?:-color)?|border(?:-[a-z]+)?|outline|fill|stroke)\s*:\s*(?:white|black|red|green|blue|gray|grey|yellow|orange|purple)\b/gi) ?? [];
    expect(named, "no named colour").toEqual([]);
  });

  it("every colour the stylesheet sets is a var(--token): a colour property with a literal value fails", () => {
    const css = SCREEN_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const literal = [...css.matchAll(/(^|[;{\s])(color|background|background-color|border-color|outline-color|fill|stroke)\s*:\s*([^;}]+)/g)]
      .map((m) => [m[2] as string, (m[3] as string).trim()] as const)
      .filter(([, value]) => !/^(var\(--[\w-]+\)|none|transparent|currentColor|inherit)$/.test(value));
    expect(literal).toEqual([]);
  });
});
