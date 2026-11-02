// @vitest-environment jsdom
// The shared icon set: the ten names, each drawn through `Glyph` with the path data of its entry in
// `docs/design/mockups/gui-v2.html`'s `I` map, copied here as strings so a drifted path fails.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ICON_NAMES, Icon } from "./index";
import type { IconName } from "./index";

afterEach(cleanup);

/** Each name's `I` map entry: the mockup key and the shape markup inside its `ico('…')`. */
const MOCKUP: Readonly<Record<IconName, { readonly key: string; readonly markup: string }>> = {
  back: { key: "back", markup: '<path d="m15 18-6-6 6-6"/>' },
  chat: { key: "chat", markup: '<path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12Z"/>' },
  pencil: { key: "pen", markup: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>' },
  history: { key: "hist", markup: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>' },
  file: { key: "mem", markup: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>' },
  shared: { key: "team", markup: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M15 19a4.5 4.5 0 0 1 7 0"/>' },
  task: { key: "list", markup: '<path d="M4 6h16M4 12h10M4 18h7"/>' },
  session: { key: "term", markup: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 20h10M8 9l3 3-3 3M13 15h3"/>' },
  run: { key: "book", markup: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v14H6.5a2.5 2.5 0 0 0 0 5H20"/>' },
  clock: { key: "clock", markup: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
};

const SHAPE_ATTRS = ["d", "cx", "cy", "r", "x", "y", "width", "height", "rx"] as const;

/** Every shape element under `root` as `<tag attr="value" …>`, attributes in a fixed order. */
function shapes(root: Element): string[] {
  return Array.from(root.children).map((el) => {
    const attrs = SHAPE_ATTRS.filter((a) => el.hasAttribute(a)).map((a) => ` ${a}="${el.getAttribute(a)}"`);
    return `<${el.tagName.toLowerCase()}${attrs.join("")}>`;
  });
}

function mockupShapes(markup: string): string[] {
  const holder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  holder.innerHTML = markup;
  return shapes(holder);
}

describe("icon set", () => {
  it("exports exactly these ten names, in this order", () => {
    expect([...ICON_NAMES]).toEqual(["back", "chat", "pencil", "history", "file", "shared", "task", "session", "run", "clock"]);
    expect(Object.keys(MOCKUP)).toEqual([...ICON_NAMES]);
  });

  it("draws the back chevron as the mockup does", () => {
    const { container } = render(<Icon name="back" className="demo-glyph" />);
    expect(container.querySelector("svg")?.innerHTML).toBe('<path d="m15 18-6-6 6-6"></path>');
  });

  it.each(ICON_NAMES)("%s renders through Glyph with its mockup entry's shapes", (name) => {
    const { container } = render(<Icon name={name} className="demo-glyph" />);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    const svg = container.querySelector("svg");
    if (svg === null) throw new Error("no svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("class")).toBe("demo-glyph");
    // Glyph's frame: a line icon, filled with nothing and stroked in the text colour.
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    const expected = mockupShapes(MOCKUP[name].markup);
    expect(expected.length).toBeGreaterThan(0);
    expect(shapes(svg)).toEqual(expected);
  });

  it("gives each name a different drawing", () => {
    const drawn = ICON_NAMES.map((name) => render(<Icon name={name} className="demo-glyph" />).container.innerHTML);
    expect(new Set(drawn).size).toBe(ICON_NAMES.length);
  });
});
