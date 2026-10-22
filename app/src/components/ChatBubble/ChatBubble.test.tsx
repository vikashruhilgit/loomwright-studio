// @vitest-environment jsdom
// ChatBubble: the README's rules (sides and edges, 520px cap, caption, playbook draft with its
// dry run in mono, proposed tags, streaming caret), inert rendering of hostile text (AC2), and
// the folder's source scans: no raw-HTML injection (AC3), no hard-coded colour (AC8), and a
// token focus ring with no motion outside `prefers-reduced-motion: no-preference` (AC9).
// The scans read exactly ChatBubble.css and ChatBubble.tsx, never the test or the gallery.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatBubble, type PlaybookDraft } from "./ChatBubble";
import { galleryStates } from "./ChatBubble.gallery";
import source from "./ChatBubble.tsx?raw";

// The CSS cannot come through `?raw`: vitest's `vitest:css-disable` plugin rewrites every id
// matching `.css` (with or without a query) to `export default ""` unless `test.css` opts in,
// so `import css from "./ChatBubble.css?raw"` is an empty string and every CSS scan would pass
// vacuously. The file is read from disk instead, typed locally so tsconfig needs no Node types.
interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
}
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): NodeFs } }).process.getBuiltinModule("node:fs");
const here = (import.meta as unknown as { dirname: string }).dirname;
const css = nodeFs.readFileSync(`${here}/ChatBubble.css`, "utf8");

afterEach(cleanup);

it("reads the real ChatBubble.css and ChatBubble.tsx (the scans below are not vacuous)", () => {
  expect(css).toContain(".chat-bubble__bubble {");
  expect(source).toContain("export function ChatBubble(");
});

const XSS_IMG = "<img src=x onerror=alert(1)>";

function draft(overrides: Partial<PlaybookDraft> = {}): PlaybookDraft {
  return {
    name: { value: "Review PRs where I'm requested" },
    runsAs: "Mason",
    trigger: { value: "Poll GitHub every 5 min for PRs requesting my review" },
    action: { value: "Mason runs Loomwright /review-pr and posts one review" },
    dedupeKey: { value: "{pr.head_sha}", proposed: true },
    model: { value: "Sonnet 5", proposed: true },
    approval: { value: "Ask before posting each review" },
    dryRun: "would review vikashruhilgit/loomwright #412, #409, ntfs-tool #7 · skipped 0",
    ...overrides,
  };
}

