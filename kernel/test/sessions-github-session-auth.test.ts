// Phase 8 item 04: the GitHub token a live, write-granted session holds. Driven
// through the real `SessionManager` over the fake spawner/query in
// session-fakes.ts: no network, no real `gh`, never the real SDK. The token
// lives in a 0600 file in a 0700 per-session directory (`GH_CONFIG_DIR/hosts.yml`
// for `gh`, an env-scoped credential helper for git), never in `GH_TOKEN`; a
// re-mint rewrites both before the token expires; the directory goes with the
// session; a mint that cannot happen refuses the session `github_token_unavailable`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decideApproval } from "../src/approvals/index.js";
import { stripCredentialEnv } from "../src/auth/credential-env.js";
import { agentSettingsPath } from "../src/agents/index.js";
import type { ConnectorKind } from "../src/integrations/index.js";
import { githubWriteFor } from "../src/kernel.js";
import { GITHUB_TOKEN_REMINT_MARGIN_MS, GITHUB_TOKEN_REMINT_RETRY_MS, GithubTokenUnavailableError, githubSessionEnv } from "../src/sessions/github-session-auth.js";
import type { SessionTokenMint, SessionTokenMintResult } from "../src/sessions/github-session-auth.js";
import { GITHUB_SESSION_ENV_NAMES, isKernelSessionEnvVar } from "../src/sessions/kernel-env.js";
import { GITHUB_CLI_DENY_REASON } from "../src/sessions/draft-mode.js";
import { SessionError, SessionManager } from "../src/sessions/index.js";
import type { ToolPolicy } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { count, events } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

type Decision = { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };

const NOW0 = new Date("2026-11-03T10:00:00.000Z");
const HOUR = 3_600_000;
const REPOS = ["vikashruhilgit/studio-sandbox", "vikashruhilgit/other"];
const LIVE_POLICY: ToolPolicy = { allowedTools: [], allowedBashPrefixes: ["gh", "git push"] };

let tmp: string;
let pluginDir: string;
let home: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-ghsession-"));
  pluginDir = makePluginDir(tmp);
  home = join(tmp, "home");
  mkdirSync(home);
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** A minter that answers from `script(n)` (n counts calls) and remembers the repos it was asked for. */
function minter(script?: (n: number, now: Date) => SessionTokenMintResult | Promise<SessionTokenMintResult>, clock?: { at: Date }) {
  const asked: (readonly string[])[] = [];
  const fn: SessionTokenMint = (repos) => {
    const n = asked.length;
    asked.push([...repos]);
    const at = clock?.at ?? NOW0;
    return script !== undefined ? script(n, at) : { ok: true, token: `ghs_token${n}abcdefgh`, expires_at: new Date(at.getTime() + HOUR).toISOString() };
  };
  return { fn, asked };
}

interface Options {
  readonly mint?: SessionTokenMint | null;
  readonly write?: boolean;
  readonly connectors?: readonly ConnectorKind[];
  readonly baseEnv?: Record<string, string>;
  /** The manager's clock; share it with the minter so an expiry is measured on the same one. */
  readonly clock?: { at: Date };
}

