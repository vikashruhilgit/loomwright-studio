// Phase 8 item 10: the owner-aware comment routing (`kernel_pr_route`, built in
// `kernel/src/automate/routing.ts`).
//
//   - AC3: a PR a `running` run names answers `automate_drain`; a paused run's
//     parked item answers `automate_fix` with that item and the command
//     `/loomwright:review-pr <pr url>`; an owner- or App-authored PR no run holds
//     answers `review_pr` with the same command shape; the route is re-read on every
//     call (a fixture switched from parked to running answers `automate_drain`
//     next); the tool's description names the four routes and fix / reply / answer.
//   - AC4: a PR by another person answers `reply_only` with no command; no
//     workspace, unreadable run state or a failed GitHub read answers `reply_only`
//     with its reason and never a route that pushes; nothing in the automate
//     sources runs git or starts a session.
//
// Everything runs on a temp store and checkouts with `FakeGitHubClient`: no
// network, no real Keychain, never the SDK or a model.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PR_ROUTES, PR_ROUTE_REASONS, createRoutingTools, identityOf, ownerOf, routingPart } from "../src/automate/routing.js";
import { readRunState } from "../src/automate/run-state.js";
import type { FakeGitHubData } from "./fixtures/github-fake.js";
import { FakeGitHubClient } from "./fixtures/github-fake.js";
import { HEAD, PARKED_RUN_ID, PR, installRunFiles, toolEnv } from "./fixtures/loomwright-run-files/harness.js";
import type { ToolEnv } from "./fixtures/loomwright-run-files/harness.js";
import type { GitHubPull } from "../src/integrations/types.js";

// The default client is built from the real Keychain reader; a test that injects a client must never get that far.
vi.mock("../src/auth/keychain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth/keychain.js")>()),
  securityCliKeychain: () => {
    throw new Error("the real Keychain must not be read in a test");
  },
}));

const AUTOMATE_SRC = new URL("../src/automate/", import.meta.url);
const URL7 = `https://github.com/o/r/pull/${PR}`;
const COMMAND = `/loomwright:review-pr ${URL7}`;

let env: ToolEnv;

beforeEach(() => {
  env = toolEnv("studio-routing-");
});

afterEach(() => {
  env.close();
});

const pull = (author: string, number = PR): GitHubPull => ({
  number,
  title: "A change",
  author,
  draft: false,
  head_sha: HEAD,
  url: `https://github.com/o/r/pull/${number}`,
  updated_at: "2026-11-09T09:00:00Z",
  body: "",
  state: "open",
  merged: false,
  base_ref: "main",
  head_ref: "feature/x",
  labels: [],
});

const fakeBy = (author: string, data: FakeGitHubData = {}): FakeGitHubClient => new FakeGitHubClient({ pulls: { "o/r": [pull(author)] }, ...data });

/** Calls `kernel_pr_route` as a chat session of `mason`, with `fake` as the GitHub client. */
async function route(fake: FakeGitHubClient, args: { repo?: string; pr?: number } = {}, agent: string | null = "mason"): Promise<Record<string, unknown>> {
  const answer = await env.call(createRoutingTools({ client: () => fake }), "kernel_pr_route", { repo: args.repo ?? "o/r", pr: args.pr ?? PR }, { playbook: null, agent });
  if (answer.isError) throw new Error(answer.text);
  return answer.value as Record<string, unknown>;
}

const connect = (login: string | null, slug: string | null = null): void => {
  env.store.prepare("INSERT INTO connectors (kind, status, account_login, app_slug) VALUES ('github', 'connected', ?, ?)").run(login, slug);
};

const runDir = (): string => join(env.checkout, ".supervisor", "automate");

/** A `running` run whose current item names `pr`. */
function writeRunning(pr: string | null = URL7): void {
  mkdirSync(runDir(), { recursive: true });
  writeFileSync(
    join(runDir(), "2026-11-09-100000-stories.md"),
    ["# Automate Run: 2026-11-09-100000-stories", "## Status: running", "## Current", `- item: stories/01-add-greeting.md | status: running | pr: ${pr} | branch: feature/x`, "- pause_reason: null", ""].join("\n"),
  );
}

// ---- The closed sets and the tool's shape -----------------------------------------------------------------

