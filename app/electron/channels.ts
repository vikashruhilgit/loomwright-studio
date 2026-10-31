// The IPC channels between the preload bridge and the main process. The
// renderer never names a channel itself: it calls `window.api`.
export const CHANNELS = Object.freeze({
  connection: "studio:connection",
  request: "studio:request",
  feedSubscribe: "studio:feed:subscribe",
  feedUnsubscribe: "studio:feed:unsubscribe",
  /** Renderer -> main: open one allowlisted address in the system browser (`open-external.ts`). */
  openExternal: "studio:open-external",
  /** Renderer -> main: the app's own preferences (`settings.ts`). */
  prefsGet: "studio:prefs:get",
  /** Renderer -> main: a patch of the app's own preferences; the main process validates it. */
  prefsSet: "studio:prefs:set",
  /** Renderer -> main: open the main process's own resolved data dir in Finder. Carries no argument. */
  revealDataDir: "studio:reveal-data-dir",
  /** Main -> renderer: one `FeedRelayFrame`. */
  feedFrame: "studio:feed:frame",
  /** Main -> renderer: an app route a deep link asked for (item 17). */
  navigate: "studio:navigate",
} as const);

/** The channels the renderer may invoke (the main process handles exactly these). */
export const INVOKE_CHANNELS: readonly string[] = [
  CHANNELS.connection,
  CHANNELS.request,
  CHANNELS.feedSubscribe,
  CHANNELS.feedUnsubscribe,
  CHANNELS.openExternal,
  CHANNELS.prefsGet,
  CHANNELS.prefsSet,
  CHANNELS.revealDataDir,
];
