// @vitest-environment jsdom
// Charter: the README's sections (Identity, Persona, Duties, Tools, Boundaries, Model, Limits,
// first playbook's dry run), proposed tags (AC5), not-connected tools and token limits with any
// dollar figure shown as "≈$x at API rates" (AC6), the Create / Edit in English / Shape actions,
// inert rendering of hostile text (AC2), and the folder's source scans (AC3, AC8, AC9).
// The scans read exactly Charter.css and Charter.tsx, never the test or the gallery.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Charter, type CharterProps } from "./Charter";
import { galleryStates } from "./Charter.gallery";
import source from "./Charter.tsx?raw";

// The CSS cannot come through `?raw`: vitest's `vitest:css-disable` plugin rewrites every id
// matching `.css` (with or without a query) to `export default ""` unless `test.css` opts in,
// so `import css from "./Charter.css?raw"` is an empty string and every CSS scan would pass
// vacuously. The file is read from disk instead, typed locally so tsconfig needs no Node types.
interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
}
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): NodeFs } }).process.getBuiltinModule("node:fs");
const here = (import.meta as unknown as { dirname: string }).dirname;
const css = nodeFs.readFileSync(`${here}/Charter.css`, "utf8");

afterEach(cleanup);

const XSS_IMG = "<img src=x onerror=alert(1)>";

function props(overrides: Partial<CharterProps> = {}): CharterProps {
  return {
    name: { value: "Pim", proposed: true },
    avatar: <span data-testid="avatar-slot" />,
    shape: "octopus",
    summary: "personal assistant",
    persona: "Brief and direct. Morning digest in bullets, most urgent first. Never chatty.",
    duties: ["Daily digest at 08:00 of calendar, mail and Slack", "Remind you of commitments you made in chat or mail"],
    tools: [
      { name: "Calendar", connected: false },
      { name: "Mail", connected: false },
      { name: "Slack", connected: true },
    ],
    boundaries: ["Reads only: never sends mail or messages", "Never moves or declines meetings"],
    model: { value: "Haiku 4.5", proposed: true },
    limits: { tokensPerDay: 100_000, sessionsAtOnce: 1, proposed: true },
    firstPlaybookDryRun: { text: "Daily digest · cron 08:00 Mon–Fri · would summarise 4 meetings, 32 mails, 6 Slack threads" },
    onCreate: vi.fn(),
    onEditInEnglish: vi.fn(),
    onPickShape: vi.fn(),
    ...overrides,
  };
}

function renderCharter(overrides: Partial<CharterProps> = {}) {
  const p = props(overrides);
  const view = render(<Charter {...p} />);
  const root = screen.getByRole("region", { name: `Charter for ${p.name.value}` });
  const section = (id: string) => {
    const el = root.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (el === null) throw new Error(`no section ${id}`);
    return el;
  };
  return { ...view, p, root, section };
}

// ---- folder-local source scanners (AC3, AC8, AC9) -------------------------------------------

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");

interface Declaration {
  readonly prop: string;
  readonly value: string;
}

/** CSS declarations (`prop: value`), skipping selectors and at-rule preludes (chunks ending in `{`). */
function cssDeclarations(cssText: string): Declaration[] {
  const out: Declaration[] = [];
  for (const m of stripComments(cssText).matchAll(/([^{};]*)([{};]|$)/g)) {
    if (m[2] === "{") continue;
    const chunk = (m[1] ?? "").trim();
    const colon = chunk.indexOf(":");
    if (colon <= 0) continue;
    out.push({ prop: chunk.slice(0, colon).trim().toLowerCase(), value: chunk.slice(colon + 1).trim() });
  }
  return out;
}