function renderDraft(d: PlaybookDraft = draft()) {
  const handlers = { onEnable: vi.fn(), onEditInEnglish: vi.fn(), onEditFields: vi.fn() };
  const view = render(<ChatBubble speaker="Wright" from="wright" time="14:06" body="Here's the duty I'd set up." draft={d} {...handlers} />);
  return { ...view, handlers, card: screen.getByRole("region", { name: "Drafted playbook" }) };
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

// ---- README rules (AC1) ---------------------------------------------------------------------

describe("ChatBubble sides and edges", () => {
  it("puts Wright and specialists left and the user right", () => {
    render(
      <>
        <ChatBubble speaker="Wright" from="wright" time="14:06" body="Hello" avatar={<span data-testid="avatar-wright" />} />
        <ChatBubble speaker="Mason" from="specialist" time="14:07" body="On it" avatar={<span data-testid="avatar-mason" />} />
        <ChatBubble speaker="You" from="user" time="14:08" body="Thanks" avatar={<span data-testid="avatar-you" />} />
      </>,
    );
    const [wright, mason, you] = screen.getAllByRole("article");
    expect(wright?.dataset.side).toBe("left");
    expect(wright?.classList.contains("chat-bubble--left")).toBe(true);
    expect(mason?.dataset.side).toBe("left");
    expect(mason?.dataset.from).toBe("specialist");
    expect(you?.dataset.side).toBe("right");
    expect(you?.classList.contains("chat-bubble--right")).toBe(true);
    // The 24px avatar slot is shown on the left; the user's turn has none (preview.html).
    expect(screen.getByTestId("avatar-wright")).toBeTruthy();
    expect(screen.getByTestId("avatar-mason")).toBeTruthy();
    expect(screen.queryByTestId("avatar-you")).toBeNull();
  });

  it("styles left on surface with a hairline edge and right on accent-soft with no edge", () => {
    const left = ruleBody(css, ".chat-bubble--left .chat-bubble__bubble");
    expect(left).toMatch(/background:\s*var\(--surface\)/);
    expect(left).toMatch(/border:\s*1px solid var\(--hairline\)/);
    const right = ruleBody(css, ".chat-bubble--right .chat-bubble__bubble");
    expect(right).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(right).toMatch(/border-color:\s*transparent/);
    expect(right).not.toMatch(/var\(--hairline\)/);
  });

  it("caps the bubble at 520px and wraps", () => {
    const bubble = ruleBody(css, ".chat-bubble__bubble");
    expect(bubble).toMatch(/max-width:\s*520px/);
    expect(bubble).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("uses the chat type size and a caption for speaker and time", () => {
    expect(ruleBody(css, ".chat-bubble")).toMatch(/font-size:\s*var\(--type-chat-size\)/);
    expect(ruleBody(css, ".chat-bubble__meta")).toMatch(/font-size:\s*var\(--type-caption-size\)/);
    expect(ruleBody(css, ".chat-bubble__meta")).toMatch(/color:\s*var\(--ink-tertiary\)/);
    render(<ChatBubble speaker="Wright" from="wright" time="14:06" body="Hello" />);
    const meta = screen.getByTestId("chat-bubble-meta");
    expect(within(meta).getByText("Wright")).toBeTruthy();
    expect(within(meta).getByText("14:06")).toBeTruthy();
  });

  it("renders paragraphs, line breaks and the safe inline subset as elements", () => {
    render(<ChatBubble speaker="Wright" from="wright" time="14:06" body={"First line\nsecond line\n\nRun `npm test` and **then** push."} />);
    const bubble = screen.getByTestId("chat-bubble-bubble");
    const paragraphs = bubble.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.querySelectorAll("br")).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe("First linesecond line");
    expect(bubble.querySelector("code")?.textContent).toBe("npm test");
    expect(bubble.querySelector("strong")?.textContent).toBe("then");
  });
});

describe("ChatBubble playbook draft", () => {
  it("shows the name, runs-as agent and the key/value block", () => {
    const { card } = renderDraft();
    expect(within(card).getByText("Review PRs where I'm requested")).toBeTruthy();
    expect(within(card).getByText("runs as Mason")).toBeTruthy();
    const terms = [...card.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(terms).toEqual(["Trigger", "Action", "Dedupe key", "Model", "Approval"]);
    expect(card.querySelector('[data-field="trigger"]')?.textContent).toContain("Poll GitHub every 5 min");
    expect(card.querySelector('[data-field="action"]')?.textContent).toContain("/review-pr");
    expect(card.querySelector('[data-field="dedupe-key"] .chat-bubble__mono')?.textContent).toBe("{pr.head_sha}");
    expect(card.querySelector('[data-field="model"]')?.textContent).toContain("Sonnet 5");
    expect(card.querySelector('[data-field="approval"]')?.textContent).toContain("Ask before posting each review");
  });

  it("shows the dry run in mono, never behind a disclosure", () => {
    const { card } = renderDraft();
    const dry = screen.getByTestId("chat-bubble-dry-run");
    expect(card.contains(dry)).toBe(true);
    expect(dry.textContent).toContain("dry run · would review vikashruhilgit/loomwright #412");
    expect(dry.closest("details")).toBeNull();
    expect(card.querySelector("details, summary, [hidden], [aria-expanded]")).toBeNull();
    expect(ruleBody(css, ".chat-bubble__dry")).toMatch(/font-family:\s*var\(--type-mono-family\)/);
    expect(ruleBody(css, ".chat-bubble__dry")).not.toMatch(/display:\s*none/);
  });

  it("labels a dry-run dollar figure as an estimate at API rates (D24)", () => {
    renderDraft(draft({ costEstimate: 0.6 }));
    const estimate = screen.getByTestId("chat-bubble-dry-run").querySelector(".chat-bubble__estimate");
    expect(estimate?.textContent).toBe("≈$0.60 at API rates");
    cleanup();
    renderDraft(draft({ costEstimate: 0 }));
    expect(screen.getByTestId("chat-bubble-dry-run").textContent).toContain("≈$0.00 at API rates");
    cleanup();
    renderDraft(draft({ costEstimate: Number.NaN }));
    expect(screen.getByTestId("chat-bubble-dry-run").textContent).not.toMatch(/\$|API rates/);
    cleanup();
    renderDraft();
    expect(screen.getByTestId("chat-bubble-dry-run").textContent).not.toMatch(/\$|API rates/);
  });

  it("marks values Wright chose as proposed and leaves user-set values untagged (AC5)", () => {
    const { card } = renderDraft(draft({ name: { value: "Review PRs", proposed: true } }));
    const tag = (field: string) => card.querySelector(`[data-field="${field}"] .chat-bubble__proposed`)?.textContent;
    expect(tag("model")).toBe("proposed");
    expect(tag("dedupe-key")).toBe("proposed");
    expect(tag("approval")).toBeUndefined();
    expect(tag("trigger")).toBeUndefined();
    expect(card.querySelector(".chat-bubble__draft-head .chat-bubble__proposed")?.textContent).toBe("proposed");
    expect(ruleBody(css, ".chat-bubble__proposed")).toMatch(/color:\s*var\(--ink-tertiary\)/);
  });

  it("shows no proposed tag on a model the user set", () => {
    const { card } = renderDraft(draft({ model: { value: "Opus 5" }, dedupeKey: { value: "{pr.number}" } }));
    expect(card.querySelector('[data-field="model"] .chat-bubble__proposed')).toBeNull();
    expect(within(card).queryByText("proposed")).toBeNull();
  });

  it("calls Enable, Edit in English and Edit fields", () => {
    const { handlers } = renderDraft();
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit in English" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit fields" }));
    expect(handlers.onEnable).toHaveBeenCalledTimes(1);
    expect(handlers.onEditInEnglish).toHaveBeenCalledTimes(1);
    expect(handlers.onEditFields).toHaveBeenCalledTimes(1);
  });
});

