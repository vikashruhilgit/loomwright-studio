// @vitest-environment jsdom
// DiffView: the README's anatomy (file header with path, scope and counts, hunk
// headers, two gutters and a sign column out of the copied text, add/del/context
// lines, nothing collapsed, horizontal scroll inside the diff only), the
// `onRendered` Allow gate, untrusted text staying inert (AC2), and the
// source/CSS scans (AC3, AC8, AC9). jsdom applies no CSS, so visual rules are
// asserted on DiffView.css itself.
import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiffView, type DiffHunk } from "./DiffView";
import { galleryStates, hookHunks } from "./DiffView.gallery";
import src from "./DiffView.tsx?raw";

// The stylesheet is read from disk: vitest stubs every `.css` request, `?raw`
// included, to "" (test.css is off), so `import css from "./DiffView.css?raw"`
// would make every CSS scan below pass on an empty string. The file is read
// through `process.getBuiltinModule`, typed locally so app/tsconfig.json needs
// no Node types.
interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
}
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): NodeFs } }).process.getBuiltinModule("node:fs");
const here = (import.meta as unknown as { dirname: string }).dirname;
const css = nodeFs.readFileSync(`${here}/DiffView.css`, "utf8");

const XSS = "<img src=x onerror=alert(1)>";

afterEach(cleanup);

/** The body of the rule whose selector list is exactly `selector`. */
function ruleBody(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(sheet);
  if (!match?.[1]) throw new Error(`no rule for ${selector}`);
  return match[1];
}

function rows(root: ParentNode) {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-line]"));
}

