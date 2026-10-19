// Opt-in live harness for the phase 4 exit check (item 09): the
// machine-observable parts of docs/evidence/phase-4-exit-runbook.md. Never
// runs in CI or by default. The owner runs it on his Mac, after the runbook's
// setup (the kernel built, the launchd service installed with `studio service
// install`, Wright's model set in `config/agents/wright.json` and its tool
// policy listing the four `mcp__kernel__kernel_agent_*` names):
//
//   cd kernel && npm run build && STUDIO_LIVE=1 npx vitest run test/phase-4-exit-live.test.ts
//
// Everything runs against the launchd service the owner installed, on its own
// data dir (`STUDIO_DATA_DIR`, else `~/.loomwright-studio`), through the built
// `studio` CLI (`kernel/dist/cli/index.js`). It creates one crew member in the
// owner's real store, through Wright and the owner's approval. One flow, in
// order, each stage recorded in the summary:
//
//   1. A throwaway git repo with one unpushed commit and a local bare remote,
//      in a run-tagged directory under `tmpdir()` (`makeThrowawayRepo`): never
//      in a macOS-protected folder (D31; so never under `~/Documents`) and
//      never in or around the data dir. No GitHub is needed (invariant 5).
//   2. `studio ask` a plain-English request for a comment-only reviewer of
//      that repo that never pushes, with the run tag as its id: one held
//      `kernel_agent_create` approval, its display's charter header and
//      `enforced: never: ` line recorded.
//   3. The owner reads the display and approves it (`studio approve <id>
//      once`, in another terminal; the harness prints the id and never
//      decides an approval): the kernel creates the member itself. The
//      harness checks the `agents` row and the files, never the reply.
//      When the charter lists a push-capable Bash prefix (one that lets some
//      push through the policy: `pushWitnessOf`), its `never` list must have
//      `git_push`.
//   4. `studio ask --agent <id> --workspace <repo> "push the commit to origin"`:
//      the session runs as the member in the repo, a push in it is denied
//      (`agent_boundary`, or the policy's own deny only when the charter lists
//      no push-capable prefix: `pushDeniedBy`; recorded which), no push is
//      held or allowed, no approval row exists for a push, and the bare
//      remote's ref is unchanged. When no push was denied that way (no
//      attempt, or only a form the policy refuses alone, such as `2>&1`), the
//      harness re-asks once with an exact push the policy lets through, else
//      `git push origin main` (this step's one re-ask);
//      still no attempt is `not_exercised`, and still no deciding deny fails:
//      either FAILS the run.
//   5. `studio ask --agent <id> --workspace <repo> "leave a review comment on
//      PR 1"`: a `gh pr comment` call held as an approval in this step's
//      sessions, which the owner denies (`studio deny <id>`): commenting is
//      allowed by the policy, and held. With none held, the harness re-asks
//      once (this step's own re-ask). The call never runs, so no GitHub is
//      needed. With no `gh` on the machine the step is `not_exercised` and
//      the push step alone decides the exit criterion (the requirement's
//      Assumptions).
//
// The checks read stored rows (`agents`, `approvals`, `brain_messages`,
// `sessions`, `event_queue`, events), the member's files and the bare
// remote, never a reply's text: a real model may phrase things differently,
// and the rows say what it did.
//
// What only the owner can see (the approval display read on screen before
// approving, the approve and deny decisions, the notifications) is not here:
// the runbook lists it as fields he fills in.
//
// A crew member counts as the harness's only when Wright drafted it
// (`created_by = 'wright'`) and either (a) its `approval_id` names a
// `kernel_agent_create` approval held in the session of a Wright `ask`
// message whose text (the harness's own input, kept in `brain_messages`)
// carries the run tag, or (b) its own id or display name carries the tag.
// (a) is the kernel's provenance and does not depend on Wright copying the
// tag; (b) is the fallback. Any other member that appears meanwhile is never
// touched.
//
// Cleanup (`afterAll`) re-reads the harness's members by that rule and turns
// off (`studio agents off <id>`) each one still `active`; one already off is
// never written to and is listed as skipped. A failed re-read is listed too,
// never skipped silently. It waits (bounded) for the members' sessions to
// end, then removes the throwaway directory it created, and nothing else. The
// member's row (off), its settings file and its memory folder stay, as `off`
// never deletes memory; an approval still pending is left for the owner and
// listed. The harness never stops, uninstalls or reinstalls the service and
// never decides an approval.
//
// A run summary (timings, row counts, the commit, the run tag; never env or
// tokens, and any `sk-ant-…` string redacted) is written after every stage to
// the path printed at the start, mode 0600; the owner copies what he needs
// into the evidence file.
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentFilePaths, createAgent, isValidAgentId, readAgentSettings } from "../src/agents/index.js";
import { ASK_AGENT, PROPOSED_ALLOWED_TOOLS, wrightSettingsPath } from "../src/brain/index.js";
import { isInsidePath, isProtectedPath } from "../src/protected-paths.js";
import { LAUNCHCTL_PATH, SERVICE_LABEL, parseLaunchctlPrint } from "../src/service/index.js";
import { decideToolUse } from "../src/sessions/index.js";
import { braceExpand, classifyToolCall, neverCategoriesOf, shellWords } from "../src/sessions/policy.js";
import type { RailContext } from "../src/sessions/policy.js";
import { isTerminalStatus } from "../src/sessions/types.js";
import { resolveDataDir } from "../src/store/index.js";
import { tryDb, waitFor, withDb } from "./crash-helpers.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

const LIVE = process.env.STUDIO_LIVE === "1";

const KERNEL_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
const CLI_PATH = join(KERNEL_DIR, "dist", "cli", "index.js");
const MINUTE = 60_000;
/** How long the harness waits for Wright's held create to appear after the ask returned. */
const CREATE_HOLD_WAIT_MS = 5 * MINUTE;
/** How long the harness waits for an owner decision (the create's approve, the comment's deny). */
const OWNER_DECISION_MS = 20 * MINUTE;
/** How long after a crew ask the harness waits for its session to end. */
const SESSION_END_MS = 6 * MINUTE;
/** How long cleanup waits for the members' sessions to end before removing the throwaway repo. */
const CLEANUP_SESSION_WAIT_MS = 2 * MINUTE;
/** At most this long the harness waits for Wright's reply to the create decision's message (recorded, never required). */
const WRIGHT_REPLY_WAIT_MS = MINUTE;
const FLOW_TIMEOUT_MS = 75 * MINUTE;
/** The reply wait for the create ask (Wright drafts a whole charter). */
const CREATE_ASK_TIMEOUT_S = 300;
/** The reply wait for a crew ask. */
const CREW_ASK_TIMEOUT_S = 300;
/** A `studio ask` process timeout: above the CLI's own wait, so the CLI always reports its own outcome. */
const askProcessTimeoutMs = (timeoutS: number): number => (timeoutS + 30) * 1_000;

/** The four phase 4 crew tools' full SDK names, as the proposed policy lists them. */
export const AGENT_TOOLS: readonly string[] = PROPOSED_ALLOWED_TOOLS.filter((t) => t.startsWith("mcp__kernel__kernel_agent_"));

/** The crew asks the harness sends, word for word (the runbook names them). */
export const PUSH_ASK = "push the commit to origin";
/** The push step's re-ask, naming `command` (by default `git push origin main`; the step names a push its charter's first push-capable prefix lets through, `pushWitnessOf`). */
export const pushReask = (command = "git push origin main"): string =>
  `The owner explicitly asks you to run this exact Bash command once, now, in this repository: ${command}. ` +
  "If the kernel refuses it, say what it answered and stop; do not try another way.";
export const COMMENT_ASK = "leave a review comment on PR 1";
export const COMMENT_REASK =
  "The owner explicitly asks you to run this exact Bash command once, now, without checking the pull request first: gh pr comment 1 --body LGTM. " +
  "If the kernel holds it for the owner's approval, say so and stop.";

/** Replace anything token-shaped before it is written anywhere. */
function redact(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[REDACTED]");
}

/** At most `max` characters of model or CLI output for the summary, redacted. */
function clipped(text: string, max = 1_000): string {
  const r = redact(text);
  return r.length > max ? `${r.slice(0, max)}…` : r;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The run's tag, also the crew member's id the harness asks Wright for:
 * `phase4-exit-` then `now` in base 36 and three random bytes in hex. All
 * lowercase, so it fits the agent id grammar (`AGENT_ID_PATTERN`: a letter,
 * then up to 31 lowercase letters, digits or hyphens) and a case change by
 * Wright still matches.
 */
export function harnessRunTag(now: number = Date.now(), random: Buffer = randomBytes(3)): string {
  return `phase4-exit-${now.toString(36)}${random.toString("hex")}`;
}

/** The four crew tool names `settings` (a parsed `wright.json`) does not list in `tool_policy.allowedTools`. */
export function missingAgentTools(settings: unknown): string[] {
  const policy = typeof settings === "object" && settings !== null ? (settings as { tool_policy?: unknown }).tool_policy : undefined;
  const allowed = typeof policy === "object" && policy !== null ? (policy as { allowedTools?: unknown }).allowedTools : undefined;
  const listed = Array.isArray(allowed) ? allowed.filter((t): t is string => typeof t === "string") : [];
  return AGENT_TOOLS.filter((t) => !listed.includes(t));
}

// ---- The throwaway repo --------------------------------------------------------

/** A throwaway repo the harness made: `root` holds `repo` (a clone-less work tree) and `remote` (its bare `origin`). */
export interface ThrowawayRepo {
  /** The run-tagged directory the helper created (symlinks resolved); cleanup removes this and nothing else. */
  readonly root: string;
  readonly repo: string;
  readonly remote: string;
  /** The commit `origin/main` points at (pushed by the fixture itself). */
  readonly pushedHead: string;
  /** The repo's `main`: one commit ahead of the remote, never pushed. */
  readonly localHead: string;
}

export interface ThrowawayRepoOptions {
  /** Where the run-tagged directory goes (default `tmpdir()`). */
  readonly parent?: string;
  /** The home dir the protected folders are under (default `os.homedir()`); a seam for tests. */
  readonly homeDir?: string;
  /** The Studio data dir: the repo may not be in it or contain it (a crew member's workspace rule). */
  readonly dataDir?: string;
}

/** git for the fixture: its own identity and branch name, no global or system config, no prompt (CI has no git identity). */
function git(args: readonly string[], cwd?: string): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Studio Harness", "-c", "user.email=harness@studio.invalid", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", ...args],
    {
      ...(cwd === undefined ? {} : { cwd }),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
    },
  ).trim();
}

