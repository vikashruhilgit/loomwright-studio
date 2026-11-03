// Fakes for the MCP connector tests (phase 8 item 06): a fake MCP server with
// its fake authorization server on one 127.0.0.1 origin, and a fake Keychain
// behind the REAL `security` writer, reader and deleter (so the argument rules
// and the 4096-character line limit of `security -i` are the real ones). Never
// the real network, the real Keychain, the Agent SDK or a model.
//
// The fake authorization server serves protected-resource metadata
// (`/.well-known/oauth-protected-resource/mcp`), authorization-server metadata,
// dynamic registration (`/register`), the authorization endpoint (`/authorize`,
// which redirects to the caller's `redirect_uri` with a code and the `state`),
// and the token endpoint (`/token`: `authorization_code` with PKCE `S256`
// verified, and `refresh_token`). The fake MCP server (`/mcp`, Streamable HTTP
// with JSON answers) takes `initialize`, `tools/list` and `tools/call` under a
// bearer token and answers 401 for any token it did not issue (or has expired).
//
// Every secret it issues is recorded in `secrets()`, so a test can scan every
// row, event, log line and answer for any of them.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { SECURITY_BIN, securityCliKeychain, securityCliKeychainDeleter, securityCliKeychainWriter } from "../../src/auth/keychain.js";
import type { ExecFileSyncLike, KeychainDeleter, KeychainReader, KeychainWriter } from "../../src/auth/keychain.js";

// ---- The fake Keychain ----------------------------------------------------------

export interface FakeKeychain {
  /** service to secret. */
  readonly items: Map<string, string>;
  readonly reader: KeychainReader;
  readonly writer: KeychainWriter;
  readonly deleter: KeychainDeleter;
  /** Every `security` invocation as `<verb> <service>`, secrets left out. */
  readonly calls: string[];
  /** While true an add exits 0 and stores nothing (a `security -i` that failed quietly). */
  failWrites: boolean;
}

/** The longest `security -i` line the fake keeps; a longer one is cut here and exits non-zero (probed on macOS 2026-11-03). */
export const SECURITY_LINE_LIMIT = 4096;

/** A fake Keychain: the real `securityCliKeychain*` modules over an `exec` that behaves like `/usr/bin/security`. */
export function fakeKeychain(): FakeKeychain {
  const items = new Map<string, string>();
  const calls: string[] = [];
  const state = { failWrites: false };
  const notFound = (): never => {
    throw Object.assign(new Error("not found"), { status: 44 });
  };
  const exec: ExecFileSyncLike = (file, args, options) => {
    if (file !== SECURITY_BIN) throw new Error(`unexpected binary ${file}`);
    const verb = args[0] === "-i" ? "add" : (args[0] ?? "");
    if (args[0] === "-i") {
      const line = (options.input ?? "").replace(/\n$/, "");
      const m = /^add-generic-password -a (\S+) -s (\S+) -w (\S+)$/.exec(line.slice(0, SECURITY_LINE_LIMIT - 1));
      if (m === null) throw Object.assign(new Error("bad add"), { status: 1 });
      calls.push(`add ${m[2]}`);
      // An existing item is never overwritten (no -U), and `security -i` exits 0 about it.
      if (!state.failWrites && !items.has(m[2] as string)) items.set(m[2] as string, m[3] as string);
      if (line.length > SECURITY_LINE_LIMIT - 1) throw Object.assign(new Error("line too long"), { status: 1 });
      return "";
    }
    const service = args[args.indexOf("-s") + 1] as string;
    calls.push(`${verb === "find-generic-password" ? "read" : "delete"} ${service}`);
    if (verb === "find-generic-password") {
      const value = items.get(service);
      return value === undefined ? notFound() : `${value}\n`;
    }
    if (verb === "delete-generic-password") {
      if (!items.delete(service)) notFound();
      return "";
    }
    throw new Error(`unexpected security verb ${verb}`);
  };
  return {
    items,
    reader: securityCliKeychain(exec),
    writer: securityCliKeychainWriter(exec),
    deleter: securityCliKeychainDeleter(exec),
    calls,
    get failWrites() {
      return state.failWrites;
    },
    set failWrites(value: boolean) {
      state.failWrites = value;
    },
  };
}

// ---- The fake server ---------------------------------------------------------------

