# The app

Part of [Phase 5 features](../ARCHITECTURE.md#phase-5-features). Item 01 (the phase 5 foundation) built the scaffold: the main/renderer split, the kernel connection, the one-key preload, the stub screens and the package. Items 12-17 build the rest and document it here:

- item 12: the app's live store (REST reads plus the event feed, with reconnect and the kernel-unreachable state);
- item 13: Chat and the Crew threads;
- item 14: the Team screen;
- item 15: the Approvals screen;
- item 16: the Sessions screen;
- item 17: the menu bar, deep links, Pause all and the kill switch.

**Contract types it fills** (`app/src/api/contract.ts`): `StudioBridge` (what the preload exposes as `window.api`), `KernelConnectionState` and `KernelUnreachableReason`, `ApiRequest` and `ApiResult`, `FeedRelayFrame`, and `ContractRouteMap` / `RouteKey` over `CONTRACT_ROUTES`. Each screen reads the route types of the existing routes and of items 02-07's.

How the app is split, and why the token never reaches the renderer, is in [ARCHITECTURE.md](../ARCHITECTURE.md#phase-5-features) until these items document it here.