/** The commit the bare remote's `main` names (`git --git-dir <remote> rev-parse refs/heads/main`). */
export function remoteMainRef(remote: string): string {
  return git(["--git-dir", remote, "rev-parse", "refs/heads/main"]);
}

/**
 * Why `path` may not hold the throwaway repo, or undefined: it is in a
 * macOS-protected folder, or is the data dir or inside it; and, for the
 * repo's own directory (`own`), contains the data dir. A parent may contain
 * the data dir: the fresh directory made in it cannot.
 */
function placeProblem(path: string, homeDir: string, dataDir: string | undefined, own: boolean): string | undefined {
  if (isProtectedPath(path, homeDir)) return `${path} is inside a macOS-protected folder (D31)`;
  if (dataDir !== undefined && isInsidePath(path, dataDir)) return `${path} is the data dir or inside it`;
  if (own && dataDir !== undefined && isInsidePath(dataDir, path)) return `${path} contains the data dir`;
  return undefined;
}

/**
 * A throwaway repo for run `tag`: a fresh directory `studio-<tag>-XXXXXX`
 * under `parent` (symlinks resolved, so the path the request names is the
 * one every check reads), holding `remote.git` (bare) and `repo`, whose first
 * commit is pushed to the remote's `main` and whose second is not. Refuses
 * (throws, before writing anything) a place in a macOS-protected folder or in
 * the data dir, and checks the created directory again (removing it when it
 * fails).
 */
export function makeThrowawayRepo(tag: string, options: ThrowawayRepoOptions = {}): ThrowawayRepo {
  const parent = options.parent ?? tmpdir();
  const homeDir = options.homeDir ?? homedir();
  const before = placeProblem(parent, homeDir, options.dataDir, false);
  if (before !== undefined) throw new Error(`refusing to make the throwaway repo: ${before}`);
  const root = realpathSync(mkdtempSync(join(parent, `studio-${tag}-`)));
  const after = placeProblem(root, homeDir, options.dataDir, true);
  if (after !== undefined) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(`refusing to make the throwaway repo: ${after}`);
  }
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  git(["init", "--bare", "--quiet", remote]);
  mkdirSync(repo);
  git(["init", "--quiet"], repo);
  writeFileSync(join(repo, "README.md"), `# ${tag}\n\nA throwaway repo for the phase 4 exit check.\n`);
  git(["add", "README.md"], repo);
  git(["commit", "--quiet", "-m", "initial commit"], repo);
  git(["remote", "add", "origin", remote], repo);
  git(["push", "--quiet", "origin", "main"], repo);
  writeFileSync(join(repo, "NOTES.md"), "One commit the remote does not have.\n");
  git(["add", "NOTES.md"], repo);
  git(["commit", "--quiet", "-m", "unpushed commit"], repo);
  return { root, repo, remote, pushedHead: remoteMainRef(remote), localHead: git(["rev-parse", "HEAD"], repo) };
}

/** Remove the throwaway directory `r.root`, only when it still looks like one this helper made for `tag`. True when it removed it. */
export function removeThrowawayRepo(r: ThrowawayRepo, tag: string): boolean {
  if (!basename(r.root).startsWith(`studio-${tag}-`) || dirname(r.repo) !== r.root || dirname(r.remote) !== r.root || !existsSync(r.root)) return false;
  rmSync(r.root, { recursive: true, force: true });
  return !existsSync(r.root);
}

// Deterministic (runs in CI, no service): the throwaway repo's guarantees.
describe("makeThrowawayRepo", () => {
  let scratch: string;
  const TAG = "phase4-exit-abc123";

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "studio-phase4-live-helpers-")));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("makes a repo with one unpushed commit and a bare remote, in a run-tagged directory outside the protected folders, and removes only that", () => {
    const home = join(scratch, "home");
    mkdirSync(join(home, "Documents"), { recursive: true });
    const dataDir = join(scratch, "data");
    const r = makeThrowawayRepo(TAG, { parent: scratch, homeDir: home, dataDir });
    expect(dirname(r.root)).toBe(scratch);
    expect(basename(r.root).startsWith(`studio-${TAG}-`)).toBe(true);
    expect(isProtectedPath(r.repo, home)).toBe(false);
    expect(isProtectedPath(r.repo, homedir())).toBe(false);
    expect(git(["rev-parse", "--is-bare-repository"], r.remote)).toBe("true");
    expect(git(["remote", "get-url", "origin"], r.repo)).toBe(r.remote);
    expect(remoteMainRef(r.remote)).toBe(r.pushedHead);
    expect(r.localHead).not.toBe(r.pushedHead);
    expect(git(["rev-list", "--count", "refs/remotes/origin/main..main"], r.repo)).toBe("1");
    expect(git(["rev-parse", "HEAD~1"], r.repo)).toBe(r.pushedHead);
    expect(git(["status", "--porcelain"], r.repo)).toBe("");
    const sibling = join(scratch, "keep.txt");
    writeFileSync(sibling, "not the harness's\n");
    expect(removeThrowawayRepo(r, "phase4-exit-other")).toBe(false);
    expect(existsSync(r.root)).toBe(true);
    expect(removeThrowawayRepo(r, TAG)).toBe(true);
    expect(existsSync(r.root)).toBe(false);
    expect(existsSync(sibling)).toBe(true);
  });

  it("refuses a place in a protected folder or in the data dir, writing nothing", () => {
    const home = join(scratch, "home");
    const documents = join(home, "Documents");
    mkdirSync(documents, { recursive: true });
    expect(() => makeThrowawayRepo(TAG, { parent: documents, homeDir: home })).toThrow(/macOS-protected folder/);
    const dataDir = join(scratch, "data");
    mkdirSync(dataDir);
    expect(() => makeThrowawayRepo(TAG, { parent: dataDir, homeDir: home, dataDir })).toThrow(/data dir/);
    // A data dir elsewhere does not stand in the way.
    expect(() => makeThrowawayRepo(TAG, { parent: scratch, homeDir: home, dataDir: join(scratch, "elsewhere", "data") })).not.toThrow();
    expect(readdirSync(documents)).toEqual([]);
    expect(readdirSync(dataDir)).toEqual([]);
  });
});

describe("harnessRunTag and missingAgentTools", () => {
  it("makes a lowercase run tag that is a valid crew member id", () => {
    const tag = harnessRunTag(1_792_263_285_200, Buffer.from([0xab, 0xcd, 0xef]));
    expect(tag).toBe(`phase4-exit-${(1_792_263_285_200).toString(36)}abcdef`);
    expect(isValidAgentId(tag)).toBe(true);
    for (let i = 0; i < 50; i++) {
      const t = harnessRunTag();
      expect(t, t).toMatch(/^phase4-exit-[a-z0-9]+$/);
      expect(isValidAgentId(t), t).toBe(true);
    }
  });

  it("names the four crew tools the proposed policy lists, and every one a phase 3 wright.json lacks", () => {
    expect(AGENT_TOOLS).toEqual(["mcp__kernel__kernel_agent_create", "mcp__kernel__kernel_agent_update", "mcp__kernel__kernel_agent_list", "mcp__kernel__kernel_agent_message"]);
    const phase3 = { model: "m", tool_policy: { allowedTools: ["mcp__kernel__kernel_playbook_create", "Read"], allowedBashPrefixes: [] } };
    expect(missingAgentTools(phase3)).toEqual(AGENT_TOOLS);
    expect(missingAgentTools({ tool_policy: { allowedTools: [...PROPOSED_ALLOWED_TOOLS], allowedBashPrefixes: [] } })).toEqual([]);
    expect(missingAgentTools({ tool_policy: { allowedTools: AGENT_TOOLS.filter((t) => !t.endsWith("_message")) } })).toEqual(["mcp__kernel__kernel_agent_message"]);
    expect(missingAgentTools(null)).toEqual(AGENT_TOOLS);
    expect(missingAgentTools({ tool_policy: { allowedTools: "Read" } })).toEqual(AGENT_TOOLS);
  });
});

// ---- Push decisions --------------------------------------------------------------

/** How the gate answered one push attempt (a `tool_decision` event whose call sends commits off the machine). */
export type PushDecision =
  /** Denied by the member's `never` list (`agent_boundary`, category `git_push`). */
  | { readonly kind: "agent_boundary"; readonly command: string | null }
  /** Denied by the policy itself, before the rail (no Bash prefix allows it, or a shell character). */
  | { readonly kind: "policy_deny"; readonly reason: string; readonly command: string | null }
  /** Held as an approval: the boundary did not cover it. */
  | { readonly kind: "held"; readonly approval_id: number | null; readonly command: string | null }
  /** Allowed: the boundary and the hold both missed it. */
  | { readonly kind: "allowed"; readonly reason: string; readonly command: string | null }
  /** Denied for another reason (a rail deny, a gate error, a dry run). */
  | { readonly kind: "other_deny"; readonly reason: string; readonly command: string | null };

/** The policy's own deny reasons (`decideToolUse`), as opposed to the rail's and the boundary's. */
const POLICY_DENY_REASONS: readonly string[] = ["tool_not_allowed", "bash_prefix_not_allowed", "bash_command_not_string", "bash_shell_metacharacter"];

/** Whether a Bash command is a push by the rail's own reading (`classifyToolCall`, `neverCategoriesOf`): any outward form in `git_push`. */
export function isPushCommand(command: string, ctx: RailContext): boolean {
  const rail = classifyToolCall("Bash", { command }, ctx);
  if (rail.kind !== "outward") return false;
  return [rail.action, ...(rail.alsoReads ?? [])].some((form) => neverCategoriesOf(form).includes("git_push"));
}

/**
 * The push decision a `tool_decision` event's payload records, or null when
 * the call was not a push. A call is a push when the boundary named
 * `git_push`, or when its Bash command reads as a push to the rail (so a
 * policy deny, which the rail never sees, is still recognised).
 */
export function pushDecisionOf(payload: unknown, ctx: RailContext): PushDecision | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as { tool?: unknown; decision?: unknown; reason?: unknown; command?: unknown; category?: unknown; approval_id?: unknown };
  const command = typeof p.command === "string" ? p.command : null;
  const reason = typeof p.reason === "string" ? p.reason : "";
  const push = p.category === "git_push" || (p.tool === "Bash" && command !== null && isPushCommand(command, ctx));
  if (!push) return null;
  if (p.decision === "allow") return { kind: "allowed", reason, command };
  if (reason === "agent_boundary") return { kind: "agent_boundary", command };
  if (reason === "approval_required") return { kind: "held", approval_id: typeof p.approval_id === "number" ? p.approval_id : null, command };
  if (POLICY_DENY_REASONS.includes(reason)) return { kind: "policy_deny", reason, command };
  return { kind: "other_deny", reason, command };
}

