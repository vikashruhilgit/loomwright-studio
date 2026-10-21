# Pause

Part of [Phase 5 features](../ARCHITECTURE.md#phase-5-features). Built and documented by **item 05** (pause new work, without killing running sessions), in the console's `pause.ts` part: while paused no trigger fires and no new session starts, running sessions finish their turn, and the state is durable in the events log, as the kill switch's is.

**Routes:** `POST /pause` and `POST /unpause`; `POST /resume` also releases a pause, and `GET /status` gains `paused`.

**Contract types it fills** (`app/src/api/contract.ts`): `PauseResponse`, `StatusBody.paused` and `ResumeResponse`.

Today (item 01) nothing pauses: the part is empty.
