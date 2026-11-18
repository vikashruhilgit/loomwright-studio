// The stitched sea-creature avatar (D23): an agent's identity and its kernel
// state at once. Ported from the approved design: docs/design/avatar/avatar.js
// (`avatarHTML`) and avatar.css, with the state words from
// docs/design/design-system/components/Avatar/preview.html and the rules in
// that component's README. Non-interactive: `role="img"` with the label as
// both `aria-label` and the `title` tooltip.
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactElement } from "react";
import "./Avatar.css";
import { CREW_CREATURES, CREW_HUES, SHAPES, WHALE_CROWN, crownPath, seedOf, threadPaths } from "./creatures";
import type { CreatureName, CreaturePart, CrewCreature, CrewHue, ThreadName } from "./creatures";

/** The six kernel states an avatar carries. */
export type AvatarState = "idle" | "working" | "waiting" | "parked" | "done" | "danger";

export const AVATAR_STATES: readonly AvatarState[] = ["idle", "working", "waiting", "parked", "done", "danger"];

/** The words each state reads as, in the label and the tooltip (preview.html `stateWord`). */
export const STATE_WORDS: Readonly<Record<AvatarState, string>> = {
  idle: "idle",
  working: "working",
  waiting: "waiting on you",
  parked: "paused at cap",
  done: "done",
  danger: "killed",
};

/**
 * The thread path(s) each state shows. Only these are rendered, so the state is
 * legible from the markup alone, with motion off and without CSS. `idle` and
 * `working` share `t-idle` in the design; `working` is told apart by its
 * running stitches, which only move when motion is on.
 */
export const STATE_THREADS: Readonly<Record<AvatarState, readonly ThreadName[]>> = {
  idle: ["t-idle"],
  working: ["t-idle"],
  waiting: ["t-up"],
  parked: ["t-slack"],
  done: ["t-bow"],
  danger: ["t-cut", "t-cut2"],
};

export const WRIGHT_ID = "wright";
export const MIN_AVATAR_SIZE = 16;
export const DEFAULT_AVATAR_SIZE = 32;

const CREW_HUE_TOKENS: Readonly<Record<CrewHue, string>> = {
  teal: "--crew-teal",
  berry: "--crew-berry",
  sky: "--crew-sky",
  olive: "--crew-olive",
  slate: "--crew-slate",
};

/** The agent as the avatar needs it. `shape` and `hue` come from the charter, so they are checked, not trusted. */
export interface AvatarAgent {
  readonly id: string;
  readonly name: string;
  /** A crew creature. Ignored for Wright (always the whale); unknown or `whale` falls back to `fish` for anyone else. */
  readonly shape?: string;
  /**
   * A crew hue, canonically the kernel's `AgentRow.avatar_hue` as sent over the wire (`crew-teal`, `crew-berry`,
   * `crew-sky`, `crew-olive`, `crew-slate`; kernel `AVATAR_HUES`). The design's bare names (`teal` and so on) are
   * also accepted. Ignored for Wright (always `accent`); anything else, `accent` and `crew-accent` included, falls
   * back to `slate`.
   */
  readonly hue?: string;
}

export interface AvatarProps {
  readonly agent: AvatarAgent;
  readonly state: AvatarState;
  /** Edge length in px: 16 (approval chips), 24 (Crew rows, chat), 36 (Team cards, inspector), 56 (showcase). Never below 16. */
  readonly size?: number;
  /** The agent's current action, appended to the label ("Mason · waiting on you · {action}"). */
  readonly action?: string;
  /**
   * The avatar shows an agent's CURRENT state (a crew row, a Team card, the inspector) for an agent that is on. Only
   * then does `idle` sway: an idle avatar anywhere else (a finished card, a chat message, a folder mark, a picker, a
   * crew member that is off) is still, its thread's shape alone carrying the state, as under reduced motion. The
   * other states keep their motion wherever they are drawn: it says something is happening.
   */
  readonly live?: boolean;
}

/**
 * Why `idle` motion is opt-in (2026-11-17, measured): every avatar animated forever, wherever it was drawn, and SVG
 * part animations are redrawn by the CPU every frame. Visible on Tasks with 199 finished cards, the renderer used
 * ~69% CPU with motion on and ~0.7% with Reduce motion on; 14 idle crew rows alone kept it near 35% on any screen.
 * So the number of moving avatars follows what is happening, never the length of a list.
 */
export function avatarIsStill(state: AvatarState, live: boolean | undefined): boolean {
  return state === "idle" && live !== true;
}

/** One observer for every avatar: an avatar out of the viewport gets `data-offscreen`, which pauses its animations (CSS). */
let offscreenObserver: IntersectionObserver | null | undefined;

function observerOf(): IntersectionObserver | null {
  if (offscreenObserver === undefined) {
    offscreenObserver =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            for (const entry of entries) {
              // Set on the element itself, never through React state: no avatar re-renders when the list scrolls.
              if (entry.isIntersecting) entry.target.removeAttribute("data-offscreen");
              else entry.target.setAttribute("data-offscreen", "");
            }
          })
        : null;
  }
  return offscreenObserver;
}

function isCrewCreature(shape: string | undefined): shape is CrewCreature {
  return (CREW_CREATURES as readonly string[]).includes(shape ?? "");
}

