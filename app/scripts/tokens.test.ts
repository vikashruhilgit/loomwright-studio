// The tokens pin (Criterion 9): the checked-in app/src/styles/tokens.css
// equals `node app/scripts/tokens.mjs`'s output byte for byte, and holds the
// light and dark custom properties plus the layout width tokens. A drift
// either way (tokens.json changed, or the CSS hand-edited) fails here; the
// fix is `npm run tokens`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./tokens.mjs", import.meta.url));
const CSS = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));
const JSON_PATH = fileURLToPath(new URL("../../docs/design/tokens.json", import.meta.url));

describe("tokens.css", () => {
  const generated = execFileSync(process.execPath, [SCRIPT], { encoding: "buffer" });
  const checkedIn = readFileSync(CSS);

  it("equals the generator's output byte for byte", () => {
    expect(checkedIn.equals(generated)).toBe(true);
  });

  it("holds every colour in light and dark, and the layout widths", () => {
    const css = checkedIn.toString("utf8");
    const tokens = JSON.parse(readFileSync(JSON_PATH, "utf8")) as { color: { tokens: { name: string; value: unknown }[] } };
    const [light, ...darkBlocks] = css.split("@media (prefers-color-scheme: dark)");
    const dark = darkBlocks.join("");
    for (const { name, value } of tokens.color.tokens) {
      if (typeof value === "object" && value !== null) {
        const { light: l, dark: d } = value as { light: string; dark: string };
        expect(light).toContain(`--${name}: ${l};`);
        expect(dark).toContain(`--${name}: ${d};`);
      } else {
        expect(light).toContain(`--${name}: var(--`);
      }
    }
    for (const line of ["--sidebar-width: 240px;", "--titlebar-height: 52px;", "--inspector-width: 320px;", "--list-pane-width: 360px;"]) {
      expect(css).toContain(line);
    }
    expect(css).toContain(':root[data-theme="dark"] {');
  });
});