describe("the routing part", () => {
  it("has the four routes and the three failure reasons, closed in code", () => {
    expect(PR_ROUTES).toEqual(["automate_drain", "automate_fix", "review_pr", "reply_only"]);
    expect(PR_ROUTE_REASONS).toEqual(["no_workspace", "run_state_unreadable", "unreadable"]);
    expect(Object.isFrozen(PR_ROUTES) && Object.isFrozen(PR_ROUTE_REASONS)).toBe(true);
  });

  it("is exactly kernel_pr_route, offered to a GitHub read grant, with no route, handler, due work or subcommand", () => {
    expect(routingPart.name).toBe("routing");
    expect(routingPart.tools.map((t) => t.name)).toEqual(["kernel_pr_route"]);
    expect(routingPart.tools[0]?.requiresConnector).toBe("github");
    expect(routingPart.tools[0]?.requiresConnectorLevel).toBeUndefined();
    expect(routingPart.routes).toEqual([]);
    expect(routingPart.handlers).toEqual({});
    expect(routingPart.dueWork ?? []).toEqual([]);
    expect(routingPart.subcommands ?? []).toEqual([]);
  });

  it("describes the four routes and the three triage outcomes, and says it reads fresh, starts no session and pushes nothing", () => {
    const description = routingPart.tools[0]?.description ?? "";
    for (const word of [...PR_ROUTES, "fix", "reply", "answer", "/loomwright:review-pr <pr url>", "fresh on every call", "starts no session and pushes nothing", "untrusted data"]) {
      expect(description, word).toContain(word);
    }
    expect(description.startsWith("Read-only.")).toBe(true);
  });

  it("refuses a repo that is not <owner>/<repo> and a pr that is not a positive integer, before any read", async () => {
    const fake = fakeBy("octo");
    const tools = createRoutingTools({ client: () => fake });
    for (const args of [{ repo: "nope", pr: 7 }, { repo: "o/r", pr: 0 }, { repo: "o/r", pr: 1.5 }, { repo: "../x/y", pr: 7 }]) {
      expect((await env.call(tools, "kernel_pr_route", args, { playbook: null })).isError, JSON.stringify(args)).toBe(true);
    }
    expect(fake.calls).toEqual([]);
  });
});

// ---- AC3: the routes -------------------------------------------------------------------------------------------

describe("the four routes (AC3)", () => {
  it("answers automate_drain for a PR a running run names, with no command and no item", async () => {
    writeRunning();
    const answer = await route(fakeBy("stranger"));
    expect(answer).toMatchObject({ route: "automate_drain", repo: "o/r", pr: PR, owner_kind: "automate_live" });
    expect(answer).not.toHaveProperty("command");
    expect(answer).not.toHaveProperty("item");
    expect(answer["note"]).toContain("leave the fix to that run");
  });

  it("answers automate_fix for a parked item, with that item and the review-pr command", async () => {
    installRunFiles(env.checkout, "parked");
    const answer = await route(fakeBy("stranger"));
    expect(answer).toMatchObject({
      route: "automate_fix",
      owner_kind: "automate_parked",
      command: COMMAND,
      item: { run_id: PARKED_RUN_ID, item: "stories/02-add-farewell.md", status: "awaiting_merge", reason: "awaiting_merge", pr: URL7 },
    });
    expect(answer["note"]).toContain(COMMAND);
    expect(answer["note"]).toContain("only by /automate itself");
  });

  it("answers automate_fix for an escalated item, with its status and reason", async () => {
    installRunFiles(env.checkout, "escalated");
    const answer = await route(fakeBy("stranger"));
    expect(answer).toMatchObject({ route: "automate_fix", item: { status: "escalated" }, command: COMMAND });
  });

  it("answers review_pr for the connected account's PR and for the App's, with the same command shape", async () => {
    connect("Octo", "studio-app");
    for (const author of ["octo", "studio-app[bot]"]) {
      const answer = await route(fakeBy(author));
      expect(answer, author).toMatchObject({ route: "review_pr", owner_kind: "owner", command: COMMAND });
      expect(answer["note"]).toContain("never merges");
      expect(answer).not.toHaveProperty("item");
    }
  });

  it("re-reads on every call: a fixture switched from parked to running answers automate_drain next, and back", async () => {
    const fake = fakeBy("stranger");
    installRunFiles(env.checkout, "parked");
    expect(await route(fake)).toMatchObject({ route: "automate_fix" });
    writeRunning();
    // The paused run is still on disk; the running one takes it.
    expect(await route(fake)).toMatchObject({ route: "automate_drain" });
    writeFileSync(join(runDir(), "2026-11-09-100000-stories.md"), "# Automate Run: 2026-11-09-100000-stories\n## Status: done\n");
    expect(await route(fake)).toMatchObject({ route: "automate_fix" });
    // The pull request was read on each of the three calls.
    expect(fake.callsTo("getPull")).toHaveLength(3);
  });

  it("never takes the owner from pr_tracks: a stored owner row does not make a stranger's PR the owner's", async () => {
    env.store.prepare("INSERT INTO pr_tracks (repo, number, head_sha, state, owner_kind) VALUES ('o/r', 7, ?, 'open', 'owner')").run(HEAD);
    expect(await route(fakeBy("stranger"))).toMatchObject({ route: "reply_only", owner_kind: "other" });
    env.store.prepare("UPDATE pr_tracks SET owner_kind = 'automate_live'").run();
    expect(await route(fakeBy("stranger"))).toMatchObject({ route: "reply_only", owner_kind: "other" });
  });

  it("names the PR by repo and number (an item for another PR does not route this one)", async () => {
    installRunFiles(env.checkout, "parked");
    const fake = new FakeGitHubClient({ pulls: { "o/r": [pull("stranger", 8)] } });
    expect(await route(fake, { pr: 8 })).toMatchObject({ route: "reply_only", owner_kind: "other" });
  });
});