export interface FakeMcpOptions {
  /** The raw `tools/list` entries (untrusted shapes allowed). Default: one read-only and one writing tool. */
  readonly tools?: readonly unknown[];
  /** Offer `registration_endpoint`. Default true. */
  readonly registration?: boolean;
  /** Seconds until an issued access token expires, or `null` for no `expires_in`. Default 3600. */
  readonly accessTtlSeconds?: number | null;
  /** Issue refresh tokens. Default true. */
  readonly refreshTokens?: boolean;
  /** Registration returns this `client_secret`. */
  readonly clientSecret?: string;
  /** Hold every `authorization_code` token answer until this settles. */
  readonly tokenGate?: Promise<void>;
  /** Pad every issued access token to this many characters (for the Keychain length limit). */
  readonly accessTokenLength?: number;
  /** Advertise PKCE methods without `S256`. */
  readonly noS256?: boolean;
  /** Answer authorization-server metadata 404. */
  readonly noAuthServerMetadata?: boolean;
  /** Registration answers 400. */
  readonly registrationFails?: boolean;
  /** `tools/call` is never answered. */
  readonly hangCall?: boolean;
  /** `tools/list` answers a JSON-RPC error. */
  readonly listFails?: boolean;
  /** What `tools/call` answers; default one text block naming the tool. */
  readonly callResult?: (name: string, args: unknown) => unknown;
}

/** How the refresh grant answers. */
export type RefreshMode = "ok" | "invalid_grant" | "unavailable";

export interface FakeMcp {
  readonly origin: string;
  readonly mcpUrl: string;
  /** Requested paths, in order (discovery order is checked from this). */
  readonly paths: string[];
  /** The registration bodies. */
  readonly registrations: Record<string, unknown>[];
  /** The query of each `/authorize`. */
  readonly authorizations: Record<string, string>[];
  /** The form of each `/token` call. */
  readonly tokenRequests: Record<string, string>[];
  /** Each MCP JSON-RPC call: method, the tool's name and arguments for `tools/call`, and the Authorization header. */
  readonly mcpCalls: { method: string; name?: string; arguments?: unknown; authorization: string | undefined }[];
  /** The current valid access token (the last issued). */
  access(): string;
  refresh(): string;
  refreshMode: RefreshMode;
  /** Pad the access tokens issued from now on to this many characters (`undefined`: not padded). */
  accessTokenLength: number | undefined;
  /** Make every issued access token stop working (the server expired them). */
  expireAccess(): void;
  /** Every secret string it issued or received: tokens, codes, the client secret, verifiers. */
  secrets(): string[];
  /** Follow `authorize_url` at the authorization server and return the callback address it redirects to (without calling it). */
  authorize(authorizeUrl: string): Promise<string>;
  /** `authorize` then call the callback address (the owner's browser coming back). */
  browse(authorizeUrl: string): Promise<{ readonly callback: string; readonly status: number; readonly text: string }>;
  close(): Promise<void>;
}