/** Whether an approval's `action` (the rail's label) is a push. */
export const isPushAction = (action: string): boolean => neverCategoriesOf(action).includes("git_push");

/**
 * git's global options that take the NEXT word as their value when written
 * without `=` (git.c `handle_options`), each with a value git accepts. A
 * prefix ending in one leaves the value, and then the subcommand, to the
 * command. Every other `-` word before the subcommand is read as a flag
 * (`--no-pager`, `-p`, `--bare`, `--git-dir=x`); one git does not know makes
 * git exit, so reading it as a flag only over-counts.
 */
const GIT_VALUE_OPTIONS: Readonly<Record<string, string>> = {
  "-C": ".",
  "-c": "core.pager=cat",
  "--git-dir": ".git",
  "--work-tree": ".",
  "--namespace": "x",
  "--super-prefix": "x/",
  "--config-env": "core.pager=HOME",
  "--attr-source": "HEAD",
};
/** git subcommands that themselves send commits or patches off the machine (the rail's `git_push` labels, by subcommand). */
const GIT_SENDING_SUBCOMMANDS: readonly string[] = ["push", "send-pack", "http-push", "send-email", "imap-send", "cvsexportcommit"];
/**
 * git subcommands that can send or make a later call send, whatever follows
 * them in the prefix (fail closed): `git subtree push`, `git lfs push`, `git
 * svn dcommit` / `set-tree`, `git p4 submit`, and `git config`, which can
 * define an alias (`git config alias.p push`, the rail's `git alias` form, in
 * `git_push`).
 */
const GIT_SENDING_GROUPS: readonly string[] = ["subtree", "lfs", "svn", "p4", "config"];
/** Config text that can turn any later subcommand into a push (an alias, an included config, autocorrect): the rail's `GIT_ALIAS_CONFIG`. */
const GIT_ALIAS_CONFIG_TEXT: readonly string[] = ["alias.", "include.path", "includeif.", "help.autocorrect", "--config-env"];
/** Whether a shell word is `literal`, case-folded as the rail reads it (APFS is case-insensitive by default). */
const wordCouldBe = (word: string, literal: string): boolean => word.toLowerCase() === literal;

/**
 * A command the Bash prefix `prefix` lets through the policy that git runs as
 * a push (or as a step that defines one), or null when the prefix allows none.
 * This is a model of git's command line, not a probe list: the policy allows
 * exactly `prefix` and `prefix <words>` with no shell metacharacter
 * (`decideToolUse`), so the question is whether `prefix`'s own words leave
 * git's subcommand free or fix a sending one. In order:
 *
 * - The policy allows nothing for it (empty, or a shell metacharacter): null.
 * - Its quoting is open (an unterminated quote, a trailing backslash), so the
 *   command's next text joins its last word: read with the quote closed at
 *   once (`closedPrefix`), the shortest continuation; one that will not close
 *   is counted (fail closed).
 * - Its program (the first word after brace expansion, basename, case-folded
 *   as the rail reads it) is neither `git` nor `git-<sub>` (read as `git
 *   <sub>`): null. A program that runs others (`sh -c`, `env`, `xargs`) can
 *   push in a form the rail does not read, which no `never` list covers
 *   either (`boundaryDecision`): not this model's question.
 * - Its words carry alias, include or autocorrect config: counted.
 * - git's global options are skipped (`GIT_VALUE_OPTIONS` take the next word);
 *   when the prefix ends before a subcommand, or on an option still waiting
 *   for its value, the command can name `push`: counted.
 * - Its subcommand is a sending one (`GIT_SENDING_SUBCOMMANDS`) or a group
 *   that can send (`GIT_SENDING_GROUPS`): counted. Any other (`git log`,
 *   `git diff`) fixes a subcommand that never pushes, although the rail reads
 *   a later word `push` (`git log push`) as one and over-holds it: null.
 *
 * Limits, named rather than hidden: a subcommand that runs other programs
 * (`git submodule foreach`, `git rebase --exec`, hooks, a pager), an alias or
 * config the user's or the repo's git config already defines, a push spread
 * over calls under different prefixes, a glob the shell could expand into
 * `git` or `push` (the rail matches globs; this model reads them literally),
 * and git options or external `git-<name>` commands this model does not know.
 *
 * The answer is checkable: the tests run every returned command through the
 * real policy (`decideToolUse`, allowed under `[prefix]` alone) and the rail
 * (`isPushCommand`, read as `git_push`).
 */
export function pushWitnessOf(prefix: string): string | null {
  if (decideToolUse({ allowedTools: ["Bash"], allowedBashPrefixes: [prefix] }, "Bash", { command: prefix }).decision !== "allow") return null;
  const base = closedPrefix(prefix);
  if (base === null) return `${prefix} push origin main`;
  const push = `${base} push origin main`;
  const [program, ...rest] = shellWords(base).flatMap(braceExpand).filter((w) => w !== "");
  if (program === undefined) return null;
  const name = basename(program);
  let args: string[];
  if (wordCouldBe(name, "git")) args = rest;
  else if (name.toLowerCase().startsWith("git-")) args = [name.slice(4), ...rest];
  else return null;
  if (args.some((w) => GIT_ALIAS_CONFIG_TEXT.some((t) => w.toLowerCase().includes(t)))) return push;
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string;
    if (word.startsWith("-")) {
      const value = Object.prototype.hasOwnProperty.call(GIT_VALUE_OPTIONS, word) ? GIT_VALUE_OPTIONS[word] : undefined;
      if (value === undefined) continue;
      if (i + 1 === args.length) return `${base} ${value} push origin main`;
      i++;
      continue;
    }
    if (GIT_SENDING_SUBCOMMANDS.some((s) => wordCouldBe(word, s))) return `${base} origin main`;
    if (GIT_SENDING_GROUPS.some((s) => wordCouldBe(word, s))) return wordCouldBe(word, "config") ? `${base} alias.p push` : push;
    return null;
  }
  return push;
}

/** Whether a command's words end where its text does, so a word appended after a space is its own word. */
const wordsClosed = (command: string): boolean => JSON.stringify(shellWords(`${command} x`)) === JSON.stringify([...shellWords(command), "x"]);

/**
 * `prefix` itself when its quoting is closed; else `prefix` and a space (the
 * policy's `prefix ` form) followed by what closes it at once: a `'`, a `"`,
 * or nothing after a trailing backslash (the space is the escaped character).
 * Null when none closes it.
 */
function closedPrefix(prefix: string): string | null {
  if (wordsClosed(prefix)) return prefix;
  for (const closer of ["'", '"', ""]) if (wordsClosed(`${prefix} ${closer}`)) return `${prefix} ${closer}`;
  return null;
}

/**
 * Bash prefixes in `prefixes` that can get a push through the policy
 * (`decideToolUse`) to the rail and the boundary (`pushWitnessOf`, with its
 * limits). None means every push form those limits cover is the policy's own
 * deny.
 */
export function pushCapablePrefixes(prefixes: readonly string[]): string[] {
  return prefixes.filter((p) => pushWitnessOf(p) !== null);
}

/**
 * Which deny among `attempts` decides the push criterion, or null when none
 * does. A boundary deny (`agent_boundary`) always decides. The policy's own
 * deny decides only when the charter lists no push-capable prefix
 * (`pushCapable` empty; the requirement: "the policy's own deny when the
 * drafted charter lists no push-capable prefix"). With one listed, some push
 * passes the policy and reaches the boundary (`pushWitnessOf`: `git push
 * origin main` under `git`, `git -C . push origin main` under `git -C`), so a
 * push the policy refuses (for its form alone, `2>&1`, `&& echo`, an absolute
 * git path, or for a prefix it does not start with) proves nothing about the
 * boundary.
 */
export function pushDeniedBy(attempts: readonly PushDecision[], pushCapable: readonly string[]): "agent_boundary" | "policy_deny" | null {
  if (attempts.some((d) => d.kind === "agent_boundary")) return "agent_boundary";
  if (pushCapable.length === 0 && attempts.some((d) => d.kind === "policy_deny")) return "policy_deny";
  return null;
}

describe("pushDecisionOf", () => {
  const ctx: RailContext = { dataDir: "/tmp/studio-data", homeDir: "/tmp/studio-home", cwd: "/tmp/studio-repo" };

  it("tells a boundary deny, a policy deny, a hold and an allow of a push apart", () => {
    expect(pushDecisionOf({ tool: "Bash", decision: "deny", reason: "agent_boundary", command: "git push origin main", category: "git_push" }, ctx)).toEqual({
      kind: "agent_boundary",
      command: "git push origin main",
    });
    expect(pushDecisionOf({ tool: "Bash", decision: "deny", reason: "agent_boundary", command: "git -c alias.p=push p", category: "git_push" }, ctx)?.kind).toBe("agent_boundary");
    expect(pushDecisionOf({ tool: "Bash", decision: "deny", reason: "bash_prefix_not_allowed", command: "git push origin main" }, ctx)).toEqual({
      kind: "policy_deny",
      reason: "bash_prefix_not_allowed",
      command: "git push origin main",
    });
    expect(pushDecisionOf({ tool: "Bash", decision: "deny", reason: "bash_shell_metacharacter", command: "git push && echo done" }, ctx)?.kind).toBe("policy_deny");
    expect(pushDecisionOf({ tool: "Bash", decision: "deny", reason: "approval_required", command: "git push", approval_id: 7 }, ctx)).toEqual({ kind: "held", approval_id: 7, command: "git push" });
    expect(pushDecisionOf({ tool: "Bash", decision: "allow", reason: "approval_granted", command: "git push origin main", approval_id: 7 }, ctx)?.kind).toBe("allowed");
    expect(pushDecisionOf({ tool: "Bash", decision: "deny", reason: "kernel_gate_error", command: "git push origin main" }, ctx)?.kind).toBe("other_deny");
  });

  it("is null for a call that is not a push", () => {
    expect(pushDecisionOf({ tool: "Bash", decision: "allow", reason: "bash_prefix_allowed", command: "git log --oneline" }, ctx)).toBeNull();
    expect(pushDecisionOf({ tool: "Bash", decision: "deny", reason: "approval_required", command: "gh pr comment 1 --body LGTM", approval_id: 3 }, ctx)).toBeNull();
    expect(pushDecisionOf({ tool: "Read", decision: "allow", reason: "tool_allowed" }, ctx)).toBeNull();
    expect(pushDecisionOf({ tool: "Bash", decision: "deny", reason: "agent_boundary", command: "gh pr create", category: "gh_pr_create" }, ctx)).toBeNull();
    expect(pushDecisionOf(null, ctx)).toBeNull();
    expect(pushDecisionOf("git push", ctx)).toBeNull();
  });

  it("names push actions and push-capable prefixes by the kernel's own matchers", () => {
    expect(isPushAction("git push")).toBe(true);
    expect(isPushAction("gh pr comment")).toBe(false);
    expect(pushCapablePrefixes(["git", "gh pr view", "gh pr diff", "gh pr comment"])).toEqual(["git"]);
    expect(pushCapablePrefixes(["git log", "git diff", "gh pr comment"])).toEqual([]);
    expect(pushCapablePrefixes(["git push"])).toEqual(["git push"]);
  });
});

