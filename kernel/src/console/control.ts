// The console's session-control part (phase 5 item 04): a graceful stop and
// an immediate kill of one session, through the route request's `sessions`.
// Empty until item 04 fills it in.
import { emptyConsolePart } from "./types.js";
import type { ConsolePart } from "./types.js";

export const controlPart: ConsolePart = emptyConsolePart("control");
