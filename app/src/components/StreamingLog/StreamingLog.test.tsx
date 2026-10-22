// @vitest-environment jsdom
// StreamingLog (docs/design/design-system/components/StreamingLog/README.md): the header
// (status slot, agent, task, running time, tabular tokens, an optional cost only as
// "≈ at API rates"), Stop and Kill, the line kinds, the static caret, `role="log"` with
// `aria-live="off"`, "Read latest" and polite status announcements (AC1); untrusted text
// stays inert (AC2); follow / Jump to latest scrolling (AC4); keyboard access (AC9); and
// the folder's source scans: no raw-HTML injection (AC3), no hard-coded colour (AC8), a
// focus ring on `var(--focus)` and no motion outside `prefers-reduced-motion: no-preference` (AC9).
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import source from "./StreamingLog.tsx?raw";
import { StreamingLog, type StreamingLogLine, type StreamingLogProps } from "./StreamingLog";

// The CSS is read from disk, not through `?raw`: under vitest's default `test.css`
// setting every `.css` request, `?raw` included, is transformed to an empty string,
// so a `?raw` scan of the stylesheet would pass vacuously. `process.getBuiltinModule`
// keeps Node types out of app/tsconfig.json, and vitest's `import.meta.dirname` names this
// folder (jsdom's `URL` resolves relative URLs against http://localhost, so no file URL).
// The "reads the real files" test below guards against an empty read.
interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
}
const nodeProcess = (globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): NodeFs } }).process;
const here = (import.meta as ImportMeta & { readonly dirname: string }).dirname;
const css = nodeProcess.getBuiltinModule("node:fs").readFileSync(`${here}/StreamingLog.css`, "utf8");

const XSS = "<img src=x onerror=alert(1)>";

const LINES: readonly StreamingLogLine[] = [
  { id: "1", kind: "tool", time: "14:02:11", tool: "Bash", text: "gh pr view 412" },
  { id: "2", kind: "output", time: "14:02:12", text: "12 files · 0 reviews" },
  { id: "3", kind: "prose", time: "14:02:31", text: "The hook prints ok false on failure." },
  { id: "4", kind: "error", time: "14:02:41", text: "exit 0 · no decision recorded" },
  { id: "5", kind: "ok", time: "14:02:55", text: "Finding confirmed against the fixture" },
];

function makeLines(count: number, start = 0): StreamingLogLine[] {
  return Array.from({ length: count }, (_, i) => ({ id: `n${start + i}`, kind: "output", time: "14:10:00", text: `line ${start + i}` }));
}

