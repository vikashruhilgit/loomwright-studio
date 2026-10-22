// StreamingLog's gallery: every README/preview state with canned data, for the
// e2e evidence page (app/e2e/components.conversation.spec.ts). Never imported by
// App.tsx, so it stays out of the app bundle.
import { useState, type ReactElement } from "react";
import { StreamingLog, type StreamingLogLine } from "./StreamingLog";

const noop = () => undefined;

/** A stand-in for the StatusDot primitive (another lane's): a token-coloured dot plus its word. */
function GalleryDot({ tone, word }: { readonly tone: string; readonly word: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", color: "var(--ink-secondary)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "var(--radius-full)", background: `var(--${tone})` }} />
      {word}
    </span>
  );
}

/** The preview.html session: a PR review with tool calls, output, prose, an error and a verified step. */
const PREVIEW_LINES: readonly StreamingLogLine[] = [
  { id: "1", kind: "tool", time: "14:02:11", tool: "Bash", text: "gh pr view 412 --json files,reviews,statusCheckRollup" },
  { id: "2", kind: "output", time: "14:02:12", text: "12 files · 0 reviews · checks: ci ✓ claude-review ✓" },
  { id: "3", kind: "tool", time: "14:02:12", tool: "Read", text: "scripts/validate-worker-result.py" },
  { id: "4", kind: "tool", time: "14:02:14", tool: "Grep", text: '"decision" scripts/*.py' },
  { id: "5", kind: "output", time: "14:02:14", text: "6 matches" },
  {
    id: "6",
    kind: "prose",
    time: "14:02:31",
    text: 'The hook prints {"ok": false} on failure. That is the prompt-hook response shape; a command hook blocks via {"decision": "block"}, so this validator is a silent no-op.',
  },
  { id: "7", kind: "tool", time: "14:02:40", tool: "Bash", text: "bash scripts/fixtures/run-hook.sh subagentstop-decision-shape-probe.json" },
  { id: "8", kind: "error", time: "14:02:41", text: "exit 0 · hook_success · no decision recorded" },
  { id: "9", kind: "ok", time: "14:02:55", text: "Finding confirmed against the fixture. Drafting review (1 blocking, 2 nits)" },
  { id: "10", kind: "prose", time: "14:03:02", text: "Preparing review for approval" },
];

function manyLines(count: number, start = 0): StreamingLogLine[] {
  return Array.from({ length: count }, (_, i) => {
    const n = start + i;
    const seconds = String(n % 60).padStart(2, "0");
    return n % 3 === 0
      ? { id: `l${n}`, kind: "tool", time: `14:${String(10 + Math.floor(n / 60)).padStart(2, "0")}:${seconds}`, tool: "Read", text: `src/file-${n}.ts` }
      : { id: `l${n}`, kind: "output", time: `14:${String(10 + Math.floor(n / 60)).padStart(2, "0")}:${seconds}`, text: `line ${n} of the session output` };
  });
}

/**
 * A live harness for the e2e spec's AC4 check in a real layout engine: "Append 50 lines"
 * adds lines the way a running session does, so the spec can scroll up, append, and read
 * `scrollTop` and the pill.
 */
function AppendingStreamingLog() {
  const [lines, setLines] = useState<StreamingLogLine[]>(() => manyLines(40));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", height: 300 }}>
      <button type="button" data-testid="streaming-log-append" onClick={() => setLines((prev) => [...prev, ...manyLines(50, prev.length)])}>
        Append 50 lines
      </button>
      <div style={{ flex: 1, minHeight: 0 }}>
        <StreamingLog
          status={<GalleryDot tone="working" word="Running" />}
          statusLabel="running"
          agent="Mason"
          task="index the repo"
          elapsed="1m 03s"
          tokens={3_412}
          lines={lines}
          onStop={noop}
          onKillRequest={noop}
        />
      </div>
    </div>
  );
}

function frame(element: ReactElement): ReactElement {
  return <div style={{ height: 268 }}>{element}</div>;
}

const XSS = "<img src=x onerror=alert(1)>";

export const galleryStates: readonly { id: string; title: string; element: ReactElement }[] = [
  {
    id: "running",
    title: "Running, following, with a cost estimate (preview.html)",
    element: frame(
      <StreamingLog
        status={<GalleryDot tone="working" word="Running" />}
        statusLabel="running"
        agent="Mason"
        task="review PR #412"
        elapsed="4m 12s"
        tokens={14_208}
        costEstimate={0.11}
        lines={PREVIEW_LINES}
        onStop={noop}
        onKillRequest={noop}
      />,
    ),
  },
  {
    id: "running-no-cost",
    title: "Running, tokens only (no cost passed)",
    element: frame(
      <StreamingLog
        status={<GalleryDot tone="working" word="Running" />}
        statusLabel="running"
        agent="Mason"
        task="review PR #412"
        elapsed="4m 12s"
        tokens={14_208}
        lines={PREVIEW_LINES}
        onStop={noop}
        onKillRequest={noop}
      />,
    ),
  },
  {
    id: "starting",
    title: "Just started: no output yet, caret at the live end",
    element: frame(
      <StreamingLog
        status={<GalleryDot tone="working" word="Running" />}
        statusLabel="running"
        agent="Wright"
        task="triage new issues"
        elapsed="0m 01s"
        tokens={0}
        lines={[]}
        onStop={noop}
        onKillRequest={noop}
      />,
    ),
  },
  {
    id: "stopped",
    title: "Stopped: no caret, Stop and Kill unavailable",
    element: frame(
      <StreamingLog
        status={<GalleryDot tone="idle" word="Stopped" />}
        statusLabel="stopped"
        agent="Mason"
        task="review PR #412"
        elapsed="4m 40s"
        tokens={15_902}
        lines={PREVIEW_LINES}
        live={false}
        onStop={noop}
        onKillRequest={noop}
      />,
    ),
  },
  {
    id: "killed",
    title: "Killed, ending on an error line",
    element: frame(
      <StreamingLog
        status={<GalleryDot tone="danger" word="Killed" />}
        statusLabel="killed"
        agent="Mason"
        task="review PR #412"
        elapsed="2m 05s"
        tokens={8_340}
        lines={[...PREVIEW_LINES.slice(0, 7), { id: "k", kind: "error", time: "14:02:42", text: "session killed by the user" }]}
        live={false}
        onStop={noop}
        onKillRequest={noop}
      />,
    ),
  },
  {
    id: "long",
    title: "A long log, pinned to the bottom",
    element: frame(
      <StreamingLog
        status={<GalleryDot tone="working" word="Running" />}
        statusLabel="running"
        agent="Mason"
        task="index the repo"
        elapsed="6m 30s"
        tokens={42_118}
        lines={manyLines(120)}
        onStop={noop}
        onKillRequest={noop}
      />,
    ),
  },
  {
    id: "untrusted",
    title: "Untrusted text renders inert",
    element: frame(
      <StreamingLog
        status={<GalleryDot tone="working" word="Running" />}
        statusLabel="running"
        agent={XSS}
        task={XSS}
        elapsed="0m 12s"
        tokens={512}
        lines={[
          { id: "x1", kind: "tool", time: "14:05:00", tool: XSS, text: XSS },
          { id: "x2", kind: "output", time: "14:05:01", text: XSS },
          { id: "x3", kind: "prose", time: "14:05:02", text: "[x](javascript:alert(1))" },
        ]}
        onStop={noop}
        onKillRequest={noop}
      />,
    ),
  },
  {
    id: "append-harness",
    title: "Live append harness (AC4 in a real layout engine)",
    element: <AppendingStreamingLog />,
  },
];