function setup(o: Options = {}) {
  const store = new Store({ dataDir: join(tmp, `data-${stores.length}`) });
  stores.push(store);
  const fakes = fakeSessions();
  const clock = o.clock ?? { at: NOW0 };
  /** The re-mint timers: a callback and the delay it was armed with, run by the test (`fired` once it ran). */
  const timers: { fn: () => void; ms: number; cancelled: boolean; fired: boolean }[] = [];
  const schedule = (fn: () => void, ms: number) => {
    if (ms < 10_000) {
      const t = setImmediate(fn);
      return () => clearImmediate(t);
    }
    const timer = {
      fn: () => {
        timer.fired = true;
        fn();
      },
      ms,
      cancelled: false,
      fired: false,
    };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const mint = o.mint === undefined ? minter(undefined, clock).fn : (o.mint ?? undefined);
  const manager = new SessionManager(
    {
      store,
      authProvider: stubProvider({ buildEnv: (base) => stripCredentialEnv(base) }),
      loomwrightPath: pluginDir,
      stopGraceMs: 10,
      baseEnv: o.baseEnv ?? { PATH: "/usr/bin", GH_TOKEN: "gho_ownerstoredlogin", GITHUB_TOKEN: "gho_ownerother" },
      connectorsFor: () => o.connectors ?? ["github"],
      githubWriteFor: () => o.write ?? true,
      ...(mint === undefined ? {} : { sessionTokenMint: mint }),
    },
    { ...fakes.deps, homeDir: home, now: () => clock.at, schedule },
  );
  /** A playbook of agent wright (live by default), with a poll trigger naming `repos` unless `repos` is null. */
  const playbook = (mode: "draft" | "live" = "live", repos: readonly string[] | null = REPOS): number => {
    const slug = `pb${count(store, "SELECT count(*) FROM playbooks")}`;
    const id = Number(
      store.prepare("INSERT INTO playbooks (slug, name, owning_agent, intent, version, mode) VALUES (?, ?, 'wright', 'Ship', 1, ?)").run(slug, slug, mode).lastInsertRowid,
    );
    if (repos !== null) {
      const spec = JSON.stringify({ source: "github.pulls", repos, filters: {}, interval_seconds: 300 });
      store
        .prepare("INSERT INTO triggers (owning_agent, playbook, kind, spec_json, action, action_payload, created_by) VALUES ('wright', ?, 'poll', ?, 'wake_agent', '{}', 'owner')")
        .run(slug, spec);
    }
    return id;
  };
  const start = (pb: number | undefined, extra: { dryRun?: boolean; agent?: string; policy?: ToolPolicy } = {}) =>
    manager.startSession(
      startParams(tmp, { policy: extra.policy ?? LIVE_POLICY, ...(extra.dryRun === undefined ? {} : { dryRun: extra.dryRun }), ...(extra.agent === undefined ? {} : { agent: extra.agent }), ...(pb === undefined ? {} : { playbook: pb, playbookVersion: 1 }) }),
    );
  const envOf = (n = fakes.calls.length - 1): Record<string, string | undefined> => fakes.calls[n]?.options.env ?? {};
  const gateOf = (n = fakes.calls.length - 1) => {
    const hook = fakes.calls[n]?.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    return async (command: string): Promise<Decision> => {
      const input = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: tmp } as unknown as HookInput;
      return ((await hook(input, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
    };
  };
  const dirOf = (id: number) => join(store.dataDir, "session-github", `session-${id}`);
  const decisions = () => events(store, "tool_decision").map((e) => e.payload);
  const refusals = () => events(store, "session_refused");
  return { store, manager, fakes, clock, timers, playbook, start, envOf, gateOf, dirOf, decisions, refusals };
}

const flushAll = async () => {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
};

const tokenOf = (dir: string) => readFileSync(join(dir, "token"), "utf8");
const hostsOf = (dir: string) => readFileSync(join(dir, "gh", "hosts.yml"), "utf8");
const mode = (path: string) => statSync(path).mode & 0o777;

/** Run the session's git credential helper the way git does, for `host`. */
function helperPrints(env: Record<string, string | undefined>, host: string): string {
  const value = env["GIT_CONFIG_VALUE_1"] as string;
  expect(value.startsWith("!")).toBe(true);
  return execFileSync("sh", ["-c", `${value.slice(1)} get`], { input: `protocol=https\nhost=${host}\n\n`, encoding: "utf8" });
}

describe("a live, write-granted session's token (AC2)", () => {
  it("gets GH_CONFIG_DIR, an env-scoped git credential helper and no terminal prompt, and never GH_TOKEN", async () => {
    const m = minter();
    const t = setup({ mint: m.fn });
    const h = await t.start(t.playbook());
    const env = t.envOf();
    const dir = t.dirOf(h.id);
    expect(m.asked).toEqual([REPOS]);
    expect(env["GH_CONFIG_DIR"]).toBe(join(dir, "gh"));
    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(env["GIT_CONFIG_COUNT"]).toBe("2");
    expect([env["GIT_CONFIG_KEY_0"], env["GIT_CONFIG_VALUE_0"], env["GIT_CONFIG_KEY_1"]]).toEqual(["credential.helper", "", "credential.helper"]);
    // The owner's stored logins and inherited tokens never reach it.
    for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]) expect(env, name).not.toHaveProperty(name);
    // The kernel's tool deferral switch is still the last word.
    expect(env["ENABLE_TOOL_SEARCH"]).toBe("false");
    // The session's directory: 0700, the token and hosts.yml 0600.
    expect(tokenOf(dir)).toBe("ghs_token0abcdefgh");
    expect(hostsOf(dir)).toBe("github.com:\n    oauth_token: ghs_token0abcdefgh\n    user: x-access-token\n    git_protocol: https\n");
    expect([mode(dir), mode(join(dir, "gh")), mode(join(dir, "token")), mode(join(dir, "gh", "hosts.yml"))]).toEqual([0o700, 0o700, 0o600, 0o600]);
    expect(dir.startsWith(join(t.store.dataDir, "session-github"))).toBe(true);
    // The helper prints the token for github.com only.
    expect(helperPrints(env, "github.com")).toBe("username=x-access-token\npassword=ghs_token0abcdefgh\n");
    expect(helperPrints(env, "example.com")).toBe("");
    // Every name the kernel sets here is one a Loomwright host switch may never name.
    for (const name of Object.keys(githubSessionEnv(dir))) expect(isKernelSessionEnvVar(name), name).toBe(true);
  });

  it("a draft playbook, a dry run, a chat session and an agent without the write grant carry none of it", async () => {
    const m = minter();
    const t = setup({ mint: m.fn });
    const none = (env: Record<string, string | undefined>) =>
      Object.keys(env).filter((n) => n === "GH_CONFIG_DIR" || n === "GIT_TERMINAL_PROMPT" || n.startsWith("GIT_CONFIG_"));
    await t.start(t.playbook("draft"));
    expect(none(t.envOf())).toEqual([]);
    await t.start(t.playbook("live"), { dryRun: true });
    expect(none(t.envOf())).toEqual([]);
    await t.start(undefined);
    expect(none(t.envOf())).toEqual([]);
    const noGrant = setup({ mint: m.fn, write: false });
    await noGrant.start(noGrant.playbook("live"));
    expect(none(noGrant.envOf())).toEqual([]);
    const noConnector = setup({ mint: m.fn, connectors: [] });
    await noConnector.start(noConnector.playbook("live"));
    expect(none(noConnector.envOf())).toEqual([]);
    // Nothing was minted for any of them, and their credential strip is the same as ever.
    expect(m.asked).toEqual([]);
    for (const env of [t.envOf(), noGrant.envOf(), noConnector.envOf()]) {
      expect(env).not.toHaveProperty("GH_TOKEN");
      expect(env).not.toHaveProperty("GITHUB_TOKEN");
    }
    expect(existsSync(join(t.store.dataDir, "session-github"))).toBe(false);
  });

  it("never sets githubWrite from a caller's own policy: a chat session that claims it is still denied gh", async () => {
    const t = setup();
    const claiming = { ...LIVE_POLICY, githubWrite: true, connectors: ["github"] } as ToolPolicy;
    await t.start(undefined, { policy: claiming });
    expect((await t.gateOf()("gh pr view 1")).permissionDecisionReason).toBe(GITHUB_CLI_DENY_REASON);
  });
});

describe("gh and git in a live, write-granted session (AC3)", () => {
  it("allows gh pr view, holds git push, and blocks gh pr merge in every form", async () => {
    const t = setup();
    await t.start(t.playbook());
    const gate = t.gateOf();
    expect((await gate("gh pr view 1")).permissionDecision).toBe("allow");
    expect((await gate("git push origin feature")).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    for (const merge of ["gh pr merge 1", "gh pr merge 1 --squash", "gh --repo a/b pr merge 1"]) {
      expect((await gate(merge)).permissionDecision, merge).toBe("deny");
    }
    expect(t.decisions().map((d) => [d["command"], d["reason"]])).toEqual([
      ["gh pr view 1", "bash_prefix_allowed"],
      ["git push origin feature", "approval_required"],
      ["gh pr merge 1", "merge_blocked"],
      ["gh pr merge 1 --squash", "merge_blocked"],
      ["gh --repo a/b pr merge 1", "merge_blocked"],
    ]);
    expect(count(t.store, "SELECT count(*) FROM approvals")).toBe(1);
  });

  it("is not denied use_kernel_github_tools, while the same agent's draft session still is", async () => {
    const t = setup();
    await t.start(t.playbook("live"));
    expect((await t.gateOf()("gh pr view 1")).permissionDecisionReason).not.toBe(GITHUB_CLI_DENY_REASON);
    await t.start(undefined);
    expect((await t.gateOf()("gh pr view 1")).permissionDecisionReason).toBe(GITHUB_CLI_DENY_REASON);
  });

  it("runs a push the owner's always grant for the playbook version covers (approval_granted)", async () => {
    const t = setup();
    const pb = t.playbook();
    await t.start(pb);
    expect((await t.gateOf()("git push origin feature")).permissionDecision).toBe("deny");
    decideApproval(t.store, { id: 1, decision: "always", by: "owner" }, NOW0);
    await t.start(pb);
    expect(await t.gateOf()("git push origin feature")).toMatchObject({ permissionDecision: "allow", permissionDecisionReason: "approval_granted" });
    expect(t.decisions().at(-1)).toMatchObject({ reason: "approval_granted" });
  });

  it("keeps the agent's never boundary ahead of everything (agent_boundary)", async () => {
    const t = setup();
    await t.start(t.playbook(), { policy: { ...LIVE_POLICY, never: ["git_push"] } });
    expect((await t.gateOf()("git push origin feature")).permissionDecision).toBe("deny");
    expect(t.decisions()).toEqual([expect.objectContaining({ reason: "agent_boundary", category: "git_push" })]);
    expect(count(t.store, "SELECT count(*) FROM approvals")).toBe(0);
  });
});

describe("github_token_unavailable (AC4)", () => {
  async function refused(t: ReturnType<typeof setup>, pb: number): Promise<SessionError> {
    const err: unknown = await t.start(pb).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SessionError);
    expect((err as SessionError).code).toBe("github_token_unavailable");
    return err as SessionError;
  }

  it("refuses with no minter wired: one session_refused event, no row, no spawn, no directory, no token env", async () => {
    const t = setup({ mint: null });
    await refused(t, t.playbook());
    expect(t.refusals().map((e) => [e.session_id, e.payload])).toEqual([[null, { reason: "github_token_unavailable", detail: "no_minter" }]]);
    expect(count(t.store, "SELECT count(*) FROM sessions")).toBe(0);
    expect(t.fakes.calls).toHaveLength(0);
    expect(existsSync(join(t.store.dataDir, "session-github"))).toBe(false);
  });

  it("refuses when the mint fails, throws, or answers a token or expiry it cannot use, naming the reason and never the token", async () => {
    const cases: [string, SessionTokenMint, RegExp][] = [
      ["failed", () => ({ ok: false, error: "repo_not_reached", message: "vikashruhilgit/other is not reached" }), /^mint_failed: repo_not_reached: vikashruhilgit\/other is not reached$/],
      ["threw", () => Promise.reject(new Error("network down")), /^mint_failed: network down$/],
      ["malformed", () => ({ ok: true, token: "ghs_bad token\nwith newline", expires_at: new Date(NOW0.getTime() + HOUR).toISOString() }), /^malformed_token$/],
      ["expiry", () => ({ ok: true, token: "ghs_validtoken1234", expires_at: "tomorrow-ish" }), /^bad_expiry$/],
    ];
    for (const [name, fn, detail] of cases) {
      const t = setup({ mint: fn });
      const err = await refused(t, t.playbook());
      const events1 = t.refusals();
      expect(events1, name).toHaveLength(1);
      expect(events1[0]?.payload["reason"], name).toBe("github_token_unavailable");
      expect(String(events1[0]?.payload["detail"]), name).toMatch(detail);
      expect(err).toBeInstanceOf(GithubTokenUnavailableError);
      expect(JSON.stringify(events(t.store))).not.toContain("ghs_validtoken1234");
      expect(count(t.store, "SELECT count(*) FROM sessions"), name).toBe(0);
      expect(t.fakes.calls, name).toHaveLength(0);
      expect(existsSync(join(t.store.dataDir, "session-github")), name).toBe(false);
    }
  });

  it("refuses a playbook whose poll trigger names no repos, or that has no poll trigger, without calling the minter", async () => {
    const m = minter();
    const t = setup({ mint: m.fn });
    await refused(t, t.playbook("live", []));
    await refused(t, t.playbook("live", null));
    expect(t.refusals().map((e) => e.payload["detail"])).toEqual(["no_repos", "no_repos"]);
    expect(m.asked).toEqual([]);
  });

  it("refuses a resume whose mint fails on the session's id, with the row unchanged; a working mint resumes it", async () => {
    let fail = false;
    const clock = { at: NOW0 };
    const m = minter((n, now) => (fail ? { ok: false, error: "needs_permissions", message: "App lacks them" } : { ok: true, token: `ghs_resume${n}abcdefgh`, expires_at: new Date(now.getTime() + HOUR).toISOString() }), clock);
    const t = setup({ mint: m.fn, clock });
    const pb = t.playbook();
    const h = await t.start(pb);
    expect(existsSync(t.dirOf(h.id))).toBe(true);
    await t.manager.stopAll({ mode: "shutdown" });
    expect(await h.done).toBe("interrupted");
    expect(existsSync(t.dirOf(h.id))).toBe(false);

    const before = t.manager.getSession(h.id);
    const callsBefore = t.fakes.calls.length;
    fail = true;
    const resume = () => t.manager.resumeSession(h.id, { permissionMode: "default", cwd: tmp, policy: LIVE_POLICY });
    await expect(resume()).rejects.toMatchObject({ code: "github_token_unavailable" });
    expect(t.manager.getSession(h.id)).toEqual(before);
    expect(t.refusals().filter((e) => e.session_id === h.id).map((e) => e.payload)).toEqual([
      { reason: "github_token_unavailable", detail: "mint_failed: needs_permissions: App lacks them" },
    ]);
    expect(t.fakes.calls).toHaveLength(callsBefore);
    expect(existsSync(t.dirOf(h.id))).toBe(false);

    fail = false;
    const resumed = await resume();
    expect(resumed.id).toBe(h.id);
    expect(t.fakes.calls).toHaveLength(callsBefore + 1);
    expect(t.envOf()["GH_CONFIG_DIR"]).toBe(join(t.dirOf(h.id), "gh"));
    expect(tokenOf(t.dirOf(h.id))).toBe("ghs_resume2abcdefgh");
    expect(t.gateOf()).toBeDefined();
    expect((await t.gateOf()("gh pr view 1")).permissionDecision).toBe("allow");
  });

  it("a second resume that raced the first one's mint is refused not_resumable, and the first one runs", async () => {
    const releases: ((r: SessionTokenMintResult) => void)[] = [];
    let first = true;
    const clock = { at: NOW0 };
    const m = minter((_n, now) => {
      if (first) {
        first = false;
        return { ok: true, token: "ghs_start0abcdefgh", expires_at: new Date(now.getTime() + HOUR).toISOString() };
      }
      return new Promise<SessionTokenMintResult>((resolve) => releases.push(resolve));
    }, clock);
    const t = setup({ mint: m.fn, clock });
    const h = await t.start(t.playbook());
    await t.manager.stopAll({ mode: "shutdown" });
    await h.done;
    const params = { permissionMode: "default", cwd: tmp, policy: LIVE_POLICY } as const;
    const a = t.manager.resumeSession(h.id, params);
    const b = t.manager.resumeSession(h.id, params);
    const settled = [a, b].map((p) => p.then(() => "resumed", (e: unknown) => (e as SessionError).code));
    await flushAll();
    expect(releases).toHaveLength(2);
    const ok = (n: number): SessionTokenMintResult => ({ ok: true, token: `ghs_resume${n}abcdefgh`, expires_at: new Date(NOW0.getTime() + HOUR).toISOString() });
    releases[0]?.(ok(1));
    await flushAll();
    releases[1]?.(ok(2));
    expect(await Promise.all(settled)).toEqual(["resumed", "not_resumable"]);
    expect(t.fakes.calls).toHaveLength(2);
    expect(tokenOf(t.dirOf(h.id))).toBe("ghs_resume1abcdefgh");
  });

  it("a token directory that cannot be written fails the start (the row ends failed, nothing is left) and a resume (still resumable)", async () => {
    const t = setup();
    const pb = t.playbook();
    // A file where the session-github directory should be: every install fails.
    writeFileSync(join(t.store.dataDir, "session-github"), "in the way");
    const failed: unknown = await t.start(pb).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(failed).toBeInstanceOf(Error);
    expect(failed).not.toBeInstanceOf(SessionError);
    expect(t.fakes.calls).toHaveLength(0);
    expect(t.manager.getSession(1)?.status).toBe("failed");
    rmSync(join(t.store.dataDir, "session-github"));

    const h = await t.start(pb);
    await t.manager.stopAll({ mode: "shutdown" });
    await h.done;
    rmSync(join(t.store.dataDir, "session-github"), { recursive: true, force: true });
    writeFileSync(join(t.store.dataDir, "session-github"), "in the way");
    await expect(t.manager.resumeSession(h.id, { permissionMode: "default", cwd: tmp, policy: LIVE_POLICY })).rejects.toThrow();
    expect(t.manager.getSession(h.id)?.status).toBe("interrupted");
    rmSync(join(t.store.dataDir, "session-github"));
    await t.manager.resumeSession(h.id, { permissionMode: "default", cwd: tmp, policy: LIVE_POLICY });
    expect(existsSync(t.dirOf(h.id))).toBe(true);
  });

  it("a resume of a draft playbook's session mints nothing and carries no token env", async () => {
    const m = minter();
    const t = setup({ mint: m.fn });
    const h = await t.start(t.playbook("draft"));
    await t.manager.stopAll({ mode: "shutdown" });
    await h.done;
    await t.manager.resumeSession(h.id, { permissionMode: "default", cwd: tmp, policy: LIVE_POLICY });
    expect(m.asked).toEqual([]);
    expect(t.envOf()).not.toHaveProperty("GH_CONFIG_DIR");
  });
});

describe("re-mint before expiry and cleanup (AC5)", () => {
  it("mints again GITHUB_TOKEN_REMINT_MARGIN_MS before expiry and rewrites the token file and hosts.yml in place, atomically", async () => {
    const clock = { at: NOW0 };
    const m = minter(undefined, clock);
    const t = setup({ mint: m.fn, clock });
    const h = await t.start(t.playbook());
    const dir = t.dirOf(h.id);
    expect(GITHUB_TOKEN_REMINT_MARGIN_MS).toBe(5 * 60_000);
    expect(t.timers.map((x) => x.ms)).toEqual([HOUR - 5 * 60_000]);
    expect(tokenOf(dir)).toBe("ghs_token0abcdefgh");

    clock.at = new Date(NOW0.getTime() + HOUR - 5 * 60_000);
    t.timers[0]?.fn();
    await flushAll();
    expect(m.asked).toEqual([REPOS, REPOS]);
    expect(tokenOf(dir)).toBe("ghs_token1abcdefgh");
    expect(hostsOf(dir)).toContain("oauth_token: ghs_token1abcdefgh\n");
    expect(readdirSync(dir).sort()).toEqual(["gh", "token"]);
    expect(readdirSync(join(dir, "gh"))).toEqual(["hosts.yml"]);
    expect([mode(join(dir, "token")), mode(join(dir, "gh", "hosts.yml"))]).toEqual([0o600, 0o600]);
    // The helper reads the new token without a restart, and the next re-mint is armed from the new expiry.
    expect(helperPrints(t.envOf(), "github.com")).toContain("password=ghs_token1abcdefgh");
    expect(t.timers.map((x) => x.ms)).toEqual([HOUR - 5 * 60_000, HOUR - 5 * 60_000]);
  });

  it("keeps the old token when a re-mint fails and tries again after the retry interval", async () => {
    const clock = { at: NOW0 };
    let failNext = false;
    const m = minter((n, now) => (failNext ? { ok: false, error: "rate_limited", message: "slow down" } : { ok: true, token: `ghs_token${n}abcdefgh`, expires_at: new Date(now.getTime() + HOUR).toISOString() }), clock);
    const t = setup({ mint: m.fn, clock });
    const h = await t.start(t.playbook());
    failNext = true;
    t.timers[0]?.fn();
    await flushAll();
    expect(tokenOf(t.dirOf(h.id))).toBe("ghs_token0abcdefgh");
    expect(t.timers.map((x) => x.ms)).toEqual([HOUR - 5 * 60_000, GITHUB_TOKEN_REMINT_RETRY_MS]);
    failNext = false;
    t.timers[1]?.fn();
    await flushAll();
    expect(tokenOf(t.dirOf(h.id))).toBe("ghs_token2abcdefgh");
    // A failed re-mint is not an event or a refusal: the session runs on.
    expect(t.refusals()).toEqual([]);
  });

  it("drops a token whose mint was still in flight when the session ended", async () => {
    let release: (r: SessionTokenMintResult) => void = () => {};
    const clock = { at: NOW0 };
    const m = minter((n, now) => (n === 0 ? { ok: true, token: "ghs_token0abcdefgh", expires_at: new Date(now.getTime() + HOUR).toISOString() } : new Promise<SessionTokenMintResult>((r) => (release = r))), clock);
    const t = setup({ mint: m.fn, clock });
    const h = await t.start(t.playbook());
    t.timers[0]?.fn();
    await flushAll();
    await t.manager.stopSession(h.id);
    expect(existsSync(t.dirOf(h.id))).toBe(false);
    release({ ok: true, token: "ghs_late0000abcdefgh", expires_at: new Date(NOW0.getTime() + 2 * HOUR).toISOString() });
    await flushAll();
    expect(existsSync(t.dirOf(h.id))).toBe(false);
    expect(t.timers.filter((x) => !x.cancelled && !x.fired)).toEqual([]);
  });

  it("clears the timer and removes the token directory when the session ends, whatever its terminal status", async () => {
    const t = setup();
    const pb = t.playbook();
    const stopped = await t.start(pb);
    const ended = await t.start(pb);
    expect(existsSync(t.dirOf(stopped.id))).toBe(true);
    expect(existsSync(t.dirOf(ended.id))).toBe(true);
    expect(await t.manager.stopSession(stopped.id)).toBe("stopped");
    expect(existsSync(t.dirOf(stopped.id))).toBe(false);
    expect(existsSync(t.dirOf(ended.id))).toBe(true);
    t.fakes.calls[1]?.stream.end();
    const status = await ended.done;
    expect(["completed", "failed"]).toContain(status);
    expect(existsSync(t.dirOf(ended.id))).toBe(false);
    expect(t.timers.map((x) => x.cancelled)).toEqual([true, true]);
  });

  it("removes a directory a dead kernel left when it reaps orphans, and keeps a live session's", async () => {
    const t = setup();
    const h = await t.start(t.playbook());
    const stale = join(t.store.dataDir, "session-github", "session-9999");
    mkdirSync(join(stale, "gh"), { recursive: true });
    writeFileSync(join(stale, "token"), "ghs_stale0000abcdef");
    await t.manager.reapOrphans();
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(t.dirOf(h.id))).toBe(true);
  });

  it("never puts the token in an event, a log line or a row", async () => {
    const t = setup();
    const h = await t.start(t.playbook());
    t.timers[0]?.fn();
    await flushAll();
    await t.gateOf()("git push origin feature");
    await t.manager.stopSession(h.id);
    const tables = t.store.prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all();
    const dump = tables.map((name) => JSON.stringify(t.store.prepare(`SELECT * FROM "${name}"`).all())).join("\n");
    expect(dump.length).toBeGreaterThan(0);
    for (const secret of ["ghs_token0abcdefgh", "ghs_token1abcdefgh", "ghs_token", "oauth_token"]) expect(dump, secret).not.toContain(secret);
  });
});

