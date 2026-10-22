// One session's output log, read from the kernel (phase 5 item 16): the
// bounded log the kernel keeps per session (`GET /sessions/:id/output`), never
// the CLI's own files (D10).
//
// Rows are append-only by `seq`, so the reader keeps the last `seq` it has and
// every read asks only for what comes after it (`?after=<last seq>`), paging
// at `OUTPUT_PAGE_LIMIT` (the kernel's `MAX_OUTPUT_LIMIT`) until a page comes
// back short. It never reads from 0 again: following live, catching up after
// a reconnect and re-opening an ended session's log are all the same read.
//
// One read at a time: a `read()` while one is in flight is owed, and runs once
// that one ends (so a burst of `session_output_appended` frames is one or two
// reads, never one each).
//
// Plain TypeScript: no React.
import type { ApiRequest, ApiResult, SessionOutputResponse, SessionOutputRow, StudioBridge } from "../../api/contract";
import { printable } from "../approvals/printable";

/** Rows per page: the kernel's `MAX_OUTPUT_LIMIT` (`kernel/src/console/output.ts`). */
export const OUTPUT_PAGE_LIMIT = 500;

export interface OutputSnapshot {
  /** Every row read so far, in `seq` order, each once. */
  readonly rows: readonly SessionOutputRow[];
  /** The highest `seq` read; 0 before the first row. The next read's `after`. */
  readonly lastSeq: number;
  readonly reading: boolean;
  /** A read has answered at least once. */
  readonly loaded: boolean;
  /** The last read's failure, escaped; cleared by the next good page. */
  readonly error: string | undefined;
}

/** The request for the page after `after`. */
export function outputRequest(sessionId: number, after: number): ApiRequest {
  return { method: "GET", path: "/sessions/:id/output", params: { id: sessionId }, query: { after: String(after), limit: String(OUTPUT_PAGE_LIMIT) } };
}

function failureText(result: ApiResult<unknown> | undefined): string {
  if (result === undefined) return "The output read failed before it reached the kernel.";
  if (result.ok) return "";
  if ("connection" in result) return "Couldn't reach the kernel to read this session's output.";
  const message = typeof result.body.message === "string" ? `: ${printable(result.body.message)}` : "";
  return `The kernel refused the output read (${result.status} ${printable(String(result.body.error))})${message}.`;
}

function isRow(value: unknown): value is SessionOutputRow {
  const row = value as Partial<SessionOutputRow> | null;
  return typeof row === "object" && row !== null && Number.isSafeInteger(row.seq) && Number.isSafeInteger(row.id) && typeof row.kind === "string";
}

export class SessionOutputReader {
  readonly sessionId: number;
  readonly #api: StudioBridge;
  readonly #listeners = new Set<() => void>();
  #rows: SessionOutputRow[] = [];
  #lastSeq = 0;
  #reading = false;
  #owed = false;
  #loaded = false;
  #error: string | undefined;
  #disposed = false;
  #snapshot: OutputSnapshot | undefined;

  constructor(api: StudioBridge, sessionId: number) {
    this.#api = api;
    this.sessionId = sessionId;
  }

  snapshot(): OutputSnapshot {
    this.#snapshot ??= { rows: this.#rows, lastSeq: this.#lastSeq, reading: this.#reading, loaded: this.#loaded, error: this.#error };
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Read every row after the last `seq`; owed (not dropped) while a read is in flight. */
  read(): void {
    if (this.#disposed) return;
    if (this.#reading) {
      this.#owed = true;
      return;
    }
    void this.#run();
  }

  /** No more reads; an answer still in flight is dropped. */
  dispose(): void {
    this.#disposed = true;
    this.#listeners.clear();
  }

  #emit(): void {
    this.#snapshot = undefined;
    for (const listener of [...this.#listeners]) listener();
  }

  async #page(): Promise<"more" | "done" | "failed"> {
    let result: ApiResult<SessionOutputResponse> | undefined;
    try {
      result = await this.#api.request<SessionOutputResponse>(outputRequest(this.sessionId, this.#lastSeq));
    } catch {
      result = undefined;
    }
    if (this.#disposed) return "done";
    if (result?.ok !== true || !Array.isArray(result.body.rows)) {
      this.#error = result?.ok === true ? "The kernel's output answer had no rows." : failureText(result);
      return "failed";
    }
    const page = result.body.rows;
    const fresh = page.filter(isRow).filter((row) => row.seq > this.#lastSeq);
    fresh.sort((a, b) => a.seq - b.seq);
    if (fresh.length > 0) {
      this.#rows = [...this.#rows, ...fresh];
      this.#lastSeq = fresh[fresh.length - 1]?.seq ?? this.#lastSeq;
    }
    this.#loaded = true;
    this.#error = undefined;
    // A full page may have more behind it; a full page with nothing new would loop forever.
    return page.length >= OUTPUT_PAGE_LIMIT && fresh.length > 0 ? "more" : "done";
  }

  async #run(): Promise<void> {
    this.#reading = true;
    this.#emit();
    do {
      this.#owed = false;
      let step: "more" | "done" | "failed";
      do {
        step = await this.#page();
        if (this.#disposed) return;
        this.#emit();
      } while (step === "more");
    } while (this.#owed && !this.#disposed);
    this.#reading = false;
    this.#emit();
  }
}