function props(overrides: Partial<StreamingLogProps> = {}): StreamingLogProps {
  return {
    status: <span data-testid="status-slot">dot</span>,
    statusLabel: "running",
    agent: "Mason",
    task: "review PR #412",
    elapsed: "4m 12s",
    tokens: 14_208,
    lines: LINES,
    onStop: vi.fn(),
    onKillRequest: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

/** The header bar. Inside a <section> a <header> has no banner role, so it is found by its class. */
function headerBar(): HTMLElement {
  const bar = document.querySelector<HTMLElement>("header.streaming-log__bar");
  if (!bar) throw new Error("no header bar");
  return bar;
}

describe("StreamingLog header", () => {
  it("shows the status slot, agent, task, running time and tabular tokens", () => {
    render(<StreamingLog {...props()} />);
    const bar = within(headerBar());
    expect(bar.getByTestId("status-slot")).toBeTruthy();
    expect(bar.getByText("Mason")).toBeTruthy();
    expect(bar.getByText("review PR #412")).toBeTruthy();
    expect(bar.getByText("4m 12s").className).toContain("streaming-log__num");
    const tokens = screen.getByTestId("streaming-log-tokens");
    expect(tokens.textContent).toBe("14,208 tokens");
    expect(tokens.className).toContain("streaming-log__num");
    expect(css).toMatch(/\.streaming-log__num\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  it("labels a passed cost '≈ at API rates' and never as a limit or budget", () => {
    render(<StreamingLog {...props({ cost: 0.11 })} />);
    const cost = screen.getByTestId("streaming-log-cost");
    expect(cost.textContent).toBe("≈$0.11 at API rates");
    expect(headerBar().textContent).not.toMatch(/budget|limit/i);
  });

  it("omits the cost when none is passed: tokens only", () => {
    render(<StreamingLog {...props()} />);
    expect(screen.queryByTestId("streaming-log-cost")).toBeNull();
    expect(headerBar().textContent).not.toContain("$");
  });

  it("shows a zero cost (never swallowed as falsy) and omits a non-finite one", () => {
    const { rerender } = render(<StreamingLog {...props({ cost: 0, tokens: 0 })} />);
    expect(screen.getByTestId("streaming-log-cost").textContent).toBe("≈$0.00 at API rates");
    expect(screen.getByTestId("streaming-log-tokens").textContent).toBe("0 tokens");
    rerender(<StreamingLog {...props({ cost: Number.NaN })} />);
    expect(screen.queryByTestId("streaming-log-cost")).toBeNull();
  });

  it("renders without a status slot", () => {
    const { container } = render(<StreamingLog {...props({ status: undefined })} />);
    expect(container.querySelector(".streaming-log__status")).toBeNull();
    expect(screen.getByTestId("streaming-log-status").textContent).toBe("running");
  });

  it("Stop calls onStop and Kill only requests a kill", () => {
    const p = props();
    render(<StreamingLog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(p.onStop).toHaveBeenCalledTimes(1);
    expect(p.onKillRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    expect(p.onKillRequest).toHaveBeenCalledTimes(1);
    expect(p.onStop).toHaveBeenCalledTimes(1);
  });

  it("⌘. inside the component stops the session; a plain '.' does not", () => {
    const p = props();
    render(<StreamingLog {...p} />);
    const log = screen.getByRole("log");
    fireEvent.keyDown(log, { key: "." });
    expect(p.onStop).not.toHaveBeenCalled();
    fireEvent.keyDown(log, { key: ".", metaKey: true });
    expect(p.onStop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Stop" }).getAttribute("aria-keyshortcuts")).toBe("Meta+Period");
  });

  it("an ended session keeps Stop and Kill focusable but inert", () => {
    const p = props({ live: false, statusLabel: "stopped" });
    render(<StreamingLog {...p} />);
    const stop = screen.getByRole("button", { name: "Stop" });
    const kill = screen.getByRole("button", { name: "Kill" });
    expect(stop.getAttribute("aria-disabled")).toBe("true");
    expect(kill.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(stop);
    fireEvent.click(kill);
    fireEvent.keyDown(screen.getByRole("log"), { key: ".", metaKey: true });
    expect(p.onStop).not.toHaveBeenCalled();
    expect(p.onKillRequest).not.toHaveBeenCalled();
  });

  it("announces status changes politely from the header", () => {
    const { rerender } = render(<StreamingLog {...props()} />);
    const region = screen.getByTestId("streaming-log-status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.closest("header")).toBeTruthy();
    expect(region.textContent).toBe("running");
    rerender(<StreamingLog {...props({ statusLabel: "killed", live: false })} />);
    expect(screen.getByTestId("streaming-log-status").textContent).toBe("killed");
  });
});

describe("StreamingLog lines", () => {
  it("is role=log with aria-live=off, so a running session never floods a screen reader", () => {
    render(<StreamingLog {...props()} />);
    const log = screen.getByRole("log", { name: "Session output" });
    expect(log.getAttribute("aria-live")).toBe("off");
  });

  it("renders each kind with its class, a timestamp gutter, and the tool prefix ▸ in accent", () => {
    const { container } = render(<StreamingLog {...props()} />);
    const rows = [...container.querySelectorAll<HTMLElement>(".streaming-log__line")];
    expect(rows.map((r) => r.dataset.kind)).toEqual(["tool", "output", "prose", "error", "ok"]);
    expect(rows.map((r) => r.querySelector("time")?.textContent)).toEqual(["14:02:11", "14:02:12", "14:02:31", "14:02:41", "14:02:55"]);
    const kinds = ["tool", "output", "prose", "error", "ok"];
    rows.forEach((row, i) => expect(row.querySelector(".streaming-log__text")?.className).toContain(`streaming-log__text--${kinds[i]}`));
    const tool = rows[0]!;
    expect(tool.querySelector(".streaming-log__prompt")?.textContent?.trim()).toBe("▸");
    expect(tool.querySelector(".streaming-log__tool")?.textContent).toBe("Bash");
    expect(tool.textContent).toContain("gh pr view 412");
    expect(css).toMatch(/\.streaming-log__prompt\s*\{[^}]*color:\s*var\(--accent\)/);
    expect(css).toMatch(/\.streaming-log__text--tool\s*\{[^}]*color:\s*var\(--accent\)/);
    expect(css).toMatch(/\.streaming-log__text--output\s*\{[^}]*color:\s*var\(--ink\)/);
    expect(css).toMatch(/\.streaming-log__text--prose\s*\{[^}]*color:\s*var\(--ink-secondary\)/);
    expect(css).toMatch(/\.streaming-log__text--error\s*\{[^}]*color:\s*var\(--danger\)/);
    expect(css).toMatch(/\.streaming-log__text--ok\s*\{[^}]*color:\s*var\(--ok\)/);
    expect(css).toMatch(/\.streaming-log__time\s*\{[^}]*color:\s*var\(--ink-tertiary\)/);
  });

  it("gives error and verified lines a word as well as a colour", () => {
    const { container } = render(<StreamingLog {...props()} />);
    const rows = container.querySelectorAll(".streaming-log__line");
    expect(rows[3]?.textContent).toContain("Error: exit 0");
    expect(rows[4]?.textContent).toContain("Verified: Finding confirmed");
  });

  it("marks the live end with one static caret, and none once the session has ended", () => {
    const { container, rerender } = render(<StreamingLog {...props()} />);
    const carets = screen.getAllByTestId("streaming-log-caret");
    expect(carets).toHaveLength(1);
    expect(carets[0]?.getAttribute("aria-hidden")).toBe("true");
    const rows = container.querySelectorAll(".streaming-log__line");
    expect(rows[rows.length - 1]?.contains(carets[0]!)).toBe(true);
    expect(css).toMatch(/\.streaming-log__caret\s*\{[^}]*background:\s*var\(--accent\)/);
    rerender(<StreamingLog {...props({ live: false })} />);
    expect(screen.queryByTestId("streaming-log-caret")).toBeNull();
  });

  it("an empty running log shows only the caret; an empty ended log says 'No output'", () => {
    const { rerender } = render(<StreamingLog {...props({ lines: [] })} />);
    expect(screen.getAllByTestId("streaming-log-caret")).toHaveLength(1);
    rerender(<StreamingLog {...props({ lines: [], live: false })} />);
    expect(screen.getByRole("log").textContent).toBe("No output");
  });

  it("'Read latest' puts the last line in the polite live region, every time it is pressed", () => {
    render(<StreamingLog {...props()} />);
    const region = screen.getByTestId("streaming-log-latest");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Read latest" }));
    expect(region.textContent).toBe("Verified: Finding confirmed against the fixture");
    const first = region.firstElementChild;
    fireEvent.click(screen.getByRole("button", { name: "Read latest" }));
    // A fresh node, so a screen reader announces the same line again.
    expect(region.firstElementChild).not.toBe(first);
    expect(region.textContent).toBe("Verified: Finding confirmed against the fixture");
  });

  it("'Read latest' reads a tool line with its tool name, and says so when there is no output", () => {
    const { rerender } = render(<StreamingLog {...props({ lines: [LINES[0]!] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Read latest" }));
    expect(screen.getByTestId("streaming-log-latest").textContent).toBe("Bash gh pr view 412");
    rerender(<StreamingLog {...props({ lines: [] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Read latest" }));
    expect(screen.getByTestId("streaming-log-latest").textContent).toBe("No output yet");
  });

  it("names a tool line 'Tool' when the tool name is missing", () => {
    const { container } = render(<StreamingLog {...props({ lines: [{ id: "t", kind: "tool", time: "14:00:00", text: "ls" }] })} />);
    expect(container.querySelector(".streaming-log__tool")?.textContent).toBe("Tool");
    fireEvent.click(screen.getByRole("button", { name: "Read latest" }));
    expect(screen.getByTestId("streaming-log-latest").textContent).toBe("Tool ls");
  });
});

describe("StreamingLog renders untrusted text inert (AC2)", () => {
  it("shows an <img onerror> string literally in a line, a tool name, the agent and the task", () => {
    const lines: StreamingLogLine[] = [
      { id: "a", kind: "output", time: "14:00:00", text: XSS },
      { id: "b", kind: "tool", time: "14:00:01", tool: XSS, text: XSS },
      { id: "c", kind: "prose", time: "14:00:02", text: "[x](javascript:alert(1))" },
    ];
    const { container } = render(<StreamingLog {...props({ agent: XSS, task: XSS, lines })} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[href]")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    const rows = container.querySelectorAll(".streaming-log__line");
    expect(rows[0]?.querySelector(".streaming-log__text")?.textContent).toBe(XSS);
    expect(rows[1]?.querySelector(".streaming-log__tool")?.textContent).toBe(XSS);
    expect(rows[2]?.textContent).toContain("[x](javascript:alert(1))");
    expect(headerBar().textContent).toContain(XSS);
  });
});

/**
 * jsdom has no layout: give the log a fixed viewport and a scroll height that grows with
 * its lines, with `scrollTop` clamped to the end the way a browser clamps it.
 */
function stubLayout(log: HTMLElement, { clientHeight = 200, lineHeight = 18 } = {}) {
  let top = 0;
  const scrollHeight = () => log.querySelectorAll(".streaming-log__line").length * lineHeight;
  Object.defineProperty(log, "clientHeight", { configurable: true, get: () => clientHeight });
  Object.defineProperty(log, "scrollHeight", { configurable: true, get: scrollHeight });
  Object.defineProperty(log, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, scrollHeight() - clientHeight));
    },
  });
  return { maxTop: () => scrollHeight() - clientHeight };
}

describe("StreamingLog follows without jank (AC4)", () => {
  it("a reader scrolled up keeps scrollTop when 50 lines arrive, and the pill reads 'Jump to latest'", () => {
    const initial = makeLines(40);
    const { rerender } = render(<StreamingLog {...props({ lines: initial })} />);
    const log = screen.getByRole("log");
    stubLayout(log);
    log.scrollTop = 100;
    fireEvent.scroll(log);
    expect(screen.getByTestId("streaming-log-pill").textContent).toBe("Jump to latest");
    rerender(<StreamingLog {...props({ lines: [...initial, ...makeLines(50, 40)] })} />);
    expect(log.scrollTop).toBe(100);
    expect(screen.getByTestId("streaming-log-pill").textContent).toBe("Jump to latest");
  });

  it("a reader at the bottom stays pinned as lines arrive, and the pill reads 'Following'", () => {
    const initial = makeLines(40);
    const { rerender } = render(<StreamingLog {...props({ lines: initial })} />);
    const log = screen.getByRole("log");
    const layout = stubLayout(log);
    log.scrollTop = layout.maxTop();
    fireEvent.scroll(log);
    expect(screen.getByTestId("streaming-log-pill").textContent).toBe("Following");
    const before = log.scrollTop;
    rerender(<StreamingLog {...props({ lines: [...initial, ...makeLines(50, 40)] })} />);
    expect(log.scrollTop).toBe(layout.maxTop());
    expect(log.scrollTop).toBeGreaterThan(before);
    expect(screen.getByTestId("streaming-log-pill").textContent).toBe("Following");
  });

  it("'Jump to latest' returns to the bottom, moves focus into the log, and resumes following", () => {
    let lines = makeLines(40);
    const { rerender } = render(<StreamingLog {...props({ lines })} />);
    const log = screen.getByRole("log");
    const layout = stubLayout(log);
    log.scrollTop = 0;
    fireEvent.scroll(log);
    lines = [...lines, ...makeLines(50, 40)];
    rerender(<StreamingLog {...props({ lines })} />);
    expect(log.scrollTop).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(log.scrollTop).toBe(layout.maxTop());
    expect(screen.getByTestId("streaming-log-pill").textContent).toBe("Following");
    expect(document.activeElement).toBe(log);
    lines = [...lines, ...makeLines(50, 90)];
    rerender(<StreamingLog {...props({ lines })} />);
    expect(log.scrollTop).toBe(layout.maxTop());
  });

  it("keeps the pill outside the log, so the log's content never includes it", () => {
    render(<StreamingLog {...props()} />);
    expect(screen.getByRole("log").contains(screen.getByTestId("streaming-log-pill"))).toBe(false);
  });
});

describe("StreamingLog keyboard access (AC9)", () => {
  const TABBABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  it("every control is a native button with a name, in DOM tab order with no positive tabindex", () => {
    const { container } = render(<StreamingLog {...props({ lines: makeLines(40) })} />);
    let tabbables = [...container.querySelectorAll<HTMLElement>(TABBABLE)];
    expect(tabbables.map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim())).toEqual([
      "Read latest",
      "Stop ⌘.",
      "Kill",
      "Session output",
    ]);
    expect(screen.getAllByRole("button").map((b) => b.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
    for (const el of tabbables) expect(el.tabIndex).toBe(0);

    // Scrolled up, the pill becomes a fourth control after the log.
    const log = screen.getByRole("log");
    stubLayout(log);
    log.scrollTop = 0;
    fireEvent.scroll(log);
    tabbables = [...container.querySelectorAll<HTMLElement>(TABBABLE)];
    expect(tabbables.at(-1)?.textContent).toBe("Jump to latest");
    expect(tabbables.at(-1)?.tagName).toBe("BUTTON");
    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("type")).toBe("button");
      expect(button.textContent?.trim() || button.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("Tab reaches each control in order, and Enter and Space activate it", () => {
    const p = props();
    const { container } = render(<StreamingLog {...p} />);
    const order = [...container.querySelectorAll<HTMLElement>(TABBABLE)];
    for (const el of order) {
      act(() => el.focus());
      expect(document.activeElement).toBe(el);
    }
    // jsdom does not synthesise a click from a key on a button; a browser does for a native
    // <button> (proven in Electron by AC10). Emulate that activation for each key.
    const activate = (el: HTMLElement, key: "Enter" | " ") => {
      act(() => el.focus());
      const notCancelled = fireEvent.keyDown(el, { key });
      if (notCancelled && el.tagName === "BUTTON") fireEvent.click(el);
      fireEvent.keyUp(el, { key });
    };
    activate(screen.getByRole("button", { name: "Stop" }), "Enter");
    activate(screen.getByRole("button", { name: "Stop" }), " ");
    expect(p.onStop).toHaveBeenCalledTimes(2);
    activate(screen.getByRole("button", { name: "Kill" }), "Enter");
    activate(screen.getByRole("button", { name: "Kill" }), " ");
    expect(p.onKillRequest).toHaveBeenCalledTimes(2);
    activate(screen.getByRole("button", { name: "Read latest" }), "Enter");
    expect(screen.getByTestId("streaming-log-latest").textContent).toContain("Finding confirmed");
  });
});

// ---- Source scans (AC3, AC8, AC9). Only StreamingLog.tsx and StreamingLog.css are read. ----

const NAMED_COLOURS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
    "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray " +
    "darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue " +
    "firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew " +
    "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue " +
    "mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
    "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
    "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue " +
    "slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white " +
    "whitesmoke yellow yellowgreen"
  ).split(" "),
);
const COLOUR_PROPERTY =
  /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|fill|stroke|caret-color|text-decoration(?:-color)?|column-rule(?:-color)?|box-shadow|text-shadow|accent-color|text-emphasis(?:-color)?|scrollbar-color)$/;
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?)\s*\(/i;

function valueViolations(property: string, value: string): string[] {
  const found: string[] = [];
  if (HEX.test(value)) found.push(`hex colour in ${property}: ${value.trim()}`);
  if (COLOUR_FUNCTION.test(value)) found.push(`colour function in ${property}: ${value.trim()}`);
  if (COLOUR_PROPERTY.test(property)) {
    const words = value.replace(/var\([^)]*\)/g, " ").toLowerCase().match(/[a-z]+/g) ?? [];
    for (const word of words) if (NAMED_COLOURS.has(word)) found.push(`named colour in ${property}: ${word}`);
  }
  return found;
}

/** Colour literals in CSS declaration values. Quoted strings (`content: "PR #401"`) are not colours. */
function cssColourViolations(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const found: string[] = [];
  // Each segment ends at `{` (a selector or at-rule prelude: skipped), `;`, `}` or the end (a declaration).
  for (const match of code.matchAll(/([^{};]*)([{};]|$)/g)) {
    if (match[2] === "{") continue;
    const segment = match[1] ?? "";
    const colon = segment.indexOf(":");
    if (colon < 0) continue;
    const property = segment.slice(0, colon).trim().toLowerCase();
    if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(property)) continue;
    found.push(...valueViolations(property, segment.slice(colon + 1)));
  }
  return found;
}

/** Colour literals in a TSX file's `style={{ … }}` objects, colour-function literals anywhere, and hex-colour string literals. JSX text is not scanned. */
function tsxColourViolations(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const found: string[] = [];
  for (const start of code.matchAll(/style=\{\{/g)) {
    let depth = 2;
    let i = (start.index ?? 0) + start[0].length;
    const bodyStart = i;
    while (i < code.length && depth > 0) {
      if (code[i] === "{") depth += 1;
      else if (code[i] === "}") depth -= 1;
      i += 1;
    }
    const body = code.slice(bodyStart, i - 2);
    for (const entry of body.matchAll(/([A-Za-z]+)\s*:\s*([^,]+)/g)) {
      const property = (entry[1] ?? "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      found.push(...valueViolations(property, (entry[2] ?? "").replace(/^\s*["'`]|["'`]\s*$/g, "")));
    }
  }
  if (COLOUR_FUNCTION.test(code.replace(/>[^<>{}]*</g, "><"))) found.push("colour function literal");
  for (const literal of code.matchAll(/["'`](#[0-9a-f]{3,8})["'`]/gi)) found.push(`hex colour string ${literal[1]}`);
  return found;
}

describe("StreamingLog source scans", () => {
  it("reads the real files (a vacuous empty read would pass every scan)", () => {
    expect(css).toContain(".streaming-log {");
    expect(source).toContain("export function StreamingLog");
  });

  it("never injects raw HTML (AC3)", () => {
    const needles = ["dangerously" + "SetInnerHTML", "inner" + "HTML"];
    for (const needle of needles) expect(source.includes(needle), needle).toBe(false);
  });

  it("the colour matcher catches a hex value and ignores 'PR #401' text", () => {
    expect(cssColourViolations("color: #ffffff")).toHaveLength(1);
    expect(cssColourViolations(".x { background: rgba(0, 0, 0, 0.5); }")).not.toHaveLength(0);
    expect(cssColourViolations(".x { color: red; }")).toHaveLength(1);
    expect(cssColourViolations(".x { border: 1px solid transparent; color: currentColor; background: inherit; }")).toEqual([]);
    expect(cssColourViolations("PR #401")).toEqual([]);
    expect(cssColourViolations('.x::after { content: "PR #401"; }')).toEqual([]);
    expect(tsxColourViolations('<p style={{ color: "#ffffff" }}>x</p>')).not.toEqual([]);
    expect(tsxColourViolations('<p style={{ background: "var(--surface)" }}>x</p>')).toEqual([]);
    expect(tsxColourViolations("<p>PR #401</p>")).toEqual([]);
  });

  it("uses only tokens.css colours: no hex, rgb/hsl or named colour in the CSS or the component (AC8)", () => {
    expect(cssColourViolations(css)).toEqual([]);
    expect(tsxColourViolations(source)).toEqual([]);
    const vars = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    expect(vars.has("--surface-sunken")).toBe(true);
  });

  it("has a :focus-visible ring on var(--focus) (AC9)", () => {
    expect(css).toMatch(/\.streaming-log :focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
  });

  it("has no transition or animation outside prefers-reduced-motion: no-preference (AC9)", () => {
    let rest = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (;;) {
      const at = rest.search(/@media\s*\(\s*prefers-reduced-motion:\s*no-preference\s*\)\s*\{/);
      if (at < 0) break;
      let i = rest.indexOf("{", at) + 1;
      let depth = 1;
      while (i < rest.length && depth > 0) {
        if (rest[i] === "{") depth += 1;
        else if (rest[i] === "}") depth -= 1;
        i += 1;
      }
      rest = rest.slice(0, at) + rest.slice(i);
    }
    expect(rest).not.toMatch(/(^|[^-\w])(?:transition|animation)(?:-[a-z-]+)?\s*:/m);
    expect(rest).not.toMatch(/@keyframes/);
  });
});