/** Declarations inside JSX `style={{ … }}` objects. JSX text is never scanned. */
function styleObjectDeclarations(tsx: string): Declaration[] {
  const out: Declaration[] = [];
  for (const m of tsx.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    for (const pair of (m[1] ?? "").split(",")) {
      const colon = pair.indexOf(":");
      if (colon <= 0) continue;
      const prop = pair.slice(0, colon).trim().replace(/["']/g, "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      out.push({ prop, value: pair.slice(colon + 1).trim().replace(/^["'`]|["'`]$/g, "") });
    }
  }
  return out;
}

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z_-])/i;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?)\s*\(/gi;
const COLOUR_PROPERTY = /(?:^|-)(?:color|background|border|outline|fill|stroke|shadow|caret|accent|column-rule|text-decoration)(?:-|$)/;
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
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue " +
    "slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke " +
    "yellow yellowgreen"
  ).split(" "),
);

/** Every hard-coded colour in a component's CSS or TSX source (AC8). */
function colourViolations(text: string, kind: "css" | "tsx"): string[] {
  const found: string[] = [];
  for (const { prop, value } of kind === "css" ? cssDeclarations(text) : styleObjectDeclarations(text)) {
    // Custom-property names such as --crew-teal are token references, not colour keywords.
    const clean = value.replace(/--[\w-]+/g, " ");
    const named = (clean.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => NAMED_COLOURS.has(w));
    if (HEX.test(clean) || (COLOUR_PROPERTY.test(prop) && named.length > 0)) found.push(`${prop}: ${value}`);
  }
  for (const m of (kind === "css" ? stripComments(text) : text).matchAll(COLOUR_FUNCTION)) found.push(m[0]);
  return found;
}

/** `transition`/`animation` declarations outside `@media (prefers-reduced-motion: no-preference)` (AC9). */
function motionOutsideNoPreference(cssText: string): string[] {
  let text = stripComments(cssText);
  const opener = /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)\s*\{/;
  for (let m = opener.exec(text); m !== null; m = opener.exec(text)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") depth -= 1;
    }
    text = text.slice(0, m.index) + text.slice(i);
  }
  return cssDeclarations(text)
    .map((d) => d.prop)
    .filter((p) => /^(?:transition|animation)(?:-|$)/.test(p));
}

/** Rule bodies keyed by trimmed selector, innermost blocks only (so rules inside @media count). */
function rules(cssText: string): { selector: string; body: string }[] {
  return [...stripComments(cssText).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] ?? "").trim(), body: m[2] ?? "" }));
}

function ruleBody(cssText: string, selector: string): string {
  return rules(cssText)
    .filter((r) => r.selector === selector)
    .map((r) => r.body)
    .join(";");
}

// ---- keyboard helpers (jsdom has no activation behaviour, so it is mimicked here) -----------

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';

/** Focusable controls in Tab order; with no positive tabindex, Tab order is DOM order. */
function tabOrder(root: HTMLElement): HTMLElement[] {
  const all = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);
  for (const el of all) expect(el.tabIndex).toBe(0);
  return all;
}

/** Press Enter or Space on a focused control the way a browser does: keydown, then the native click unless prevented. */
function press(el: HTMLElement, key: "Enter" | " ") {
  el.focus();
  expect(document.activeElement).toBe(el);
  const down = fireEvent.keyDown(el, { key });
  if (key === "Enter" && down && el instanceof HTMLButtonElement) fireEvent.click(el);
  const up = fireEvent.keyUp(el, { key });
  if (key === " " && down && up && el instanceof HTMLButtonElement) fireEvent.click(el);
}

it("reads the real Charter.css and Charter.tsx (the scans below are not vacuous)", () => {
  expect(css).toContain(".charter__btn:focus-visible {");
  expect(source).toContain("export function Charter(");
});

// ---- README rules (AC1) ---------------------------------------------------------------------

