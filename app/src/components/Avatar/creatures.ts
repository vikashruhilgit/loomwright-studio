// The stitched sea creatures, ported from the approved design
// (docs/design/avatar/avatar.js, `SHAPES`, `seedOf` and the thread/crown
// builders inside `avatarHTML`). Every coordinate and every path's `d` is the
// source's, verbatim: Avatar.test.tsx compares this table against avatar.js so
// a design change cannot drift silently. Data only; no colour lives here.

/** The whale is Wright's alone; the seven crew creatures are picked in a charter. */
export type CreatureName = "whale" | CrewCreature;
export type CrewCreature = "shark" | "seahorse" | "octopus" | "turtle" | "jellyfish" | "fish" | "crab";

/** Crew identity hues: each maps to a `--crew-*` token. `accent` is Wright's alone; semantic tokens are never an identity. */
export type CrewHue = "teal" | "berry" | "sky" | "olive" | "slate";

/** The layer a body part is drawn on: `.fill` silhouette, `.st` running-stitch outline, `.ln` inner lines, `.knot` eye. */
export type PartClass = "fill" | "st" | "ln" | "knot";

export type CreaturePart =
  | { readonly tag: "path"; readonly cls: PartClass; readonly d: string }
  | { readonly tag: "ellipse"; readonly cls: PartClass; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number }
  | { readonly tag: "circle"; readonly cls: PartClass; readonly cx: number; readonly cy: number; readonly r: number };

export interface Creature {
  readonly parts: readonly CreaturePart[];
  /** Where the loose thread leaves the body, in the 32-unit drawing space. */
  readonly tail: readonly [number, number];
}

export const SHAPES: Readonly<Record<CreatureName, Creature>> = {
  whale: {
    parts: [
      { tag: "ellipse", cls: "fill", cx: 18, cy: 17, rx: 10, ry: 7 },
      { tag: "path", cls: "fill", d: "M9 17c-3-1-5-3-6-6 0 4 0 8 0 12 1-3 3-5 6-6z" },
      { tag: "ellipse", cls: "st", cx: 18, cy: 17, rx: 10, ry: 7 },
      { tag: "path", cls: "st", d: "M9 17c-3-1-5-3-6-6 0 4 0 8 0 12 1-3 3-5 6-6z" },
      { tag: "path", cls: "ln", d: "M17 24c-1 3 0 5 2 6M12 20c3 1 7 1 10 0M23 9c0-2 1-3 2-4M22 9c0-2-1-3-2-4" },
      { tag: "circle", cls: "knot", cx: 24, cy: 15, r: 1.3 },
    ],
    tail: [3, 23],
  },
  shark: {
    parts: [
      { tag: "path", cls: "fill", d: "M5 17c4-4 9-6 15-6 4 0 8 2 10 6-2 4-6 6-10 6-6 0-11-2-15-6z" },
      { tag: "path", cls: "fill", d: "M13 12c1-4 3-6 5-7 0 3 0 5-1 7z" },
      { tag: "path", cls: "st", d: "M5 17c4-4 9-6 15-6 4 0 8 2 10 6-2 4-6 6-10 6-6 0-11-2-15-6z" },
      { tag: "path", cls: "st", d: "M13 12c1-4 3-6 5-7 0 3 0 5-1 7zM5 17c-2-3-3-5-3-8 2 2 4 4 6 5M5 17c-2 3-3 5-3 8 2-2 4-4 6-5" },
      { tag: "path", cls: "ln", d: "M22 15v4M24 15v4M18 22c1 2 2 3 3 3" },
      { tag: "circle", cls: "knot", cx: 26, cy: 16, r: 1.2 },
    ],
    tail: [2, 25],
  },
  seahorse: {
    parts: [
      { tag: "path", cls: "fill", d: "M18 4c4 0 6 3 6 7 0 5-4 8-6 12-1 3 0 5 2 6-4 0-7-3-6-7 1-4 5-7 5-11 0-2-1-3-2-3-2 0-3 1-4 2l-4-1c1-3 5-5 9-5z" },
      { tag: "path", cls: "st", d: "M18 4c4 0 6 3 6 7 0 5-4 8-6 12-1 3 0 5 2 6-4 0-7-3-6-7 1-4 5-7 5-11 0-2-1-3-2-3-2 0-3 1-4 2l-4-1c1-3 5-5 9-5z" },
      { tag: "path", cls: "ln", d: "M9 9h-4M22 8l2-2M23 12l3-1M20 16l3 1M16 22h3" },
      { tag: "circle", cls: "knot", cx: 18, cy: 8, r: 1.2 },
    ],
    tail: [20, 29],
  },
  octopus: {
    parts: [
      { tag: "circle", cls: "fill", cx: 16, cy: 12, r: 8 },
      { tag: "circle", cls: "st", cx: 16, cy: 12, r: 8 },
      { tag: "path", cls: "ln", d: "M9 18c-2 4-4 7-2 11M13 19c-1 4-1 8 1 11M19 19c1 4 1 8-1 11M23 18c2 4 4 7 2 11" },
      { tag: "circle", cls: "knot", cx: 13, cy: 12, r: 1.2 },
      { tag: "circle", cls: "knot", cx: 19, cy: 12, r: 1.2 },
    ],
    tail: [27, 22],
  },
  turtle: {
    parts: [
      { tag: "ellipse", cls: "fill", cx: 15, cy: 17, rx: 10, ry: 7 },
      { tag: "circle", cls: "fill", cx: 27, cy: 15, r: 3 },
      { tag: "ellipse", cls: "st", cx: 15, cy: 17, rx: 10, ry: 7 },
      { tag: "circle", cls: "st", cx: 27, cy: 15, r: 3 },
      { tag: "path", cls: "ln", d: "M8 17h14M11 12l2 5M19 12l-2 5M11 22l2-5M19 22l-2-5M8 12l-4-3M8 22l-4 3M22 22l3 3" },
      { tag: "circle", cls: "knot", cx: 28, cy: 14, r: 1 },
    ],
    tail: [4, 17],
  },
  jellyfish: {
    parts: [
      { tag: "path", cls: "fill", d: "M6 15a10 8 0 0 1 20 0c-3 2-7 3-10 3s-7-1-10-3z" },
      { tag: "path", cls: "st", d: "M6 15a10 8 0 0 1 20 0c-3 2-7 3-10 3s-7-1-10-3z" },
      { tag: "path", cls: "ln", d: "M10 18c-1 4 1 7 0 11M14 19c-1 4 1 7 0 10M18 19c1 4-1 7 0 10M22 18c1 4-1 7 0 11M10 12c2-2 10-2 12 0" },
      { tag: "circle", cls: "knot", cx: 13, cy: 14, r: 1 },
      { tag: "circle", cls: "knot", cx: 19, cy: 14, r: 1 },
    ],
    tail: [26, 16],
  },
  fish: {
    parts: [
      { tag: "ellipse", cls: "fill", cx: 15, cy: 16, rx: 9, ry: 6 },
      { tag: "path", cls: "fill", d: "M6 16l-4-5v10z" },
      { tag: "ellipse", cls: "st", cx: 15, cy: 16, rx: 9, ry: 6 },
      { tag: "path", cls: "st", d: "M6 16l-4-5v10zM14 10c1-3 3-4 5-4-1 2-1 4-2 5z" },
      { tag: "path", cls: "ln", d: "M12 11v10M16 11v10M15 22c1 2 3 3 4 3" },
      { tag: "circle", cls: "knot", cx: 20, cy: 15, r: 1.2 },
    ],
    tail: [24, 17],
  },
  crab: {
    parts: [
      { tag: "ellipse", cls: "fill", cx: 16, cy: 18, rx: 9, ry: 6 },
      { tag: "circle", cls: "fill", cx: 5, cy: 12, r: 3 },
      { tag: "circle", cls: "fill", cx: 27, cy: 12, r: 3 },
      { tag: "ellipse", cls: "st", cx: 16, cy: 18, rx: 9, ry: 6 },
      { tag: "circle", cls: "st", cx: 5, cy: 12, r: 3 },
      { tag: "circle", cls: "st", cx: 27, cy: 12, r: 3 },
      { tag: "path", cls: "ln", d: "M8 14l-2-1M24 14l2-1M8 20l-4 3M9 22l-3 4M24 20l4 3M23 22l3 4M12 12v-3M20 12v-3" },
      { tag: "circle", cls: "knot", cx: 12, cy: 9, r: 1.2 },
      { tag: "circle", cls: "knot", cx: 20, cy: 9, r: 1.2 },
    ],
    tail: [24, 24],
  },
};

