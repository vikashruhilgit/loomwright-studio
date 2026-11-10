// Settings → Threads (phase 8 item 17c), built to the approved mockup (`docs/design/mockups/chat-threads.html`,
// `settingsScreen`, the views `settings-threads` and `settings-threads-set`): each agent's size hint, the thread size
// in tokens past which Chat highlights Summarize & start fresh on that thread.
//
// Read-only, by design (the brief's Task § Design decisions). The hint is `thread_summarize_hint_tokens` in the agent's
// own `config/agents/<id>.json`, which only the owner's edit of the file sets: no kernel route, verb or tool writes it
// (D34, `kernel/src/agents/settings.ts`). So this section has no field, no Save, no Wright proposal (DESIGN.md open
// point 2: the proposal has no stored source) and no reference limit (open point 1: that bound is the kernel's). It
// says each value as "set by you" or "not set" and names the file to edit.
//
// Data. The roster is the live store's `agents` resource (`GET /agents`), Wright first. A crew member's hint is read
// from `GET /agents/:id`'s `settings.content` with `hintOf`; that route refuses Wright (`409 reserved`), so Wright's is
// read from `GET /threads/wright?limit=1`, whose body carries the kernel's own reading under the same name. Each agent
// is read on mount, when the roster's ids change and when the kernel answers again; while it is unreachable the last
// answer stays. Every kernel string (a name, an id, a refusal) passes through `safe` and renders as a text child.
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { AgentDetailResponse, AgentsResponse, StudioBridge, ThreadResponse } from "../../api/contract";
import { Badge } from "../../components/Badge/Badge";
import { useResource } from "../../store/react";
import type { ResourceState } from "../../store/store";
import { readAgent } from "../integrations/actions";
import { type Reply, failureDetail, replyOf } from "../schedules/model";
import { WRIGHT_ID, orderRoster } from "../team/model";
import { HINT_SET_BY, type HintWords, SETTINGS_TEST_IDS as IDS, hintFile, hintOf, hintWords, isRecord, safe } from "./model";
import { Skeleton } from "./parts";

/** One agent's hint as the section holds it. */
type HintRead = { readonly kind: "loading" } | { readonly kind: "ok"; readonly words: HintWords } | { readonly kind: "unknown" } | { readonly kind: "failed"; readonly detail: string };

/** `settings.error` of `GET /agents/:id`, when it is the shape the contract declares. */
function refusalOfFile(settings: unknown): { readonly error: string; readonly message: string } | undefined {
  if (!isRecord(settings) || !isRecord(settings.error)) return undefined;
  const { error, message } = settings.error;
  return typeof error === "string" ? { error, message: typeof message === "string" ? message : error } : undefined;
}

/** `GET /threads/wright?limit=1`: Wright's thread, read only for the hint its body carries. */
async function readWrightThread(api: StudioBridge): Promise<Reply<ThreadResponse>> {
  try {
    return replyOf(await api.request<ThreadResponse>({ method: "GET", path: "/threads/:agent", params: { agent: WRIGHT_ID }, query: { limit: "1" } }));
  } catch {
    return replyOf<ThreadResponse>(undefined);
  }
}

/** One agent's hint, read from the route that serves it. */
async function readHint(api: StudioBridge, id: string): Promise<HintRead> {
  if (id === WRIGHT_ID) {
    const reply = await readWrightThread(api);
    if (reply.kind === "ok") return { kind: "ok", words: hintWords(hintOf(reply.body)) };
    return reply.kind === "unreachable" ? { kind: "unknown" } : { kind: "failed", detail: failureDetail("GET /threads/wright", reply) };
  }
  const reply: Reply<AgentDetailResponse> = await readAgent(api, id);
  if (reply.kind === "ok") {
    const settings: unknown = isRecord(reply.body) ? reply.body.settings : undefined;
    return { kind: "ok", words: hintWords(hintOf(isRecord(settings) ? settings.content : undefined), refusalOfFile(settings)) };
  }
  return reply.kind === "unreachable" ? { kind: "unknown" } : { kind: "failed", detail: failureDetail(`GET /agents/${safe(id)}`, reply) };
}

/**
 * Each listed agent's hint. Reads every id again when the list changes or the kernel comes back (`offline` turns
 * false); an answer older than the latest round is dropped; an "unreachable" answer keeps a value already held.
 */
function useHints(api: StudioBridge, ids: readonly string[], offline: boolean): ReadonlyMap<string, HintRead> {
  const [hints, setHints] = useState<ReadonlyMap<string, HintRead>>(new Map());
  const round = useRef(0);
  const key = ids.join("\n");
  useEffect(() => {
    if (offline) return undefined;
    round.current += 1;
    const mine = round.current;
    const list = key === "" ? [] : key.split("\n");
    setHints((prev) => new Map(list.map((id) => [id, prev.get(id) ?? { kind: "loading" }])));
    for (const id of list) {
      void readHint(api, id).then((read) => {
        if (round.current !== mine) return;
        setHints((prev) => {
          const held = prev.get(id);
          const next = new Map(prev);
          next.set(id, read.kind === "unknown" && held?.kind === "ok" ? held : read);
          return next;
        });
      });
    }
    return () => {
      round.current += 1;
    };
  }, [api, key, offline]);
  return hints;
}