describe("Charter sections", () => {
  it("renders Identity, Persona, Duties, Tools, Boundaries, Model, Limits and the first playbook's dry run", () => {
    const { root, section } = renderCharter();
    const identity = within(root).getByRole("group", { name: "Identity" });
    expect(within(identity).getByTestId("avatar-slot")).toBeTruthy();
    expect(within(identity).getByText("Pim")).toBeTruthy();
    expect(within(identity).getByText("personal assistant")).toBeTruthy();
    expect([...root.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Persona", "Duties", "Tools", "Boundaries", "Model", "Limits"]);
    expect(section("persona").textContent).toContain("Brief and direct.");
    expect([...section("duties").querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Daily digest at 08:00 of calendar, mail and Slack",
      "Remind you of commitments you made in chat or mail",
    ]);
    expect(section("model").textContent).toContain("Haiku 4.5");
    expect(section("dry-run").textContent).toBe("first playbook · Daily digest · cron 08:00 Mon–Fri · would summarise 4 meetings, 32 mails, 6 Slack threads");
  });

  it("shows the dry run in mono, never behind a disclosure", () => {
    const { root, section } = renderCharter();
    expect(root.querySelector("details, summary, [hidden], [aria-expanded]")).toBeNull();
    expect(section("dry-run").closest("details")).toBeNull();
    expect(ruleBody(css, ".charter__dry")).toMatch(/font-family:\s*var\(--type-mono-family\)/);
    expect(ruleBody(css, ".charter__dry")).toMatch(/background:\s*var\(--surface-sunken\)/);
  });

  it("says plainly when no playbook has been drafted yet", () => {
    const { section } = renderCharter({ firstPlaybookDryRun: undefined });
    expect(section("dry-run").textContent).toBe("first playbook · no playbook drafted yet");
  });

  it("always renders boundaries, even when the charter adds none", () => {
    const { section } = renderCharter();
    expect([...section("boundaries").querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Reads only: never sends mail or messages",
      "Never moves or declines meetings",
    ]);
    cleanup();
    const empty = renderCharter({ boundaries: [] });
    expect(within(empty.root).getByText("Boundaries")).toBeTruthy();
    expect(empty.section("boundaries").textContent).toBe("No extra boundaries. The kernel's fixed rails still apply.");
  });

  it("calls onCreate, onEditInEnglish and onPickShape", () => {
    const { p } = renderCharter();
    fireEvent.click(screen.getByRole("button", { name: "Create Pim" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit in English" }));
    fireEvent.click(screen.getByRole("button", { name: "Shape octopus" }));
    expect(p.onCreate).toHaveBeenCalledTimes(1);
    expect(p.onEditInEnglish).toHaveBeenCalledTimes(1);
    expect(p.onPickShape).toHaveBeenCalledTimes(1);
    // The picker dialog is the Team screen's: the Shape button only triggers it.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByRole("button", { name: "Shape octopus" }).getAttribute("aria-haspopup")).toBe("dialog");
  });
});

// ---- AC5: proposed tags ---------------------------------------------------------------------

describe("Charter proposed values (AC5)", () => {
  it("tags the Wright-chosen model as proposed in ink-tertiary", () => {
    const { section } = renderCharter();
    expect(section("model").querySelector(".charter__proposed")?.textContent).toBe("proposed");
    expect(ruleBody(css, ".charter__proposed")).toMatch(/color:\s*var\(--ink-tertiary\)/);
  });

  it("tags a Wright-chosen name and limits as proposed", () => {
    const { root, section } = renderCharter();
    expect(within(root).getByRole("group", { name: "Identity" }).querySelector(".charter__proposed")?.textContent).toBe("name proposed");
    expect(section("limits").querySelector(".charter__proposed")?.textContent).toBe("proposed");
  });

  it("shows no tag on values the user set", () => {
    const { root } = renderCharter({ name: { value: "Pim" }, model: { value: "Opus 5" }, limits: { tokensPerDay: 250_000, sessionsAtOnce: 2 } });
    expect(root.querySelector(".charter__proposed")).toBeNull();
    expect(within(root).queryByText(/proposed/)).toBeNull();
  });

  it("tags each value independently", () => {
    const { root, section } = renderCharter({ name: { value: "Pim" }, model: { value: "Opus 5" } });
    expect(section("model").querySelector(".charter__proposed")).toBeNull();
    expect(within(root).getByRole("group", { name: "Identity" }).querySelector(".charter__proposed")).toBeNull();
    expect(section("limits").querySelector(".charter__proposed")?.textContent).toBe("proposed");
  });
});

// ---- AC6: tools and limits ------------------------------------------------------------------

describe("Charter tools and limits (AC6)", () => {
  it("lists a not-connected tool with 'not connected', never hiding it", () => {
    const { section } = renderCharter();
    const chips = [...section("tools").querySelectorAll("li")];
    expect(chips.map((c) => c.textContent)).toEqual(["Calendarnot connected", "Mailnot connected", "Slackconnected"]);
    expect(within(chips[0] as HTMLElement).getByText("not connected")).toBeTruthy();
    expect(ruleBody(css, ".charter__badge--attention")).toMatch(/color:\s*var\(--attention\)/);
  });

  it("lists tools even when none is connected", () => {
    const { section } = renderCharter({ tools: [{ name: "GitHub", connected: false }] });
    expect(section("tools").textContent).toBe("GitHubnot connected");
  });

  it("gives a connected tool's dot a word as well as a colour", () => {
    const { section } = renderCharter();
    const slack = [...section("tools").querySelectorAll("li")].find((li) => li.textContent?.startsWith("Slack"));
    expect(slack?.querySelector(".charter__dot")?.getAttribute("aria-hidden")).toBe("true");
    expect(slack?.querySelector(".charter__sr-only")?.textContent).toBe("connected");
  });

  it("shows limits as tokens per day and sessions at once", () => {
    const { section } = renderCharter();
    expect(section("limits").textContent).toBe("100k tokens / day · 1 session at once" + "proposed");
    cleanup();
    const more = renderCharter({ limits: { tokensPerDay: 1_500_000, sessionsAtOnce: 3 } });
    expect(more.section("limits").textContent).toBe("1.5M tokens / day · 3 sessions at once");
    cleanup();
    expect(renderCharter({ limits: { tokensPerDay: 900, sessionsAtOnce: 0 } }).section("limits").textContent).toBe("900 tokens / day · 0 sessions at once");
    cleanup();
    expect(renderCharter({ limits: { tokensPerDay: 999_950, sessionsAtOnce: 1 } }).section("limits").textContent).toBe("1M tokens / day · 1 session at once");
    cleanup();
    expect(renderCharter({ limits: { tokensPerDay: 999_949, sessionsAtOnce: 1 } }).section("limits").textContent).toBe("999.9k tokens / day · 1 session at once");
    expect(ruleBody(css, ".charter__limits")).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("labels a passed dollar figure '≈$x at API rates' and never as a budget or limit (D24)", () => {
    const { root, section } = renderCharter({
      limits: { tokensPerDay: 100_000, sessionsAtOnce: 1, costEstimate: 2.4 },
      firstPlaybookDryRun: { text: "Daily digest", costEstimate: 0.08 },
    });
    const estimates = within(root).getAllByTestId("charter-estimate");
    expect(estimates.map((e) => e.textContent)).toEqual(["≈$2.40/day at API rates", "≈$0.08/run at API rates"]);
    expect(section("limits").textContent).toContain("≈$2.40/day at API rates");
    expect(section("dry-run").textContent).toContain("≈$0.08/run at API rates");
    // Every dollar sign on the charter sits inside an estimate label.
    const dollarsOutsideEstimates = [...root.querySelectorAll("*")].filter(
      (el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes("$")) && !el.matches('[data-testid="charter-estimate"]'),
    );
    expect(dollarsOutsideEstimates).toEqual([]);
    expect(root.textContent).not.toMatch(/budget/i);
    expect(root.querySelector("input, [role='spinbutton'], [role='slider']")).toBeNull();
  });

  it("shows no dollar figure when none is passed, or when it is not a finite number", () => {
    const { root } = renderCharter();
    expect(root.textContent).not.toMatch(/\$|API rates/);
    cleanup();
    const nan = renderCharter({
      limits: { tokensPerDay: 100_000, sessionsAtOnce: 1, costEstimate: Number.NaN },
      firstPlaybookDryRun: { text: "Daily digest", costEstimate: Number.POSITIVE_INFINITY },
    });
    expect(nan.root.textContent).not.toMatch(/\$|API rates/);
    cleanup();
    for (const negative of [-0.5, -0.004]) {
      const neg = renderCharter({
        limits: { tokensPerDay: 100_000, sessionsAtOnce: 1, costEstimate: negative },
        firstPlaybookDryRun: { text: "Daily digest", costEstimate: negative },
      });
      expect(neg.root.textContent).not.toMatch(/\$|API rates/);
      cleanup();
    }
  });

  it("formats a large estimate with thousands separators, never in exponent form", () => {
    const { root } = renderCharter({
      limits: { tokensPerDay: 100_000, sessionsAtOnce: 1, costEstimate: 123_456_789.99 },
      firstPlaybookDryRun: { text: "Daily digest", costEstimate: 1e21 },
    });
    expect(within(root).getAllByTestId("charter-estimate").map((e) => e.textContent)).toEqual([
      "≈$123,456,789.99/day at API rates",
      "≈$1,000,000,000,000,000,000,000.00/run at API rates",
    ]);
  });

  it("shows a zero estimate rather than swallowing it as falsy", () => {
    const { root } = renderCharter({ limits: { tokensPerDay: 100_000, sessionsAtOnce: 1, costEstimate: 0 } });
    expect(within(root).getByTestId("charter-estimate").textContent).toBe("≈$0.00/day at API rates");
  });

  it("shows a -0 estimate as a plain zero, never '-0.00', on both the limits and dry-run lines", () => {
    // JSON.parse("-0") yields -0, so a kernel payload can carry it.
    const { root } = renderCharter({
      limits: { tokensPerDay: 100_000, sessionsAtOnce: 1, costEstimate: -0 },
      firstPlaybookDryRun: { text: "Daily digest", costEstimate: -0 },
    });
    expect(within(root).getAllByTestId("charter-estimate").map((e) => e.textContent)).toEqual([
      "≈$0.00/day at API rates",
      "≈$0.00/run at API rates",
    ]);
  });
});

// ---- AC2: hostile text renders inert --------------------------------------------------------

describe("Charter renders untrusted text inert (AC2)", () => {
  it("shows an <img onerror> string in every field as text and creates no img", () => {
    const { container, root, section } = renderCharter({
      name: { value: XSS_IMG, proposed: true },
      summary: XSS_IMG,
      shape: XSS_IMG,
      persona: XSS_IMG,
      duties: [XSS_IMG, "[x](javascript:alert(1))"],
      tools: [{ name: XSS_IMG, connected: false }],
      boundaries: [XSS_IMG],
      model: { value: XSS_IMG },
      limits: { tokensPerDay: 1, sessionsAtOnce: 1, costEstimate: 0.5 },
      firstPlaybookDryRun: { text: XSS_IMG, costEstimate: 0.5 },
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[href]")).toBeNull();
    expect(root.getAttribute("aria-label")).toBe(`Charter for ${XSS_IMG}`);
    expect(section("persona").textContent).toBe(XSS_IMG);
    expect(section("duties").querySelector("li")?.textContent).toBe(XSS_IMG);
    expect(section("boundaries").textContent).toBe(XSS_IMG);
    expect(section("tools").textContent).toBe(`${XSS_IMG}not connected`);
    expect(section("model").textContent).toBe(XSS_IMG);
    expect(section("dry-run").textContent).toContain(XSS_IMG);
  });
});

// ---- AC9: keyboard --------------------------------------------------------------------------

describe("Charter keyboard (AC9)", () => {
  it("makes every control a native button, reachable by Tab in DOM order, with a name", () => {
    const { root } = renderCharter();
    const order = tabOrder(root);
    expect(order).toEqual([
      screen.getByRole("button", { name: "Create Pim" }),
      screen.getByRole("button", { name: "Edit in English" }),
      screen.getByRole("button", { name: "Shape octopus" }),
    ]);
    for (const el of order) {
      expect(el).toBeInstanceOf(HTMLButtonElement);
      expect(el.getAttribute("type")).toBe("button");
    }
  });

  it("names the Shape button 'Shape' when no silhouette is chosen yet", () => {
    renderCharter({ shape: undefined });
    expect(screen.getByRole("button", { name: "Shape" })).toBeTruthy();
  });

  it("activates each control with Enter and with Space, and only that control", () => {
    const { p } = renderCharter();
    press(screen.getByRole("button", { name: "Edit in English" }), "Enter");
    press(screen.getByRole("button", { name: "Shape octopus" }), "Enter");
    press(screen.getByRole("button", { name: "Create Pim" }), " ");
    expect(p.onEditInEnglish).toHaveBeenCalledTimes(1);
    expect(p.onPickShape).toHaveBeenCalledTimes(1);
    expect(p.onCreate).toHaveBeenCalledTimes(1);
  });

  it("handles ⏎ (Create) and E (Edit in English) only while focus is inside the charter", () => {
    const { p, root } = renderCharter();
    fireEvent.keyDown(root, { key: "Enter" });
    expect(p.onCreate).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("button", { name: "Shape octopus" }), { key: "E" });
    expect(p.onEditInEnglish).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(root, { key: "e", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "e" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(p.onEditInEnglish).toHaveBeenCalledTimes(1);
    expect(p.onCreate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Create Pim" }).getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(screen.getByRole("button", { name: "Edit in English" }).getAttribute("aria-keyshortcuts")).toBe("E");
  });

  it("has a :focus-visible rule using var(--focus)", () => {
    const focusRules = rules(css).filter((r) => r.selector.includes(":focus-visible"));
    expect(focusRules.length).toBeGreaterThan(0);
    expect(focusRules.some((r) => /outline:\s*2px solid var\(--focus\)/.test(r.body))).toBe(true);
  });

  it("has no transition or animation outside prefers-reduced-motion: no-preference", () => {
    expect(motionOutsideNoPreference(css)).toEqual([]);
    expect(motionOutsideNoPreference(".a { transition: opacity 120ms; }")).toEqual(["transition"]);
    expect(motionOutsideNoPreference("@media (prefers-reduced-motion: no-preference) { .a { animation: x 1s; } }")).toEqual([]);
    expect(motionOutsideNoPreference("@media (prefers-reduced-motion: reduce) { .a { animation-name: x; } }")).toEqual(["animation-name"]);
  });
});

// ---- the gallery the evidence page renders --------------------------------------------------

describe("Charter gallery", () => {
  it("renders every state with a unique id, the hostile string inert", () => {
    expect(new Set(galleryStates.map((s) => s.id)).size).toBe(galleryStates.length);
    for (const state of galleryStates) {
      const { container, unmount } = render(state.element);
      expect(container.querySelector("img")).toBeNull();
      expect(screen.getByRole("button", { name: /^Create/ })).toBeTruthy();
      unmount();
    }
    expect(galleryStates.some((s) => s.id === "untrusted-text")).toBe(true);
  });
});

// ---- AC3 and AC8: source scans of Charter.tsx and Charter.css only ---------------------------

describe("Charter source scans", () => {
  it("never injects raw HTML (AC3)", () => {
    const needles = ["dangerously" + "SetInner" + "HTML", "inner" + "HTML"];
    for (const needle of needles) expect(source.includes(needle)).toBe(false);
  });

  it("has no hard-coded colour in Charter.css or Charter.tsx (AC8)", () => {
    expect(colourViolations(css, "css")).toEqual([]);
    expect(colourViolations(source, "tsx")).toEqual([]);
  });

  it("proves the colour matcher on positive and negative samples", () => {
    expect(colourViolations("color: #ffffff", "css")).not.toEqual([]);
    expect(colourViolations(".a { border: 1px solid #fff; }", "css")).not.toEqual([]);
    expect(colourViolations(".a { background: #0f0f1a66; }", "css")).not.toEqual([]);
    expect(colourViolations(".a { color: hsl(0 0% 100%); }", "css")).not.toEqual([]);
    expect(colourViolations(".a { background-color: black; }", "css")).not.toEqual([]);
    expect(colourViolations('<div style={{ color: "#ffffff" }} />', "tsx")).not.toEqual([]);
    expect(colourViolations('<div style={{ borderColor: "teal" }} />', "tsx")).not.toEqual([]);
    expect(colourViolations("<p>PR #401</p>", "tsx")).toEqual([]);
    expect(colourViolations("/* PR #401 */ .a { color: var(--crew-teal); background: transparent; }", "css")).toEqual([]);
    expect(colourViolations(".a { color: currentColor; border-color: inherit; }", "css")).toEqual([]);
  });
});
