/// <reference types="node" />
// @vitest-environment jsdom
// Badge family: semantic tones and neutral, the count pill (aria-label with
// the unit is required), the chip's avatar slot, kbd and mono; and the
// token-only source rule (AC7, AC9). CSS is read from disk with readFileSync,
// never `?raw` (vitest's css-disable plugin empties `*.css?raw`).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge, type BadgeTone, Chip, CountPill, Kbd, Mono } from "./Badge";
import { states } from "./Badge.states";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const css = read("./Badge.css");

afterEach(cleanup);

describe("Badge", () => {
  it.each<[BadgeTone, string, string]>([
    ["ok", "--ok-soft", "--ok"],
    ["attention", "--attention-soft", "--attention"],
    ["danger", "--danger-soft", "--danger"],
    ["parked", "--parked-soft", "--parked"],
    ["accent", "--accent-soft", "--accent"],
    ["neutral", "--surface-sunken", "--ink-secondary"],
  ])("the %s tone puts %s behind %s text", (tone, ground, ink) => {
    render(<Badge tone={tone}>merged</Badge>);
    expect(screen.getByText("merged").getAttribute("data-tone")).toBe(tone);
    const rule = new RegExp(`\\.badge\\[data-tone="${tone}"\\]\\s*\\{\\s*background:\\s*var\\(${ground}\\);\\s*color:\\s*var\\(${ink}\\);`);
    expect(css).toMatch(rule);
  });

  it("defaults to neutral and is 20px, radius-xs, caption size at weight 600", () => {
    render(<Badge>draft</Badge>);
    expect(screen.getByText("draft").getAttribute("data-tone")).toBe("neutral");
    const base = /\.badge\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(base).toMatch(/height:\s*20px/);
    expect(base).toMatch(/border-radius:\s*var\(--radius-xs\)/);
    expect(base).toMatch(/font-size:\s*var\(--type-caption-size\)/);
    expect(base).toMatch(/font-weight:\s*600/);
  });

  it("renders an optional icon in a decorative slot before the text", () => {
    render(
      <Badge tone="ok" icon={<svg data-testid="check" />}>
        CI green
      </Badge>,
    );
    const badge = screen.getByText("CI green");
    const slot = screen.getByTestId("check").parentElement;
    expect(slot?.getAttribute("aria-hidden")).toBe("true");
    expect(badge.firstElementChild).toBe(slot);
    expect(badge.textContent).toBe("CI green");
  });

  it("is never interactive", () => {
    render(<Badge tone="danger">denied</Badge>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("denied").tagName).toBe("SPAN");
  });
});

describe("CountPill", () => {
  it("is named by its required aria-label with the unit and shows tabular digits", () => {
    render(<CountPill count={3} aria-label="3 pending" />);
    const pill = screen.getByRole("img", { name: "3 pending" });
    expect(pill.textContent).toBe("3");
    const rule = /\.count-pill\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/background:\s*var\(--attention\)/);
    expect(rule).toMatch(/border-radius:\s*var\(--radius-full\)/);
    expect(rule).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("refuses to typecheck without an aria-label", () => {
    // @ts-expect-error the aria-label with the unit is required
    const pill = <CountPill count={3} />;
    expect(pill).toBeTruthy();
  });
});

describe("Chip, Kbd and Mono", () => {
  it("chip takes an avatar slot and a label on surface with a hairline edge", () => {
    render(<Chip avatar={<span role="img" aria-label="Mason · idle" />}>Mason</Chip>);
    expect(screen.getByRole("img", { name: "Mason · idle" })).toBeTruthy();
    expect(screen.getByText("Mason").closest(".chip")).toBeTruthy();
    const rule = /\.chip\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/background:\s*var\(--surface\)/);
    expect(rule).toMatch(/border:\s*1px solid var\(--hairline\)/);
  });

  it("chip renders without an avatar (a linked PR or ticket)", () => {
    const { container } = render(<Chip>loomwright PR 412</Chip>);
    expect(container.querySelector(".chip-avatar")).toBeNull();
    expect(screen.getByText("loomwright PR 412")).toBeTruthy();
  });

  it("kbd is a <kbd> and mono is a <code> in the mono type", () => {
    render(
      <>
        <Kbd>⇧A</Kbd>
        <Mono>{"{pr.head_sha}"}</Mono>
      </>,
    );
    expect(screen.getByText("⇧A").tagName).toBe("KBD");
    expect(screen.getByText("{pr.head_sha}").tagName).toBe("CODE");
    expect(/\.mono\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/font-family:\s*var\(--type-mono-small-family\)/);
  });

  it("renders every gallery state", () => {
    expect(new Set(states.map((s) => s.id)).size).toBe(states.length);
    for (const state of states) {
      const { container, unmount } = render(state.render());
      expect(container.textContent?.trim()).not.toBe("");
      unmount();
    }
  });
});

describe("Badge source (AC7, AC9)", () => {
  const sources = { "Badge.css": css, "Badge.tsx": read("./Badge.tsx"), "Badge.states.tsx": read("./Badge.states.tsx") };

  it.each(Object.entries(sources))("%s is non-empty and has no hard-coded colour", (_name, source) => {
    expect(source.trim().length).toBeGreaterThan(0);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });

  it("carries a prefers-reduced-motion block", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*transition-duration:\s*0s/);
  });
});
