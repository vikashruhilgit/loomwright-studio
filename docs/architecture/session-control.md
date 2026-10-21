# Session control

Part of [Phase 5 features](../ARCHITECTURE.md#phase-5-features). Built and documented by **item 04** (the owner stops or kills one session from the app), in the console's `control.ts` part: Stop is graceful and Kill is immediate, neither engages the kill switch.

**Routes:** `POST /sessions/:id/stop` and `POST /sessions/:id/kill`.

**Contract types it fills** (`app/src/api/contract.ts`): `SessionControlResponse`.

Today (item 01) a contributed route's request already carries `sessions` (the kernel's session manager) and a read-only `killSwitch`, so this part needs no change to the API server; see [ARCHITECTURE.md: Phase 2 features](../ARCHITECTURE.md#phase-2-features).
