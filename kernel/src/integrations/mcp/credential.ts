// The MCP connector's Keychain item: the one place a connector's tokens live
// (invariant 3). Service `loomwright-studio-mcp-<kind>`, one value holding the
// access token, the refresh token, the access token's expiry, the registered
// client id (and secret, when the server gave one) and the authorization
// server's address (so a refresh finds the token endpoint again).
//
// The value is a string the Keychain writer accepts. `securityCliKeychainWriter`
// takes only `[A-Za-z0-9_.@-]` (no quote, space, brace or colon can reach
// `security -i`'s command line), so the credential's JSON is written as
// `v1.` followed by that JSON with every byte outside `[A-Za-z0-9_.-]` as `@`
// and two hex digits (`@` itself is `@40`). Tokens are mostly in that set
// already, so the value stays near the tokens' own length. `security -i` also
// reads one line of at most about 4096 characters and, probed 2026-11-03, stores
// a longer one cut short while exiting non-zero: so a value over
// `MCP_CREDENTIAL_MAX_CHARS` is refused before anything is written, and the
// caller still reads the item back after writing it.
//
// Nothing here logs, and no error carries a value: a failure is a fixed
// sentence.
//
// The `studio` CLI loads it, so it imports only the Keychain module's types
// and the kinds: never the Agent SDK, the session manager or `kernel.ts`.
import type { KeychainReader } from "../../auth/keychain.js";
import type { McpKind } from "./rows.js";

/** The Keychain item's service for `kind`: `loomwright-studio-mcp-<kind>`. */
export function mcpKeychainService(kind: McpKind): string {
  return `loomwright-studio-mcp-${kind}`;
}

/** The Keychain item's account label: a fixed constant, never a login or the OS user name. */
export const MCP_KEYCHAIN_ACCOUNT = "loomwright-studio";

/**
 * The longest value written: the `security -i` line is `add-generic-password -a <account> -s <service> -w <value>`,
 * about 80 characters of which are not the value, and the line is cut at about 4096.
 */
export const MCP_CREDENTIAL_MAX_CHARS = 3800;

/** What the Keychain item holds. */
export interface McpCredential {
  readonly access_token: string;
  readonly refresh_token?: string;
  /** ISO time the access token stops working, when the server said (`expires_in`). */
  readonly expires_at?: string;
  readonly client_id: string;
  readonly client_secret?: string;
  /** The authorization server's address, as discovery found it. */
  readonly authorization_server_url: string;
}

const PREFIX = "v1.";
const PLAIN = /[A-Za-z0-9_.-]/;

/** `text` with every UTF-8 byte outside `[A-Za-z0-9_.-]` as `@` and two upper-case hex digits. */
function escape(text: string): string {
  let out = "";
  for (const byte of Buffer.from(text, "utf8")) {
    const ch = String.fromCharCode(byte);
    out += PLAIN.test(ch) ? ch : `@${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** The inverse of `escape`, or `undefined` for an `@` not followed by two hex digits. */
function unescape(text: string): string | undefined {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch !== "@") {
      bytes.push(text.charCodeAt(i));
      continue;
    }
    const hex = text.slice(i + 1, i + 3);
    if (!/^[0-9A-F]{2}$/.test(hex)) return undefined;
    bytes.push(Number.parseInt(hex, 16));
    i += 2;
  }
  return Buffer.from(bytes).toString("utf8");
}

/** `credential` as the Keychain value. Throws `RangeError` (a fixed sentence, no value) when it is over `MCP_CREDENTIAL_MAX_CHARS`. */
export function encodeCredential(credential: McpCredential): string {
  const compact = {
    a: credential.access_token,
    ...(credential.refresh_token === undefined ? {} : { r: credential.refresh_token }),
    ...(credential.expires_at === undefined ? {} : { e: credential.expires_at }),
    c: credential.client_id,
    ...(credential.client_secret === undefined ? {} : { s: credential.client_secret }),
    u: credential.authorization_server_url,
  };
  const value = `${PREFIX}${escape(JSON.stringify(compact))}`;
  if (value.length > MCP_CREDENTIAL_MAX_CHARS) throw new RangeError("the MCP credential is too long for one Keychain item");
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The credential `value` holds, or `undefined` when it is not one (never a throw, never an echo of the value). */
export function decodeCredential(value: string): McpCredential | undefined {
  if (!value.startsWith(PREFIX)) return undefined;
  const json = unescape(value.slice(PREFIX.length));
  if (json === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const o = parsed as Record<string, unknown>;
  const access = optionalString(o["a"]);
  const clientId = optionalString(o["c"]);
  const authServer = optionalString(o["u"]);
  if (access === undefined || clientId === undefined || authServer === undefined) return undefined;
  const refresh = optionalString(o["r"]);
  const expires = optionalString(o["e"]);
  const secret = optionalString(o["s"]);
  return {
    access_token: access,
    ...(refresh === undefined ? {} : { refresh_token: refresh }),
    ...(expires === undefined ? {} : { expires_at: expires }),
    client_id: clientId,
    ...(secret === undefined ? {} : { client_secret: secret }),
    authorization_server_url: authServer,
  };
}

/**
 * The stored credential of `kind`, or `undefined` when there is no item or it
 * is not a credential. A Keychain failure other than "not found" throws
 * `KeychainError` (built from the service and exit status only).
 */
export function readMcpCredential(reader: KeychainReader, kind: McpKind): McpCredential | undefined {
  const value = reader.read(mcpKeychainService(kind));
  return value === undefined ? undefined : decodeCredential(value);
}