describe("anatomy", () => {
  it("shows the file header: path in mono, scope label and +/− counts from the hunks", () => {
    render(<DiffView path=".claude/settings.json" scope="project" hunks={hookHunks} />);
    const region = screen.getByRole("region", { name: "Diff of .claude/settings.json" });
    const path = region.querySelector(".diffview-path");
    expect(path?.textContent).toBe(".claude/settings.json");
    expect(ruleBody(css, ".diffview-path")).toMatch(/font-family:\s*var\(--type-mono-family\)/);
    expect(region.querySelector(".diffview-scope")?.textContent).toBe("project scope");
    const counts = region.querySelector(".diffview-counts");
    expect(counts?.getAttribute("aria-label")).toBe("6 additions, 1 deletion");
    expect(counts?.querySelector(".diffview-count-add")?.textContent).toBe("+6");
    expect(counts?.querySelector(".diffview-count-del")?.textContent).toBe("−1");
    expect(ruleBody(css, ".diffview-count-add")).toMatch(/color:\s*var\(--ok\)/);
    expect(ruleBody(css, ".diffview-count-del")).toMatch(/color:\s*var\(--danger\)/);
    expect(ruleBody(css, ".diffview-file")).toMatch(/background:\s*var\(--surface-sunken\)/);
    expect(ruleBody(css, ".diffview")).toMatch(/background:\s*var\(--surface\)/);
  });

  it("uses singular and zero counts correctly", () => {
    render(<DiffView path="a.txt" scope="global" hunks={[{ header: "@@ -1 +1 @@", lines: [{ kind: "add", newNumber: 1, text: "x" }] }]} />);
    expect(document.querySelector(".diffview-counts")?.getAttribute("aria-label")).toBe("1 addition, 0 deletions");
    expect(document.querySelector(".diffview-scope")?.textContent).toBe("global scope");
  });

  it("renders each hunk header, ink-tertiary on ground", () => {
    const hunks: DiffHunk[] = [
      { header: "@@ -1,2 +1,2 @@", lines: [{ kind: "context", oldNumber: 1, newNumber: 1, text: "a" }] },
      { header: "@@ -9,1 +9,1 @@ tail", lines: [{ kind: "context", oldNumber: 9, newNumber: 9, text: "b" }] },
    ];
    const { container } = render(<DiffView path="f" scope="project" hunks={hunks} />);
    expect(Array.from(container.querySelectorAll(".diffview-hunk-header")).map((h) => h.textContent)).toEqual(["@@ -1,2 +1,2 @@", "@@ -9,1 +9,1 @@ tail"]);
    const rule = ruleBody(css, ".diffview-hunk-header");
    expect(rule).toMatch(/color:\s*var\(--ink-tertiary\)/);
    expect(rule).toMatch(/background:\s*var\(--ground\)/);
  });

  it("gives every line two number gutters, a sign column and the text, numbered per side", () => {
    const { container } = render(<DiffView path=".claude/settings.json" scope="project" hunks={hookHunks} />);
    const lines = rows(container);
    expect(lines).toHaveLength(11);
    const cells = (row: HTMLElement) => Array.from(row.children).map((c) => c.textContent);
    expect(cells(lines[0] as HTMLElement)).toEqual(["12", "12", "", '    "SubagentStop": [']);
    expect(cells(lines[2] as HTMLElement)).toEqual(["14", "", "−", '        "matcher": "loomwright:worker",']);
    expect(cells(lines[3] as HTMLElement)).toEqual(["", "14", "+", '        "matcher": "loomwright:worker|loomwright:code-reviewer",']);
    for (const row of lines) {
      expect(row.querySelectorAll(".diffview-gutter")).toHaveLength(2);
      expect(row.querySelectorAll(".diffview-sign")).toHaveLength(1);
    }
  });

  it("marks added, deleted and context lines with their own classes and token colours", () => {
    const { container } = render(<DiffView path=".claude/settings.json" scope="project" hunks={hookHunks} />);
    const kinds = rows(container).map((r) => r.dataset.line);
    expect(kinds).toEqual(["context", "context", "del", "add", "context", "add", "add", "add", "add", "add", "context"]);
    for (const row of rows(container)) expect(row.classList.contains(`diffview-${row.dataset.line}`)).toBe(true);
    expect(ruleBody(css, ".diffview-add")).toMatch(/background:\s*var\(--diff-add-soft\)/);
    expect(ruleBody(css, ".diffview-del")).toMatch(/background:\s*var\(--diff-del-soft\)/);
    expect(ruleBody(css, ".diffview-context")).toMatch(/color:\s*var\(--ink-secondary\)/);
    expect(css).toMatch(/\.diffview-add \.diffview-gutter,\s*\.diffview-add \.diffview-sign\s*\{[^}]*color:\s*var\(--diff-add\)/);
    expect(css).toMatch(/\.diffview-del \.diffview-gutter,\s*\.diffview-del \.diffview-sign\s*\{[^}]*color:\s*var\(--diff-del\)/);
  });

  it("keeps the gutters and sign out of copied text (user-select: none), the line text selectable", () => {
    expect(ruleBody(css, ".diffview-gutter")).toMatch(/user-select:\s*none/);
    expect(ruleBody(css, ".diffview-sign")).toMatch(/user-select:\s*none/);
    expect(ruleBody(css, ".diffview-text")).toMatch(/user-select:\s*text/);
  });

  it("never collapses a hunk: every line of every hunk is in the DOM with no disclosure", () => {
    const many: DiffHunk[] = Array.from({ length: 3 }, (_, h) => ({
      header: `@@ -${h * 100 + 1},40 +${h * 100 + 1},40 @@`,
      lines: Array.from({ length: 40 }, (_, i) => ({ kind: "context" as const, oldNumber: h * 100 + i + 1, newNumber: h * 100 + i + 1, text: `line ${i}` })),
    }));
    const { container } = render(<DiffView path="big.txt" scope="project" hunks={many} />);
    expect(rows(container)).toHaveLength(120);
    expect(container.querySelector("details, [aria-expanded], [hidden]")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("scrolls long lines horizontally inside the diff only", () => {
    expect(ruleBody(css, ".diffview")).toMatch(/overflow:\s*hidden/);
    expect(ruleBody(css, ".diffview")).toMatch(/min-width:\s*0/);
    expect(ruleBody(css, ".diffview-body")).toMatch(/overflow-x:\s*auto/);
    expect(ruleBody(css, ".diffview-lines")).toMatch(/width:\s*max-content/);
    expect(ruleBody(css, ".diffview-line")).toMatch(/white-space:\s*pre/);
    expect(ruleBody(css, ".diffview-line")).toMatch(/grid-template-columns:\s*40px 40px 16px 1fr/);
  });

  it("shows an empty diff as such", () => {
    render(<DiffView path="notes.md" scope="project" hunks={[]} />);
    expect(screen.getByText("No changes in this diff.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Diff of notes.md" }).querySelector(".diffview-counts")?.textContent).toBe("+0 −0");
  });
});

describe("onRendered (the approval's Allow gate)", () => {
  it("fires once, after the hunk rows are in the DOM", () => {
    const rowsAtCall: number[] = [];
    const onRendered = vi.fn(() => {
      rowsAtCall.push(document.querySelectorAll("[data-line]").length);
    });
    const { rerender } = render(<DiffView path="f" scope="project" hunks={hookHunks} onRendered={onRendered} />);
    expect(onRendered).toHaveBeenCalledTimes(1);
    expect(rowsAtCall).toEqual([11]);
    rerender(<DiffView path="f" scope="project" hunks={hookHunks} onRendered={onRendered} />);
    rerender(<DiffView path="f" scope="project" hunks={[...hookHunks]} onRendered={onRendered} />);
    expect(onRendered).toHaveBeenCalledTimes(1);
  });

  it("does not fire while there is nothing to review, then fires once the hunks arrive", () => {
    const onRendered = vi.fn(() => {
      expect(document.querySelectorAll("[data-line]").length).toBeGreaterThan(0);
    });
    const { rerender } = render(<DiffView path="f" scope="project" hunks={[]} onRendered={onRendered} />);
    rerender(<DiffView path="f" scope="project" hunks={[{ header: "@@ -1 +1 @@", lines: [] }]} onRendered={onRendered} />);
    expect(onRendered).not.toHaveBeenCalled();
    rerender(<DiffView path="f" scope="project" hunks={hookHunks} onRendered={onRendered} />);
    expect(onRendered).toHaveBeenCalledTimes(1);
  });

  it("re-gates when the instance shows a new diff: diff A then diff B each fire exactly once", () => {
    const bHunks: DiffHunk[] = [{ header: "@@ -1 +1 @@", lines: [{ kind: "add", newNumber: 1, text: "echo b" }] }];
    const onA = vi.fn();
    const onB = vi.fn(() => {
      expect(document.querySelector(".diffview-text")?.textContent).toBe("echo b");
    });
    const { rerender } = render(<DiffView path="a.json" scope="project" hunks={hookHunks} onRendered={onA} />);
    expect(onA).toHaveBeenCalledTimes(1);
    rerender(<DiffView path="b.sh" scope="project" hunks={bHunks} onRendered={onB} />);
    expect(onB).toHaveBeenCalledTimes(1);
    rerender(<DiffView path="b.sh" scope="project" hunks={bHunks} onRendered={onB} />);
    rerender(<DiffView path="b.sh" scope="project" hunks={[...bHunks]} onRendered={onB} />);
    expect(onB).toHaveBeenCalledTimes(1);
    expect(onA).toHaveBeenCalledTimes(1);
  });

  it("re-gates when only the path changes", () => {
    const onRendered = vi.fn();
    const { rerender } = render(<DiffView path="a.json" scope="project" hunks={hookHunks} onRendered={onRendered} />);
    rerender(<DiffView path="b.json" scope="project" hunks={hookHunks} onRendered={onRendered} />);
    expect(onRendered).toHaveBeenCalledTimes(2);
  });

  it("fires once, after the rows render, under StrictMode's double effects", () => {
    const rowsAtCall: number[] = [];
    const onRendered = vi.fn(() => {
      rowsAtCall.push(document.querySelectorAll("[data-line]").length);
    });
    render(
      <StrictMode>
        <DiffView path="f" scope="project" hunks={hookHunks} onRendered={onRendered} />
      </StrictMode>,
    );
    expect(onRendered).toHaveBeenCalledTimes(1);
    expect(rowsAtCall).toEqual([11]);
  });

  it("calls the latest handler and tolerates none", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<DiffView path="f" scope="project" hunks={[]} onRendered={first} />);
    rerender(<DiffView path="f" scope="project" hunks={hookHunks} onRendered={second} />);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(() => render(<DiffView path="g" scope="project" hunks={hookHunks} />)).not.toThrow();
  });
});