/** Why the roster could not be shown, or `undefined` while it is loading. */
function rosterProblem(agents: ResourceState<AgentsResponse> | undefined): string | undefined {
  const error = agents?.error;
  if (agents?.data !== undefined || error === undefined) return undefined;
  if (error.kind === "not_connected") return "Unknown until the kernel answers.";
  if (error.kind === "bridge_failed") return "Couldn't read the agents: GET /agents · no answer from the kernel.";
  const body = error.body;
  return `Couldn't read the agents: GET /agents · ${error.status} · ${safe(typeof body.message === "string" && body.message !== "" ? body.message : body.error)}.`;
}

function HintValue({ read: held, offline }: { readonly read: HintRead | undefined; readonly offline: boolean }) {
  // Offline, nothing is read: a row that holds no answer is unknown, never "Reading…".
  const read: HintRead | undefined = offline && (held === undefined || held.kind === "loading") ? { kind: "unknown" } : held;
  if (read === undefined || read.kind === "loading") {
    return (
      <span className="settings-cap" aria-busy="true" data-testid={IDS.threadsHint}>
        Reading…
      </span>
    );
  }
  if (read.kind === "unknown") {
    return (
      <span className="settings-cap" data-testid={IDS.threadsHint}>
        Unknown until the kernel answers.
      </span>
    );
  }
  if (read.kind === "failed") {
    return (
      <span className="settings-cap" data-tone="danger" data-testid={IDS.threadsHint}>
        {`Couldn't read it: ${read.detail}`}
      </span>
    );
  }
  const { words } = read;
  return (
    <>
      {words.tokens === undefined ? (
        <span data-testid={IDS.threadsHint}>{words.value}</span>
      ) : (
        // The mockup's `N tokens` then a neutral "set by you" badge; the hidden " · " keeps the words one phrase for a screen reader.
        <span data-testid={IDS.threadsHint} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span className="settings-tn">{words.tokens}</span>
          <span className="settings-sr-only"> · </span>
          <Badge>{HINT_SET_BY}</Badge>
        </span>
      )}
      {words.note === undefined ? null : (
        <span className="settings-cap" data-tone="attention" data-testid={IDS.threadsNote}>
          {words.note}
        </span>
      )}
    </>
  );
}

export interface ThreadsSectionProps {
  readonly api: StudioBridge;
  /** The kernel is unreachable (the screen's own flag): no read is sent, and the held values stay. */
  readonly offline: boolean;
}

export function ThreadsSection({ api, offline }: ThreadsSectionProps) {
  const agents = useResource("agents", api);
  const roster = agents?.data === undefined ? undefined : orderRoster(Array.isArray(agents.data.agents) ? agents.data.agents : []);
  const ids = roster?.map((a) => a.id) ?? [];
  const hints = useHints(api, ids, offline);
  const problem = rosterProblem(agents);

  let body: ReactNode;
  if (roster !== undefined && roster.length > 0) {
    body = (
      <dl className="settings-kv" aria-label="Size hint by agent">
        {roster.map((agent) => {
          const read = hints.get(agent.id);
          return (
            <div key={agent.id} className="settings-row" data-testid={IDS.threadsRow} data-agent={agent.id}>
              <dt>{safe(agent.display_name)}</dt>
              <dd>
                <HintValue read={read} offline={offline} />
                <span className="settings-cap" data-testid={IDS.threadsFile}>
                  {read?.kind === "ok" && read.words.set ? "in " : "Set one in "}
                  <span className="settings-mono">{hintFile(agent.id)}</span>
                </span>
              </dd>
            </div>
          );
        })}
        <div className="settings-row" data-testid={IDS.threadsSample}>
          <dt>On a thread past it</dt>
          <dd>
            <span
              className="btn"
              data-variant="secondary"
              data-size="row"
              aria-hidden="true"
              style={{ background: "var(--attention-soft)", borderColor: "var(--attention)", color: "var(--attention)", cursor: "default" }}
            >
              Summarize &amp; start fresh
            </span>
            <Badge tone="attention">past your size hint</Badge>
            <span className="settings-sr-only">Past an agent's size hint, Summarize &amp; start fresh is highlighted on that thread and marked past your size hint.</span>
          </dd>
        </div>
      </dl>
    );
  } else if (roster !== undefined) {
    body = (
      <p className="settings-text" data-testid={IDS.threadsEmpty}>
        The kernel lists no agents.
      </p>
    );
  } else if (problem !== undefined) {
    body = (
      <p className="settings-text" data-testid={IDS.threadsError}>
        {problem}
      </p>
    );
  } else body = <Skeleton testId={IDS.threadsLoading} what="the size hints" rows={1} />;

  return (
    <section className="settings-blk" aria-labelledby="settings-h-threads" data-testid={IDS.threads}>
      <div className="settings-sech">
        <h2 className="settings-label" id="settings-h-threads">
          Threads
        </h2>
        <span className="settings-cap">Kept in each agent's settings file in the kernel</span>
      </div>
      <p className="settings-text">Size hint: when the tokens a thread's latest reply read pass it, Summarize &amp; start fresh is highlighted on that thread. Not set, it is never highlighted.</p>
      {body}
      <p className="settings-cap">
        Studio doesn't change it. To set one, edit <span className="settings-mono">thread_summarize_hint_tokens</span> (a whole number of tokens) in that agent's file in the kernel's data folder; remove it for none.
      </p>
    </section>
  );
}
