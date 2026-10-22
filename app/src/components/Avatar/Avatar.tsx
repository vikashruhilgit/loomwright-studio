// The stitched sea-creature avatar (D23): an agent's identity and its kernel
// state at once. Ported from the approved design: docs/design/avatar/avatar.js
// (`avatarHTML`) and avatar.css, with the state words from
// docs/design/design-system/components/Avatar/preview.html and the rules in
// that component's README. Non-interactive: `role="img"` with the label as
// both `aria-label` and the `title` tooltip.
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

export function Avatar({ agent, state, size, action }: AvatarProps): ReactElement {
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
    <span className={isWright ? `bot ${state} lead` : `bot ${state}`} style={style} role="img" aria-label={label} title={label}>
      <span className="ring" aria-hidden="true" />
      <svg viewBox="-2 -2 36 36">
        <circle className="stitch" cx="16" cy="16" r="16.5" />
        <g className="drift">
          <g className="rig">
            {creature.parts.map((part, index) => (
              <Part key={index} part={part} />
            ))}
            {isWright ? <path className="crown" d={crownPath(WHALE_CROWN)} /> : null}
            <g className="tail" style={{ transformOrigin: `${tx}px ${ty}px` }}>
              {STATE_THREADS[state].map((name) => (
                <path key={name} className={`t ${name}`} d={threads[name]} />
              ))}
            </g>
          </g>
        </g>
      </svg>
    </span>
  );
}