describe("untrusted text is inert (AC2)", () => {
  it("renders an <img …> string in the path, scope, hunk header and line text as literal text", () => {
    const { container } = render(
      <DiffView path={XSS} scope={XSS} hunks={[{ header: XSS, lines: [{ kind: "add", newNumber: 1, text: XSS }, { kind: "del", oldNumber: 1, text: XSS }, { kind: "context", oldNumber: 2, newNumber: 2, text: XSS }] }]} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".diffview-path")?.textContent).toBe(XSS);
    expect(container.querySelector(".diffview-scope")?.textContent).toBe(`${XSS} scope`);
    expect(container.querySelector(".diffview-hunk-header")?.textContent).toBe(XSS);
    expect(Array.from(container.querySelectorAll(".diffview-text")).map((t) => t.textContent)).toEqual([XSS, XSS, XSS]);
  });
});

describe("keyboard (AC9)", () => {
  it("has no buttons; the horizontal scroller is the one tab stop, named, so keyboard users can scroll it", () => {
    const { container } = render(<DiffView path=".claude/settings.json" scope="project" hunks={hookHunks} />);
    const stops = Array.from(container.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]")).filter((el) => el.tabIndex >= 0);
    expect(stops).toHaveLength(1);
    const scroller = stops[0] as HTMLElement;
    expect(scroller.classList.contains("diffview-body")).toBe(true);
    expect(scroller.tabIndex).toBe(0);
    expect(screen.getByRole("group", { name: "Lines of .claude/settings.json" })).toBe(scroller);
    scroller.focus();
    expect(document.activeElement).toBe(scroller);
  });

  it("an empty diff has no tab stop", () => {
    const { container } = render(<DiffView path="e" scope="project" hunks={[]} />);
    expect(container.querySelectorAll("[tabindex]")).toHaveLength(0);
  });
});