describe("the kernel's names and the grant reader (AC2, AC5)", () => {
  it("refuses a Loomwright host switch that names a GitHub session variable", () => {
    for (const name of [...GITHUB_SESSION_ENV_NAMES, "GH_CONFIG_DIR", "GIT_TERMINAL_PROMPT", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_1"]) {
      expect(isKernelSessionEnvVar(name), name).toBe(true);
    }
    expect(isKernelSessionEnvVar("ENABLE_TOOL_SEARCH")).toBe(true);
    expect(isKernelSessionEnvVar("LOOMWRIGHT_HOST_MODE")).toBe(false);
    expect(isKernelSessionEnvVar("GIT_AUTHOR_NAME")).toBe(false);
  });

  it("githubWriteFor reads only the object form {github: write}, and any refusal grants no write", () => {
    const BASE = { model: "claude-haiku-4-5", permission_mode: "default", tool_policy: { allowedTools: [], allowedBashPrefixes: [] } };
    const write = (id: string, content: unknown): void => {
      const file = agentSettingsPath(tmp, id);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify(content));
    };
    write("writer", { ...BASE, connectors: { github: "write" } });
    write("reader", { ...BASE, connectors: ["github"] });
    write("plain", BASE);
    write("broken", { ...BASE, connectors: { github: "read" } });
    const grant = githubWriteFor(tmp);
    expect([grant("writer"), grant("reader"), grant("plain"), grant("broken"), grant("nobody")]).toEqual([true, false, false, false, false]);
  });
});
