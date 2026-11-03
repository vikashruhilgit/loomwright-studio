// The GitHub token a live, write-granted session holds (phase 8 item 04, D39).
// Mechanism only (invariant 1): which sessions qualify is decided by the manager
// from the playbook's `mode`, the agent's `github: write` grant and the owner's
// settings; this module mints, stores, renews and removes the token.
//
// Why a file, not `GH_TOKEN`: a running process's environment cannot change, so
// a `GH_TOKEN` set at spawn would go stale at the token's one-hour expiry. The
// token instead lives in a 0600 file in a 0700 per-session directory
// (`<dataDir>/session-github/session-<id>/`), which the session reaches two ways:
//
//   - `gh` reads `GH_CONFIG_DIR/hosts.yml` (`<dir>/gh/hosts.yml`, an `oauth_token`);
//   - `git` asks an env-scoped credential helper (`GIT_CONFIG_COUNT` and its
//     `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`) that prints `<dir>/token` for
//     `github.com`.
//
// A re-mint, a little before the token's expiry, rewrites both files in place
// (a temp file and a rename, so a reader sees the old token or the new one,
// never half of one). The directory is removed when the session ends, and
// `sweep` removes the ones a dead kernel left. No `GH_TOKEN` is ever set.
//
// The token is never in an event, a log, a row or an error message: it exists
// in memory here and in those two files. An error's text carries only the
// minter's `error`/`message` (cut), which describe a failure and hold no token.
//
// Dependency-light on purpose: `./types.js` (the error), node's fs and the
// store's `prepare` for the playbook's repos. It never imports `manager.ts`.
import { chmodSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../store/store.js";
import { SessionError } from "./types.js";
import type { CancelTimer } from "./types.js";

/** How long before a token's `expires_at` the kernel mints a fresh one. */
export const GITHUB_TOKEN_REMINT_MARGIN_MS = 5 * 60_000;

/** A failed re-mint (or one that left less than this) is tried again after this long, so a failure never spins. */
export const GITHUB_TOKEN_REMINT_RETRY_MS = 30_000;

/** The directory under the Studio data dir that holds one `session-<id>` directory per live, write-granted session. */
export const GITHUB_SESSION_DIR = "session-github";

/** The longest `detail` a refusal carries. */
const MAX_DETAIL_CHARS = 200;

/**
 * What the port answers: a token and the ISO instant it expires, or a failure
 * (`error` a stable code, `message` its text). The shape of item 03's
 * `mintSessionToken(repos)` result.
 */
export type SessionTokenMintResult =
  | { readonly ok: true; readonly token: string; readonly expires_at: string }
  | { readonly ok: false; readonly error: string; readonly message: string };

/**
 * The port that mints a session's down-scoped GitHub token for `repos`
 * (`owner/name` names). Item 03 provides the function; this item defines the
 * port and wires none, so with no minter every live, write-granted session is
 * refused `github_token_unavailable` (fail closed). A throw is a failed mint.
 */
export type SessionTokenMint = (repos: readonly string[]) => SessionTokenMintResult | Promise<SessionTokenMintResult>;

/**
 * A session start or resume refused `github_token_unavailable`: no token could
 * be had for a live, write-granted session. `detail` is the short reason the
 * refusal event carries (`no_minter`, `no_repos`, `mint_failed: …`); it never
 * holds a token.
 */
export class GithubTokenUnavailableError extends SessionError {
  readonly detail: string;

  constructor(detail: string) {
    super("github_token_unavailable", `no GitHub token for this live session: ${detail}`);
    this.name = "GithubTokenUnavailableError";
    this.detail = detail;
  }
}

/** A minted token held in memory until it is installed (never logged, never in an error). */
export interface MintedGithubToken {
  readonly token: string;
  readonly expiresAtMs: number;
  readonly repos: readonly string[];
}

/** An installation token: `ghs_…`, a fine-grained or classic token. Anything else is refused before it reaches a YAML file or a shell. */
const TOKEN_SHAPE = /^[A-Za-z0-9_.-]{8,512}$/;

/** An `owner/name` repo, as a poll spec stores it. */
const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function cut(text: string): string {
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}…` : text;
}

function problemOf(err: unknown): string {
  return cut(err instanceof Error ? err.message : String(err));
}

/**
 * The repos the playbook `playbook` works on: its linked poll trigger's spec
 * (`triggers.playbook` = its slug, owned by its agent, the first by id, as
 * `linkedTriggerOf` reads it). `[]` when it has no poll trigger or the spec
 * names none (or cannot be read): the caller refuses `no_repos`.
 */
export function playbookRepos(store: Store, playbook: number): readonly string[] {
  const spec = store
    .prepare<[number], { kind: string; spec_json: string }>(
      `SELECT t.kind AS kind, t.spec_json AS spec_json
         FROM playbooks p JOIN triggers t ON t.playbook = p.slug AND t.owning_agent = p.owning_agent
        WHERE p.id = ? ORDER BY t.id LIMIT 1`,
    )
    .get(playbook);
  if (spec === undefined || spec.kind !== "poll") return [];
  try {
    const repos = (JSON.parse(spec.spec_json) as { repos?: unknown }).repos;
    if (!Array.isArray(repos)) return [];
    return [...new Set(repos.filter((r): r is string => typeof r === "string" && REPO_SHAPE.test(r)))];
  } catch {
    return [];
  }
}

/** `text` in single quotes, for a POSIX shell. */
function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * The env additions of a session whose token directory is `dir`: `gh`'s config
 * dir, no terminal prompt, and an env-scoped git credential helper (the
 * `credential.helper` list reset to empty, then one helper that prints the
 * token file for `github.com` only). Never `GH_TOKEN`. Probed with gh 2.102.0
 * and git 2.55.0 (docs/OPEN_QUESTIONS.md).
 */
export function githubSessionEnv(dir: string): Record<string, string> {
  const helper =
    `!f() { test "$1" = get || exit 0; ok=; while IFS= read -r l; do test "$l" = host=github.com && ok=1; done; ` +
    `test -n "$ok" || exit 0; echo username=x-access-token; printf 'password=%s\\n' "$(cat ${shellQuote(join(dir, "token"))})"; }; f`;
  return {
    GH_CONFIG_DIR: join(dir, "gh"),
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: helper,
  };
}

/** Write `content` to `path` through a temp file and a rename (mode 0600). */
function writeAtomic(path: string, content: string, nonce: string): void {
  const temp = `${path}.${nonce}.tmp`;
  try {
    writeFileSync(temp, content, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  } catch (err) {
    removeTree(temp);
    throw err;
  }
}

/** Remove a file or directory tree; a path that is not there is fine. */
function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/** Both files a token lives in: `<dir>/token` and `<dir>/gh/hosts.yml`. */
function writeTokenFiles(dir: string, token: string, nonce: string): void {
  writeAtomic(join(dir, "token"), token, nonce);
  writeAtomic(join(dir, "gh", "hosts.yml"), `github.com:\n    oauth_token: ${token}\n    user: x-access-token\n    git_protocol: https\n`, nonce);
}

/** One installed session: its directory, the timer that renews its token, and whether it ended. */
interface Entry {
  readonly dir: string;
  readonly repos: readonly string[];
  expiresAtMs: number;
  cancel: CancelTimer | undefined;
  closed: boolean;
}

export interface GithubSessionAuthDeps {
  readonly dataDir: string;
  /** Absent: no token can be minted, so every `mint` is refused `no_minter`. */
  readonly mint: SessionTokenMint | undefined;
  readonly now: () => Date;
  readonly schedule: (fn: () => void, ms: number) => CancelTimer;
}

/**
 * The token lifecycle of the live, write-granted sessions of one manager:
 * `mint` (before the session's row exists), `install` (the files, the env and
 * the renewal timer), `release` (the session ended) and `sweep` (directories
 * a dead kernel left).
 */
export class GithubSessionAuth {
  readonly #deps: GithubSessionAuthDeps;
  readonly #entries = new Map<number, Entry>();
  #nonce = 0;

  constructor(deps: GithubSessionAuthDeps) {
    this.#deps = deps;
  }

  /** The directory of session `id`. */
  dirOf(id: number): string {
    return join(this.#deps.dataDir, GITHUB_SESSION_DIR, `session-${id}`);
  }

  /**
   * Mint a token for playbook `playbook`'s repos. Throws
   * `GithubTokenUnavailableError` for anything that leaves no usable token: no
   * minter wired, no repos, a failed or throwing mint, a token or expiry of an
   * unreadable shape. Nothing is written.
   */
  async mint(store: Store, playbook: number): Promise<MintedGithubToken> {
    const repos = this.#deps.mint === undefined ? [] : playbookRepos(store, playbook);
    const outcome = await this.#mintChecked(repos);
    if (typeof outcome === "string") throw new GithubTokenUnavailableError(outcome);
    return outcome;
  }

  /** The minted token for `repos`, or the short reason there is none. */
  async #mintChecked(repos: readonly string[]): Promise<MintedGithubToken | string> {
    const mint = this.#deps.mint;
    if (mint === undefined) return "no_minter";
    if (repos.length === 0) return "no_repos";
    let result: SessionTokenMintResult;
    try {
      result = await mint(repos);
    } catch (err) {
      return `mint_failed: ${problemOf(err)}`;
    }
    if (typeof result !== "object" || result === null) return "mint_failed: unreadable answer";
    if (!result.ok) return `mint_failed: ${cut(`${String(result.error)}: ${String(result.message)}`)}`;
    if (typeof result.token !== "string" || !TOKEN_SHAPE.test(result.token)) return "malformed_token";
    const expiresAtMs = typeof result.expires_at === "string" ? Date.parse(result.expires_at) : Number.NaN;
    if (!Number.isFinite(expiresAtMs)) return "bad_expiry";
    return { token: result.token, expiresAtMs, repos };
  }

  /**
   * Write session `id`'s directory (0700) with the token's two files (0600),
   * arm the renewal timer, and return the env additions. A directory left by an
   * earlier run is replaced. A failure removes the partial directory and throws.
   */
  install(id: number, minted: MintedGithubToken): Record<string, string> {
    const dir = this.dirOf(id);
    this.release(id);
    try {
      removeTree(dir);
      mkdirSync(join(dir, "gh"), { recursive: true, mode: 0o700 });
      for (const path of [join(this.#deps.dataDir, GITHUB_SESSION_DIR), dir, join(dir, "gh")]) chmodSync(path, 0o700);
      writeTokenFiles(dir, minted.token, this.#nextNonce());
    } catch (err) {
      removeTree(dir);
      throw err;
    }
    const entry: Entry = { dir, repos: minted.repos, expiresAtMs: minted.expiresAtMs, cancel: undefined, closed: false };
    this.#entries.set(id, entry);
    this.#arm(entry);
    return githubSessionEnv(dir);
  }

  /** The session ended: stop its renewal and remove its directory. Never throws; a session with no token is a no-op. */
  release(id: number): void {
    const entry = this.#entries.get(id);
    if (entry === undefined) return;
    entry.closed = true;
    entry.cancel?.();
    entry.cancel = undefined;
    this.#entries.delete(id);
    try {
      removeTree(entry.dir);
    } catch {
      // Left for the next `sweep`; the token expires within the hour anyway.
    }
  }

  /** Remove every `session-<id>` directory no installed session owns: what a killed kernel left. Never throws. */
  sweep(): void {
    const root = join(this.#deps.dataDir, GITHUB_SESSION_DIR);
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      return;
    }
    for (const name of names) {
      const id = /^session-(\d+)$/.exec(name)?.[1];
      if (id !== undefined && this.#entries.has(Number(id))) continue;
      try {
        removeTree(join(root, name));
      } catch {
        // Retried by the next sweep.
      }
    }
  }

  #nextNonce(): string {
    return `${process.pid}-${++this.#nonce}`;
  }

  /** Renew `margin` before expiry, never sooner than the retry interval after now. */
  #arm(entry: Entry): void {
    const wait = entry.expiresAtMs - GITHUB_TOKEN_REMINT_MARGIN_MS - this.#deps.now().getTime();
    this.#after(entry, Math.max(GITHUB_TOKEN_REMINT_RETRY_MS, wait));
  }

  #after(entry: Entry, ms: number): void {
    if (entry.closed) return;
    entry.cancel = this.#deps.schedule(() => void this.#remint(entry), ms);
  }

  /** Mint again and rewrite both files; a failure keeps the old token and tries again after the retry interval. */
  async #remint(entry: Entry): Promise<void> {
    entry.cancel = undefined;
    if (entry.closed) return;
    let outcome: MintedGithubToken | string;
    try {
      outcome = await this.#mintChecked(entry.repos);
    } catch (err) {
      outcome = problemOf(err);
    }
    // The session ended while the mint was in flight: the new token is dropped, never written.
    if (entry.closed) return;
    if (typeof outcome !== "string") {
      try {
        writeTokenFiles(entry.dir, outcome.token, this.#nextNonce());
        entry.expiresAtMs = outcome.expiresAtMs;
        this.#arm(entry);
        return;
      } catch {
        // The files keep the old token (each write is atomic); try again below.
      }
    }
    this.#after(entry, GITHUB_TOKEN_REMINT_RETRY_MS);
  }
}
