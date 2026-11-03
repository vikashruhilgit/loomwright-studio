// The MCP client side of an MCP connector (phase 8 item 06, D38): `tools/list`
// and `tools/call` against a hosted server over Streamable HTTP, with the
// access token as a bearer header, and the guarded `fetch` every call to the
// remote side goes through (the OAuth helpers in `oauth.ts` use it too).
//
// The server is untrusted (invariant 3): its tool list, its results and its
// error text are data. So:
//   - every request goes through a URL policy (`https`, or `http` on a
//     loopback host only when a test turns that on), a deadline, and no
//     redirect on a POST (a refresh token or a code is never forwarded to
//     another host); a GET follows at most 3 redirects, each checked again;
//   - `tools/list` is read with a loose result schema, so one tool with an
//     off-shape entry is the planner's to drop (`tools.ts`), never a failure
//     of the whole list;
//   - a result is cut at `MCP_RESULT_MAX_CHARS`, and what a server says about
//     a failure is never kept: an error is a fixed code (`McpClientError`).
//
// The bearer token is passed in per call and held only for it: nothing here
// stores, logs or echoes one.
//
// The `studio` CLI loads it through the integrations feature, so it imports the
// MCP SDK's client (never the Agent SDK, the session manager or `kernel.ts`).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

/** The bound on one remote call, request to last byte. */
export const MCP_CALL_TIMEOUT_MS = 30_000;

/** The most text one tool result gives back to a session; the rest is cut. */
export const MCP_RESULT_MAX_CHARS = 200_000;

/** The most tools one server may list: pages are read until this, then the rest is ignored. */
export const MCP_MAX_TOOLS = 500;
const MAX_PAGES = 10;

/** The largest OAuth answer (metadata, registration, tokens) read: a few KB in practice. */
const MAX_OAUTH_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

/** What a remote call can fail with, each the whole of the failure: no server text is kept. */
export type McpClientErrorCode = "unauthorized" | "unreachable" | "timeout" | "protocol" | "refused_url";

/** A failed remote call. `code` is closed; the message is a fixed sentence per code. */
export class McpClientError extends Error {
  readonly code: McpClientErrorCode;
  constructor(code: McpClientErrorCode) {
    super(`the MCP server call failed: ${code}`);
    this.name = "McpClientError";
    this.code = code;
  }
}

/** The knobs of a remote call. Defaults are the shipped ones; tests turn loopback `http` on and shorten the deadline. */
export interface McpHttpOptions {
  /** Default false: only `https` is allowed. A test sets it so the fake server on 127.0.0.1 is reachable. */
  readonly allowLoopbackHttp?: boolean;
  /** Default `MCP_CALL_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /** Default the global `fetch`, read at call time. */
  readonly fetch?: typeof globalThis.fetch;
}

/** Whether `url` may be called: `https`, or `http` to 127.0.0.1, `localhost` or `[::1]` when `allowLoopbackHttp`. No credentials in the URL. */
export function mcpUrlAllowed(url: string | URL, allowLoopbackHttp: boolean = false): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.protocol === "https:") return true;
  return allowLoopbackHttp && parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
}

/** `body` as text, or `undefined` once it passes `max` bytes (reading stops and the rest is cancelled). */
async function readBoundedText(body: ReadableStream<Uint8Array> | null, max: number): Promise<string | undefined> {
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** A signal that fires when `timeoutMs` passes or `outer` aborts. */
function deadline(timeoutMs: number, outer: AbortSignal | null | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return outer === null || outer === undefined ? timeout : AbortSignal.any([timeout, outer]);
}

/**
 * The `fetch` the OAuth helpers use (discovery, registration, token calls):
 * the URL policy on every hop, a deadline, a POST never redirected, a GET
 * redirected at most `MAX_REDIRECTS` times, and the answer read whole up to
 * `MAX_OAUTH_BYTES` (a longer one is a failure) and handed back as a fresh
 * `Response`. A refusal throws `McpClientError("refused_url")`.
 */
export function guardedFetch(options: McpHttpOptions = {}): FetchLike {
  const allow = options.allowLoopbackHttp === true;
  const timeoutMs = options.timeoutMs ?? MCP_CALL_TIMEOUT_MS;
  return async (url, init) => {
    const doFetch = options.fetch ?? globalThis.fetch;
    const method = (init?.method ?? "GET").toUpperCase();
    let target = String(url);
    for (let hop = 0; ; hop++) {
      if (!mcpUrlAllowed(target, allow)) throw new McpClientError("refused_url");
      const res = await doFetch(target, { ...init, redirect: "manual", signal: deadline(timeoutMs, init?.signal) });
      const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has("location");
      if (isRedirect) {
        await res.body?.cancel().catch(() => undefined);
        if (method !== "GET" || hop >= MAX_REDIRECTS) throw new McpClientError("protocol");
        target = new URL(res.headers.get("location") as string, target).toString();
        continue;
      }
      const text = await readBoundedText(res.body, MAX_OAUTH_BYTES);
      if (text === undefined) throw new McpClientError("protocol");
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      // A status that has no body (a `Response` refuses one with a body).
      const bodyless = res.status === 204 || res.status === 205 || res.status === 304;
      return new Response(bodyless ? null : text, { status: res.status, statusText: res.statusText, headers });
    }
  };
}

/**
 * The `fetch` the MCP transport uses: the URL policy, a deadline and no
 * redirect, with the body left as a stream (a server may answer a call as an
 * event stream, which a whole-body read would hold back).
 */
function transportFetch(options: McpHttpOptions): FetchLike {
  const allow = options.allowLoopbackHttp === true;
  const timeoutMs = options.timeoutMs ?? MCP_CALL_TIMEOUT_MS;
  return (url, init) => {
    if (!mcpUrlAllowed(url, allow)) return Promise.reject(new McpClientError("refused_url"));
    const doFetch = options.fetch ?? globalThis.fetch;
    return doFetch(String(url), { ...init, redirect: "error", signal: deadline(timeoutMs, init?.signal) });
  };
}

/** A thrown value as one of the client's codes. The thrown message is dropped: it can quote the server. */
function classify(err: unknown): McpClientError {
  if (err instanceof McpClientError) return err;
  if (err instanceof StreamableHTTPError) return new McpClientError(err.code === 401 || err.code === 403 ? "unauthorized" : "protocol");
  const name = typeof err === "object" && err !== null && "name" in err ? String((err as { name: unknown }).name) : "";
  const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : undefined;
  if (name === "TimeoutError" || name === "AbortError" || code === -32001) return new McpClientError("timeout");
  if (err instanceof TypeError) return new McpClientError("unreachable");
  return new McpClientError("protocol");
}

/** A connected MCP client over `serverUrl` with `accessToken`; closed afterwards, whatever `fn` does. */
async function withClient<T>(serverUrl: string, accessToken: string, options: McpHttpOptions, fn: (client: Client) => Promise<T>): Promise<T> {
  const timeout = options.timeoutMs ?? MCP_CALL_TIMEOUT_MS;
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    fetch: transportFetch(options),
  });
  const client = new Client({ name: "loomwright-studio", version: "1" }, { capabilities: {} });
  try {
    await client.connect(transport, { timeout });
    return await fn(client);
  } catch (err) {
    throw classify(err);
  } finally {
    await client.close().catch(() => undefined);
  }
}

