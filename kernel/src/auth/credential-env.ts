import type { BaseEnv, ChildEnv } from "./types.js";

/**
 * Every variable with this prefix is removed. Any `ANTHROPIC_*` variable can
 * authenticate or re-route billing (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
 * `ANTHROPIC_BASE_URL` and the other `*_BASE_URL`s, `ANTHROPIC_FOUNDRY_*`,
 * `ANTHROPIC_IDENTITY_TOKEN[_FILE]`, `ANTHROPIC_PROFILE`, `ANTHROPIC_CONFIG_DIR`,
 * `ANTHROPIC_CUSTOM_HEADERS`, ...), and the kernel passes model choice through
 * SDK options rather than inherited environment.
 */
export const CREDENTIAL_ENV_PREFIX = "ANTHROPIC_";

/**
 * Credential and billing-routing variables outside the `ANTHROPIC_` prefix,
 * grounded in the variable names the bundled CLI (2.1.284) reads.
 *
 * Generic cloud credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
 * `AWS_SESSION_TOKEN`, `AWS_PROFILE`) are deliberately NOT listed: the CLI uses
 * them only behind a provider switch, which this list removes, and an agent's
 * own tools may legitimately need them.
 *
 * Blanket `CLAUDE_CODE_USE_*` is deliberately NOT used: some of those are
 * feature flags (`CLAUDE_CODE_USE_NATIVE_FILE_SEARCH`, ...), not providers.
 */
export const CREDENTIAL_ENV_VARS: readonly string[] = Object.freeze([
  // Claude Code credentials.
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_OAUTH_CLIENT_ID",
  "CLAUDE_CODE_OAUTH_SCOPES",
  "CLAUDE_CODE_CUSTOM_OAUTH_URL",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "CLAUDE_CODE_SESSION_ACCESS_TOKEN",
  "CLAUDE_CODE_GATEWAY_TOKEN",
  "CLAUDE_CODE_HOST_AUTH_ENV_VAR",
  "CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR",
  "CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_HOST_CREDS_FILE",
  // Other sensitive tokens the CLI reads.
  "CLAUDE_BRIDGE_OAUTH_TOKEN",
  "CLAUDE_TRUSTED_DEVICE_TOKEN",
  "AGENT_PROXY_AUTH_TOKEN",
  "CLAUDE_BG_AUTH_SNAPSHOT_PATH",
  "CLAUDE_BG_CLAIM_AUTH",
  "CLAUDE_BG_PTY_AUTH",
  "CLAUDE_BG_RV_AUTH",
  // Selects which stored login the CLI uses.
  "CLAUDE_CONFIG_DIR",
  // Provider switches.
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_GATEWAY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
  "AWS_BEARER_TOKEN_BEDROCK",
  // OAuth and bridge endpoint switches: each can send the token to a host other
  // than Anthropic's (F04-1). Whether the public build honours them is
  // unverified (docs/OPEN_QUESTIONS.md); they are stripped anyway. Exact names,
  // not a `CLAUDE_` prefix rule, which would strip legitimate flags.
  "USE_LOCAL_OAUTH",
  "USE_STAGING_OAUTH",
  "CLAUDE_LOCAL_OAUTH_API_BASE",
  "CLAUDE_LOCAL_OAUTH_APPS_BASE",
  "CLAUDE_LOCAL_OAUTH_CONSOLE_BASE",
  "CLAUDE_BRIDGE_BASE_URL",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR",
  "CLAUDE_BRIDGE_SESSION_INGRESS_URL",
  "CLAUDE_REMOTE_TOOLS_BRIDGE_URL",
  "CLAUDE_CODE_GB_BASE_URL",
]);

const CREDENTIAL_SET: ReadonlySet<string> = new Set(CREDENTIAL_ENV_VARS);

/** True when `name` is a credential or billing-routing variable. */
export function isCredentialEnvVar(name: string): boolean {
  return name.startsWith(CREDENTIAL_ENV_PREFIX) || CREDENTIAL_SET.has(name);
}

/**
 * A NEW environment: `env` without any credential or billing-routing variable
 * and without `undefined` values. Never mutates `env`.
 */
export function stripCredentialEnv(env: BaseEnv): ChildEnv {
  const out: ChildEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || isCredentialEnvVar(name)) continue;
    out[name] = value;
  }
  return out;
}