// ---- AC4: reply only, fail closed ---------------------------------------------------------------------------------

describe("reply only and failing closed (AC4)", () => {
  it("answers reply_only with no command for a PR by another person", async () => {
    connect("octo", "studio-app");
    const answer = await route(fakeBy("stranger"));
    expect(answer).toMatchObject({ route: "reply_only", owner_kind: "other" });
    expect(answer).not.toHaveProperty("command");
    expect(answer).not.toHaveProperty("item");
    expect(answer).not.toHaveProperty("reason");
    expect(answer["note"]).toContain("never push");
  });

  it("answers reply_only for anyone when the GitHub connector has no account", async () => {
    expect(await route(fakeBy("octo"))).toMatchObject({ route: "reply_only", owner_kind: "other" });
  });

  it("answers reply_only with no_workspace for a repo none of the agent's workspaces clones, a session with no agent and an agent with no workspace", async () => {
    connect("octo");
    const fake = new FakeGitHubClient({ pulls: { "x/y": [pull("octo", 3)] } });
    for (const [args, agent] of [
      [{ repo: "x/y", pr: 3 }, "mason"],
      [{ repo: "o/r" }, null],
      [{ repo: "o/r" }, "wright"],
      [{ repo: "o/r" }, "nobody"],
    ] as const) {
      const answer = await route(fake, args, agent);
      expect(answer, JSON.stringify([args, agent])).toMatchObject({ route: "reply_only", reason: "no_workspace", owner_kind: "other" });
      expect(answer).not.toHaveProperty("command");
    }
    // No workspace means no GitHub read either.
    expect(fake.calls).toEqual([]);
  });

  it("answers reply_only with run_state_unreadable when the run files cannot be read, even for the owner's own PR", async () => {
    connect("octo");
    installRunFiles(env.checkout, "parked");
    // An oversize run file (over the reader's bound) makes the whole state unreadable.
    writeFileSync(join(runDir(), "2026-11-09-100001-big.md"), `# Automate Run: big\n${"x".repeat(1024 * 1024 + 1)}`);
    expect(readRunState(env.checkout).ok).toBe(false);
    const fake = fakeBy("octo");
    const answer = await route(fake);
    expect(answer).toMatchObject({ route: "reply_only", reason: "run_state_unreadable", owner_kind: "other" });
    expect(answer).not.toHaveProperty("command");
    expect(answer).not.toHaveProperty("item");
    expect(fake.callsTo("getPull")).toEqual([]);
  });

  it("answers reply_only with unreadable when GitHub fails, answers no pull or throws, even if a run is parked", async () => {
    connect("octo");
    installRunFiles(env.checkout, "parked");
    const failing = fakeBy("octo", { failures: { getPull: { ok: false, error: "rate_limited", resets_at: "2026-11-09T12:00:00.000Z", rateLimit: { limit: 1, remaining: 0, reset_at: "2026-11-09T12:00:00.000Z" } } } });
    expect(await route(failing)).toMatchObject({ route: "reply_only", reason: "unreadable" });
    expect(await route(new FakeGitHubClient({}))).toMatchObject({ route: "reply_only", reason: "unreadable" });
    const throwing = { getPull: () => Promise.reject(new Error("boom")) } as unknown as FakeGitHubClient;
    const answer = await route(throwing);
    expect(answer).toMatchObject({ route: "reply_only", reason: "unreadable", owner_kind: "other" });
    expect(answer).not.toHaveProperty("command");
  });

  it("every note says it is read fresh and a run that went live answers automate_drain", async () => {
    connect("octo");
    installRunFiles(env.checkout, "parked");
    const notes = [
      (await route(fakeBy("octo")))["note"],
      (await route(new FakeGitHubClient({})))["note"],
      (await route(fakeBy("octo"), { repo: "x/y", pr: 3 }))["note"],
    ];
    writeRunning();
    notes.push((await route(fakeBy("octo")))["note"]);
    for (const note of notes) expect(note, String(note)).toContain("a run that went live since the last call answers automate_drain");
  });
});