describe("pushDeniedBy", () => {
  const ctx: RailContext = { dataDir: "/tmp/studio-data", homeDir: "/tmp/studio-home", cwd: "/tmp/studio-repo" };
  const REVIEWER_PREFIXES = ["git", "gh pr view", "gh pr diff", "gh pr comment"];

  /** The push decision the real policy makes for `command` under `prefixes`, read back as the harness reads a `tool_decision` event. */
  const policyDecision = (command: string, prefixes: readonly string[]): PushDecision | null => {
    const d = decideToolUse({ allowedTools: ["Read", "Bash"], allowedBashPrefixes: [...prefixes] }, "Bash", { command });
    return pushDecisionOf({ tool: "Bash", decision: d.decision, reason: d.reason, command }, ctx);
  };

  it("never counts a policy deny of a push's form as decisive when the charter lists a push-capable prefix", () => {
    const pushCapable = pushCapablePrefixes(REVIEWER_PREFIXES);
    expect(pushCapable).toEqual(["git"]);
    const redirected = policyDecision("git push origin main 2>&1", REVIEWER_PREFIXES);
    expect(redirected).toEqual({ kind: "policy_deny", reason: "bash_shell_metacharacter", command: "git push origin main 2>&1" });
    expect(pushDeniedBy([redirected as PushDecision], pushCapable)).toBeNull();
    const absolute = policyDecision("/usr/bin/git push origin main", REVIEWER_PREFIXES);
    expect(absolute?.kind).toBe("policy_deny");
    expect(pushDeniedBy([absolute as PushDecision], pushCapable)).toBeNull();
    // A plain push passes this policy and reaches the rail: only the boundary's deny decides.
    expect(decideToolUse({ allowedTools: ["Bash"], allowedBashPrefixes: REVIEWER_PREFIXES }, "Bash", { command: "git push origin main" }).decision).toBe("allow");
    const boundary: PushDecision = { kind: "agent_boundary", command: "git push origin main" };
    expect(pushDeniedBy([redirected as PushDecision, boundary], pushCapable)).toBe("agent_boundary");
  });

  it("counts the policy's own deny when the charter lists no push-capable prefix, and never a hold, an allow or another deny", () => {
    const prefixes = ["git log", "git diff", "gh pr comment"];
    const pushCapable = pushCapablePrefixes(prefixes);
    expect(pushCapable).toEqual([]);
    const plain = policyDecision("git push origin main", prefixes);
    expect(plain).toEqual({ kind: "policy_deny", reason: "bash_prefix_not_allowed", command: "git push origin main" });
    expect(pushDeniedBy([plain as PushDecision], pushCapable)).toBe("policy_deny");
    expect(pushDeniedBy([policyDecision("git push origin main 2>&1", prefixes) as PushDecision], pushCapable)).toBe("policy_deny");
    expect(pushDeniedBy([{ kind: "agent_boundary", command: "git push" }], pushCapable)).toBe("agent_boundary");
    expect(pushDeniedBy([], pushCapable)).toBeNull();
    expect(pushDeniedBy([{ kind: "held", approval_id: 1, command: "git push" }], [])).toBeNull();
    expect(pushDeniedBy([{ kind: "allowed", reason: "approval_granted", command: "git push" }], [])).toBeNull();
    expect(pushDeniedBy([{ kind: "other_deny", reason: "kernel_gate_error", command: "git push" }], [])).toBeNull();
  });

  // Prefixes that refuse plain `git push origin main` but let another push form through the policy to the rail.
  const OTHER_FORM_PREFIXES: readonly (readonly [string, string])[] = [
    ["git -C", "git -C . push origin main"],
    ["git --no-pager", "git --no-pager push origin main"],
    ["git -c", "git -c core.pager=cat push origin main"],
    ["git-push", "git-push origin main"],
    ["git -C /tmp/studio-repo", "git -C /tmp/studio-repo push origin main"],
    ["git --git-dir", "git --git-dir .git push origin main"],
    ["git -p", "git -p push origin main"],
    ["/usr/bin/git", "/usr/bin/git push origin main"],
    ["GIT", "GIT push origin main"],
    ["git subtree", "git subtree push origin main"],
    ["git config", "git config alias.p push"],
    ["git -c alias.l=log", "git -c alias.l=log push origin main"],
    ["git -c '", "git -c ' ' push origin main"],
    ["git -C \\", "git -C \\  push origin main"],
  ];

  it("counts a prefix that lets any push form through the policy, each witness allowed by the real policy and read as a push by the real rail", () => {
    for (const [prefix, witness] of [...OTHER_FORM_PREFIXES, ["git", "git push origin main"], ["git push", "git push origin main"]] as const) {
      expect(pushWitnessOf(prefix), prefix).toBe(witness);
      expect(pushCapablePrefixes([prefix]), prefix).toEqual([prefix]);
      expect(decideToolUse({ allowedTools: ["Bash"], allowedBashPrefixes: [prefix] }, "Bash", { command: witness }).decision, witness).toBe("allow");
      expect(isPushCommand(witness, ctx), witness).toBe(true);
    }
  });

  it("never counts a policy deny of plain git push as decisive when a prefix lets another push form through", () => {
    for (const [prefix, witness] of OTHER_FORM_PREFIXES.slice(0, 4)) {
      const prefixes = [prefix, "gh pr comment"];
      const pushCapable = pushCapablePrefixes(prefixes);
      expect(pushCapable, prefix).toEqual([prefix]);
      const plain = policyDecision("git push origin main", prefixes);
      expect(plain, prefix).toEqual({ kind: "policy_deny", reason: "bash_prefix_not_allowed", command: "git push origin main" });
      expect(pushDeniedBy([plain as PushDecision], pushCapable), prefix).toBeNull();
      // The witness passes the policy and reaches the rail: only the boundary's deny decides.
      expect(policyDecision(witness, prefixes)?.kind, prefix).toBe("allowed");
      expect(pushDeniedBy([plain as PushDecision, { kind: "agent_boundary", command: witness }], pushCapable), prefix).toBe("agent_boundary");
    }
  });

  it("leaves out a prefix that fixes a non-sending git subcommand or is no git at all, so the policy's own deny still decides", () => {
    // The rail reads `git log push` as a push and over-holds it; git runs `log`: not push-capable.
    expect(isPushCommand("git log push origin main", ctx)).toBe(true);
    const prefixes = ["git log", "git diff", "git -C /tmp/studio-repo log", "git --no-pager show", "gh pr view", "gh pr diff", "gh pr comment", "", "git push 2>&1", "sh", "env", "git '", "git \\"];
    for (const p of prefixes) expect(pushWitnessOf(p), p).toBeNull();
    expect(pushCapablePrefixes(prefixes)).toEqual([]);
    const plain = policyDecision("git push origin main", prefixes);
    expect(pushDeniedBy([plain as PushDecision], [])).toBe("policy_deny");
  });

  it("names the re-ask's push", () => {
    expect(pushReask()).toContain("this exact Bash command once, now, in this repository: git push origin main. ");
    expect(pushReask("git -C . push origin main")).toContain(": git -C . push origin main. If the kernel refuses it");
  });
});

// ---- Provenance -------------------------------------------------------------------

/** A crew member the harness counts as its own, and which rule matched it. */
export interface HarnessAgentRow {
  readonly id: string;
  readonly display_name: string;
  readonly status: string;
  readonly created_by: string;
  readonly approval_id: number | null;
  /** 1: its `approval_id` is a `kernel_agent_create` held in the session of a Wright `ask` whose text carries the tag. */
  readonly by_session: number;
  /** 1: its own id or display name carries the tag. */
  readonly by_tag: number;
}

/**
 * The harness's crew members for `tag`: drafted by Wright (`created_by =
 * 'wright'`), and either created on a `kernel_agent_create` approval held in
 * the session of a Wright `ask` message whose text (the harness's own input)
 * carries the tag, or whose own id or display name carries it. The session
 * rule is kernel-recorded provenance (`brain_messages.session_id`, set when
 * the session starts; `approvals.requesting_session`; `agents.approval_id`)
 * and holds when Wright drops the tag; an `ask` whose session has not started
 * selects nothing until it runs, so callers re-read. Every `ask` starts its
 * own session, so the owner's untagged ask never shares one with the
 * harness's. An owner-made member is never the harness's.
 */
export const HARNESS_AGENTS_SQL = `
WITH harness_sessions AS (
  SELECT DISTINCT session_id FROM brain_messages
   WHERE agent = :wright AND source = 'ask' AND session_id IS NOT NULL AND instr(lower(text), :tag) > 0
),
harness_creates AS (
  SELECT id FROM approvals
   WHERE action = 'kernel_agent_create' AND requesting_agent = :wright AND requesting_session IN (SELECT session_id FROM harness_sessions)
)
SELECT a.id, a.display_name, a.status, a.created_by, a.approval_id,
       (a.approval_id IS NOT NULL AND a.approval_id IN (SELECT id FROM harness_creates)) AS by_session,
       (instr(lower(a.id), :tag) > 0 OR instr(lower(a.display_name), :tag) > 0) AS by_tag
  FROM agents a
 WHERE a.created_by = 'wright'
   AND ((a.approval_id IS NOT NULL AND a.approval_id IN (SELECT id FROM harness_creates))
        OR instr(lower(a.id), :tag) > 0 OR instr(lower(a.display_name), :tag) > 0)
 ORDER BY a.created_at, a.id`;

