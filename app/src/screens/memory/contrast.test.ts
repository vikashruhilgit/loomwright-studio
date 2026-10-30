// WCAG 2.1 AA for the Memory screen's text colours (AC12): each rule of `memory.css` that
// sets a text colour is listed below with the ground it sits on, and the test checks three
// things. The rule really declares that token (so a changed colour turns this red, whatever its
// ratio), every rule that sets a colour is listed (so a new one cannot slip in unchecked), and
// the pair is at least 4.5:1 in the light and the dark theme, computed from `src/styles/tokens.css`.
// The Badge and the Button own their own colours; their pairs are listed once as well. Non-text
// parts (the focus ring, the current version's border) need 3:1. The stylesheet takes every
// colour from a token: no hex, no `rgb(` or `hsl(`. The evidence README
// (`docs/evidence/phase-7-polish/memory/README.md`) records these same pairs.
//
// The helper below follows `src/screens/schedules/contrast.test.ts`; it is the second copy, and
// moving both into one shared module is a follow-up once both screens have landed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TOKENS = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
const SCREEN_CSS = readFileSync(new URL("./memory.css", import.meta.url), "utf8");
const CSS = SCREEN_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

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

/** Every rule of `memory.css`: selector -> its declarations (a comma list is one entry per selector). */
function rules(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, header, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of (header as string).split(",")) {
      const key = selector.trim().replace(/\s+/g, " ");
      out.set(key, `${out.get(key) ?? ""}${body as string}`);
    }
  }
  return out;
}

/** The value of `color:` in a rule's declarations (not `border-color` or `background-color`), if it sets one. */
function colorOf(declarations: string): string | undefined {
  return /(?:^|[;\s])color:\s*([^;]+);/.exec(declarations)?.[1]?.trim();
}

/** [selector in memory.css, foreground token, background token, where it is used]. */
const TEXT: readonly (readonly [string, string, string, string])[] = [
  [".memory", "ink", "ground", "the screen's own text"],
  [".memory-subtitle", "ink-tertiary", "ground", "the count line in the bar"],
  [".memory-root", "ink-tertiary", "ground", "the memory root above the tree"],
  [".memory-folder-name", "ink-tertiary", "ground", "a folder's name in the tree"],
  [".memory-cap", "ink-tertiary", "ground", "captions on the page ground"],
  [".memory-cap", "ink-tertiary", "surface", "captions in the overview's box and the Changes inspector"],
  [".memory-file", "ink-secondary", "ground", "a file's name in the tree"],
  [".memory-file:hover", "ink", "surface-sunken", "a file under the pointer"],
  [".memory-file-size", "ink-tertiary", "ground", "a file's size in the tree"],
  [".memory-file-current", "accent", "accent-soft", "the open file in the tree"],
  [".memory-file-current:hover", "accent", "accent-soft", "the open file under the pointer"],
  [".memory-file-current .memory-file-size", "accent", "accent-soft", "the open file's size"],
  [".memory-h", "ink", "ground", "the file title and the view headings"],
  [".memory-text", "ink-secondary", "ground", "the overview's paragraph"],
  [".memory-label", "ink-tertiary", "ground", "section labels (Contents, On disk now, Your edit)"],
  [".memory-label", "ink-tertiary", "surface", "the Changes inspector's label"],
  [".memory-crumb", "ink-tertiary", "ground", "the crumb above the editor and the conflict"],
  [".memory-box", "ink", "surface", "the overview's folder rows"],
  [".memory-kv dt", "ink-tertiary", "ground", "the facts' names (Path, Size, Modified, Version)"],
  [".memory-kv dd", "ink", "ground", "the facts' values"],
  [".memory-src", "ink", "surface", "a file's text, the disk's text and the owner's edit"],
  [".memory-textarea", "ink", "surface-sunken", "the editor at rest"],
  [".memory-textarea", "ink", "surface", "the editor with focus"],
  [".memory-inspector", "ink", "surface", "the Changes inspector"],
  [".memory-note[data-tone=\"danger\"]", "danger", "danger-soft", "a refusal under a save, or a failed read of a file"],
  [".memory-stale", "ink-secondary", "ground", "the line that says the tree is the last one that answered"],
  [".memory-state-title", "ink", "ground", "the empty state's heading"],
  [".memory-state-note", "ink-secondary", "ground", "the empty state's note"],
  [".memory-fail-title", "danger", "surface", "the route-failure card's heading"],
  [".memory-fail-note", "ink-secondary", "surface", "the route-failure card's note"],
  [".memory-fail-detail", "ink", "surface-sunken", "the route-failure detail line"],
  [".memory-band", "attention", "attention-soft", "the conflict's attention band"],
];

