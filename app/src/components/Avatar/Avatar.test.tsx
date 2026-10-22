// @vitest-environment jsdom
/// <reference types="node" />
// The stitched sea-creature avatar against the approved design's rules
// (docs/design/design-system/components/Avatar/README.md): construction, the
// six states and their thread shapes, Wright's whale and crown, identity hues,
// sizes, the label, the reduced-motion block, no hard-coded colour, and no tab stop.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AVATAR_STATES, Avatar } from "./Avatar";
import type { AvatarAgent, AvatarState } from "./Avatar";
import { CREW_CREATURES, CREW_HUES, SHAPES, seedOf } from "./creatures";

// Sources are read from disk, not imported with `?raw`: vitest stubs CSS (`Avatar.css?raw` is ""), and the
// design lives outside the app's Vite root, which `?raw` refuses. A plain path, not a URL object: jsdom
// replaces the global URL, which node:fs rejects.
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(resolve(HERE, relative), "utf8");
const designAvatarJs = read("../../../../docs/design/avatar/avatar.js");
const avatarCss = read("Avatar.css");
const avatarTsx = read("Avatar.tsx");
const creaturesTs = read("creatures.ts");

const WRIGHT: AvatarAgent = { id: "wright", name: "Wright", shape: "whale", hue: "accent" };
const MASON: AvatarAgent = { id: "mason", name: "Mason", shape: "shark", hue: "teal" };
const SEMANTIC = ["ok", "attention", "danger", "parked"] as const;

const WORDS: Record<AvatarState, string> = {
  idle: "idle",
  working: "working",
  waiting: "waiting on you",
  parked: "paused at cap",
  done: "done",
  danger: "killed",
};

afterEach(cleanup);

function renderAvatar(agent: AvatarAgent, state: AvatarState, extra: { size?: number; action?: string } = {}): HTMLElement {
  const { container } = render(<Avatar agent={agent} state={state} {...extra} />);
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error("Avatar rendered no root element");
  return root;
}

function threadClasses(root: HTMLElement): string[] {
  return [...root.querySelectorAll(".tail .t")].map((t) => [...t.classList].filter((c) => c !== "t").join(" ")).sort();
}

/** The rendered body parts (everything in the rig but the crown and the tail), as tag + attributes. */
function renderedParts(root: HTMLElement): string[] {
  const rig = root.querySelector("g.rig");
  if (rig === null) throw new Error("no g.rig");
  return [...rig.children].filter((el) => !el.matches(".crown, .tail")).map(describeElement);
}

function describeElement(el: Element): string {
  const attrs = [...el.attributes].map((a) => `${a.name}=${a.value}`).sort();
  return `${el.tagName.toLowerCase()} ${attrs.join(" ")}`;
}

