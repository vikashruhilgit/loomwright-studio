/// <reference types="node" />
// @vitest-environment jsdom
// StatusDot: the six states, the state word always present (visibly or as an
// aria-label), honest `ok` (AC5), only `working` animates and it stops under
// reduced motion (AC9), and the token-only source rule (AC7). CSS is read from
// disk with readFileSync, never `?raw` (vitest's css-disable plugin empties it).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusDot, type StatusState } from "./StatusDot";
import { states } from "./StatusDot.states";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const css = read("./StatusDot.css");

const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";

/** Splits CSS into its top-level blocks: `[prelude, body]` per rule, at-rule or keyframes. */
function topLevelBlocks(source: string): Array<[string, string]> {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: Array<[string, string]> = [];
  let depth = 0;
  let start = 0;
  let open = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) open = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        blocks.push([text.slice(start, open).trim(), text.slice(open + 1, i)]);
        start = i + 1;
      }
    }
  }
  return blocks;
}

afterEach(cleanup);

describe("StatusDot", () => {
  it.each<[StatusState, string]>([
    ["idle", "idle"],
    ["working", "working"],
    ["waiting", "waiting on you"],
    ["paused", "paused at cap"],
    ["failed", "failed"],
  ])("%s shows its dot and the word %j", (state, word) => {
    const { container } = render(<StatusDot state={state} />);
    const dot = container.querySelector(".status-dot");
    expect(dot?.getAttribute("data-state")).toBe(state);
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText(word)).toBeTruthy();
  });

  it("each state's mark and colour follow the README table", () => {
    const rule = (state: StatusState) => new RegExp(`\\.status-dot\\[data-state="${state}"\\]\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(rule("idle")).toMatch(/border:\s*2px solid var\(--idle\)/);
    expect(rule("idle")).not.toMatch(/background/);
    expect(rule("working")).toMatch(/background:\s*var\(--working\)/);
    expect(rule("working")).toMatch(/animation:[^;]*var\(--duration-pulse\)/);
    expect(rule("waiting")).toMatch(/background:\s*var\(--attention\)/);
    expect(rule("paused")).toMatch(/background:\s*var\(--parked\)/);
    expect(css).toMatch(/\.status-dot\[data-state="paused"\]::after\s*\{[^}]*content:\s*""/);
    expect(rule("ok")).toMatch(/background:\s*var\(--ok\)/);
    expect(rule("failed")).toMatch(/background:\s*var\(--danger\)/);
  });

  it("uses the caller's word and shows meta in caption", () => {
    const { container } = render(<StatusDot state="paused" label="paused at cap" meta="resets Thu 06:00" />);
    expect(container.querySelector(".status-meta")?.textContent).toBe("· resets Thu 06:00");
    expect(/\.status-meta\s*\{[^}]*font-size:\s*var\(--type-caption-size\)/.test(css)).toBe(true);
  });

  it("hideLabel moves the word into the dot's aria-label", () => {
    render(<StatusDot state="working" hideLabel />);
    const dot = screen.getByRole("img", { name: "working" });
    expect(dot.getAttribute("data-state")).toBe("working");
    expect(screen.queryByText("working")).toBeNull();
  });

  describe("honest ok (AC5)", () => {
    it("renders the ok dot only with the kernel-verified flag, naming the verification time in its meta", () => {
      const { container } = render(<StatusDot state="ok" label="CI green" verified={{ at: "14:02" }} />);
      expect(container.querySelector('.status-dot[data-state="ok"]')).not.toBeNull();
      expect(screen.getByText("CI green")).toBeTruthy();
      expect(container.querySelector(".status-meta")?.textContent).toBe("· verified 14:02");
    });

    it("without the flag renders ink-tertiary text and no dot", () => {
      const { container } = render(<StatusDot state="ok" label="CI green" />);
      expect(container.querySelector(".status-dot")).toBeNull();
      const guess = container.querySelector(".status-guess");
      expect(guess?.getAttribute("data-verified")).toBe("false");
      expect(guess?.textContent).toBe("CI green");
      expect(css).toMatch(/\.status-guess\s*\{\s*color:\s*var\(--ink-tertiary\);\s*\}/);
    });

    it("without the flag still shows its word even when hideLabel is set (there is no dot to carry it)", () => {
      const { container } = render(<StatusDot state="ok" hideLabel />);
      expect(container.querySelector(".status-dot")).toBeNull();
      expect(container.textContent).toBe("ok");
    });

    it("a verified flag with an empty time is still a guess", () => {
      const { container } = render(<StatusDot state="ok" label="CI green" verified={{ at: "  " }} />);
      expect(container.querySelector(".status-dot")).toBeNull();
      expect(container.textContent).toBe("CI green");
    });

    it("an unverified ok never claims verification in its text", () => {
      const { container } = render(<StatusDot state="ok" meta="2 checks" />);
      expect(container.textContent).not.toMatch(/verified/);
    });
  });

  it("renders every gallery state with its word visible or as an aria-label", () => {
    expect(new Set(states.map((s) => s.id)).size).toBe(states.length);
    for (const state of states) {
      const { container, unmount } = render(state.render());
      for (const status of container.querySelectorAll(".status")) {
        const word = status.querySelector(".status-label")?.textContent ?? status.querySelector("[role=img]")?.getAttribute("aria-label");
        expect(word?.trim()).toBeTruthy();
      }
      unmount();
    }
  });
});

describe("StatusDot motion (AC9)", () => {
  const blocks = topLevelBlocks(css);

  it("only working animates", () => {
    const animated = blocks.filter(([prelude, body]) => !prelude.startsWith("@") && /\banimation(?:-name)?\s*:/.test(body));
    expect(animated.map(([prelude]) => prelude)).toEqual(['.status-dot[data-state="working"]']);
  });

  it("the working dot is static under prefers-reduced-motion: reduce", () => {
    const reduced = blocks.find(([prelude]) => prelude === REDUCED_MOTION)?.[1] ?? "";
    expect(reduced).toMatch(/\.status-dot\[data-state="working"\]\s*\{[^}]*animation:\s*none/);
  });
});

describe("StatusDot source (AC7)", () => {
  const sources = { "StatusDot.css": css, "StatusDot.tsx": read("./StatusDot.tsx"), "StatusDot.states.tsx": read("./StatusDot.states.tsx") };

  it.each(Object.entries(sources))("%s is non-empty and has no hard-coded colour", (_name, source) => {
    expect(source.trim().length).toBeGreaterThan(0);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });
});
