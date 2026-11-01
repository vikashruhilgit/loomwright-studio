// The menu-bar glyph: the app icon's Möbius ribbon, drawn in code (no asset
// files) as a macOS template image. Pure: no `electron` import, so the tray,
// its tests and any script can call it.
//
// Geometry. The ribbon's centreline is a rounded triangle,
// R·e^{iθ} + A·e^{i(ψ−2θ)}, with a corner at the top. A thread at offset
// k ∈ [−1, 1] across the band sits W·k·cos(1.5(θ − θ0)) along the normal; that
// term changes sign every 2π, so the band pinches to nothing at the three
// half-twists and a thread only closes after 4π (the ribbon has one edge).
//
// Template image. Every pixel is black with an alpha: macOS recolours it for a
// light or dark menu bar and for the highlighted state, so no state may depend
// on colour. States differ by shape, strength and motion:
//   idle     the ribbon at rest (six fine threads and a hairline edge)
//   working  fourteen finer threads, each carrying a light shaped like a speed
//            line (a round head tapering smoothly to a point), at its own speed
//   waiting  the ribbon at full strength, breathing from faint to full
//   paused   the ribbon faded, with two pause bars in its opening
//   killed   the ribbon faded, cut by a slash knocked out of it
//
// Drawing is analytic: strokes are distance-to-segment coverage, fills are
// scanline even-odd with 4×4 samples per pixel. A working frame costs well
// under a millisecond, so frames are drawn live, never shipped.

/** The glyph's states. `killed` is the kill switch: a stop, drawn as a cut. */
export type GlyphState = "idle" | "working" | "waiting" | "paused" | "killed";

/** The glyph's size in points, and the pixel scale it is drawn at (Retina). */
export const GLYPH_POINTS = 18;
export const GLYPH_SCALE = 2;
const SIZE = GLYPH_POINTS * GLYPH_SCALE;
/** Pixels per unit of the 24-unit design grid the preview was drawn on. */
const PX = SIZE / 24;

/** How often an animated state redraws, and the waiting breath's period. */
export const GLYPH_FRAME_MS = 66;
export const BREATH_MS = 2200;

/** Whether a state moves. A still state is drawn once per change. */
export function isAnimated(state: GlyphState): boolean {
  return state === "working" || state === "waiting";
}

// ---- geometry ----------------------------------------------------------------------------

type Point = readonly [number, number];

const R = 8.2;
const A = 1.2;
const W = 1.9;
const SQUASH = 0.9;
const PSI = 1.5 * Math.PI;
const TH0 = -Math.PI / 6;
const TURN = 4 * Math.PI;
const SAMPLES = 720;

function rawThread(k: number, t: number): Point {
  const cx = R * Math.cos(t) + A * Math.cos(PSI - 2 * t);
  const cy = R * Math.sin(t) + A * Math.sin(PSI - 2 * t);
  const dx = -R * Math.sin(t) + 2 * A * Math.sin(PSI - 2 * t);
  const dy = R * Math.cos(t) - 2 * A * Math.cos(PSI - 2 * t);
  const l = Math.hypot(dx, dy);
  const w = k * W * Math.cos(1.5 * (t - TH0));
  return [cx + (dy / l) * w, -(cy - (dx / l) * w) * SQUASH];
}

/** The ribbon fitted into the 24-unit grid with a margin, then scaled to pixels. */
const FIT = (() => {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i <= SAMPLES; i += 1) {
    const [x, y] = rawThread(1, (TURN * i) / SAMPLES);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const s = 21 / Math.max(x1 - x0, y1 - y0);
  return { s, ox: 12 - ((x0 + x1) / 2) * s, oy: 12 - ((y0 + y1) / 2) * s + 0.4 };
})();

/** A point on thread `k` at `t`, in pixels. */
function thread(k: number, t: number): Point {
  const [x, y] = rawThread(k, t);
  return [(x * FIT.s + FIT.ox) * PX, (y * FIT.s + FIT.oy) * PX];
}

function threadPoints(k: number): Point[] {
  return Array.from({ length: SAMPLES + 1 }, (_, i) => thread(k, (TURN * i) / SAMPLES));
}

/** `n` thread offsets spread evenly across the band. */
const spread = (n: number): number[] => Array.from({ length: n }, (_, i) => -0.82 + (1.64 * i) / (n - 1));

const EDGE = threadPoints(1);

// ---- rasterising -------------------------------------------------------------------------