describe("construction and labels", () => {
  it("builds the design's layers: role=img root, an aria-hidden ring, the stitch circle, drift, rig and tail", () => {
    const root = renderAvatar(MASON, "idle");
    expect(root.tagName).toBe("SPAN");
    expect(root.getAttribute("role")).toBe("img");
    expect(root.querySelector(":scope > span.ring")?.getAttribute("aria-hidden")).toBe("true");
    const svg = root.querySelector(":scope > svg");
    expect(svg?.getAttribute("viewBox")).toBe("-2 -2 36 36");
    const stitch = svg?.querySelector(":scope > circle.stitch");
    expect([stitch?.getAttribute("cx"), stitch?.getAttribute("cy"), stitch?.getAttribute("r")]).toEqual(["16", "16", "16.5"]);
    expect(svg?.querySelector(":scope > g.drift > g.rig > g.tail")).not.toBeNull();
    // The loose thread swings from the creature's own tail anchor (the shark's is 2,25).
    expect(root.querySelector<SVGGElement>("g.tail")?.style.transformOrigin).toBe("2px 25px");
  });

  for (const agent of [WRIGHT, MASON]) {
    for (const state of AVATAR_STATES) {
      it(`${agent.name} · ${state}: the state class on the root and the exact label as aria-label and title`, () => {
        const root = renderAvatar(agent, state);
        expect(root.classList.contains("bot")).toBe(true);
        expect(root.classList.contains(state)).toBe(true);
        for (const other of AVATAR_STATES.filter((s) => s !== state)) expect(root.classList.contains(other)).toBe(false);
        const label = `${agent.name} · ${WORDS[state]}`;
        expect(root.getAttribute("aria-label")).toBe(label);
        expect(root.getAttribute("title")).toBe(label);
      });
    }
  }

  it("appends the optional current action to the label and the tooltip", () => {
    const root = renderAvatar(MASON, "waiting", { action: "Post review on #412" });
    expect(root.getAttribute("aria-label")).toBe("Mason · waiting on you · Post review on #412");
    expect(root.getAttribute("title")).toBe("Mason · waiting on you · Post review on #412");
  });

  it("adds no suffix for an empty action", () => {
    expect(renderAvatar(MASON, "done", { action: "" }).getAttribute("aria-label")).toBe("Mason · done");
  });

  it("staggers each agent's clock with a negative per-agent seed", () => {
    expect(renderAvatar(MASON, "idle").style.getPropertyValue("--seed")).toBe(`-${seedOf("mason")}s`);
    expect(seedOf("mason")).toBeGreaterThanOrEqual(0);
    expect(seedOf("mason")).toBeLessThan(4);
    expect(seedOf("wright")).not.toBe(seedOf("mason"));
  });
});

describe("the thread carries the state with motion off", () => {
  const expected: Record<AvatarState, string[]> = {
    idle: ["t-idle"],
    working: ["t-idle"],
    waiting: ["t-up"],
    parked: ["t-slack"],
    done: ["t-bow"],
    danger: ["t-cut", "t-cut2"],
  };

  for (const state of AVATAR_STATES) {
    it(`${state} renders exactly its thread path(s)`, () => {
      expect(threadClasses(renderAvatar(MASON, state))).toEqual(expected[state]);
      expect(threadClasses(renderAvatar(WRIGHT, state))).toEqual(expected[state]);
    });
  }

  it("idle, waiting, parked, done and danger each show a distinct thread shape; working keeps t-idle", () => {
    const distinct: AvatarState[] = ["idle", "waiting", "parked", "done", "danger"];
    const shapes = distinct.map((s) => threadClasses(renderAvatar(MASON, s)).join("+"));
    expect(new Set(shapes).size).toBe(distinct.length);
    expect(threadClasses(renderAvatar(MASON, "working"))).toEqual(threadClasses(renderAvatar(MASON, "idle")));
  });

  it("builds each thread from the creature's tail anchor (the fish's is 24,17)", () => {
    const fish: AvatarAgent = { id: "f", name: "F", shape: "fish", hue: "sky" };
    expect(renderAvatar(fish, "idle").querySelector(".t-idle")?.getAttribute("d")).toBe("M24 17c-3 1-5 3-4 7");
    const danger = renderAvatar(fish, "danger");
    expect(danger.querySelector(".t-cut")?.getAttribute("d")).toBe("M24 17c-2 0-3 1-3 2");
    expect(danger.querySelector(".t-cut2")?.getAttribute("d")).toBe("M19 22c-1 1-2 3-1 5");
  });
});