/** The Badge's and the Button's pairs on this screen (their own stylesheets set them). */
const COMPONENTS: readonly (readonly [string, string, string])[] = [
  ["ink-secondary", "surface-sunken", "the neutral badges (the folder, 'opened at version')"],
  ["attention", "attention-soft", "the 'not saved' badge"],
  ["on-accent", "accent", "the primary button's label (Edit, Save, Edit on top of the current version)"],
];

/** Non-text parts: the focus ring, and the border that marks the text on disk. */
const NON_TEXT: readonly (readonly [string, string, string])[] = [
  ["focus", "ground", "the focus ring on the page"],
  ["focus", "surface", "the focus ring on a card"],
  ["accent", "surface", "the border of the disk's text in the conflict view"],
];

describe("contrast (WCAG 2.1 AA)", () => {
  const byRule = rules();

  it.each(TEXT)("memory.css declares the colour that %s is checked as (%s on %s: %s)", (selector, fg) => {
    const declarations = byRule.get(selector);
    expect(declarations, `${selector} is a rule of memory.css`).toBeDefined();
    expect(colorOf(declarations as string), `${selector}'s color`).toBe(`var(--${fg})`);
  });

  it("lists every rule of memory.css that sets a text colour", () => {
    const listed = new Set(TEXT.map(([selector]) => selector));
    const setsColour = [...byRule.entries()].filter(([, declarations]) => {
      const colour = colorOf(declarations);
      return colour !== undefined && colour !== "inherit";
    });
    expect(setsColour.map(([selector]) => selector).filter((selector) => !listed.has(selector))).toEqual([]);
  });

  for (const [name, theme] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it.each(TEXT)(`${name}: %s is at least 4.5:1 (%s on %s: %s)`, (_selector, fg, bg) => {
      expect(ratio(hex(theme, fg), hex(theme, bg))).toBeGreaterThanOrEqual(4.5);
    });
    it.each(COMPONENTS)(`${name}: %s on %s is at least 4.5:1 (%s)`, (fg, bg) => {
      expect(ratio(hex(theme, fg), hex(theme, bg))).toBeGreaterThanOrEqual(4.5);
    });
    it.each(NON_TEXT)(`${name}: %s against %s is at least 3:1 (%s)`, (fg, bg) => {
      expect(ratio(hex(theme, fg), hex(theme, bg))).toBeGreaterThanOrEqual(3);
    });
  }

  it("the stylesheet names only tokens that exist", () => {
    const used = new Set([...CSS.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1] as string));
    expect([...used].filter((name) => !light.has(name))).toEqual([]);
  });

  it("the stylesheet takes every colour from the design tokens: no hex, no colour function, no named colour", () => {
    expect(CSS.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], "no hex colour").toEqual([]);
    expect(CSS.match(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\(/g) ?? [], "no colour function").toEqual([]);
    const named = CSS.match(/(?:color|background(?:-color)?|border(?:-[a-z]+)?|outline|fill|stroke)\s*:\s*(?:white|black|red|green|blue|gray|grey|yellow|orange|purple)\b/gi) ?? [];
    expect(named, "no named colour").toEqual([]);
  });
});
