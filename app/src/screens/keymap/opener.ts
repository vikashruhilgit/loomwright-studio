// Where the Keyboard map was opened from, so its Back control returns there. The map is reached by `?`, by the
// palette's "Keyboard map" command or by its own link, and all three are plain hash changes, so the screen
// remembers the last hash that was not its own instead of depending on who navigated. `index.tsx` installs the
// tracker when the module is first loaded (screens are eager-imported, so before the first hash change).

const KEYMAP_HASH = /^#\/keymap(?![a-z0-9-])/;

/** Where Back goes when the window opened on the map itself (a deep link): the mockup's parent, Settings. */
export const FALLBACK_HASH = "#/settings";

let opener: string | undefined;

function remember(): void {
  const hash = window.location.hash;
  if (!KEYMAP_HASH.test(hash)) opener = hash;
}

/** Starts remembering; returns the stop. The hash the window has now counts unless it is the map's own. */
export function installOpenerTracker(): () => void {
  opener = undefined;
  if (typeof window === "undefined") return () => undefined;
  remember();
  window.addEventListener("hashchange", remember);
  return () => window.removeEventListener("hashchange", remember);
}

/** The hash Back returns to (`""` is the default screen). */
export function openerHash(): string {
  return opener ?? FALLBACK_HASH;
}

/**
 * The id of the screen the map was opened from, which the sidebar marks while the map is open (the mockup's
 * `navHTML` marks the map's parent). The same `#/<id>` reading as `screenForHash` in `App.tsx`, which is not
 * imported here (it would make an import cycle); a hash that names no screen is the default screen, `DEFAULT_SCREEN`
 * there, which is `chat`. A deep link onto the map opens on `FALLBACK_HASH`, so Settings.
 */
export function openerScreenId(): string {
  return /^#\/([a-z][a-z0-9-]*)/.exec(openerHash())?.[1] ?? "chat";
}