function isCrewHue(hue: string | undefined): hue is CrewHue {
  return (CREW_HUES as readonly string[]).includes(hue ?? "");
}

/** The crew hue an input names: the kernel's `crew-teal` or the design's bare `teal`; undefined when it names none. */
export function crewHueOf(hue: string | undefined): CrewHue | undefined {
  const bare = hue?.startsWith("crew-") ? hue.slice("crew-".length) : hue;
  return isCrewHue(bare) ? bare : undefined;
}

/** Wright is the whale; any other agent is its crew creature, or the fish when the shape is unknown or the whale. */
export function creatureFor(agent: AvatarAgent): CreatureName {
  if (agent.id === WRIGHT_ID) return "whale";
  return isCrewCreature(agent.shape) ? agent.shape : "fish";
}

/** Wright wears `accent`; any other agent its crew hue, or slate when unknown. Never a semantic token. */
export function hueTokenFor(agent: AvatarAgent): string {
  if (agent.id === WRIGHT_ID) return "--accent";
  return CREW_HUE_TOKENS[crewHueOf(agent.hue) ?? "slate"];
}

/** The label read by assistive tech and shown as the tooltip. */
export function avatarLabel(name: string, state: AvatarState, action?: string): string {
  return `${name} · ${STATE_WORDS[state]}${action ? ` · ${action}` : ""}`;
}

function clampSize(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size)) return DEFAULT_AVATAR_SIZE;
  return Math.max(MIN_AVATAR_SIZE, size);
}

/**
 * Why the moving parts are HTML layers, each holding its own copy of the viewBox (2026-11-18, measured live).
 * The design animates `transform` on `<g>` groups inside one SVG. Chromium cannot hand an animation inside an SVG
 * to the compositor, so every display frame (120 Hz here) ran style, layout and paint for the whole page on the
 * main thread: on Tasks, two moving avatars held the renderer at ~38% CPU, and pausing only the in-SVG animations
 * took it to ~3% while the HTML ring kept animating. A `transform` animation on an HTML element runs on the
 * compositor thread with no main-thread frame at all, so drift, rig, tail and the stitch ring's spin are spans.
 * The layers stack exactly as the groups nested: every layer fills the root, and each SVG shares the viewBox.
 */
const VIEW_BOX = "-2 -2 36 36";
const VIEW_MIN = -2;
const VIEW_SIZE = 36;

/** A point of the viewBox as a `transform-origin` in percent of the layer, which is the viewBox drawn at full size. */
export function originOf(x: number, y: number): string {
  const percent = (v: number): string => `${+(((v - VIEW_MIN) / VIEW_SIZE) * 100).toFixed(4)}%`;
  return `${percent(x)} ${percent(y)}`;
}

function Part({ part }: { readonly part: CreaturePart }): ReactElement {
  switch (part.tag) {
    case "path":
      return <path className={part.cls} d={part.d} />;
    case "ellipse":
      return <ellipse className={part.cls} cx={part.cx} cy={part.cy} rx={part.rx} ry={part.ry} />;
    case "circle":
      return <circle className={part.cls} cx={part.cx} cy={part.cy} r={part.r} />;
  }
}

export function Avatar({ agent, state, size, action, live }: AvatarProps): ReactElement {
  const still = avatarIsStill(state, live);
  const ref = useRef<HTMLSpanElement>(null);
  // A still avatar runs no animation, so only a moving one is watched for leaving the viewport.
  useEffect(() => {
    const el = ref.current;
    const observer = still ? null : observerOf();
    if (el === null || observer === null) return;
    observer.observe(el);
    return () => {
      observer.unobserve(el);
      el.removeAttribute("data-offscreen");
    };
  }, [still]);
  const isWright = agent.id === WRIGHT_ID;
  const creature = SHAPES[creatureFor(agent)];
  const [tx, ty] = creature.tail;
  const threads = threadPaths(creature.tail);
  const label = avatarLabel(agent.name, state, action);
  const style = {
    "--s": `${clampSize(size)}px`,
    "--bot": `var(${hueTokenFor(agent)})`,
    "--seed": `-${seedOf(agent.id)}s`,
  } as CSSProperties;

  return (
    <span ref={ref} className={`bot ${state}${isWright ? " lead" : ""}${still ? " still" : ""}`} style={style} role="img" aria-label={label} title={label}>
      <span className="ring" aria-hidden="true" />
      <span className="layer spin">
        <svg viewBox={VIEW_BOX}>
          <circle className="stitch" cx="16" cy="16" r="16.5" />
        </svg>
      </span>
      <span className="layer drift">
        <span className="layer rig">
          <svg viewBox={VIEW_BOX}>
            {creature.parts.map((part, index) => (
              <Part key={index} part={part} />
            ))}
            {isWright ? <path className="crown" d={crownPath(WHALE_CROWN)} /> : null}
          </svg>
          <span className="layer tail" style={{ transformOrigin: originOf(tx, ty) }}>
            <svg viewBox={VIEW_BOX}>
              {STATE_THREADS[state].map((name) => (
                <path key={name} className={`t ${name}`} d={threads[name]} />
              ))}
            </svg>
          </span>
        </span>
      </span>
    </span>
  );
}
