# Session output

Part of [Phase 5 features](../ARCHITECTURE.md#phase-5-features). Built and documented by **item 03** (the kernel keeps a bounded output log for every session), in the console's `output.ts` part.

**Routes:** `GET /sessions` and `GET /sessions/:id/output`.

**Contract types it fills** (`app/src/api/contract.ts`): `SessionOutputKind` (mirrors `SESSION_OUTPUT_KINDS`, pinned by `kernel/test/console-contract.test.ts`), `SessionsQuery`, `SessionSummary` and `SessionsResponse`, `SessionOutputQuery`, `SessionOutputRow` and `SessionOutputResponse`.

Today (item 01) migration 16 creates the `session_output` table (see [the data model](../ARCHITECTURE.md#data-model)), and the session manager hands every SDK message to `recordSessionOutput`, which writes nothing yet.
