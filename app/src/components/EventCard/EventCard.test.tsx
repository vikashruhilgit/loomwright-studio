// @vitest-environment jsdom
// EventCard: the README's rules (event line, one icon per kind, the subject
// link, the inline approval and its shortcuts), another agent's approval
// rendering nothing (AC7), untrusted text staying inert (AC2), and the
// source/CSS scans (AC3, AC8, AC9). jsdom applies no CSS, so visual rules are
// asserted on EventCard.css itself.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventCard, type EventCardApprovalProps, type EventKind, type EventLine } from "./EventCard";
import { galleryStates } from "./EventCard.gallery";
import src from "./EventCard.tsx?raw";

// The stylesheet is read from disk: vitest stubs every `.css` request, `?raw`
// included, to "" (test.css is off), so `import css from "./EventCard.css?raw"`
// would make every CSS scan below pass on an empty string. The file is read
// through `process.getBuiltinModule`, typed locally so app/tsconfig.json needs
// no Node types.
interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
}
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): NodeFs } }).process.getBuiltinModule("node:fs");
const here = (import.meta as unknown as { dirname: string }).dirname;
const css = nodeFs.readFileSync(`${here}/EventCard.css`, "utf8");

const XSS = "<img src=x onerror=alert(1)>";
const KINDS: readonly EventKind[] = ["session", "playbook", "agent", "memory", "approval", "hook"];

afterEach(cleanup);

function event(overrides: Partial<EventLine> = {}): EventLine {
  return {
    kind: "session",
    before: "Session started · review PR #401 · playbook ",
    subject: "Review PRs where I'm requested",
    time: "13:40",
    dateTime: "2026-10-22T13:40:00Z",
    target: "session:42",
    ...overrides,
  };
}

function approvalProps(overrides: Partial<EventCardApprovalProps> = {}): EventCardApprovalProps {
  return {
    variant: "approval",
    approval: {
      id: "ap-7",
      requestingAgent: "mason",
      title: "Post review on loomwright #412",
      summary: "A review that requests changes: 1 blocking, 2 nits.",
      reason: "Playbook approval level: ask before posting each review.",
    },
    threadAgent: "mason",
    onAllowOnce: vi.fn(),
    onAlways: vi.fn(),
    onDeny: vi.fn(),
    onFullPayload: vi.fn(),
    ...overrides,
  };
}

/** The body of the rule whose selector list is exactly `selector`. */
function ruleBody(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(sheet);
  if (!match?.[1]) throw new Error(`no rule for ${selector}`);
  return match[1];
}

/** Tabbable elements in DOM order; with no positive tabindex, that is the Tab order. */
function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]")).filter(
    (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled,
  );
}

/** What a browser does for Enter/Space on a native button: activate it unless keydown was prevented. */
function pressActivation(el: HTMLElement, key: "Enter" | " ") {
  const notPrevented = fireEvent.keyDown(el, { key });
  if (key === " ") fireEvent.keyUp(el, { key });
  if (notPrevented && el instanceof HTMLButtonElement && el.type === "button") fireEvent.click(el);
}