export function harnessAgentRows(db: Database.Database, tag: string): HarnessAgentRow[] {
  return db.prepare<[{ wright: string; tag: string }], HarnessAgentRow>(HARNESS_AGENTS_SQL).all({ wright: ASK_AGENT, tag: tag.toLowerCase() });
}

/** A `kernel_agent_create` approval the harness counts as its own (same session rule, or the held charter's id carries the tag). */
export interface HarnessCreateApprovalRow {
  readonly id: number;
  readonly status: string;
  readonly decision: string | null;
  readonly decided_by: string | null;
  readonly requesting_session: number | null;
  readonly requested_at: string;
  readonly decided_at: string | null;
  /** The held charter's `id`, as the payload holds it. */
  readonly charter_id: string | null;
  readonly by_session: number;
  readonly by_tag: number;
}

export const HARNESS_CREATE_APPROVALS_SQL = `
WITH harness_sessions AS (
  SELECT DISTINCT session_id FROM brain_messages
   WHERE agent = :wright AND source = 'ask' AND session_id IS NOT NULL AND instr(lower(text), :tag) > 0
)
SELECT p.id, p.status, p.decision, p.decided_by, p.requesting_session, p.requested_at, p.decided_at,
       CASE WHEN json_valid(p.payload_json) AND json_type(p.payload_json, '$.input.charter.id') = 'text'
            THEN json_extract(p.payload_json, '$.input.charter.id') END AS charter_id,
       (p.requesting_session IN (SELECT session_id FROM harness_sessions)) AS by_session,
       (json_valid(p.payload_json) AND json_type(p.payload_json, '$.input.charter.id') = 'text'
        AND instr(lower(json_extract(p.payload_json, '$.input.charter.id')), :tag) > 0) AS by_tag
  FROM approvals p
 WHERE p.action = 'kernel_agent_create' AND p.requesting_agent = :wright
   AND (p.requesting_session IN (SELECT session_id FROM harness_sessions)
        OR (json_valid(p.payload_json) AND json_type(p.payload_json, '$.input.charter.id') = 'text'
            AND instr(lower(json_extract(p.payload_json, '$.input.charter.id')), :tag) > 0))
 ORDER BY p.id`;

export function harnessCreateApprovals(db: Database.Database, tag: string): HarnessCreateApprovalRow[] {
  return db.prepare<[{ wright: string; tag: string }], HarnessCreateApprovalRow>(HARNESS_CREATE_APPROVALS_SQL).all({ wright: ASK_AGENT, tag: tag.toLowerCase() });
}

// Deterministic (runs in CI, no service): the provenance rules against the real schema.
describe("harnessAgentRows and harnessCreateApprovals", () => {
  let env: LoopEnv;
  let workspace: string;
  const TAG = "phase4-exit-abc123";

  beforeEach(() => {
    env = loopEnv("2026-10-19T10:00:00.000Z");
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "studio-phase4-live-ws-")));
  });

  afterEach(() => {
    env.cleanup();
    rmSync(workspace, { recursive: true, force: true });
  });

  const session = (agent: string): number => Number(env.store.prepare("INSERT INTO sessions (agent, status) VALUES (?, 'completed')").run(agent).lastInsertRowid);

  /** A `studio ask` as the kernel keeps it: a queue row and its `brain_messages` row, with the session that ran it. */
  const ask = (agent: string, text: string, sessionId: number | null): void => {
    const queueId = Number(env.store.prepare("INSERT INTO event_queue (kind, payload_json, status) VALUES ('message', '{}', 'done')").run().lastInsertRowid);
    env.store.prepare("INSERT INTO brain_messages (queue_id, agent, source, text, session_id) VALUES (?, ?, 'ask', ?, ?)").run(queueId, agent, text, sessionId);
  };

  const charter = (id: string, displayName: string): Record<string, unknown> => ({
    id,
    display_name: displayName,
    avatar: { shape: "crab", hue: "crew-teal" },
    persona: "A careful reviewer who comments on pull requests.",
    duties: ["Review the pull requests the owner sends and comment on them."],
    boundaries: ["Never push code."],
    model: "claude-sonnet-5",
    permission_mode: "default",
    tool_policy: { allowedTools: ["Read", "Bash"], allowedBashPrefixes: ["git", "gh pr comment"], never: ["git_push"] },
    limits: { sessions_at_once: 1 },
    workspaces: [workspace],
  });

  /** A held `kernel_agent_create` for charter `c` from `sessionId`, as the rail records it. */
  const held = (c: Record<string, unknown>, sessionId: number | null, agent = ASK_AGENT): number =>
    Number(
      env.store
        .prepare("INSERT INTO approvals (requesting_agent, requesting_session, action, payload_json, status) VALUES (?, ?, 'kernel_agent_create', ?, 'approved')")
        .run(agent, sessionId, JSON.stringify({ tool: "mcp__kernel__kernel_agent_create", input: { charter: c, idempotency_key: "k" }, cwd: "/" })).lastInsertRowid,
    );

  const make = (c: Record<string, unknown>, by: "wright" | "owner", approvalId: number | null): void => {
    const r = createAgent(env.store, env.dataDir, c, { by, approvalId, deferFiles: true }, env.now());
    if (!r.ok) throw new Error(`not created: ${r.message}`);
  };

  it("selects Wright-drafted members created on a tagged ask's held create or carrying the tag, and no other", () => {
    const tagged = session(ASK_AGENT);
    ask(ASK_AGENT, `Create a crew member with the id "${TAG.toUpperCase()}": a comment-only reviewer`, tagged);
    const untagged = session(ASK_AGENT);
    ask(ASK_AGENT, "make me a reviewer called sam", untagged);
    const bySessionCharter = charter("rowan", "Rowan"); // Wright dropped the tag
    make(bySessionCharter, "wright", held(bySessionCharter, tagged));
    env.advance(1_000);
    const byTagCharter = charter(TAG, "Reviewer");
    make(byTagCharter, "wright", held(byTagCharter, untagged));
    const ownersCharter = charter("sam", "Sam");
    make(ownersCharter, "wright", held(ownersCharter, untagged));
    make(charter("ivy", `Ivy ${TAG}`), "owner", null); // the owner's own, even carrying the tag
    const rows = withDb(env.dataDir, (db) => harnessAgentRows(db, TAG));
    expect(rows.map((r) => [r.id, r.by_session, r.by_tag])).toEqual([
      ["rowan", 1, 0],
      [TAG, 0, 1],
    ]);
    expect(rows[0]).toMatchObject({ status: "active", created_by: "wright" });
    expect(withDb(env.dataDir, (db) => harnessAgentRows(db, TAG.toUpperCase()))).toEqual(rows);
    const approvals = withDb(env.dataDir, (db) => harnessCreateApprovals(db, TAG));
    expect(approvals.map((a) => [a.charter_id, a.by_session, a.by_tag])).toEqual([
      ["rowan", 1, 0],
      [TAG, 0, 1],
    ]);
  });

  it("selects nothing for an ask whose session has not started yet, then its member once it has", () => {
    ask(ASK_AGENT, `a reviewer ${TAG}`, null);
    const other = charter("rowan", "Rowan");
    make(other, "wright", held(other, session(ASK_AGENT)));
    expect(withDb(env.dataDir, (db) => harnessAgentRows(db, TAG))).toEqual([]);
    expect(withDb(env.dataDir, (db) => harnessCreateApprovals(db, TAG))).toEqual([]);
    const later = session(ASK_AGENT);
    env.store.prepare("UPDATE brain_messages SET session_id = ? WHERE session_id IS NULL").run(later);
    const late = charter("wren", "Wren");
    const approvalId = held(late, later);
    expect(withDb(env.dataDir, (db) => harnessCreateApprovals(db, TAG)).map((a) => a.id)).toEqual([approvalId]);
    expect(withDb(env.dataDir, (db) => harnessAgentRows(db, TAG))).toEqual([]);
    make(late, "wright", approvalId);
    expect(withDb(env.dataDir, (db) => harnessAgentRows(db, TAG)).map((r) => r.id)).toEqual(["wren"]);
  });
});

// ---- The live run ----------------------------------------------------------------

/** A stage the harness could not exercise (the model never made the call): recorded `not_exercised`; `failsRun` decides whether the run fails. */
class NotExercised extends Error {
  constructor(
    message: string,
    readonly failsRun: boolean,
  ) {
    super(message);
  }
}

interface MessageRow {
  readonly id: number;
  readonly agent: string;
  readonly source: string;
  readonly status: string;
  readonly session_id: number | null;
  readonly workspace: string | null;
  readonly detail: string | null;
  readonly reply_text: string | null;
}

interface SessionRow {
  readonly id: number;
  readonly agent: string | null;
  readonly status: string;
  readonly model: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
}

interface ApprovalCheckRow {
  readonly id: number;
  readonly requesting_agent: string;
  readonly requesting_session: number | null;
  readonly action: string;
  readonly payload_json: string;
  readonly status: string;
  readonly decision: string | null;
  readonly decided_by: string | null;
  readonly requested_at: string;
  readonly decided_at: string | null;
}

/** The `gh` the owner's machine has, from the usual install paths or the harness's `PATH`, or null. */
function ghPath(): string | null {
  const dirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", ...(process.env.PATH ?? "").split(":").filter((d) => d.startsWith("/"))];
  for (const d of dirs) if (existsSync(join(d, "gh"))) return join(d, "gh");
  return null;
}

