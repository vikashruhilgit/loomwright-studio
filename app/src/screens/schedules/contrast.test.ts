// WCAG 2.1 AA for the Schedules screen's text and control colours (AC8): the token
// pairs `schedules.css`, the Badge and the Button put together, computed from
// `src/styles/tokens.css` in the light and the dark theme. Text needs 4.5:1; the
// switch's track and the focus ring are non-text and need 3:1. The evidence README
// (`docs/evidence/phase-7-polish/schedules/README.md`) records these same pairs.
// The token parsing, hex resolution and ratio live in `src/styles/test-support.ts`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dark, hex, light, ratio } from "../../styles/test-support";

const SCREEN_CSS = readFileSync(new URL("./schedules.css", import.meta.url), "utf8");

/** [foreground token, background token, where it is used]. */
const TEXT: readonly (readonly [string, string, string])[] = [
  ["ink", "surface", "names, table text, the open trigger's title"],
  ["ink", "accent-soft", "the selected trigger row"],
  ["ink-secondary", "surface", "reasons, counts, the detail's values"],
  ["ink-secondary", "accent-soft", "the selected row's second line"],
  ["ink-secondary", "ground", "the timeline's times"],
  ["ink-tertiary", "surface", "captions, section labels, table headers"],
  ["ink-tertiary", "ground", "the summary line, captions on the page ground"],
  ["ink-secondary", "surface-sunken", "the neutral badges (kind, 'missed', 'off')"],
  ["accent", "accent-soft", "the pressed filter chip"],
  ["accent", "surface", "the link to Integrations"],
  ["ok", "ok-soft", "the 'fired' and 'on' badges"],
  ["attention", "attention-soft", "the paused, kill switch, rate limited and not enabled badges"],
  ["danger", "danger-soft", "the no connector and source error badges, a notice"],
  ["danger", "surface", "a row's refusal, the route-failure card's heading"],
  ["ink", "surface-sunken", "the route-failure detail"],
  ["on-accent", "accent", "the primary button's label"],
];

/** Non-text parts: the switch's off track against the row, and the focus ring against the surface. */
const NON_TEXT: readonly (readonly [string, string, string])[] = [
  ["border", "surface", "the switch's off track"],
  ["accent", "surface", "the switch's on track, the focus ring"],
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