describe("ChatBubble streaming", () => {
  it("reads 'streaming' on the meta line and marks the live end with a static caret", () => {
    render(<ChatBubble speaker="Wright" from="wright" time="14:06" body={"Enabled.\n\nI'll ask before anything is posted"} streaming />);
    const meta = screen.getByTestId("chat-bubble-meta");
    expect(meta.textContent).toContain("streaming");
    expect(meta.textContent).not.toContain("14:06");
    const caret = screen.getByTestId("chat-bubble-caret");
    expect(caret.getAttribute("aria-hidden")).toBe("true");
    // The caret sits at the end of the last paragraph.
    const paragraphs = screen.getByTestId("chat-bubble-bubble").querySelectorAll("p");
    expect(paragraphs[paragraphs.length - 1]?.lastElementChild).toBe(caret);
    const caretRule = ruleBody(css, ".chat-bubble__caret");
    expect(caretRule).toMatch(/width:\s*2px/);
    expect(caretRule).toMatch(/background:\s*var\(--accent\)/);
    expect(caretRule).not.toMatch(/animation|transition/);
  });

  it("shows the time and no caret once streaming ends", () => {
    render(<ChatBubble speaker="Wright" from="wright" time="14:06" body="Done." />);
    expect(screen.getByTestId("chat-bubble-meta").textContent).toContain("14:06");
    expect(screen.queryByTestId("chat-bubble-caret")).toBeNull();
  });
});

// ---- AC2: hostile text renders inert --------------------------------------------------------

describe("ChatBubble renders untrusted text inert (AC2)", () => {
  it("shows an <img onerror> string literally and creates no img", () => {
    const { container } = render(<ChatBubble speaker="Wright" from="wright" time="14:06" body={XSS_IMG} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("chat-bubble-bubble").textContent).toBe(XSS_IMG);
  });

  it("keeps raw and markdown javascript: links as text with no href built from the message", () => {
    const body = "Open javascript:alert(1) or [x](javascript:alert(1)) or https://example.com";
    const { container } = render(<ChatBubble speaker="Mason" from="specialist" time="14:06" body={body} />);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector("[href]")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByTestId("chat-bubble-bubble").textContent).toBe(body);
  });

  it("keeps hostile text inert in the speaker, time and every draft field", () => {
    const hostile = { value: XSS_IMG, proposed: true };
    const { container } = render(
      <ChatBubble
        speaker={XSS_IMG}
        from="wright"
        time={XSS_IMG}
        body="[x](javascript:alert(1))"
        draft={{ name: hostile, runsAs: XSS_IMG, trigger: hostile, action: hostile, dedupeKey: hostile, model: hostile, approval: hostile, dryRun: XSS_IMG, costEstimate: 0.6 }}
        onEnable={() => undefined}
        onEditInEnglish={() => undefined}
        onEditFields={() => undefined}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[href]")).toBeNull();
    expect(screen.getAllByText((_, el) => el?.textContent === XSS_IMG && el.tagName === "B")).toHaveLength(1);
    expect(screen.getByTestId("chat-bubble-dry-run").textContent).toContain(XSS_IMG);
  });
});

// ---- AC9: keyboard --------------------------------------------------------------------------