type Alpha = Float32Array;
const blank = (): Alpha => new Float32Array(SIZE * SIZE);
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Coverage of a polyline of width `width` (in grid units), as the union of its segments. */
function stroke(points: readonly Point[], width: number): Alpha {
  const cover = blank();
  const w = width * PX;
  const reach = w / 2 + 1;
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy || 1;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - reach));
    const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(ax, bx) + reach));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - reach));
    const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(ay, by) + reach));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5 - ax;
        const py = y + 0.5 - ay;
        const u = clamp01((px * vx + py * vy) / len2);
        const d = Math.hypot(px - u * vx, py - u * vy);
        // A line under a pixel wide covers about its width: a tent, not a box.
        const c = w >= 1 ? clamp01(w / 2 + 0.5 - d) : w * clamp01(1 - d);
        const at = y * SIZE + x;
        if (c > cover[at]!) cover[at] = c;
      }
    }
  }
  return cover;
}

/** Even-odd coverage of a closed polygon, 4×4 samples per pixel. */
function fill(points: readonly Point[]): Alpha {
  const cover = blank();
  const n = points.length;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const rowFrom = Math.max(0, Math.floor(minY * 4));
  const rowTo = Math.min(SIZE * 4 - 1, Math.ceil(maxY * 4));
  const xs: number[] = [];
  for (let sub = rowFrom; sub <= rowTo; sub += 1) {
    const sy = (sub + 0.5) / 4;
    xs.length = 0;
    for (let i = 0; i < n; i += 1) {
      const [ax, ay] = points[i]!;
      const [bx, by] = points[(i + 1) % n]!;
      if (ay <= sy === by <= sy) continue;
      xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    const row = Math.floor(sub / 4) * SIZE;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil(xs[i]! * 4 - 0.5));
      const to = Math.min(SIZE * 4 - 1, Math.floor(xs[i + 1]! * 4 - 0.5));
      for (let sx = from; sx <= to; sx += 1) cover[row + (sx >> 2)]! += 1 / 16;
    }
  }
  return cover;
}

/** Composites `layer` × `opacity` over `into` (alpha only: the colour is always black). */
function over(into: Alpha, layer: Alpha, opacity = 1): void {
  for (let i = 0; i < into.length; i += 1) {
    const a = clamp01(layer[i]!) * opacity;
    if (a > 0) into[i] = a + into[i]! * (1 - a);
  }
}

// ---- the ribbon --------------------------------------------------------------------------

interface RibbonLook {
  readonly tint: number;
  readonly threads: number;
  readonly edge: number;
  readonly count: number;
  readonly width: number;
}

const LOOKS = {
  rest: { tint: 0.06, threads: 0.4, edge: 0.65, count: 6, width: 0.22 },
  working: { tint: 0.06, threads: 0.32, edge: 0.5, count: 14, width: 0.12 },
  full: { tint: 0.25, threads: 1, edge: 1, count: 6, width: 0.22 },
  faded: { tint: 0.04, threads: 0.22, edge: 0.4, count: 6, width: 0.22 },
} satisfies Record<string, RibbonLook>;

const BAND = fill(EDGE);
const threadCache = new Map<string, Alpha>();
function threadLayer(k: number, width: number): Alpha {
  const key = `${k}:${width}`;
  let layer = threadCache.get(key);
  if (layer === undefined) {
    layer = stroke(threadPoints(k), width);
    threadCache.set(key, layer);
  }
  return layer;
}
const EDGE_LINE = stroke(EDGE, 0.55);

function ribbon(look: RibbonLook): Alpha {
  const out = blank();
  over(out, BAND, look.tint);
  for (const k of spread(look.count)) over(out, threadLayer(k, look.width), look.threads);
  over(out, EDGE_LINE, look.edge);
  return out;
}

const line = (x1: number, y1: number, x2: number, y2: number): Point[] => [
  [x1 * PX, y1 * PX],
  [x2 * PX, y2 * PX],
];

// ---- the still layers, drawn once ----------------------------------------------------------

const STILL: Readonly<Record<GlyphState, Alpha>> = (() => {
  const paused = ribbon(LOOKS.faded);
  over(paused, stroke(line(10.5, 11, 10.5, 15.4), 0.85));
  over(paused, stroke(line(12.7, 11, 12.7, 15.4), 0.85));

  // The slash is knocked out of the ribbon (a gap each side), then drawn.
  const killed = ribbon(LOOKS.faded);
  const gap = stroke(line(20.5, 3.5, 3.5, 20.5), 2.4);
  for (let i = 0; i < killed.length; i += 1) killed[i] = killed[i]! * (1 - clamp01(gap[i]!));
  over(killed, stroke(line(20.5, 3.5, 3.5, 20.5), 0.75));

  return { idle: ribbon(LOOKS.rest), working: ribbon(LOOKS.working), waiting: ribbon(LOOKS.full), paused, killed };
})();

