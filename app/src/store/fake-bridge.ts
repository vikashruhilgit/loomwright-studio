// A scriptable `StudioBridge` for the store's unit tests (test-only: imported
// by `store.test.ts` and `connection.test.tsx`, never by the app). It keeps
// the real bridge's semantics where the store can tell: `connection()` is the
// main process's answer, `feed.subscribe` answers `connected` before the
// socket proves itself, and frames (including the close) arrive through
// `onFrame`.
import type { ApiRequest, ApiResult, FeedRelayFrame, KernelConnectionState, StudioBridge } from "../api/contract";

export type Responder = (req: ApiRequest) => ApiResult<unknown> | Promise<ApiResult<unknown>>;

export interface FakeBridge {
  readonly bridge: StudioBridge;
  /** What `connection()` answers next. */
  connectionAnswer: KernelConnectionState;
  /** What `feed.subscribe` answers next. */
  subscribeAnswer: KernelConnectionState;
  /** How many of the next subscribes are followed at once (a few microtasks after it answers, no time passing) by a `closed` 1006 frame. */
  closeAfterSubscribe: number;
  readonly connectionCalls: number[];
  readonly subscribeCalls: { readonly at: number; readonly after: number }[];
  readonly requests: { readonly at: number; readonly req: ApiRequest }[];
  unsubscribes: number;
  /** Answer `"<METHOD> <path>"` (the contract path, before params are filled). */
  route(key: string, responder: Responder): void;
  emit(frame: FeedRelayFrame): void;
  listenerCount(): number;
  requestsTo(key: string): { readonly at: number; readonly req: ApiRequest }[];
}

export function ok<T>(body: T): ApiResult<T> {
  return { ok: true, status: 200, body };
}

export function fakeBridge(initial: KernelConnectionState = { state: "connected", port: 1 }): FakeBridge {
  const listeners = new Set<(frame: FeedRelayFrame) => void>();
  const routes = new Map<string, Responder>();
  const fake: FakeBridge = {
    connectionAnswer: initial,
    subscribeAnswer: initial,
    closeAfterSubscribe: 0,
    connectionCalls: [],
    subscribeCalls: [],
    requests: [],
    unsubscribes: 0,
    route(key, responder) {
      routes.set(key, responder);
    },
    emit(frame) {
      for (const listener of [...listeners]) listener(frame);
    },
    listenerCount() {
      return listeners.size;
    },
    requestsTo(key) {
      return fake.requests.filter((r) => `${r.req.method} ${r.req.path}` === key);
    },
    bridge: {
      connection: async () => {
        fake.connectionCalls.push(Date.now());
        return fake.connectionAnswer;
      },
      request: async <R>(req: ApiRequest): Promise<ApiResult<R>> => {
        fake.requests.push({ at: Date.now(), req });
        const responder = routes.get(`${req.method} ${req.path}`);
        const answer = responder === undefined ? { ok: false as const, status: 404, body: { error: "not_found" } } : await responder(req);
        return answer as ApiResult<R>;
      },
      feed: {
        subscribe: async (after: number) => {
          fake.subscribeCalls.push({ at: Date.now(), after });
          if (fake.closeAfterSubscribe > 0) {
            fake.closeAfterSubscribe -= 1;
            void (async () => {
              for (let i = 0; i < 5; i += 1) await Promise.resolve();
              fake.emit({ type: "closed", code: 1006, reason: "" });
            })();
          }
          return fake.subscribeAnswer;
        },
        unsubscribe: async () => {
          fake.unsubscribes += 1;
        },
        onFrame: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
      onNavigate: () => () => undefined,
    },
  };
  return fake;
}
