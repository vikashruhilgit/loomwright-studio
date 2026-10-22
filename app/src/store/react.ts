// The live store, for React: one store per bridge, shared by every hook that
// names that bridge, started while any component holds it and disposed when
// the last one lets go. `useSyncExternalStore` reads it, so a change is one
// synchronous re-render, never a stale closure.
//
// Under `<StrictMode>` a mount runs its effects twice: the store is disposed
// and started again, which `createLiveStore` supports (its data is kept).
import { useEffect, useSyncExternalStore } from "react";
import type { StudioBridge } from "../api/contract";
import { getBridge } from "../api/bridge";
import type { ResourceBody, ResourceName } from "./resources";
import { createLiveStore } from "./store";
import type { LiveSnapshot, LiveStore, ResourceState } from "./store";

interface Held {
  readonly store: LiveStore;
  holders: number;
}

const held = new WeakMap<StudioBridge, Held>();

function entryFor(api: StudioBridge): Held {
  let entry = held.get(api);
  if (entry === undefined) {
    entry = { store: createLiveStore(api), holders: 0 };
    held.set(api, entry);
  }
  return entry;
}

/** The one store for `api` (created inert on first use; the hooks start it). */
export function liveStoreFor(api: StudioBridge): LiveStore {
  return entryFor(api).store;
}

/** Hold `api`'s store running for the caller's lifetime. */
function useHeldStore(api: StudioBridge): LiveStore {
  const entry = entryFor(api);
  useEffect(() => {
    entry.holders += 1;
    if (entry.holders === 1) entry.store.start();
    return () => {
      entry.holders -= 1;
      if (entry.holders === 0) entry.store.dispose();
    };
  }, [entry]);
  return entry.store;
}

/** The whole snapshot of `api`'s store (defaults to `window.api`). */
export function useLiveStore(api: StudioBridge = getBridge()): LiveSnapshot {
  const store = useHeldStore(api);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** One resource, loaded on its first use; `undefined` until the store has registered it. */
export function useResource<N extends ResourceName>(name: N, api: StudioBridge = getBridge()): ResourceState<ResourceBody<N>> | undefined {
  const store = useHeldStore(api);
  useEffect(() => {
    store.load(name);
  }, [store, name]);
  return useSyncExternalStore(store.subscribe, () => store.resource(name));
}