// ---- the moving layers -------------------------------------------------------------------

const RAY_THREADS = spread(14);
/** A ray's length along its thread (in θ), the head's diameter (grid units), and its outline samples. */
const RAY_LENGTH = 1.0;
const RAY_HEAD = 0.55;
const RAY_SAMPLES = 28;

/**
 * One speed line on thread `k` whose head is at `head` (θ): a single filled
 * shape whose width grows smoothly from a point at the back to a round head,
 * faded in from the tail (0 → 0.55 at 65% → 1 at the head).
 */
function ray(k: number, head: number, into: Alpha): void {
  const pts: Point[] = [];
  for (let j = 0; j <= RAY_SAMPLES; j += 1) pts.push(thread(k, head - RAY_LENGTH + (RAY_LENGTH * j) / RAY_SAMPLES));
  const left: Point[] = [];
  const right: Point[] = [];
  let tx = 0;
  let ty = 0;
  let h = 0;
  for (let j = 0; j <= RAY_SAMPLES; j += 1) {
    const [ax, ay] = pts[Math.max(j - 1, 0)]!;
    const [bx, by] = pts[Math.min(j + 1, RAY_SAMPLES)]!;
    const l = Math.hypot(bx - ax, by - ay) || 1;
    tx = (bx - ax) / l;
    ty = (by - ay) / l;
    h = ((RAY_HEAD * PX) / 2) * Math.pow(j / RAY_SAMPLES, 0.9);
    const [x, y] = pts[j]!;
    left.push([x - ty * h, y + tx * h]);
    right.push([x + ty * h, y - tx * h]);
  }
  // The round head: a half circle ahead of the last sample.
  const [hx, hy] = pts[RAY_SAMPLES]!;
  const cap: Point[] = [];
  for (let i = 1; i < 8; i += 1) {
    const a = (Math.PI * i) / 8;
    // from the left side, round the front, to the right side
    cap.push([hx + (-ty * Math.cos(a) + tx * Math.sin(a)) * h, hy + (tx * Math.cos(a) + ty * Math.sin(a)) * h]);
  }
  const shape = fill([...left, ...cap, ...right.reverse()]);
  const [x1, y1] = pts[0]!;
  const x2 = hx + tx * h;
  const y2 = hy + ty * h;
  const gx = x2 - x1;
  const gy = y2 - y1;
  const g2 = gx * gx + gy * gy || 1;
  for (let i = 0; i < shape.length; i += 1) {
    if (shape[i] === 0) continue;
    const t = clamp01((((i % SIZE) + 0.5 - x1) * gx + (Math.floor(i / SIZE) + 0.5 - y1) * gy) / g2);
    shape[i] = shape[i]! * (t < 0.65 ? (t / 0.65) * 0.55 : 0.55 + ((t - 0.65) / 0.35) * 0.45);
  }
  over(into, shape);
}

/** Each thread's ray starts at its own place round the loop and runs at its own speed (one loop in 10–13 s). */
const RAYS = RAY_THREADS.map((k, i) => ({ k, phase: ((i * 0.618) % 1) * TURN, speed: TURN / (2 * (5200 + ((i * 37) % 5) * 380)) }));

// ---- the bitmap --------------------------------------------------------------------------

/**
 * The glyph for `state` at `timeMs` into its animation, as a premultiplied BGRA
 * bitmap (the byte order `nativeImage.createFromBitmap` takes), black with
 * alpha. `still` draws the reduced-motion frame: working's rays where they
 * start, and waiting at full strength.
 */
export function glyphBitmap(state: GlyphState, timeMs = 0, still = false): { readonly buffer: Buffer; readonly size: number } {
  let alpha = STILL[state];
  if (state === "working") {
    alpha = Float32Array.from(alpha);
    const t = still ? 0 : timeMs;
    for (const r of RAYS) ray(r.k, r.phase + t * r.speed, alpha);
  }
  let opacity = 1;
  if (state === "waiting" && !still) opacity = 0.35 + 0.65 * (0.5 - 0.5 * Math.cos((2 * Math.PI * timeMs) / BREATH_MS));
  const buffer = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < alpha.length; i += 1) buffer[i * 4 + 3] = Math.round(clamp01(alpha[i]!) * opacity * 255);
  return { buffer, size: SIZE };
}