describe("Wright and the crew", () => {
  const whaleParts = designParts("whale");

  it("Wright is the whale with one crown in accent, whatever shape and hue are passed", () => {
    for (const agent of [WRIGHT, { ...WRIGHT, shape: "shark", hue: "teal" }, { id: "wright", name: "Wright" }]) {
      const root = renderAvatar(agent, "working");
      expect(renderedParts(root)).toEqual(whaleParts);
      expect(root.querySelectorAll(".crown")).toHaveLength(1);
      expect(root.querySelector(".crown")?.getAttribute("d")).toBe("M9.5 8.5l1.5-5 3 3 2-4.5 2 4.5 3-3 1.5 5z");
      expect(root.style.getPropertyValue("--bot")).toBe("var(--accent)");
    }
  });

  it("a crew member never gets the crown or the whale; asking for the whale falls back to the fish", () => {
    const fish = renderedParts(renderAvatar({ id: "f", name: "F", shape: "fish", hue: "teal" }, "idle"));
    for (const shape of ["whale", "kraken", undefined]) {
      const root = renderAvatar({ id: "nemo", name: "Nemo", shape, hue: "teal" }, "idle");
      expect(root.querySelector(".crown")).toBeNull();
      expect(renderedParts(root)).not.toEqual(whaleParts);
      expect(renderedParts(root)).toEqual(fish);
    }
  });

  for (const [index, shape] of CREW_CREATURES.entries()) {
    it(`renders the crew ${shape} verbatim from the design, without a crown`, () => {
      const hue = CREW_HUES[index % CREW_HUES.length];
      const root = renderAvatar({ id: `x${index}`, name: shape, shape, hue }, "idle");
      expect(root.querySelector(".crown")).toBeNull();
      expect(renderedParts(root)).toEqual(designParts(shape));
      expect(root.style.getPropertyValue("--bot")).toBe(`var(--crew-${hue})`);
    });
  }

  it("the whale is verbatim from the design too", () => {
    expect(renderedParts(renderAvatar(WRIGHT, "idle"))).toEqual(whaleParts);
  });

  it("the creature table holds exactly the design's eight creatures and tail anchors", () => {
    const design = designShapes();
    expect(Object.keys(SHAPES).sort()).toEqual(Object.keys(design).sort());
    for (const [name, creature] of Object.entries(SHAPES)) expect(creature.tail).toEqual(design[name]?.tail);
    expect(design.whale?.crown).toEqual([16, 4]);
  });

  it("a crew member's --bot is its crew-* hue, and never accent or a semantic token", () => {
    for (const hue of CREW_HUES) {
      expect(renderAvatar({ ...MASON, hue }, "idle").style.getPropertyValue("--bot")).toBe(`var(--crew-${hue})`);
    }
    for (const hue of ["accent", ...SEMANTIC, "magenta", undefined]) {
      const bot = renderAvatar({ ...MASON, hue }, "idle").style.getPropertyValue("--bot");
      expect(bot).toBe("var(--crew-slate)");
    }
  });
});

describe("sizes", () => {
  for (const size of [16, 24, 36, 56]) {
    it(`renders at ${size}px`, () => {
      expect(renderAvatar(MASON, "working", { size }).style.getPropertyValue("--s")).toBe(`${size}px`);
    });
  }

  it("defaults to 32px", () => {
    expect(renderAvatar(MASON, "idle").style.getPropertyValue("--s")).toBe("32px");
  });

  it("never renders below 16px", () => {
    for (const size of [15, 8, 0, -4]) {
      expect(renderAvatar(MASON, "idle", { size }).style.getPropertyValue("--s")).toBe("16px");
    }
  });
});

describe("keyboard", () => {
  it("is not a focus stop: no tabindex anywhere, and focusing it does nothing", () => {
    const root = renderAvatar(MASON, "waiting", { action: "Post review on #412" });
    expect(root.hasAttribute("tabindex")).toBe(false);
    expect(root.querySelectorAll("[tabindex]")).toHaveLength(0);
    root.focus();
    expect(document.activeElement).not.toBe(root);
  });
});

/** The rule blocks of a stylesheet (innermost `selector { body }` pairs), with whitespace collapsed. */
function cssRules(css: string): { selectors: string[]; body: string }[] {
  return cssRulesRaw(css).map((r) => ({ ...r, body: r.body.replace(/\s+/g, "") }));
}

/** Like cssRules, but the body keeps its whitespace, so a value's words stay apart. */
function cssRulesRaw(css: string): { selectors: string[]; body: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: (m[1] ?? "").split(",").map((s) => s.replace(/@media[^{]*$/, "").replace(/\s+/g, " ").trim()),
    body: m[2] ?? "",
  }));
}