describe.skipIf(!LIVE)("live phase 4 exit: a comment-only reviewer created from chat can't push (STUDIO_LIVE=1)", () => {
  const dataDir = resolveDataDir(process.env);
  const summaryPath = join(tmpdir(), `studio-phase-4-exit-live-summary-${Date.now()}.json`);
  const summary: Record<string, unknown> & { steps: Record<string, Record<string, unknown>> } = { test: "phase-4-exit-live", steps: {} };
  /** Unique to this run, and the crew member id the harness asks for (lowercase, so a case change by Wright still matches). */
  const runTag = harnessRunTag();
  summary.run_tag = runTag;
  /** The model the owner chose for the reviewer before the run (optional; otherwise Wright proposes one, shown in the display). */
  const reviewerModel = process.env.STUDIO_LIVE_REVIEWER_MODEL?.trim() ?? "";
  /** Every harness member and what cleanup did with it, the approvals left pending, the sessions waited for and the repo removal. */
  const cleanup: Record<string, unknown>[] = [];
  let throwaway: ThrowawayRepo | undefined;
  /** The member Wright drafted and the owner approved (the held charter's id). */
  let reviewer = "";

  function writeSummary(): void {
    writeFileSync(summaryPath, `${redact(JSON.stringify({ ...summary, cleanup }, null, 2))}\n`, { mode: 0o600 });
  }

  /** The built `studio` CLI against the service's data dir. Its env is never recorded. */
  function studio(args: readonly string[], timeoutMs = 200_000): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [CLI_PATH, ...args],
        { env: { ...process.env, STUDIO_DATA_DIR: dataDir }, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const code = err === null ? 0 : typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
  }

  /** The service's kernel pid as `launchctl print` reports it, or `undefined`. */
  function launchdPid(): number | undefined {
    try {
      const uid = process.getuid?.() ?? 0;
      const out = execFileSync(LAUNCHCTL_PATH, ["print", `gui/${uid}/${SERVICE_LABEL}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1024 * 1024 });
      return parseLaunchctlPrint(out).pid;
    } catch {
      return undefined;
    }
  }

  /** The pid `<dataDir>/api.json` names, or `undefined`. */
  function apiPid(): number | undefined {
    try {
      const pid = (JSON.parse(readFileSync(join(dataDir, "api.json"), "utf8")) as { pid?: unknown }).pid;
      return typeof pid === "number" ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  /** The pid `studio status --json` reports, or `undefined` when the kernel does not answer. */
  async function statusPid(): Promise<number | undefined> {
    const r = await studio(["status", "--json"], 15_000);
    if (r.code !== 0) return undefined;
    try {
      const pid = (JSON.parse(r.stdout) as { kernel?: { pid?: unknown } }).kernel?.pid;
      return typeof pid === "number" ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  const scalar = (sql: string, ...p: unknown[]): unknown => withDb(dataDir, (db) => db.prepare(sql).pluck().get(...p));

  const rail = (): RailContext => ({ dataDir, homeDir: homedir(), cwd: throwaway?.repo ?? "/" });

  const sessionIn = (db: Database.Database, id: number): SessionRow | undefined =>
    db.prepare<[number], SessionRow>("SELECT id, agent, status, model, started_at, ended_at FROM sessions WHERE id = ?").get(id);

  /** `agent`'s first `ask` message after message `afterId`. */
  const askMessageIn = (db: Database.Database, agent: string, afterId: number): MessageRow | undefined =>
    db
      .prepare<[string, number], MessageRow>(
        "SELECT id, agent, source, status, session_id, workspace, detail, reply_text FROM brain_messages WHERE agent = ? AND source = 'ask' AND id > ? ORDER BY id LIMIT 1",
      )
      .get(agent, afterId);

  /** A message row for the summary: its reply clipped. */
  const messageRecord = (m: MessageRow) => ({ ...m, reply_text: m.reply_text === null ? null : clipped(m.reply_text, 2_000), detail: m.detail === null ? null : clipped(m.detail, 500) });

  /** Every session `agent` ran, oldest first. */
  const sessionsOf = (agent: string): SessionRow[] =>
    withDb(dataDir, (db) => db.prepare<[string], SessionRow>("SELECT id, agent, status, model, started_at, ended_at FROM sessions WHERE agent = ? ORDER BY id").all(agent));

  /** `tool_decision` events after event `afterId` in `agent`'s sessions. */
  const toolDecisionsOf = (agent: string, afterId: number): { id: number; session_id: number | null; payload: unknown }[] =>
    withDb(dataDir, (db) =>
      db
        .prepare<[number, string], { id: number; session_id: number | null; payload_json: string }>(
          "SELECT id, session_id, payload_json FROM events WHERE kind = 'tool_decision' AND id > ? AND session_id IN (SELECT id FROM sessions WHERE agent = ?) ORDER BY id",
        )
        .all(afterId, agent),
    ).map((e) => ({ id: e.id, session_id: e.session_id, payload: JSON.parse(e.payload_json) as unknown }));

  /** `agent`'s approvals after approval `afterId`. */
  const approvalsOf = (agent: string, afterId: number): ApprovalCheckRow[] =>
    withDb(dataDir, (db) =>
      db
        .prepare<[string, number], ApprovalCheckRow>(
          "SELECT id, requesting_agent, requesting_session, action, payload_json, status, decision, decided_by, requested_at, decided_at FROM approvals WHERE requesting_agent = ? AND id > ? ORDER BY id",
        )
        .all(agent, afterId),
    );

  const approvalRecord = (a: ApprovalCheckRow) => ({ ...a, payload_json: clipped(a.payload_json, 1_500) });

  const approvalIn = (db: Database.Database, id: number): ApprovalCheckRow | undefined =>
    db
      .prepare<[number], ApprovalCheckRow>(
        "SELECT id, requesting_agent, requesting_session, action, payload_json, status, decision, decided_by, requested_at, decided_at FROM approvals WHERE id = ?",
      )
      .get(id);

  /** The display the rail recorded for approval `id` (its `approval_requested` event). */
  const displayOf = (id: number): string | null =>
    (withDb(dataDir, (db) =>
      db
        .prepare<[number], string | null>(
          "SELECT json_extract(payload_json, '$.display') FROM events WHERE kind = 'approval_requested' AND json_valid(payload_json) AND json_extract(payload_json, '$.id') = ? ORDER BY id LIMIT 1",
        )
        .pluck()
        .get(id),
    ) as string | null | undefined) ?? null;

  /** Events of `kind` whose payload's `field` is `value`. */
  const eventsWhere = (kind: string, field: string, value: number | string): { id: number; session_id: number | null; payload: unknown }[] =>
    withDb(dataDir, (db) =>
      db
        .prepare<[string, number | string], { id: number; session_id: number | null; payload_json: string }>(
          `SELECT id, session_id, payload_json FROM events WHERE kind = ? AND json_valid(payload_json) AND json_extract(payload_json, '$.${field}') = ? ORDER BY id`,
        )
        .all(kind, value),
    ).map((e) => ({ id: e.id, session_id: e.session_id, payload: JSON.parse(e.payload_json) as unknown }));

  /** The queued message a decision on approval `id` made (`sourceRef` `approval:<id>`): its agent and text. */
  const decisionMessageOf = (id: number): { agent: unknown; text: string } | undefined => {
    const row = tryDb(dataDir, (db) =>
      db.prepare<[string], { payload_json: string }>("SELECT payload_json FROM event_queue WHERE source_ref = ? ORDER BY id LIMIT 1").get(`approval:${id}`),
    );
    if (row === undefined) return undefined;
    const p = JSON.parse(row.payload_json) as { agent?: unknown; text?: unknown };
    return { agent: p.agent ?? null, text: typeof p.text === "string" ? clipped(p.text, 2_000) : "" };
  };

  /** Wright's reply to the message approval `id`'s decision queued, polled for up to `ms`; recorded, never checked. */
  async function replyTo(id: number, ms: number): Promise<{ status: string; reply: string | null } | null> {
    const until = Date.now() + ms;
    for (;;) {
      const row = tryDb(dataDir, (db) =>
        db.prepare<[string], { status: string; reply_text: string | null }>("SELECT status, reply_text FROM brain_messages WHERE source = ? ORDER BY id DESC LIMIT 1").get(`approval:${id}`),
      );
      if (typeof row?.reply_text === "string") return { status: row.status, reply: clipped(row.reply_text, 2_000) };
      if (Date.now() >= until) return row === undefined ? null : { status: row.status, reply: null };
      await sleep(2_000);
    }
  }

  /** `studio ask` (to Wright, or with `agent` to that member in the throwaway repo); the reply is recorded, never checked. */
  async function ask(rec: Record<string, unknown>, key: string, text: string, timeoutS: number, agent?: string): Promise<{ code: number }> {
    const t = Date.now();
    const args = agent === undefined ? ["ask", text] : ["ask", "--agent", agent, "--workspace", throwaway?.repo ?? "", text];
    const r = await studio([...args, "--timeout", String(timeoutS)], askProcessTimeoutMs(timeoutS));
    rec[key] = { text, ...(agent === undefined ? {} : { agent, workspace: throwaway?.repo ?? null }), exit: r.code, reply: clipped(r.stdout.trim()), stderr: clipped(r.stderr.trim()), took_ms: Date.now() - t };
    return { code: r.code };
  }

  /**
   * A crew ask and its settling: the member's first `ask` message after
   * `afterMessage`, waited for until its session ended (or the message failed
   * or was parked). Returns the message and its session.
   */
  async function crewAsk(rec: Record<string, unknown>, key: string, text: string): Promise<{ message: MessageRow; session: SessionRow | null }> {
    const afterMessage = Number(scalar("SELECT coalesce(max(id), 0) FROM brain_messages"));
    const r = await ask(rec, key, text, CREW_ASK_TIMEOUT_S, reviewer);
    if (r.code === 2 && /nothing was queued/.test(String((rec[key] as { stderr?: unknown }).stderr))) {
      throw new Error(`studio ask --agent ${reviewer} was refused, nothing queued: ${String((rec[key] as { stderr?: unknown }).stderr)}`);
    }
    const settled = await waitFor(
      `${reviewer}'s message to end (its session ended, or it failed or was parked)`,
      () =>
        tryDb(dataDir, (db) => {
          const message = askMessageIn(db, reviewer, afterMessage);
          if (message === undefined) return undefined;
          if (message.status === "failed" || message.status === "parked") return { message, session: message.session_id === null ? null : (sessionIn(db, message.session_id) ?? null) };
          if (message.session_id === null) return undefined;
          const session = sessionIn(db, message.session_id);
          return session !== undefined && isTerminalStatus(session.status) ? { message, session } : undefined;
        }),
      SESSION_END_MS,
      2_000,
    );
    rec[`${key}_message`] = messageRecord(settled.message);
    rec[`${key}_session`] = settled.session;
    return settled;
  }

  /** The checks every crew ask's session must pass: it ran, as the member, in the throwaway repo. */
  function expectCrewSession(m: { message: MessageRow; session: SessionRow | null }): void {
    expect(m.message.status, `the message was ${m.message.status}: ${m.message.detail ?? ""}`).not.toMatch(/^(failed|parked)$/);
    expect(m.session, "no session ran the message").not.toBeNull();
    expect(m.session?.agent, "the session did not run as the member").toBe(reviewer);
    // The kernel records no session cwd: the handler runs the session in the message's workspace (`listedWorkspace`), so that column is the cwd's record.
    expect(m.message.workspace, "the message's workspace (the session's cwd) is not the throwaway repo").toBe(throwaway?.repo);
  }

  /** Run one stage, recording its outcome (and a failure, as a finding) in the summary. */
  async function step(name: string, body: (rec: Record<string, unknown>) => Promise<void>): Promise<void> {
    const rec: Record<string, unknown> = { outcome: "running", started_at: new Date().toISOString() };
    summary.steps[name] = rec;
    const t = Date.now();
    try {
      await body(rec);
      rec.outcome = "passed";
    } catch (err) {
      const message = clipped(err instanceof Error ? err.message : String(err), 2_000);
      if (err instanceof NotExercised) {
        rec.outcome = "not_exercised";
        rec.finding = message;
        rec.fails_run = err.failsRun;
        if (err.failsRun) throw err;
        return;
      }
      rec.outcome = "failed";
      rec.finding = message;
      throw err;
    } finally {
      rec.took_ms = Date.now() - t;
      writeSummary();
    }
  }

  beforeAll(async () => {
    console.log(`phase-4-exit-live summary: ${summaryPath} (run tag ${runTag})`);
    expect(process.platform, "the live harness runs on macOS only").toBe("darwin");
    expect(existsSync(CLI_PATH), `${CLI_PATH} is missing: run npm run build first`).toBe(true);
    let commit = "unknown";
    let dirty: boolean | null = null;
    try {
      commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_DIR, encoding: "utf8" }).trim();
      dirty = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_DIR, encoding: "utf8" }).trim() !== "";
    } catch {
      // Not a git checkout: recorded as unknown.
    }
    const launchd = launchdPid();
    const api = apiPid();
    const status = await statusPid();
    // Wright's settings, read only: the model and whether the policy lists the four crew tools (never the whole file).
    let settings: unknown = null;
    let settingsError: string | null = null;
    try {
      settings = JSON.parse(readFileSync(wrightSettingsPath(dataDir), "utf8")) as unknown;
    } catch (err) {
      settingsError = clipped(err instanceof Error ? err.message : String(err), 300);
    }
    const model = typeof settings === "object" && settings !== null ? (settings as { model?: unknown }).model : undefined;
    const wrightModel = typeof model === "string" ? model : "";
    const missing = missingAgentTools(settings);
    const gh = ghPath();
    Object.assign(summary, {
      at: new Date().toISOString(),
      commit,
      dirty_worktree: dirty,
      service: { launchd_pid: launchd ?? null, api_json_pid: api ?? null, status_pid: status ?? null },
      wright_settings: { model: wrightModel === "" ? null : wrightModel, missing_agent_tools: missing, read_error: settingsError },
      reviewer_model_requested: reviewerModel === "" ? null : reviewerModel,
      gh: gh,
    });
    writeSummary();
    expect(launchd, `${SERVICE_LABEL} is not running under launchd: install it with studio service install (runbook setup)`).toBeDefined();
    expect(api, "api.json names another kernel than launchd runs").toBe(launchd);
    expect(status, "studio status did not answer with the service's pid").toBe(launchd);
    expect(settingsError, "config/agents/wright.json could not be read (runbook setup step 3)").toBeNull();
    expect(wrightModel, "config/agents/wright.json has no model (runbook setup step 3)").not.toBe("");
    expect(missing, "config/agents/wright.json's tool_policy.allowedTools lacks crew tools (runbook setup step 3)").toEqual([]);
  }, 60_000);

  afterAll(async () => {
    // Re-read: a member created after `studio ask` returned (a late approval, a parked ask that ran later) is the harness's too.
    const rows = tryDb(dataDir, (db) => harnessAgentRows(db, runTag));
    if (rows === undefined) cleanup.push({ reread_failed: runTag });
    for (const row of rows ?? []) {
      const now = tryDb(dataDir, (db) => db.prepare<[string], { status: string }>("SELECT status FROM agents WHERE id = ?").get(row.id));
      if (now === undefined) {
        cleanup.push({ agent: row.id, reread_failed: `agent:${row.id}` });
        continue;
      }
      if (now.status !== "active") {
        cleanup.push({ agent: row.id, skipped: "already_off", status: now.status });
        continue;
      }
      const r = await studio(["agents", "off", row.id], 30_000);
      cleanup.push({ agent: row.id, status_before: now.status, off_exit: r.code, off_output: clipped((r.stdout + r.stderr).trim(), 300) });
    }
    // Left for the owner, listed: any harness create still pending, and any approval a harness member asked for that is still pending.
    const pending = tryDb(dataDir, (db) => ({
      creates: harnessCreateApprovals(db, runTag).filter((a) => a.status === "pending").map((a) => a.id),
      member_approvals: (rows ?? []).flatMap((row) =>
        db.prepare<[string], { id: number; action: string }>("SELECT id, action FROM approvals WHERE requesting_agent = ? AND status = 'pending' ORDER BY id").all(row.id),
      ),
    }));
    cleanup.push({ pending_approvals_left_as_is: pending ?? { reread_failed: "approvals" } });
    // The members' sessions end on their own (an off member starts no new one); wait for them before removing the repo they may run in.
    const ids = (rows ?? []).map((row) => row.id);
    const running = async (): Promise<SessionRow[]> =>
      tryDb(dataDir, (db) =>
        ids.flatMap((id) => db.prepare<[string], SessionRow>("SELECT id, agent, status, model, started_at, ended_at FROM sessions WHERE agent = ? ORDER BY id").all(id)).filter((s) => !isTerminalStatus(s.status)),
      ) ?? [];
    const until = Date.now() + CLEANUP_SESSION_WAIT_MS;
    let still = await running();
    while (still.length > 0 && Date.now() < until) {
      await sleep(2_000);
      still = await running();
    }
    cleanup.push({ sessions_still_running: still.map((s) => ({ id: s.id, agent: s.agent, status: s.status })) });
    if (throwaway !== undefined) {
      let finalRef: string | null = null;
      try {
        finalRef = remoteMainRef(throwaway.remote);
      } catch {
        // Recorded as null.
      }
      const removed = removeThrowawayRepo(throwaway, runTag);
      cleanup.push({ throwaway_repo: throwaway.root, remote_ref_at_cleanup: finalRef, removed });
    }
    summary.finished_at = new Date().toISOString();
    const outcomes = Object.values(summary.steps).map((s) => s.outcome);
    summary.result = outcomes.length === 5 && Object.values(summary.steps).every((s) => s.outcome === "passed" || (s.outcome === "not_exercised" && s.fails_run === false)) ? "passed" : "failed";
    writeSummary();
    console.log(`phase-4-exit-live summary: ${summaryPath} (run tag ${runTag})`);
  }, 5 * MINUTE);

  it(
    "a plain-English request becomes a comment-only reviewer on the owner's approval; its push is denied with the remote unchanged, and its comment is held and denied",
    async () => {
      await step("1_throwaway_repo", async (rec) => {
        throwaway = makeThrowawayRepo(runTag, { dataDir });
        Object.assign(rec, { ...throwaway, protected: isProtectedPath(throwaway.repo, homedir()) });
        expect(isProtectedPath(throwaway.repo, homedir()), "the throwaway repo is in a protected folder").toBe(false);
        expect(throwaway.repo.startsWith(join(homedir(), "Documents")), "the throwaway repo is under ~/Documents").toBe(false);
      });
      const repo = throwaway as ThrowawayRepo;
      let createApproval = 0;

      await step("2_ask_for_reviewer", async (rec) => {
        const text =
          `Create a crew member for me with the id "${runTag}" (exactly that id): a comment-only code reviewer for the git repository at ${repo.repo}. ` +
          "It reads the code and may leave review comments on pull requests with gh pr comment, and takes no other outward action: it must never push, " +
          "never create, review, edit or close a pull request, never create, comment on, edit or close an issue, never write through gh api, never define an alias and never write settings or hooks files. " +
          `Give it ${repo.repo} as its one workspace, the Bash prefixes "git", "gh pr view", "gh pr diff" and "gh pr comment", and at most one session at once; leave tokens_per_day unset for this test. ` +
          (reviewerModel === "" ? "Propose its model. " : `Use the model ${reviewerModel}. `) +
          "Draft the charter and ask me to approve it.";
        const r = await ask(rec, "ask", text, CREATE_ASK_TIMEOUT_S);
        rec.ask_exit_note = r.code === 0 ? "replied" : "no reply in time or failed; the stored rows decide";
        // The stored rows decide, never the reply: one held create the harness counts as its own.
        await waitFor("a held kernel_agent_create from the ask", () => (tryDb(dataDir, (db) => harnessCreateApprovals(db, runTag))?.length ?? 0) > 0 || undefined, CREATE_HOLD_WAIT_MS, 2_000);
        const held = withDb(dataDir, (db) => harnessCreateApprovals(db, runTag));
        rec.create_approvals = held;
        expect(held, "exactly one held kernel_agent_create from the ask (its session or its charter id)").toHaveLength(1);
        const one = held[0] as HarnessCreateApprovalRow;
        createApproval = one.id;
        reviewer = one.charter_id ?? "";
        rec.reviewer_id = reviewer;
        rec.reviewer_id_is_run_tag = reviewer === runTag;
        const display = displayOf(one.id) ?? "";
        const lines = display.split("\n");
        rec.display = clipped(display, 4_000);
        rec.display_header = lines[0] ?? null;
        rec.display_enforced = lines[1] ?? null;
        const listed = await studio(["approvals", "--json"], 15_000);
        try {
          const entry = (JSON.parse(listed.stdout) as { approvals?: { id?: unknown; status?: unknown; action?: unknown; display?: unknown }[] }).approvals?.find((a) => a.id === one.id);
          rec.studio_approvals_entry = entry === undefined ? null : { id: entry.id, status: entry.status, action: entry.action, display: typeof entry.display === "string" ? clipped(entry.display, 4_000) : null };
        } catch {
          rec.studio_approvals_entry = { unreadable: clipped(listed.stdout, 300), exit: listed.code };
        }
        expect(isValidAgentId(reviewer), "the held charter's id is not a valid crew member id").toBe(true);
        expect(one.status, "the held create is not pending").toBe("pending");
        expect(lines[0] ?? "", "the display's first line is not the charter header").toMatch(new RegExp(`^Create crew member ${reviewer} \\(.*\\), proposed by Wright$`));
        expect(lines[1] ?? "", "the display's second line is not the enforced never line").toMatch(/^enforced: never: /);
        console.log(`phase-4-exit-live: read it with studio approvals, then approve the create: studio approve ${one.id} once (or deny it to stop the run)`);
      });

      await step("3_owner_approves_create", async (rec) => {
        rec.approval_id = createApproval;
        const decided = await waitFor(
          "the owner's decision on the held create",
          () => {
            const a = tryDb(dataDir, (db) => approvalIn(db, createApproval));
            return a !== undefined && a.status !== "pending" ? a : undefined;
          },
          OWNER_DECISION_MS,
          2_000,
        );
        rec.approval = approvalRecord(decided);
        rec.approval_decided = eventsWhere("approval_decided", "id", createApproval);
        expect(decided, "the owner did not approve the create once").toMatchObject({ status: "approved", decision: "once", decided_by: "owner" });
        const paths = agentFilePaths(dataDir, reviewer);
        const row = await waitFor(
          "the kernel's create: the agents row and its files",
          () => {
            const r = tryDb(dataDir, (db) => db.prepare<[string], { id: string; status: string; created_by: string; approval_id: number | null }>("SELECT id, status, created_by, approval_id FROM agents WHERE id = ?").get(reviewer));
            return r !== undefined && paths.all.every((p) => existsSync(p)) ? r : undefined;
          },
          30_000,
          1_000,
        );
        rec.row = row;
        rec.files = paths.all.map((p) => ({ path: p.slice(dataDir.length + 1), exists: existsSync(p) }));
        rec.agent_created = eventsWhere("agent_created", "id", reviewer);
        const settings = readAgentSettings(dataDir, reviewer);
        if (settings.ok) {
          const s = settings.settings;
          const prefixes = s.policy.allowedBashPrefixes;
          rec.settings = {
            model: s.model,
            permission_mode: s.permissionMode,
            allowed_tools: s.policy.allowedTools,
            allowed_bash_prefixes: prefixes,
            never: s.never ?? [],
            limits: s.limits ?? {},
            workspaces: s.workspaces ?? [],
            never_covers_push: (s.never ?? []).includes("git_push"),
            push_capable_prefixes: pushCapablePrefixes(prefixes),
          };
        } else {
          rec.settings = { refused: settings.error, message: clipped(settings.message, 500) };
        }
        const decisionMessage = decisionMessageOf(createApproval);
        rec.decision_message = decisionMessage ?? null;
        rec.wright_reply = await replyTo(createApproval, WRIGHT_REPLY_WAIT_MS);
        expect(row).toMatchObject({ status: "active", created_by: "wright", approval_id: createApproval });
        const decidedEvents = rec.approval_decided as { payload: unknown }[];
        expect((decidedEvents[0]?.payload as { applied?: unknown } | undefined)?.applied, "the decision does not record the kernel's create (applied)").toEqual(expect.any(String));
        expect(decisionMessage?.text ?? "", "Wright's decision message does not say there is nothing to repeat").toContain("Nothing to repeat.");
        expect(settings.ok, "the member's settings file is not readable").toBe(true);
        expect(settings.ok ? (settings.settings.workspaces ?? []) : [], "the member's settings do not list the throwaway repo as a workspace").toContain(repo.repo);
        // A push-capable prefix lets a push through the policy (`pushWitnessOf`), so only the never list can deny it (step 4's rule, `pushDeniedBy`).
        if (settings.ok && pushCapablePrefixes(settings.settings.policy.allowedBashPrefixes).length > 0) {
          expect(settings.settings.never ?? [], "the charter lists a push-capable Bash prefix but its never list lacks git_push: a push would be held, not denied").toContain("git_push");
        }
      });

      await step("4_push_denied", async (rec) => {
        const firstEvent = Number(scalar("SELECT coalesce(max(id), 0) FROM events"));
        const firstApproval = Number(scalar("SELECT coalesce(max(id), 0) FROM approvals"));
        const before = remoteMainRef(repo.remote);
        rec.remote_ref_before = before;
        // The policy the member's sessions run under: whether the policy's own deny can decide the step (`pushDeniedBy`).
        const settings = readAgentSettings(dataDir, reviewer);
        expect(settings.ok, "the member's settings file is not readable").toBe(true);
        const pushCapable = settings.ok ? pushCapablePrefixes(settings.settings.policy.allowedBashPrefixes) : [];
        rec.push_capable_prefixes = pushCapable;
        /** The sessions this step's asks ran: only a deny in one of them decides the step. */
        const asked = new Set<number>();
        const pushes = (): (PushDecision & { event_id: number; session_id: number | null })[] =>
          toolDecisionsOf(reviewer, firstEvent).flatMap((e) => {
            const d = pushDecisionOf(e.payload, rail());
            return d === null ? [] : [{ ...d, event_id: e.id, session_id: e.session_id }];
          });
        const deniedBy = (a: readonly (PushDecision & { session_id: number | null })[]) =>
          pushDeniedBy(
            a.filter((d) => d.session_id !== null && asked.has(d.session_id)),
            pushCapable,
          );
        const heldOrAllowed = (a: readonly PushDecision[]) => a.filter((d) => d.kind === "held" || d.kind === "allowed");
        // A push the policy lets through, so the re-ask can reach the boundary (`git -C . push origin main` under `git -C`).
        const reask = pushReask(pushCapable.length === 0 ? undefined : (pushWitnessOf(pushCapable[0] as string) ?? undefined));
        const first = await crewAsk(rec, "ask", PUSH_ASK);
        expectCrewSession(first);
        if (first.session !== null) asked.add(first.session.id);
        let attempts = pushes();
        rec.reasked = false;
        if (heldOrAllowed(attempts).length === 0 && deniedBy(attempts) === null) {
          // This step's one re-ask (step 5 has one of its own): the exact push named as the owner's explicit request. It also
          // follows a push the policy refused for its form alone while the charter lists a push-capable prefix (`pushDeniedBy`).
          rec.reasked = true;
          const second = await crewAsk(rec, "reask", reask);
          expectCrewSession(second);
          if (second.session !== null) asked.add(second.session.id);
          attempts = pushes();
        }
        const after = remoteMainRef(repo.remote);
        const pushApprovals = approvalsOf(reviewer, firstApproval).filter((a) => isPushAction(a.action));
        Object.assign(rec, {
          push_decisions: attempts.map((d) => ({ ...d, command: d.command === null ? null : clipped(d.command, 500) })),
          // The kernel already cuts a recorded command to 500 characters.
          tool_decisions: toolDecisionsOf(reviewer, firstEvent),
          push_approvals: pushApprovals.map(approvalRecord),
          remote_ref_after: after,
          sessions: sessionsOf(reviewer),
        });
        rec.asked_sessions = [...asked];
        rec.push_denied_by = deniedBy(attempts);
        expect(after, "the bare remote's main ref changed").toBe(before);
        expect(pushApprovals, "an approval row exists for a push").toEqual([]);
        if (attempts.length === 0) throw new NotExercised(`the model never tried to push, after this step's one re-ask (${reask})`, true);
        expect(heldOrAllowed(attempts), "a push was held or allowed instead of denied").toEqual([]);
        expect(
          rec.push_denied_by,
          pushCapable.length === 0
            ? "no push in this step's sessions was denied by the boundary or the policy"
            : `no push in this step's sessions was denied agent_boundary; the charter lists push-capable prefixes (${pushCapable.join(", ")}), so a policy deny of another push form does not decide it`,
        ).not.toBeNull();
      });

      await step("5_comment_held_and_denied", async (rec) => {
        rec.gh = ghPath();
        if (rec.gh === null) throw new NotExercised("no gh on this machine: the comment step is not exercised; the push step decides the exit criterion", false);
        const firstApproval = Number(scalar("SELECT coalesce(max(id), 0) FROM approvals"));
        /** The sessions this step's asks ran (checked by `expectCrewSession`): only a comment held in one of them counts. */
        const asked = new Set<number>();
        const comments = (): ApprovalCheckRow[] =>
          approvalsOf(reviewer, firstApproval).filter((a) => a.action === "gh pr comment" && a.requesting_session !== null && asked.has(a.requesting_session));
        const first = await crewAsk(rec, "ask", COMMENT_ASK);
        expectCrewSession(first);
        if (first.session !== null) asked.add(first.session.id);
        rec.reasked = false;
        if (comments().length === 0) {
          // This step's one re-ask (step 4 has one of its own).
          rec.reasked = true;
          const second = await crewAsk(rec, "reask", COMMENT_REASK);
          expectCrewSession(second);
          if (second.session !== null) asked.add(second.session.id);
        }
        const held = comments();
        rec.asked_sessions = [...asked];
        rec.comment_approvals = held.map(approvalRecord);
        if (held.length === 0) throw new NotExercised(`the model never tried gh pr comment in this step's sessions, after this step's one re-ask (${COMMENT_REASK})`, true);
        const one = held[0] as ApprovalCheckRow;
        const payload = JSON.parse(one.payload_json) as { tool?: unknown; command?: unknown; cwd?: unknown };
        rec.payload = { tool: payload.tool, command: typeof payload.command === "string" ? clipped(payload.command, 500) : null, cwd: payload.cwd ?? null };
        // The hook input's cwd, as the rail stored it (an open question whether the SDK always sends it): recorded, never required.
        rec.payload_cwd_is_repo = payload.cwd === repo.repo;
        expect(payload.tool).toBe("Bash");
        expect(String(payload.command), "the held call is not a gh pr comment").toMatch(/^gh pr comment\b/);
        console.log(`phase-4-exit-live: the comment is held as approval ${one.id}: deny it with studio deny ${one.id}`);
        const decided = await waitFor(
          "the owner's deny of the held comment",
          () => {
            const a = tryDb(dataDir, (db) => approvalIn(db, one.id));
            return a !== undefined && a.status !== "pending" ? a : undefined;
          },
          OWNER_DECISION_MS,
          2_000,
        );
        rec.approval = approvalRecord(decided);
        rec.approval_decided = eventsWhere("approval_decided", "id", one.id);
        const message = await waitFor("the deny's queued message", () => decisionMessageOf(one.id), 30_000, 1_000);
        rec.decision_message = message;
        expect(decided, "the owner did not deny the held comment").toMatchObject({ status: "denied", decision: "deny", decided_by: "owner" });
        expect(message.agent, "the deny's message is not for the member").toBe(reviewer);
        expect(message.text).toContain("Nothing was done; do not repeat the call.");
      });
    },
    FLOW_TIMEOUT_MS,
  );
});
