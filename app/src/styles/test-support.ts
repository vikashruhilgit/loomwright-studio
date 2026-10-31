// Test-only support for the screens' WCAG contrast suites (`screens/*/contrast.test.ts`): the
// token parsing of `tokens.css` for the light and the dark theme, hex resolution (following
// `var(--x)` aliases), relative luminance and the contrast ratio. Each screen keeps its own
// pair lists and assertions. Imported by tests only; never by the app.
import { readFileSync } from "node:fs";

const TOKENS = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

/** The custom properties of the block that starts at `marker`, up to its closing brace. */
function block(marker: string): Map<string, string> {
  const start = TOKENS.indexOf(marker);
  if (start < 0) throw new Error(`no ${marker} in tokens.css`);
  const body = TOKENS.slice(TOKENS.indexOf("{", start) + 1, TOKENS.indexOf("}", start));
  return new Map([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
}

/** The light theme's tokens (the `:root` block). */
export const light = block(":root {");
/** The dark theme's tokens: the light ones overridden by the dark block. */
export const dark = new Map([...light, ...block(':root[data-theme="dark"]')]);

/** The 6-digit hex that token `name` resolves to in `theme`; throws if it is not one. */
export function hex(theme: Map<string, string>, name: string): string {
  let value = theme.get(name);
  while (value !== undefined && value.startsWith("var(")) value = theme.get(value.slice(6, -1));
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--${name} is not a 6-digit hex: ${String(value)}`);
  return value;
}

export function luminance(color: string): number {
  const channel = (i: number): number => {
    const c = parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** The WCAG contrast ratio of two hex colours. */
export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