describe("event line", () => {
  it("is a role=status line with icon, the marked subject and a tabular timestamp", () => {
    render(<EventCard variant="event" event={event({ after: " · runs as Mason" })} onOpen={vi.fn()} />);
    const line = screen.getByRole("status");
    expect(line.textContent).toBe("Session started · review PR #401 · playbook Review PRs where I'm requested · runs as Mason13:40");
    expect(line.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    const time = line.querySelector("time");
    expect(time?.textContent).toBe("13:40");
    expect(time?.getAttribute("datetime")).toBe("2026-10-22T13:40:00Z");
    expect(time?.className).toBe("eventcard-time");
    expect(ruleBody(css, ".eventcard-time")).toMatch(/font-variant-numeric:\s*tabular-nums/);
    // Centred, caption-sized, ink-tertiary; the subject ink-secondary at weight 500.
    const lineRule = ruleBody(css, ".eventcard-event");
    expect(lineRule).toMatch(/justify-content:\s*center/);
    expect(lineRule).toMatch(/font-size:\s*var\(--type-caption-size\)/);
    expect(lineRule).toMatch(/color:\s*var\(--ink-tertiary\)/);
    const subjectRule = ruleBody(css, ".eventcard-subject");
    expect(subjectRule).toMatch(/color:\s*var\(--ink-secondary\)/);
    expect(subjectRule).toMatch(/font-weight:\s*500/);
  });

  it("draws one distinct 14px icon per kind", () => {
    const shapes = new Set<string>();
    for (const kind of KINDS) {
      const { container, unmount } = render(<EventCard variant="event" event={event({ kind })} onOpen={vi.fn()} />);
      const icons = container.querySelectorAll("svg");
      expect(icons).toHaveLength(1);
      const icon = icons[0];
      expect(icon?.getAttribute("data-icon")).toBe(kind);
      expect(icon?.children.length).toBeGreaterThan(0);
      shapes.add(Array.from(icon?.children ?? []).map((c) => c.outerHTML).join(""));
      unmount();
    }
    expect(shapes.size).toBe(KINDS.length);
    const iconRule = ruleBody(css, ".eventcard-icon");
    expect(iconRule).toMatch(/width:\s*14px/);
    expect(iconRule).toMatch(/stroke:\s*currentColor/);
  });

  it("sets a memory event's file path in mono; other subjects are not mono", () => {
    render(
      <>
        <EventCard variant="event" event={event({ kind: "memory", before: "Updated ", subject: "memory/mason/lessons.md", after: ': "hooks block via decision"', target: "file:memory/mason/lessons.md" })} onOpen={vi.fn()} />
        <EventCard variant="event" event={event()} onOpen={vi.fn()} />
      </>,
    );
    expect(screen.getByRole("button", { name: "memory/mason/lessons.md" }).classList.contains("eventcard-mono")).toBe(true);
    expect(screen.getByRole("button", { name: "Review PRs where I'm requested" }).classList.contains("eventcard-mono")).toBe(false);
    expect(ruleBody(css, ".eventcard-mono")).toMatch(/font-family:\s*var\(--type-mono-small-family\)/);
  });

  it("activates the link handler with the event's target from the subject", () => {
    const onOpen = vi.fn();
    render(<EventCard variant="event" event={event()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Review PRs where I'm requested" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("session:42");
  });

  it("renders without optional before/after text and dateTime", () => {
    render(<EventCard variant="event" event={{ kind: "hook", subject: "SubagentStop hook verified", time: "09:05", target: "hook:1" }} onOpen={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("SubagentStop hook verified09:05");
    expect(screen.getByRole("status").querySelector("time")?.hasAttribute("datetime")).toBe(false);
  });
});

describe("inline approval", () => {
  it("shows the attention-edged card with header, summary, reason and four actions", () => {
    render(<EventCard {...approvalProps()} />);
    const card = screen.getByRole("group", { name: "Approval: Post review on loomwright #412" });
    expect(card.className).toBe("eventcard-approval");
    expect(within(card).getByText("Waiting on you · Post review on loomwright #412")).toBeTruthy();
    expect(within(card).getByText("A review that requests changes: 1 blocking, 2 nits.")).toBeTruthy();
    expect(within(card).getByText("Playbook approval level: ask before posting each review.")).toBeTruthy();
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["Allow onceA", "Always⇧A", "DenyD", "Full payload"]);
    expect(ruleBody(css, ".eventcard-approval")).toMatch(/border:\s*1px solid var\(--attention\)/);
    expect(ruleBody(css, ".eventcard-approval-header")).toMatch(/background:\s*var\(--attention-soft\)/);
  });

  it("names the card by its summary when it has no title", () => {
    const props = approvalProps();
    render(<EventCard {...props} approval={{ ...props.approval, title: undefined }} />);
    expect(screen.getByRole("group", { name: "Approval: A review that requests changes: 1 blocking, 2 nits." })).toBeTruthy();
    expect(screen.getByText("Waiting on you")).toBeTruthy();
  });

  it("calls each handler with the approval id from its button", () => {
    const props = approvalProps();
    render(<EventCard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    fireEvent.click(screen.getByRole("button", { name: "Always" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    fireEvent.click(screen.getByRole("button", { name: "Full payload" }));
    for (const handler of [props.onAllowOnce, props.onAlways, props.onDeny, props.onFullPayload]) {
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith("ap-7");
    }
  });

  it("shows the shortcuts as kbd chips and exposes them to assistive tech", () => {
    render(<EventCard {...approvalProps()} />);
    expect(screen.getByRole("button", { name: "Allow once" }).getAttribute("aria-keyshortcuts")).toBe("A");
    expect(screen.getByRole("button", { name: "Always" }).getAttribute("aria-keyshortcuts")).toBe("Shift+A");
    expect(screen.getByRole("button", { name: "Deny" }).getAttribute("aria-keyshortcuts")).toBe("D");
    expect(Array.from(document.querySelectorAll("kbd")).map((k) => k.textContent)).toEqual(["A", "⇧A", "D"]);
  });

  it("handles A, ⇧A and D only while focus is inside the card", () => {
    const props = approvalProps();
    render(<EventCard {...props} />);
    const deny = screen.getByRole("button", { name: "Deny" });
    fireEvent.keyDown(deny, { key: "a" });
    expect(props.onAllowOnce).toHaveBeenCalledWith("ap-7");
    fireEvent.keyDown(deny, { key: "A", shiftKey: true });
    expect(props.onAlways).toHaveBeenCalledWith("ap-7");
    fireEvent.keyDown(deny, { key: "d" });
    expect(props.onDeny).toHaveBeenCalledWith("ap-7");
    // Outside the card, the keys are not this component's.
    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "d" });
    expect(props.onAllowOnce).toHaveBeenCalledTimes(1);
    expect(props.onDeny).toHaveBeenCalledTimes(1);
  });

  it("ignores modified, repeated, already-handled and unrelated keys", () => {
    const props = approvalProps();
    render(<EventCard {...props} />);
    const allow = screen.getByRole("button", { name: "Allow once" });
    fireEvent.keyDown(allow, { key: "a", metaKey: true });
    fireEvent.keyDown(allow, { key: "a", ctrlKey: true });
    fireEvent.keyDown(allow, { key: "a", altKey: true });
    fireEvent.keyDown(allow, { key: "a", repeat: true });
    fireEvent.keyDown(allow, { key: "D", shiftKey: true });
    fireEvent.keyDown(allow, { key: "x" });
    allow.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
    fireEvent.keyDown(allow, { key: "d" });
    for (const handler of [props.onAllowOnce, props.onAlways, props.onDeny, props.onFullPayload]) expect(handler).not.toHaveBeenCalled();
  });

  it("renders nothing for another agent's approval in this thread (AC7)", () => {
    const props = approvalProps({ threadAgent: "wright" });
    const { container } = render(<EventCard {...props} />);
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("untrusted text is inert (AC2)", () => {
  it("renders an <img …> string in every event field as literal text", () => {
    const { container } = render(<EventCard variant="event" event={event({ before: XSS, subject: XSS, after: XSS, time: XSS })} onOpen={vi.fn()} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe(XSS.repeat(4));
  });

  it("renders an <img …> string in every approval field as literal text", () => {
    const props = approvalProps();
    const { container } = render(<EventCard {...props} approval={{ ...props.approval, title: XSS, summary: XSS, reason: XSS }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(`Waiting on you · ${XSS}`)).toBeTruthy();
    expect(screen.getAllByText(XSS)).toHaveLength(2);
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("keyboard (AC9)", () => {
  it("event line: the subject is a native, named, tabbable button operable by Enter and Space", () => {
    const onOpen = vi.fn();
    const { container } = render(<EventCard variant="event" event={event()} onOpen={onOpen} />);
    const order = tabbables(container);
    expect(order).toHaveLength(1);
    const subject = order[0] as HTMLButtonElement;
    expect(subject.tagName).toBe("BUTTON");
    expect(subject.type).toBe("button");
    subject.focus();
    expect(document.activeElement).toBe(subject);
    pressActivation(subject, "Enter");
    pressActivation(subject, " ");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("approval: Tab order is Allow once, Always, Deny, Full payload, each operable by Enter and Space", () => {
    const props = approvalProps();
    const { container } = render(<EventCard {...props} />);
    const order = tabbables(container);
    expect(order.map((el) => el.getAttribute("aria-keyshortcuts") ?? el.textContent)).toEqual(["A", "Shift+A", "D", "Full payload"]);
    expect(container.querySelectorAll("[tabindex]")).toHaveLength(0);
    expect(order.map((el) => screen.getAllByRole("button").indexOf(el as HTMLButtonElement))).toEqual([0, 1, 2, 3]);
    const handlers = [props.onAllowOnce, props.onAlways, props.onDeny, props.onFullPayload];
    order.forEach((el, i) => {
      expect(el.tagName).toBe("BUTTON");
      expect((el as HTMLButtonElement).type).toBe("button");
      pressActivation(el, "Enter");
      pressActivation(el, " ");
      expect(handlers[i]).toHaveBeenCalledTimes(2);
    });
  });
});

// ---- Source and stylesheet scans (AC3, AC8, AC9). Only EventCard.tsx and EventCard.css are read. ----

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
  it("EventCard.tsx never sets raw HTML (AC3)", () => {
    expect(src.length).toBeGreaterThan(0);
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

  it("EventCard.css and EventCard.tsx use no hard-coded colour, only tokens (AC8)", () => {
    // Guard: the scans below must never run on an empty (stubbed) sheet.
    expect(css).toContain(".eventcard-approval");
    expect(src).toContain("export function EventCard");
    expect(cssColourViolations(css)).toEqual([]);
    expect(tsxColourViolations(src)).toEqual([]);
    expect(css).toMatch(/var\(--/);
  });

  it("EventCard.css has a :focus-visible ring using var(--focus) (AC9)", () => {
    expect(css).toMatch(/:focus-visible[^{]*\{[^}]*outline:[^;}]*var\(--focus\)/);
  });

  it("EventCard.css has no transition or animation outside prefers-reduced-motion: no-preference (AC9)", () => {
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
      unmount();
    }
    const { container } = render(
      <>
        {galleryStates.map((s) => (
          <div key={s.id}>{s.element}</div>
        ))}
      </>,
    );
    expect(container.textContent).toContain(XSS);
  });
});