// ---- Source and stylesheet scans (AC3, AC8, AC9). Only DiffView.tsx and DiffView.css are read. ----

const NAMED_COLOURS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue " +
    "chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey " +
    "darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray " +
    "darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen " +
    "fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen " +
    "lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime " +
    "limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue " +
    "mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive " +
    "olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver " +
    "skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white " +
    "whitesmoke yellow yellowgreen canvas canvastext linktext visitedtext activetext buttonface buttontext field fieldtext " +
    "highlight highlighttext graytext"
  ).split(" "),
);
const COLOUR_PROPERTY = /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|text-decoration(?:-color)?|caret-color|accent-color|column-rule(?:-color)?|stop-color|flood-color|lighting-color)$/i;
const COLOUR_KEY = /^(?:color|background(?:Color)?|border(?:Top|Right|Bottom|Left)?(?:Color)?|outline(?:Color)?|fill|stroke|boxShadow|textShadow|textDecoration(?:Color)?|caretColor|accentColor)$/;
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?)\(/i;

function namedColourIn(value: string): string | undefined {
  const words = value.replace(/var\([^)]*\)/g, " ").match(/[a-zA-Z][a-zA-Z-]*/g) ?? [];
  return words.find((w) => NAMED_COLOURS.has(w.toLowerCase()));
}

/** Colour literals in CSS declaration values (strings and comments ignored). */
function cssColourViolations(sheet: string): string[] {
  const found: string[] = [];
  const clean = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of clean.matchAll(/\{([^{}]*)\}/g)) {
    for (const declaration of (block[1] ?? "").split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim();
      const value = declaration.slice(colon + 1).replace(/"[^"]*"|'[^']*'/g, '""');
      if (HEX.test(value) || COLOUR_FUNCTION.test(value)) found.push(declaration.trim());
      else if (COLOUR_PROPERTY.test(property) && namedColourIn(value)) found.push(declaration.trim());
    }
  }
  return found;
}