// A loose `tools/list` page: each tool is `unknown`, so the planner (`tools.ts`) judges it.
const ListPage = z.object({ tools: z.array(z.unknown()), nextCursor: z.string().optional() });

/**
 * Every tool `serverUrl` lists, as the server sent each (`unknown`: untrusted
 * and unchecked), up to `MCP_MAX_TOOLS` over at most `MAX_PAGES` pages. The
 * caller's planner decides what a tool is worth; one odd entry never fails the
 * list.
 */
export async function listMcpTools(serverUrl: string, accessToken: string, options: McpHttpOptions = {}): Promise<unknown[]> {
  return withClient(serverUrl, accessToken, options, async (client) => {
    const tools: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES && tools.length < MCP_MAX_TOOLS; page++) {
      const res = await client.request({ method: "tools/list", params: cursor === undefined ? {} : { cursor } }, ListPage, { timeout: options.timeoutMs ?? MCP_CALL_TIMEOUT_MS });
      tools.push(...res.tools);
      cursor = res.nextCursor;
      if (cursor === undefined) break;
    }
    return tools.slice(0, MCP_MAX_TOOLS);
  });
}

// A loose `tools/call` answer.
const CallAnswer = z.object({ content: z.array(z.unknown()).optional(), structuredContent: z.unknown().optional(), isError: z.boolean().optional() });

/** What a tool call gave back, as text. */
export interface McpCallText {
  /** The result's text blocks, joined; other block kinds are named as omitted. Cut at `MCP_RESULT_MAX_CHARS`. */
  readonly text: string;
  /** The server marked the result `isError`. */
  readonly is_error: boolean;
  /** `text` was cut. */
  readonly truncated: boolean;
}

/** One content block as a line of text: a text block's text, a placeholder for any other kind. */
function blockText(block: unknown): string {
  if (typeof block === "object" && block !== null) {
    const o = block as { type?: unknown; text?: unknown };
    if (o.type === "text" && typeof o.text === "string") return o.text;
    if (typeof o.type === "string") return `[${o.type.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32)} content omitted]`;
  }
  return "[content omitted]";
}

/**
 * Call `name` on `serverUrl` with `args` (a plain object, already checked by
 * the caller) and answer its text. A transport or protocol failure throws
 * `McpClientError`; a tool that ran and failed is `is_error: true`, with the
 * server's text (untrusted: the caller wraps it as data).
 */
export async function callMcpTool(serverUrl: string, accessToken: string, name: string, args: Record<string, unknown>, options: McpHttpOptions = {}): Promise<McpCallText> {
  return withClient(serverUrl, accessToken, options, async (client) => {
    const res = await client.request({ method: "tools/call", params: { name, arguments: args } }, CallAnswer, { timeout: options.timeoutMs ?? MCP_CALL_TIMEOUT_MS });
    const parts = (res.content ?? []).map(blockText);
    if (parts.length === 0 && res.structuredContent !== undefined) parts.push(JSON.stringify(res.structuredContent) ?? "");
    const whole = parts.join("\n");
    const truncated = whole.length > MCP_RESULT_MAX_CHARS;
    return { text: truncated ? whole.slice(0, MCP_RESULT_MAX_CHARS) : whole, is_error: res.isError === true, truncated };
  });
}