/** The crown's anchor on the whale (avatar.js `SHAPES.whale.crown`). */
export const WHALE_CROWN: readonly [number, number] = [16, 4];

/** The crew creatures in the design's order (avatar.js `SHAPE_ORDER`: every shape but the whale). */
export const CREW_CREATURES: readonly CrewCreature[] = ["shark", "seahorse", "octopus", "turtle", "jellyfish", "fish", "crab"];

/** The crew identity hues in the design's assignment order (avatar.js `CREW_HUES`). */
export const CREW_HUES: readonly CrewHue[] = ["teal", "berry", "sky", "olive", "slate"];

/** The thread variants; each state shows one or two of them. */
export type ThreadName = "t-idle" | "t-up" | "t-slack" | "t-cut" | "t-cut2" | "t-bow";

/** The loose thread's path for each variant, built from the creature's tail anchor (avatar.js `tails`). */
export function threadPaths([tx, ty]: readonly [number, number]): Readonly<Record<ThreadName, string>> {
  return {
    "t-idle": `M${tx} ${ty}c-3 1-5 3-4 7`,
    "t-up": `M${tx} ${ty}c-5-1-7-6-3-9 3-2 5 2 2 3`,
    "t-slack": `M${tx} ${ty}c-1 3-1 8 0 12`,
    "t-cut": `M${tx} ${ty}c-2 0-3 1-3 2`,
    "t-cut2": `M${tx - 5} ${ty + 5}c-1 1-2 3-1 5`,
    "t-bow": `M${tx} ${ty}c-3-3-6-2-4 1s5 0 4-1c1-3 5-2 3 1s-5 0-3-1`,
  };
}

/** Wright's crown, built from the whale's crown anchor (avatar.js `crown`). */
export function crownPath([cx, cy]: readonly [number, number]): string {
  return `M${cx - 6.5} ${cy + 4.5}l1.5-5 3 3 2-4.5 2 4.5 3-3 1.5 5z`;
}

/**
 * Each agent's own clock, in seconds (0 to 3.9): a stable hash of its id, used
 * as a negative animation delay so a roster never sways in unison (avatar.js `seedOf`).
 */
export function seedOf(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 40) / 10;
}