/** Colour literals in a component's source: style objects, quoted hex strings, colour functions. JSX text is not scanned. */
function tsxColourViolations(source: string): string[] {
  const found: string[] = [];
  for (const style of source.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    const body = style[1] ?? "";
    if (HEX.test(body)) found.push(body.trim());
    for (const entry of body.matchAll(/(\w+)\s*:\s*["'`]([^"'`]*)["'`]/g)) {
      if (COLOUR_KEY.test(entry[1] ?? "") && namedColourIn(entry[2] ?? "")) found.push(entry[0]);
    }
  }
  for (const quoted of source.matchAll(/["'`]#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})["'`]/g)) found.push(quoted[0]);
  for (const fn of source.matchAll(/\b(?:rgba?|hsla?)\([^)]*\)/gi)) found.push(fn[0]);
  return found;
}

/** The sheet with every `@media (prefers-reduced-motion: no-preference) { … }` block removed. */
function outsideMotionQuery(sheet: string): string {
  const opener = /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)\s*\{/g;
  let out = "";
  let from = 0;
  for (let m = opener.exec(sheet); m; m = opener.exec(sheet)) {
    out += sheet.slice(from, m.index);
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < sheet.length && depth > 0; i += 1) {
      if (sheet[i] === "{") depth += 1;
      else if (sheet[i] === "}") depth -= 1;
    }
    from = i;
    opener.lastIndex = i;
  }
  return out + sheet.slice(from);
}

const MOTION = /(?:^|[\s;{])(?:transition|animation)(?:-[a-z-]+)?\s*:/;

describe("source scans", () => {
  it("DiffView.tsx never sets raw HTML (AC3)", () => {
    expect(src).toContain("export function DiffView");
    expect(src.includes("dangerously" + "SetInnerHTML")).toBe(false);
    expect(src.includes("inner" + "HTML")).toBe(false);
  });

  it("the colour matcher flags a literal and spares text like PR #401 (AC8 self-test)", () => {
    expect(cssColourViolations(".x { color: #ffffff; }")).toEqual(["color: #ffffff"]);
    expect(cssColourViolations(".x { background: rgba(0, 0, 0, 0.2); border-color: red; }")).toHaveLength(2);
    expect(cssColourViolations('.x { color: var(--ink); background: transparent; border: 1px solid currentColor; content: "PR #401"; }')).toEqual([]);
    expect(tsxColourViolations('<div style={{ color: "#ffffff" }} />')).not.toEqual([]);
    expect(tsxColourViolations('<div style={{ color: "white" }} />')).not.toEqual([]);
    expect(tsxColourViolations('<path fill="#fff" />')).not.toEqual([]);
    expect(tsxColourViolations('<div style={{ background: "rgb(0 0 0)" }} />')).not.toEqual([]);
    expect(tsxColourViolations("<span>PR #401</span>")).toEqual([]);
    expect(tsxColourViolations('<div style={{ color: "var(--ink)" }} />')).toEqual([]);
  });

  it("DiffView.css and DiffView.tsx use no hard-coded colour, only tokens (AC8)", () => {
    // Guard: the scans below must never run on an empty (stubbed) sheet.
    expect(css).toContain(".diffview-gutter");
    expect(cssColourViolations(css)).toEqual([]);
    expect(tsxColourViolations(src)).toEqual([]);
  });

  it("DiffView.css has a :focus-visible ring using var(--focus) (AC9)", () => {
    expect(css).toMatch(/:focus-visible[^{]*\{[^}]*outline:[^;}]*var\(--focus\)/);
  });

  it("DiffView.css has no transition or animation outside prefers-reduced-motion: no-preference (AC9)", () => {
    expect(MOTION.test(outsideMotionQuery(".a { transition: opacity 120ms; }"))).toBe(true);
    expect(MOTION.test(outsideMotionQuery("@media (prefers-reduced-motion: no-preference) { .a { transition: opacity 120ms; } }"))).toBe(false);
    expect(MOTION.test(outsideMotionQuery(css))).toBe(false);
  });
});

describe("gallery", () => {
  it("renders every state with a unique id, including the inert <img …> string", () => {
    const ids = galleryStates.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const state of galleryStates) {
      const { container, unmount } = render(state.element);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("[role='region']")).not.toBeNull();
      unmount();
    }
    const untrusted = galleryStates.find((s) => s.id === "untrusted-text");
    expect(untrusted).toBeDefined();
    const { container } = render(untrusted?.element ?? <></>);
    expect(container.textContent).toContain(XSS);
  });
});
