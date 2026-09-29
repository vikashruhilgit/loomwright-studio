The avatar is the agent's identity and its state at once. Every crew member is a **sea creature stitched from its own thread**: a filled silhouette in the agent's hue at 28%, a running-stitch outline and inner stitch lines in the full hue, a knot for the eye, and a loose thread end that carries the state. A faint stitched ring borders every avatar. **Wright is the crowned whale**; the crown is solid in Wright's own identity colour (`accent`), never a state colour, and belongs to Wright alone. Same construction everywhere: Crew rows (24px), chat turns (24px), approval chips (16px), Team cards and the inspector (36px), the showcase (56px).

**Identity:** a creature (`shark`, `seahorse`, `octopus`, `turtle`, `jellyfish`, `fish`, `crab`, picked in the charter; the `whale` is Wright's) and one hue for the thread: `accent` for Wright alone, and a `crew-*` token for each specialist (`crew-teal`, `crew-berry`, `crew-sky`, `crew-olive`, `crew-slate`, assigned first-unused so no two agents share one until all five are taken). The identity colour never changes with state. Semantic tokens (`ok`, `attention`, `danger`, `parked`) are never an identity hue: an amber creature would read as "waiting on you" forever and a red one as "killed". New creatures are added to the set as single-stroke embroidery: silhouette, one or two inner lines, one knot; nothing that needs detail below 16px.

**Four layers move.** `drift` floats the whole avatar (it swims); `rig` moves the body from its base; the stitch outlines run while working (the creature sews itself); `tail` swings the loose thread, which also changes shape per state.

| State | Thread | Body | Stitches |
|---|---|---|---|
| idle | sways, 3s, on the agent's own clock | slow swim, 7s | still |
| working | flutters | leans into the work | outline and ring run |
| waiting on you | rises toward you in a loop and beckons | anticipation squash, a 7px hop every 2.6s; `attention` ring on landing | still |
| paused at cap | hangs slack | sinks, 72% opacity | ring sparse |
| done (one shot) | ties into a bow | one spin with overshoot and a small orbit | ring solid |
| killed / failed | cut, two loose ends | tips over after a shudder | ring broken |
| any, on hover | flicks | a nod | unchanged |

Stagger the clocks with a per-agent negative `animation-delay` so a roster never sways in unison. Under `prefers-reduced-motion` every animation stops and the thread's shape alone carries the state.

**Provide:** the agent (name, creature, hue), the state, the size, and optionally its current action for the tooltip ("Mason · waiting on you · Post review on #412"). Set `role="img"` and an `aria-label` with the same text.

**Don't:** use a semantic token as an identity hue (`scripts/check-docs.sh` fails the build if the avatar code or the mockup does); give a creature a cartoon face (one knot per eye, nothing more); tint the thread by state; put a status dot beside an avatar; use the whale or the crown for anyone but Wright; scale below 16px.