// ---- ownerOf ---------------------------------------------------------------------------------------------------------

describe("ownerOf", () => {
  const identity = { login: "octo", appBot: "studio-app[bot]" };

  it("is other for state it could not read or no workspace, whoever the author", () => {
    expect(ownerOf(undefined, "o/r", PR, "octo", identity)).toBe("other");
    expect(ownerOf({ ok: false, reason: "run_state_unreadable" }, "o/r", PR, "octo", identity)).toBe("other");
  });

  it("puts a live run before a parked item before the author, and compares the repo without case", () => {
    installRunFiles(env.checkout, "parked");
    const parked = readRunState(env.checkout);
    expect(ownerOf(parked, "O/R", PR, "octo", identity)).toBe("automate_parked");
    writeRunning();
    expect(ownerOf(readRunState(env.checkout), "o/R", PR, "octo", identity)).toBe("automate_live");
    expect(ownerOf(parked, "o/r", PR, "OCTO", identity)).toBe("automate_parked");
    expect(ownerOf({ ok: true, runs: [], lock: { held: false, pid: null } }, "o/r", PR, "OCTO", identity)).toBe("owner");
    expect(ownerOf({ ok: true, runs: [], lock: { held: false, pid: null } }, "o/r", PR, "STUDIO-APP[BOT]", identity)).toBe("owner");
    expect(ownerOf({ ok: true, runs: [], lock: { held: false, pid: null } }, "o/r", PR, "someone", identity)).toBe("other");
    expect(ownerOf({ ok: true, runs: [], lock: { held: false, pid: null } }, "o/r", PR, null, identity)).toBe("other");
    expect(ownerOf({ ok: true, runs: [], lock: { held: false, pid: null } }, "o/r", PR, "octo", { login: null, appBot: null })).toBe("other");
  });

  it("never reads an empty author as the owner, even when the connector's login or slug is empty", () => {
    const none = { ok: true, runs: [], lock: { held: false, pid: null } } as const;
    expect(ownerOf(none, "o/r", PR, "", { login: "", appBot: "" })).toBe("other");
    expect(ownerOf(none, "o/r", PR, "", identity)).toBe("other");
    connect("", "");
    expect(identityOf(env.store)).toEqual({ login: null, appBot: null });
  });

  it("reads the identity from the GitHub connector row", () => {
    expect(identityOf(env.store)).toEqual({ login: null, appBot: null });
    connect("octo", "studio-app");
    expect(identityOf(env.store)).toEqual({ login: "octo", appBot: "studio-app[bot]" });
  });
});

// ---- Nothing pushes, runs git or starts a session ------------------------------------------------------------------

describe("the automate sources", () => {
  it("scan: nothing under kernel/src/automate/ runs git or gh, starts a process or starts, resumes or imports a session", () => {
    const files = readdirSync(AUTOMATE_SRC).filter((f) => f.endsWith(".ts"));
    expect(files).toEqual(expect.arrayContaining(["checkout.ts", "routing.ts", "tracker.ts"]));
    const forbidden: readonly [string, RegExp][] = [
      ["a git or gh command", /\b(?:execFile|execFileSync|exec|execSync|spawn|spawnSync)\w*\s*\(\s*["'`](?:git|gh)\b/],
      ["a process", /\bchild_process\b|\bexecFile|\bexecSync\b|\bspawn(Sync)?\b|\bfork\s*\(/],
      ["a session start", /\bstartSession\b|\bresumeSession\b|\bstopSession\b|\bnew SessionManager\b/],
      ["a session manager, SDK or kernel import", /from\s+["'][^"']*(?:sessions\/manager|claude-agent-sdk|\/kernel\.js)/],
      ["a GitHub write", /\.(?:createPullComment|createIssueComment|replyToReviewComment|requestReviewers)\s*\(/],
    ];
    for (const f of files) {
      const text = readFileSync(new URL(f, AUTOMATE_SRC), "utf8");
      for (const [what, pattern] of forbidden) {
        // `ctx.sessions.getSession` is a read of the calling session's row, the one session call routing makes.
        // `launch.ts` (D44) is the one file that starts a session: exactly one `sessions.startSession(` call, on the session manager the loop passes it.
        let scanned = what === "a session start" ? text.replace(/\.getSession\(/g, "") : text;
        if (what === "a session start" && f === "launch.ts") {
          expect(scanned.match(/\bstartSession\b/g)).toHaveLength(1);
          scanned = scanned.replace(/\bsessions\.startSession\(/, "");
        }
        expect(pattern.test(scanned), `${f} has ${what}`).toBe(false);
      }
    }
  });
});
