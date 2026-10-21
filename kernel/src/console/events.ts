// The console's event part (phase 5 item 02): the event list and the live
// event feed's data. Empty until item 02 fills it in; the feed's socket
// handler itself is `handleEventFeed` in `../api/feed.ts`.
import { emptyConsolePart } from "./types.js";
import type { ConsolePart } from "./types.js";

export const eventsPart: ConsolePart = emptyConsolePart("events");
