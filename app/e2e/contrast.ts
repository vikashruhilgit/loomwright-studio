// The WCAG contrast measure the e2e specs share (`tasks.spec.ts`, `settings-threads.spec.ts`): one copy, so every
// spec that pins "text is at least 4.5:1" measures it the same way.
import type { Page } from "@playwright/test";

/** One measured element: its class list, the start of its text, and its contrast ratio against what it sits on. */
export interface ContrastRow {
  readonly selector: string;
  readonly text: string;
  readonly ratio: number;
}

/**
 * The WCAG contrast of every element `selector` matches, text on what it sits on, in the page's current theme: the
 * element's colour composited over the stack of translucent backgrounds under it, down to the first opaque one (white
 * when there is none).
 */
export async function contrastRows(page: Page, selector: string): Promise<ContrastRow[]> {
  return page.evaluate((selector) => {
    type Rgba = readonly [number, number, number, number];
    const parse = (css: string): Rgba => {
      const n = (css.match(/[-\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
      return css.startsWith("color(") ? [(n[0] ?? 0) * 255, (n[1] ?? 0) * 255, (n[2] ?? 0) * 255, n[3] ?? 1] : [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
    };
    const over = (top: Rgba, bottom: readonly [number, number, number]): [number, number, number] => [0, 1, 2].map((i) => (top[i] as number) * top[3] + (bottom[i] as number) * (1 - top[3])) as [number, number, number];
    const channel = (v: number): number => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ([r, g, b]: readonly [number, number, number]): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const backdrop = (el: Element): [number, number, number] => {
      const layers: Rgba[] = [];
      for (let e: Element | null = el; e !== null; e = e.parentElement) {
        const bg = parse(getComputedStyle(e).backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
      }
      let base: [number, number, number] = [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i -= 1) base = over(layers[i] as Rgba, base);
      return base;
    };
    return [...document.querySelectorAll(selector)].map((el) => {
      const bg = backdrop(el);
      const fg = over(parse(getComputedStyle(el).color), bg);
      const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
      return { selector: el.className, text: (el.textContent ?? "").slice(0, 40), ratio: (hi + 0.05) / (lo + 0.05) };
    });
  }, selector);
}