describe("ChatBubble keyboard (AC9)", () => {
  it("makes every control a native button, reachable by Tab in DOM order, with a name", () => {
    const { card } = renderDraft();
    const order = tabOrder(card);
    expect(order).toEqual([
      screen.getByRole("button", { name: "Enable" }),
      screen.getByRole("button", { name: "Edit in English" }),
      screen.getByRole("button", { name: "Edit fields" }),
    ]);
    for (const el of order) {
      expect(el).toBeInstanceOf(HTMLButtonElement);
      expect(el.getAttribute("type")).toBe("button");
    }
  });

  it("activates each control with Enter and with Space, and only that control", () => {
    const { handlers } = renderDraft();
    press(screen.getByRole("button", { name: "Enable" }), "Enter");
    press(screen.getByRole("button", { name: "Edit fields" }), " ");
    press(screen.getByRole("button", { name: "Edit in English" }), "Enter");
    expect(handlers.onEnable).toHaveBeenCalledTimes(1);
    expect(handlers.onEditFields).toHaveBeenCalledTimes(1);
    expect(handlers.onEditInEnglish).toHaveBeenCalledTimes(1);
  });

  it("handles E (Edit in English) and Enter (Enable) only while focus is inside the card", () => {
    const { handlers, card } = renderDraft();
    fireEvent.keyDown(screen.getByRole("button", { name: "Edit fields" }), { key: "e" });
    expect(handlers.onEditInEnglish).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(handlers.onEnable).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: "e", metaKey: true });
    fireEvent.keyDown(document.body, { key: "e" });
    expect(handlers.onEditInEnglish).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Enable" }).getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(screen.getByRole("button", { name: "Edit in English" }).getAttribute("aria-keyshortcuts")).toBe("E");
  });

  it("has a :focus-visible rule using var(--focus)", () => {
    const focusRules = rules(css).filter((r) => r.selector.includes(":focus-visible"));
    expect(focusRules.length).toBeGreaterThan(0);
    expect(focusRules.some((r) => /outline:\s*2px solid var\(--focus\)/.test(r.body))).toBe(true);
  });

  it("has no transition or animation outside prefers-reduced-motion: no-preference", () => {
    expect(motionOutsideNoPreference(css)).toEqual([]);
    // The matcher itself: a top-level transition is caught, the same inside no-preference is not.
    expect(motionOutsideNoPreference(".a { transition: opacity 120ms; }")).toEqual(["transition"]);
    expect(motionOutsideNoPreference("@media (prefers-reduced-motion: no-preference) { .a { animation: x 1s; } }")).toEqual([]);
    expect(motionOutsideNoPreference("@media (prefers-reduced-motion: reduce) { .a { animation-name: x; } }")).toEqual(["animation-name"]);
  });
});

// ---- the gallery the evidence page renders --------------------------------------------------

describe("ChatBubble gallery", () => {
  it("renders every state with a unique id, the hostile strings inert", () => {
    expect(new Set(galleryStates.map((s) => s.id)).size).toBe(galleryStates.length);
    for (const state of galleryStates) {
      const { container, unmount } = render(state.element);
      expect(container.querySelector("article.chat-bubble")).toBeTruthy();
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("[href]")).toBeNull();
      unmount();
    }
    expect(galleryStates.some((s) => s.id === "untrusted-text")).toBe(true);
  });
});

// ---- AC3 and AC8: source scans of ChatBubble.tsx and ChatBubble.css only ---------------------

describe("ChatBubble source scans", () => {
  it("never injects raw HTML (AC3)", () => {
    const needles = ["dangerously" + "SetInner" + "HTML", "inner" + "HTML"];
    for (const needle of needles) expect(source.includes(needle)).toBe(false);
  });

  it("has no hard-coded colour in ChatBubble.css or ChatBubble.tsx (AC8)", () => {
    expect(colourViolations(css, "css")).toEqual([]);
    expect(colourViolations(source, "tsx")).toEqual([]);
  });

  it("proves the colour matcher on positive and negative samples", () => {
    expect(colourViolations("color: #ffffff", "css")).not.toEqual([]);
    expect(colourViolations(".a { border: 1px solid #fff; }", "css")).not.toEqual([]);
    expect(colourViolations(".a { background: #0f0f1a66; }", "css")).not.toEqual([]);
    expect(colourViolations(".a { color: rgba(0, 0, 0, 0.5); }", "css")).not.toEqual([]);
    expect(colourViolations(".a { outline-color: white; }", "css")).not.toEqual([]);
    expect(colourViolations('<div style={{ color: "#ffffff" }} />', "tsx")).not.toEqual([]);
    expect(colourViolations('<div style={{ backgroundColor: "red" }} />', "tsx")).not.toEqual([]);
    expect(colourViolations("<p>PR #401</p>", "tsx")).toEqual([]);
    expect(colourViolations("/* PR #401 */ .a { color: var(--crew-teal); background: transparent; }", "css")).toEqual([]);
    expect(colourViolations(".a { color: currentColor; border-color: inherit; }", "css")).toEqual([]);
  });
});