function reducedMotionBlock(css: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = stripped.search(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/);
  if (start < 0) throw new Error("Avatar.css has no prefers-reduced-motion: reduce block");
  const open = stripped.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < stripped.length; i++) {
    if (stripped[i] === "{") depth++;
    if (stripped[i] === "}" && --depth === 0) return stripped.slice(open + 1, i);
  }
  throw new Error("unbalanced reduced-motion block");
}

describe("reduced motion (Avatar.css)", () => {
  const block = reducedMotionBlock(avatarCss);
  const rules = cssRules(block);

  for (const layer of ["drift", "rig", "tail", "ring", "st", "ln", "stitch"]) {
    it(`stops the .${layer} animation`, () => {
      expect(rules.some((r) => r.selectors.includes(`.bot .${layer}`) && r.body.includes("animation:none!important"))).toBe(true);
    });
  }

  it("stops the hover nod, which out-specifies .bot .rig, after the nod rule in source order", () => {
    expect(rules.some((r) => r.selectors.includes(".bot:hover .rig") && r.body.includes("animation:none!important"))).toBe(true);
    const css = avatarCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css.search(/\.bot:hover \.rig\s*\{\s*animation:\s*nod/)).toBeGreaterThan(-1);
    expect(css.search(/\.bot:hover \.rig\s*\{\s*animation:\s*nod/)).toBeLessThan(css.search(/@media\s*\(\s*prefers-reduced-motion/));
  });

  it("never changes a thread's display, so the shape still carries the state", () => {
    expect(block).not.toMatch(/display/);
    expect(rules.every((r) => !r.selectors.some((s) => /\.t(?![\w-])|\.t-/.test(s)))).toBe(true);
  });
});

/** Every declaration in a stylesheet, with its rule's selectors and its value's whitespace collapsed. */
function cssDeclarations(css: string): { selectors: string[]; prop: string; value: string }[] {
  return cssRulesRaw(css).flatMap(({ selectors, body }) =>
    body.split(";").flatMap((declaration) => {
      const colon = declaration.indexOf(":");
      if (declaration.trim() === "") return [];
      if (colon < 0) return [{ selectors, prop: declaration.trim(), value: "" }];
      return [{ selectors, prop: declaration.slice(0, colon).trim(), value: declaration.slice(colon + 1).replace(/\s+/g, " ").trim() }];
    }),
  );
}

/**
 * A value's top-level words, with `!important` dropped and whitespace inside parentheses removed, so
 * `var( --x , var(--y) )` is the single word `var(--x,var(--y))`. Function names are lower-cased (CSS
 * treats them case-insensitively); custom-property names keep their case, because CSS does too.
 */
function valueWords(value: string): string[] {
  const words: string[] = [];
  let word = "";
  let depth = 0;
  for (const ch of value.replace(/!\s*important/gi, " ")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch)) {
      if (depth === 0 && word !== "") words.push(word);
      if (depth === 0) word = "";
      continue;
    }
    word += ch;
  }
  if (word !== "") words.push(word);
  return words.map((w) => w.replace(/[a-z-]+\(/gi, (head) => head.toLowerCase()));
}

describe("no hard-coded colour (Avatar.tsx, Avatar.css, creatures.ts)", () => {
  // The needles are assembled at runtime so this file never matches itself, and the
  // scan reads only the component's source files, never this test.
  const hex = new RegExp(["#", "[0-9a-fA-F]{3,8}", "\\b"].join(""));
  // Every CSS colour function, in any case (CSS function names are case-insensitive).
  const functional = new RegExp(["\\b(rgb", "a?|hsl", "a?|hwb|ok", "lab|ok", "lch|lab|lch|color|color-mix|light-dark)\\s*\\("].join(""), "i");
  // The semantic tokens in any `var()` form: bare, with a fallback, or with inner whitespace.
  const semantic = new RegExp(["var\\(\\s*--(", SEMANTIC.join("|"), ")\\b"].join(""), "i");
  const sources: Record<string, string> = { "Avatar.tsx": avatarTsx, "Avatar.css": avatarCss, "creatures.ts": creaturesTs };

  for (const [file, text] of Object.entries(sources)) {
    it(`${file} has no hex or colour-function literal`, () => {
      expect(text).not.toMatch(hex);
      expect(text).not.toMatch(functional);
    });
  }

  // Avatar.css colour is an allowlist, not a list of forbidden forms. Every declaration is either a known
  // non-colour property, or is treated as colour-bearing and every word of its value must be on the list below.
  // An unknown property counts as colour-bearing, and Avatar.css declares no custom property at all (the
  // component sets --s, --bot and --seed inline), so nothing can re-point --bot or smuggle a colour through one.
  const NON_COLOUR_PROPS = new Set([
    "display", "place-items", "width", "height", "flex", "position", "overflow", "inset", "border-radius",
    "pointer-events", "opacity", "transform", "transform-origin", "animation", "animation-delay",
    "stroke-width", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin",
  ]);
  // The only var()s a non-colour declaration may read: the size and the clock the component sets inline.
  const LAYOUT_VARS = new Set(["--s", "--seed"]);
  // Identity paint: the agent's own --bot (accent only as its fallback, which is how the source uses it) or a crew hue.
  const IDENTITY = new Set(["var(--bot)", "var(--bot,var(--accent))", ...CREW_HUES.map((h) => `var(--crew-${h})`)]);
  // Words that carry no colour: lengths, numbers, line styles and the non-colour keywords.
  const NEUTRAL = /^(none|transparent|inherit|initial|unset|revert|solid|dashed|dotted|double|-?(\d+|\d*\.\d+)(px|em|rem|%)?)$/;

  /** Why a colour-bearing word is not allowed in this declaration, or null when it is. */
  function colourOffence(selectors: string[], prop: string, word: string): string | null {
    if (IDENTITY.has(word) || NEUTRAL.test(word)) return null;
    // The one state colour: --attention, on the waiting ring and nowhere else.
    if (word === "var(--attention)" && selectors.every((s) => /\.ring$/.test(s))) return null;
    // The crown's cut-out edge is the ground it sits on, not a colour.
    if (word === "var(--ground)" && prop === "stroke" && selectors.every((s) => s === ".bot .crown")) return null;
    return word;
  }

  function cssColourOffenders(css: string): string[] {
    return cssDeclarations(css).flatMap(({ selectors, prop, value }) => {
      const where = `${selectors.join(", ")} { ${prop}: ${value} }`;
      if (prop.startsWith("--")) return [`${where}: Avatar.css declares no custom property`];
      if (NON_COLOUR_PROPS.has(prop.toLowerCase())) {
        const vars = [...value.matchAll(/var\(\s*(--[\w-]+)/gi)].map((m) => m[1] ?? "");
        return vars.filter((v) => !LAYOUT_VARS.has(v)).map((v) => `${where}: reads ${v}`);
      }
      return valueWords(value)
        .map((word) => colourOffence(selectors, prop.toLowerCase(), word))
        .filter((word): word is string => word !== null)
        .map((word) => `${where}: ${word}`);
    });
  }

  it("Avatar.css takes every colour from --bot, a crew hue, or --attention on the ring, and declares no custom property", () => {
    expect(cssColourOffenders(avatarCss)).toEqual([]);
    // The component sets --bot inline only; no rule may re-point it, by state or by role.
    expect(cssDeclarations(avatarCss).filter((d) => d.prop === "--bot")).toEqual([]);
  });

  it("the CSS colour allowlist rejects what it must and keeps what the real stylesheet uses", () => {
    // A guard that never fails proves nothing: each of these must be an offender.
    const bad = [
      ".bot .knot{fill:var(--nope, red)}",
      ".bot .knot{fill:var(--danger, var(--bot))}",
      ".bot .knot{fill:var( --danger )}",
      ".bot .knot{fill:var(--accent)}",
      ".bot .knot{fill:red}",
      ".bot .knot{fill:currentColor}",
      ".bot .knot{fill:RGB(1,2,3)}",
      ".bot .knot{fill:var(--attention)}",
      ".bot .ring{border:2px solid var(--danger)}",
      ".bot .st{-webkit-text-fill-color:var(--danger)}",
      ".bot .rig{opacity:var(--danger)}",
      ".bot.danger{--bot:crimson !important}",
      ".bot.danger{--bot:var(--danger)}",
      ".bot:not(.lead){--bot:var(--accent) !important}",
      ".bot{--x:var(--danger)}",
      "@keyframes k{to{fill:red}}",
    ];
    for (const css of bad) expect(cssColourOffenders(css), css).not.toEqual([]);
    const good = [".bot .knot{fill:var(--bot, var(--accent))}", ".bot .ring{border:2px solid var(--attention)}", ".bot .st{fill:none;stroke-width:1.6}"];
    for (const css of good) expect(cssColourOffenders(css), css).toEqual([]);
  });

  it("no semantic token appears in Avatar.tsx or creatures.ts", () => {
    expect(avatarTsx).not.toMatch(semantic);
    expect(creaturesTs).not.toMatch(semantic);
  });

  it("the rendered avatar carries no colour of its own: only the root sets --bot, to accent or a crew hue", () => {
    const crewTokens = CREW_HUES.map((h) => `var(--crew-${h})`);
    const colourAttrs = ["fill", "stroke", "color", "stop-color", "flood-color", "lighting-color"];
    for (const agent of [WRIGHT, MASON]) {
      for (const state of AVATAR_STATES) {
        const root = renderAvatar(agent, state, { action: "x" });
        // The inline styles the component may set, element by element, each with the only value shape it may take.
        const rootStyle: Record<string, (v: string) => boolean> = {
          "--s": (v) => /^\d+(\.\d+)?px$/.test(v),
          "--bot": (v) => (agent === WRIGHT ? v === "var(--accent)" : crewTokens.includes(v)),
          "--seed": (v) => /^-\d+(\.\d+)?s$/.test(v),
        };
        const tailStyle: Record<string, (v: string) => boolean> = { "transform-origin": (v) => /^\d+(\.\d+)?px \d+(\.\d+)?px$/.test(v) };
        for (const el of [root, ...root.querySelectorAll("*")]) {
          for (const attr of colourAttrs) expect(el.getAttribute(attr), `${state} ${el.tagName} ${attr}`).toBeNull();
          const allowed = el === root ? rootStyle : el.matches("g.tail") ? tailStyle : {};
          const declarations = (el.getAttribute("style") ?? "")
            .split(";")
            .filter((d) => d.trim() !== "")
            .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()] as const);
          const bad = declarations.filter(([prop, value]) => !(allowed[prop]?.(value) ?? false));
          expect(bad, `${state} ${el.tagName}.${el.getAttribute("class") ?? ""}`).toEqual([]);
        }
        expect(Object.keys(rootStyle).every((p) => rootStyle[p]?.(root.style.getPropertyValue(p)))).toBe(true);
      }
    }
  });
});

// --- the approved design's creature table, read from docs/design/avatar/avatar.js ---

interface DesignShape {
  body: string;
  tail: [number, number];
  crown?: [number, number];
}

function designShapes(): Record<string, DesignShape> {
  const start = designAvatarJs.indexOf("const SHAPES={");
  const end = designAvatarJs.indexOf("\n};", start);
  if (start < 0 || end < 0) throw new Error("avatar.js has no SHAPES table");
  const literal = designAvatarJs.slice(start + "const SHAPES=".length, end + 2);
  // The table is a plain object literal of strings and number pairs.
  return new Function(`return ${literal}`)() as Record<string, DesignShape>;
}

function designParts(name: string): string[] {
  const shape = designShapes()[name];
  if (shape === undefined) throw new Error(`avatar.js has no ${name}`);
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${shape.body}</svg>`, "image/svg+xml");
  return [...doc.documentElement.children].map(describeElement);
}