const DEFAULT_TOOLS: readonly unknown[] = [
  { name: "search_issues", description: "Search issues.", inputSchema: { type: "object", properties: { q: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "create_issue", description: "Create an issue.", inputSchema: { type: "object", properties: { title: { type: "string" } } } },
];

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
  res.end(text);
}

/** Start the fake MCP + authorization server on 127.0.0.1. */
export async function startFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcp> {
  const tools = options.tools ?? DEFAULT_TOOLS;
  const paths: string[] = [];
  const registrations: Record<string, unknown>[] = [];
  const authorizations: Record<string, string>[] = [];
  const tokenRequests: Record<string, string>[] = [];
  const mcpCalls: FakeMcp["mcpCalls"] = [];
  const issuedSecrets: string[] = [];
  const codes = new Map<string, { challenge: string; redirectUri: string; clientId: string; used: boolean }>();
  const validAccess = new Set<string>();
  let currentAccess = "";
  let currentRefresh = "";
  let counter = 0;
  const state = { refreshMode: "ok" as RefreshMode, accessTokenLength: options.accessTokenLength };

  const mint = (prefix: string, length?: number): string => {
    counter++;
    const base = `${prefix}-secret-${counter}-${randomBytes(9).toString("hex")}`;
    const value = length === undefined ? base : base.padEnd(length, "x").slice(0, length);
    issuedSecrets.push(value);
    return value;
  };

  let origin = "";
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    paths.push(`${req.method} ${url.pathname}`);

    if (req.method === "GET" && url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return send(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
    }
    if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      if (options.noAuthServerMetadata === true) return send(res, 404, "not found");
      return send(res, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        ...(options.registration === false ? {} : { registration_endpoint: `${origin}/register` }),
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: options.noS256 === true ? ["plain"] : ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      });
    }
    if (req.method === "POST" && url.pathname === "/register") {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      registrations.push(body);
      if (options.registrationFails === true) return send(res, 400, { error: "invalid_client_metadata" });
      if (options.clientSecret !== undefined) issuedSecrets.push(options.clientSecret);
      return send(res, 201, { ...body, client_id: `fake-client-${registrations.length}`, ...(options.clientSecret === undefined ? {} : { client_secret: options.clientSecret }) });
    }
    if (req.method === "GET" && url.pathname === "/authorize") {
      const q = Object.fromEntries(url.searchParams.entries());
      authorizations.push(q);
      const redirectUri = q["redirect_uri"] ?? "";
      if (q["response_type"] !== "code" || q["code_challenge_method"] !== "S256" || (q["code_challenge"] ?? "") === "" || (q["state"] ?? "") === "") {
        return send(res, 400, "bad authorization request");
      }
      const code = mint("code");
      codes.set(code, { challenge: q["code_challenge"] as string, redirectUri, clientId: q["client_id"] ?? "", used: false });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", q["state"] as string);
      return send(res, 302, "", { location: back.toString() });
    }
    if (req.method === "POST" && url.pathname === "/token") {
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)).entries());
      tokenRequests.push(form);
      if (form["code_verifier"] !== undefined) issuedSecrets.push(form["code_verifier"]);
      if (form["grant_type"] === "authorization_code") {
        if (options.tokenGate !== undefined) await options.tokenGate;
        const entry = codes.get(form["code"] ?? "");
        const verified = entry !== undefined && !entry.used && entry.redirectUri === form["redirect_uri"] && createHash("sha256").update(form["code_verifier"] ?? "").digest("base64url") === entry.challenge;
        if (!verified) return send(res, 400, { error: "invalid_grant" });
        (entry as { used: boolean }).used = true;
      } else if (form["grant_type"] === "refresh_token") {
        if (state.refreshMode === "invalid_grant") return send(res, 400, { error: "invalid_grant", error_description: "refresh token revoked" });
        if (state.refreshMode === "unavailable") return send(res, 503, "temporarily unavailable");
        if (form["refresh_token"] !== currentRefresh) return send(res, 400, { error: "invalid_grant" });
      } else {
        return send(res, 400, { error: "unsupported_grant_type" });
      }
      currentAccess = mint("at", state.accessTokenLength);
      validAccess.add(currentAccess);
      if (options.refreshTokens !== false) currentRefresh = mint("rt");
      const ttl = options.accessTtlSeconds === undefined ? 3600 : options.accessTtlSeconds;
      return send(res, 200, {
        access_token: currentAccess,
        token_type: "Bearer",
        ...(ttl === null ? {} : { expires_in: ttl }),
        ...(options.refreshTokens === false ? {} : { refresh_token: currentRefresh }),
      });
    }
    if (url.pathname === "/mcp") {
      if (req.method !== "POST") return send(res, 405, "method not allowed");
      const authorization = req.headers.authorization;
      const message = JSON.parse(await readBody(req)) as { id?: number; method: string; params?: { name?: string; arguments?: unknown; protocolVersion?: string } };
      mcpCalls.push({
        method: message.method,
        ...(message.params?.name === undefined ? {} : { name: message.params.name }),
        ...(message.method === "tools/call" ? { arguments: message.params?.arguments } : {}),
        authorization,
      });
      const token = authorization?.startsWith("Bearer ") === true ? authorization.slice(7) : "";
      if (!validAccess.has(token)) return send(res, 401, "unauthorized", { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` });
      if (message.id === undefined) return send(res, 202, "");
      const reply = (result: unknown): void => send(res, 200, { jsonrpc: "2.0", id: message.id, result });
      if (message.method === "initialize") {
        return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-mcp", version: "1" } });
      }
      if (message.method === "tools/list") {
        if (options.listFails === true) return send(res, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "internal error" } });
        return reply({ tools });
      }
      if (message.method === "tools/call") {
        if (options.hangCall === true) return;
        const name = message.params?.name ?? "";
        const custom = options.callResult?.(name, message.params?.arguments);
        return reply(custom ?? { content: [{ type: "text", text: `result of ${name}` }] });
      }
      return send(res, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } });
    }
    return send(res, 404, "not found");
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch(() => send(res, 500, "fake server error"));
  });
  await new Promise<void>((resolve) => server.listen({ port: 0, host: "127.0.0.1" }, () => resolve()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const authorize = async (authorizeUrl: string): Promise<string> => {
    const res = await fetch(authorizeUrl, { redirect: "manual" });
    const location = res.headers.get("location");
    await res.arrayBuffer();
    if (location === null) throw new Error(`the authorization server did not redirect (HTTP ${res.status})`);
    return location;
  };

  return {
    origin,
    mcpUrl: `${origin}/mcp`,
    paths,
    registrations,
    authorizations,
    tokenRequests,
    mcpCalls,
    access: () => currentAccess,
    refresh: () => currentRefresh,
    get refreshMode() {
      return state.refreshMode;
    },
    set refreshMode(mode: RefreshMode) {
      state.refreshMode = mode;
    },
    get accessTokenLength() {
      return state.accessTokenLength;
    },
    set accessTokenLength(length: number | undefined) {
      state.accessTokenLength = length;
    },
    expireAccess: () => validAccess.clear(),
    secrets: () => [...issuedSecrets],
    authorize,
    async browse(authorizeUrl) {
      const callback = await authorize(authorizeUrl);
      const res = await fetch(callback, { redirect: "manual" });
      return { callback, status: res.status, text: await res.text() };
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
