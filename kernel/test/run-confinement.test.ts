// Phase 8 item 25c: a kernel run session's file operations, `git -C` and `git merge` stay inside its checkout.
//
// The pure half (`src/sessions/run-confinement.ts`): which words are operands, the closed option sets, the refused
// operand forms, the `git -C` split, the resolved-path verdict, 23f's install-root derivation and the Monitor input.
// The I/O half (`src/loomwright/run-state-checkout.ts`): the worktree roots, segment-by-segment resolution, the
// local-branch lookup and the gate's whole check, against a real git repository in a temp dir.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkoutConfinement, confinementRoots, isLocalBranch, physicalPath } from "../src/loomwright/run-state-checkout.js";
import { isInsideResolved } from "../src/protected-paths.js";
import { runGateView } from "../src/sessions/policy.js";
import {
  confinedShape,
  confinementVerdict,
  installReadWords,
  isLiteralWord,
  loomwrightInstallRoot,
  MONITOR_INPUT_KEYS,
  MONITOR_REFUSED_KEYS,
  monitorCommandOf,
  splitGitC,
} from "../src/sessions/run-confinement.js";
import { parseBashCommand } from "../src/sessions/shell-words.js";

/** The command's words as the policy reads them. */
function words(command: string): string[] {
  const parsed = parseBashCommand(command);
  if (parsed.kind !== "words") throw new Error(`${command}: ${parsed.kind}`);
  return parsed.words;
}

const shape = (command: string) => confinedShape(words(command));

describe("confinedShape: the closed option sets and the refused operand forms", () => {
  it.each([
    ["rm a.txt", ["a.txt"], false, 0],
    ["rm -f a b", ["a", "b"], false, 0],
    ["rm -rf build", ["build"], true, 0],
    ["rm -Rv build", ["build"], true, 0],
    ["mv .supervisor/jobs/in-progress/x.md .supervisor/jobs/failed/x.md", [".supervisor/jobs/in-progress/x.md", ".supervisor/jobs/failed/x.md"], false, 1],
    ["mv -fnv a b", ["a", "b"], false, 1],
    ["mv a b dir", ["a", "b", "dir"], false, 2],
    ["chmod +x drum.sh", ["drum.sh"], false, 0],
    ["chmod 755 a b", ["a", "b"], false, 0],
    ["chmod -R u+x,g-w dir", ["dir"], true, 0],
    ["git rm --cached -q a", ["a"], false, 0],
    ["git rm -r -- -odd", ["-odd"], true, 0],
    ["git mv -k a b", ["a", "b"], false, 1],
  ] as const)("`%s` is a confined path shape", (command, operands, recursive, moved) => {
    expect(shape(command)).toEqual({ kind: "paths", operands, recursive, moved });
  });

  it.each([
    ["rm -x a", "option"],
    ["rm --no-preserve-root a", "option"],
    ["rm -rfx a", "option"],
    ["mv -i a b", "option"],
    ["chmod -h +x a", "option"],
    ["git rm --pathspec-from-file=x", "option"],
    ["git mv --dry-run a b", "option"],
    // An option whose value is a path is refused by name (the operand walk would not read it).
    ["mv -t /tmp a", "path_option"],
    ["mv --target-directory=/tmp a", "path_option"],
    ["mv -S .bak a b", "path_option"],
    // Globs, braces, `~` forms, `..` and git pathspec magic are refused unread.
    ["rm src/*.ts", "pattern"],
    ["rm 'src/*.ts'", "pattern"],
    ["rm a?", "pattern"],
    ["rm [ab]", "pattern"],
    ["mv {a,b} c", "pattern"],
    ["rm ~/x", "pattern"],
    ["rm ~", "pattern"],
    ["rm ../x", "pattern"],
    ["chmod +x a/../../b", "pattern"],
    ["git rm :/x", "pattern"],
    ["git mv ':(glob)*' b", "pattern"],
    // Too few operands, or no valid chmod mode.
    ["rm -rf", "operands"],
    ["mv a", "operands"],
    ["git mv a", "operands"],
    ["chmod +x", "operands"],
    ["chmod x+ a", "operands"],
  ] as const)("`%s` is refused (%s)", (command, why) => {
    expect(shape(command)).toEqual({ kind: "refuse", why });
  });

  it("reads `git merge <name> [--no-ff] [-m <msg>]` only", () => {
    expect(shape("git merge feature/x")).toEqual({ kind: "merge", branch: "feature/x" });
    expect(shape('git merge feature/x --no-ff -m "merge: a b"')).toEqual({ kind: "merge", branch: "feature/x" });
    expect(shape("git merge --no-ff feature/x")).toEqual({ kind: "merge", branch: "feature/x" });
    for (const command of [
      "git merge -X ours feature/x",
      "git merge -Xours feature/x",
      "git merge -s ours feature/x",
      "git merge --strategy=ours feature/x",
      "git merge --strategy-option=theirs feature/x",
      "git merge --abort",
      "git merge --squash feature/x",
      "git merge -mx feature/x",
      "git merge feature/x -m",
      "git merge a b",
      "git merge",
      "git merge 'feat*'",
      "git merge main..x",
      "git merge HEAD:x",
    ]) {
      expect(shape(command), command).toEqual({ kind: "refuse", why: "merge_shape" });
    }
  });

  it("any other command is `none`", () => {
    for (const command of ["git status", "git merge-base a b", "cp a b", "/bin/rm a", "git remote -v", "ls -la"]) expect(shape(command), command).toEqual({ kind: "none" });
  });

  it("isLiteralWord refuses a glob, a brace and a `~` form", () => {
    for (const w of ["a", "/x/y", ".supervisor/jobs/x.md", "a-b_c.d"]) expect(isLiteralWord(w), w).toBe(true);
    for (const w of ["", "*", "a?", "[a]", "{a,b}", "~", "~/x", "~root", "~+"]) expect(isLiteralWord(w), w).toBe(false);
  });
});

describe("splitGitC: `git -C <dir> <rest>` is judged as `git <rest>`", () => {
  it("splits one leading `-C <dir>`", () => {
    expect(splitGitC(words("git -C /w/co status --short"))).toEqual({ kind: "split", dir: "/w/co", words: ["git", "status", "--short"] });
    expect(splitGitC(words("git -C ../project-a add -A"))).toEqual({ kind: "split", dir: "../project-a", words: ["git", "add", "-A"] });
    expect(splitGitC(words("git status"))).toEqual({ kind: "none" });
    expect(splitGitC(words("git -c core.x=y status"))).toEqual({ kind: "none" });
    expect(splitGitC(words("rm -C x"))).toEqual({ kind: "none" });
  });

  it.each([
    ["git -C /w/co -c core.hooksPath=x status", "global_option"],
    ["git --git-dir=x -C /w/co status", "global_option"],
    ["git -C /w/co --work-tree=/ status", "global_option"],
    ["git -C a -C b status", "global_option"],
    ["git -C /w/co --exec-path=/x status", "global_option"],
    ["git -C", "global_option"],
    ["git -C /w/co", "global_option"],
    ["git -C '/w/*' status", "pattern"],
    ["git -C ~/co status", "pattern"],
  ] as const)("`%s` is refused (%s)", (command, why) => {
    expect(splitGitC(words(command))).toEqual({ kind: "refuse", why });
  });
});

describe("confinementVerdict: the resolved operands", () => {
  const roots = ["/w/co", "/w/wt"];
  const op = (path: string, inside = true, underClaude = false) => ({ path, inside, underClaude });

  it("admits operands inside a root; refuses outside, ~/.claude, .git, run state and the run lock", () => {
    expect(confinementVerdict([op("/w/co/a"), op("/w/wt/b")], roots, false)).toBeUndefined();
    expect(confinementVerdict([op("/w/co/a"), op("/tmp/x", false)], roots, false)).toBe("outside");
    expect(confinementVerdict([op("/w/co/x", true, true)], roots, false)).toBe("claude_dir");
    expect(confinementVerdict([op("/w/co/.git/config")], roots, false)).toBe("git_dir");
    expect(confinementVerdict([op("/w/co/.GIT")], roots, false)).toBe("git_dir");
    expect(confinementVerdict([op("/w/co/.supervisor/automate/r1.md")], roots, false)).toBe("run_state");
    expect(confinementVerdict([op("/w/co/.Supervisor/Automate")], roots, false)).toBe("run_state");
    expect(confinementVerdict([op("/w/co/.supervisor/run.lock")], roots, true)).toBe("run_state");
    // Other `.supervisor/` bookkeeping is the session's to move.
    expect(confinementVerdict([op("/w/co/.supervisor/jobs/failed/x.md")], roots, false)).toBeUndefined();
  });

  it("refuses a recursive form whose target is the checkout or a worktree root (`rm -rf .` in the checkout)", () => {
    expect(confinementVerdict([op("/w/co")], roots, true)).toBe("checkout_root");
    expect(confinementVerdict([op("/W/CO/")], roots, true)).toBe("checkout_root");
    expect(confinementVerdict([op("/w/wt")], roots, true)).toBe("checkout_root");
    expect(confinementVerdict([op("/w/co/build")], roots, true)).toBeUndefined();
    // Not recursive: the root itself is a plain operand (chmod +x . changes one directory's mode).
    expect(confinementVerdict([op("/w/co")], roots, false)).toBeUndefined();
  });

  it("judges a recursive form and a move's sources on ancestry: a root's ancestor, or a `.supervisor` directory (review iteration 1)", () => {
    const nested = ["/w/co", "/w/co/.claude/worktrees/w1"];
    // `rm -rf .claude` above a worktree, `chmod -R` on it, and the `.claude/worktrees` between.
    expect(confinementVerdict([op("/w/co/.claude")], nested, true)).toBe("checkout_root");
    expect(confinementVerdict([op("/w/co/.Claude/Worktrees")], nested, true)).toBe("checkout_root");
    expect(confinementVerdict([op("/w/co/.claude/other")], nested, true)).toBeUndefined();
    // A segment boundary: `.claude/worktrees/w10` is no ancestor of `w1`.
    expect(confinementVerdict([op("/w/co/.claude/worktrees/w10")], nested, true)).toBeUndefined();
    // `mv .claude/worktrees/w1 moved` and `mv .claude moved` detach the worktree; moving into it is fine.
    expect(confinementVerdict([op("/w/co/.claude/worktrees/w1"), op("/w/co/moved")], nested, false, 1)).toBe("checkout_root");
    expect(confinementVerdict([op("/w/co/.claude"), op("/w/co/moved")], nested, false, 1)).toBe("checkout_root");
    expect(confinementVerdict([op("/w/co/a"), op("/w/co/.claude/worktrees/w1")], nested, false, 1)).toBeUndefined();
    // Not recursive and not moved: an ancestor is a plain operand.
    expect(confinementVerdict([op("/w/co/.claude")], nested, false)).toBeUndefined();
    // A `.supervisor` directory holds run state and the run lock.
    expect(confinementVerdict([op("/w/co/.supervisor")], roots, true)).toBe("run_state");
    expect(confinementVerdict([op("/w/co/.Supervisor"), op("/w/co/x")], roots, false, 1)).toBe("run_state");
    expect(confinementVerdict([op("/w/co/.supervisor/jobs")], roots, true)).toBeUndefined();
  });
});

describe("23f: the session's own Loomwright install root", () => {
  const install = "/Users/o/.claude/plugins/cache/atelier/loomwright/18.1.2";
  const paths = [`${install}/scripts/automate-helpers.sh`, `${install}/scripts/gate-auto.sh`];

  it("is the one root every admitted script path shares", () => {
    expect(loomwrightInstallRoot(paths)).toBe(install);
    expect(loomwrightInstallRoot([])).toBeUndefined();
    expect(loomwrightInstallRoot(undefined)).toBeUndefined();
  });

  it("admittedScriptPaths under two roots, or of another shape, give no root (no exemption)", () => {
    expect(loomwrightInstallRoot([...paths, "/Users/o/.claude/plugins/cache/atelier/loomwright/17.38.0/scripts/x.sh"])).toBeUndefined();
    expect(loomwrightInstallRoot([`${install}/scripts/sub/x.sh`])).toBeUndefined();
    expect(loomwrightInstallRoot(["relative/scripts/x.sh"])).toBeUndefined();
    expect(loomwrightInstallRoot(["/scripts/x.sh"])).toBeUndefined();
  });

  it("exempts only a read-only program's literal absolute words under the root", () => {
    const home = "/Users/o";
    expect([...installReadWords(words(`grep -n x ${install}/agents/launch-pad.md`), paths, home)]).toEqual([3]);
    expect([...installReadWords(words(`cat ${install}`), paths, home)]).toEqual([1]);
    expect([...installReadWords(words(`cat ${install}/../17.38.0/x`), paths, home)]).toEqual([]);
    expect([...installReadWords(words(`cat '${install}/*'`), paths, home)]).toEqual([]);
    expect([...installReadWords(words(`cat ${install}/{a,b}`), paths, home)]).toEqual([]);
    expect([...installReadWords(words("cat ~/.claude/plugins/cache/atelier/loomwright/18.1.2/x"), paths, home)]).toEqual([]);
    expect([...installReadWords(words(`cp ${install}/x /tmp/x`), paths, home)]).toEqual([]);
    expect([...installReadWords(words(`/bin/cat ${install}/x`), paths, home)]).toEqual([]);
    expect([...installReadWords(words(`cat ${install}/x`), [...paths, "/elsewhere/scripts/y.sh"], home)]).toEqual([]);
  });
});

describe("Monitor's input: a shell watch only", () => {
  it("pins the SDK's MonitorInput keys and refuses `ws`", () => {
    // Agent SDK 0.3.284 `sdk-tools.d.ts` MonitorInput: description, timeout_ms, command?, ws?.
    expect([...MONITOR_INPUT_KEYS].sort()).toEqual(["command", "description", "timeout_ms", "ws"]);
    expect(MONITOR_REFUSED_KEYS).toEqual(["ws"]);
    expect(monitorCommandOf({ command: "tail -f x", description: "watch", timeout_ms: 1000 })).toBe("tail -f x");
    expect(monitorCommandOf({ description: "socket", timeout_ms: 1000, ws: { url: "wss://example.test" } })).toBeUndefined();
    expect(monitorCommandOf({ command: "tail -f x", description: "both", timeout_ms: 1000, ws: { url: "wss://example.test" } })).toBeUndefined();
    expect(monitorCommandOf({ command: "tail -f x", description: "x", timeout_ms: 1, persistent: true })).toBeUndefined();
    expect(monitorCommandOf({ command: 7, description: "x", timeout_ms: 1 })).toBeUndefined();
    expect(monitorCommandOf(null)).toBeUndefined();
    expect(monitorCommandOf(["tail"])).toBeUndefined();
  });
});

// ---- The I/O half, against a real git repository ------------------------------------------------------

let tmp: string;
let co: string;
let home: string;
const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "studio-run-confinement-")));
  co = join(tmp, "co");
  home = join(tmp, "home");
  mkdirSync(co);
  mkdirSync(join(home, ".claude"), { recursive: true });
  git(co, "init", "-q", "-b", "main");
  git(co, "config", "user.email", "t@t");
  git(co, "config", "user.name", "t");
  writeFileSync(join(co, "a.txt"), "a\n");
  git(co, "add", "a.txt");
  git(co, "commit", "-qm", "init");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** The gate's check for `command` in a session whose checkout and hook cwd are `co`. */
function gate(command: string, cwd: unknown = co, checkout: unknown = co) {
  const view = runGateView(command);
  if (view === undefined) throw new Error(`${command}: no view`);
  return checkoutConfinement(view, cwd, () => checkout, home);
}

describe("run-state-checkout.ts: the roots, the resolution and the local-branch lookup", () => {
  it("confinementRoots is the checkout and every worktree git lists; fails closed with no repo or a relative path", () => {
    git(co, "worktree", "add", "-q", "-b", "sub", join(tmp, "wt"));
    expect(confinementRoots(co)).toEqual([co, join(tmp, "wt")]);
    expect(confinementRoots("relative")).toBeUndefined();
    expect(confinementRoots(undefined)).toBeUndefined();
    mkdirSync(join(tmp, "plain"));
    expect(confinementRoots(join(tmp, "plain"))).toBeUndefined();
  });

  it("physicalPath follows a symlink before a `..`", () => {
    mkdirSync(join(tmp, "elsewhere", "deep"), { recursive: true });
    symlinkSync(join(tmp, "elsewhere", "deep"), join(co, "link"));
    expect(physicalPath(co, "link/../x")).toBe(join(tmp, "elsewhere", "x"));
    expect(physicalPath(co, "./a.txt")).toBe(join(co, "a.txt"));
    expect(physicalPath(co, "../wt")).toBe(join(tmp, "wt"));
    expect(physicalPath(co, "/abs/x")).toBe("/abs/x");
  });

  it("isInsideResolved compares the resolved forms only: a symlink out of the checkout is not inside", () => {
    symlinkSync(tmp, join(co, "out"));
    expect(isInsideResolved(join(co, "a.txt"), co)).toBe(true);
    expect(isInsideResolved(join(co, "out", "x"), co)).toBe(false);
    expect(isInsideResolved(join(co.toUpperCase(), "a.txt"), co)).toBe(true);
  });

  it("isLocalBranch answers true only for refs/heads/<name>: never a remote ref, a tag, a SHA, HEAD or an unknown name", () => {
    git(co, "branch", "feature/x");
    git(co, "tag", "v1.0");
    git(co, "update-ref", "refs/remotes/origin/main", "HEAD");
    const sha = git(co, "rev-parse", "HEAD").trim();
    expect(isLocalBranch(co, "feature/x")).toBe(true);
    expect(isLocalBranch(co, "main")).toBe(true);
    for (const name of ["origin/main", "v1.0", sha, "HEAD", "@{-1}", "main~1", "nope", "--all"]) expect(isLocalBranch(co, name), name).toBe(false);
    // A tag and a branch of the same name: git reads the tag, so it is no local branch.
    git(co, "branch", "both");
    git(co, "tag", "both");
    expect(isLocalBranch(co, "both")).toBe(false);
  });
});

describe("checkoutConfinement: the session gate's check (25c)", () => {
  const DENY = { kind: "deny", reason: "checkout_confinement" };
  const RUN_STATE = { kind: "deny", reason: "loomwright_run_state" };

  it("admits file operations inside the checkout and a worktree, and runs no git for an unconfined command", () => {
    git(co, "worktree", "add", "-q", "-b", "sub", join(tmp, "wt"));
    for (const command of ["rm a.txt", "rm -f missing.txt", "chmod +x a.txt", `mv a.txt ${join(tmp, "wt", "b.txt")}`, "git rm --cached a.txt", "git mv a.txt b.txt", "rm -rf build"]) {
      expect(gate(command), command).toMatchObject({ kind: "ok" });
    }
    // No confined shape and no -C: nothing to check, even with no checkout.
    expect(gate("git status", co, null)).toEqual({ kind: "ok", gitCwd: co });
  });

  it("refuses a path outside the checkout and its worktrees, under ~/.claude, in .git, run state or the run lock", () => {
    expect(gate(`rm ${join(tmp, "other.txt")}`)).toEqual(DENY);
    expect(gate(`mv a.txt ${join(home, ".claude", "x")}`)).toEqual(DENY);
    expect(gate("rm -rf .git/hooks")).toEqual(DENY);
    expect(gate("rm .supervisor/automate/r1.md")).toEqual(RUN_STATE);
    expect(gate("rm -rf .supervisor/run.lock")).toEqual(RUN_STATE);
    // A symlink inside the checkout to elsewhere: its resolved form is outside.
    symlinkSync(tmp, join(co, "out"));
    expect(gate("chmod +x out/x")).toEqual(DENY);
    // A ~/.claude checkout's files are still refused (the claude check, not only containment).
    const inClaude = join(home, ".claude", "co");
    mkdirSync(inClaude);
    git(inClaude, "init", "-q");
    expect(gate("rm x", inClaude, inClaude)).toEqual(DENY);
  });

  it("refuses a recursive form whose target is the checkout root (`rm -rf .`, `chmod -R +x .`, `git rm -r .`)", () => {
    for (const command of ["rm -rf .", "rm -r ./", `rm -rf ${co}`, "chmod -R +x .", "git rm -r .", "git rm -r --cached ."]) expect(gate(command), command).toEqual(DENY);
    // The same path, not recursive, is one operand.
    expect(gate("chmod +x .")).toMatchObject({ kind: "ok" });
  });

  it("refuses a recursive form or a move on an ancestor of a worktree root (review iteration 1)", () => {
    const w1 = join(co, ".claude", "worktrees", "w1");
    mkdirSync(join(co, ".claude", "worktrees"), { recursive: true });
    git(co, "worktree", "add", "-q", "-b", "w1", w1);
    mkdirSync(join(co, ".claude", "other"));
    for (const command of ["rm -rf .claude", "rm -rf .claude/worktrees", "chmod -R +x .claude", "git rm -r .claude", "mv .claude/worktrees/w1 moved", "mv .claude moved", "git mv .claude moved"]) {
      expect(gate(command), command).toEqual(DENY);
    }
    expect(gate("rm -rf .claude/other")).toMatchObject({ kind: "ok" });
    expect(gate("mv a.txt .claude/worktrees/w1/a.txt")).toMatchObject({ kind: "ok" });
  });

  it("drops a worktree git flags prunable: a forged `.git/worktrees/<x>` entry is no root (review iteration 1)", () => {
    const victim = join(tmp, "victim");
    mkdirSync(join(victim, "data"), { recursive: true });
    const forged = join(co, ".git", "worktrees", "evil");
    mkdirSync(forged, { recursive: true });
    writeFileSync(join(forged, "gitdir"), `${join(victim, ".git")}\n`);
    writeFileSync(join(forged, "HEAD"), `${git(co, "rev-parse", "HEAD").trim()}\n`);
    writeFileSync(join(forged, "commondir"), "../..\n");
    // git lists it (prunable); it is not a root, so the victim's files stay outside.
    expect(git(co, "worktree", "list", "--porcelain")).toContain(`worktree ${victim}`);
    expect(confinementRoots(co)).toEqual([co]);
    expect(gate(`rm -rf ${join(victim, "data")}`)).toEqual(DENY);
    expect(gate(`git -C ${victim} status`)).toEqual(DENY);
  });

  it("fails closed with no absolute hook cwd, or roots git cannot list", () => {
    expect(gate("rm a.txt", null)).toEqual(DENY);
    expect(gate("rm a.txt", "relative")).toEqual(DENY);
    expect(gate("rm a.txt", co, null)).toEqual(DENY);
    mkdirSync(join(tmp, "plain"));
    expect(gate("rm a.txt", co, join(tmp, "plain"))).toEqual(DENY);
  });

  it("`git -C <dir>` must name the checkout or a worktree, and its operands resolve against <dir>", () => {
    git(co, "worktree", "add", "-q", "-b", "sub", join(tmp, "wt"));
    expect(gate(`git -C ${co} status`)).toEqual({ kind: "ok", gitCwd: co });
    expect(gate("git -C ../wt add -A")).toEqual({ kind: "ok", gitCwd: join(tmp, "wt") });
    expect(gate(`git -C ${join(tmp, "wt")} rm a.txt`)).toMatchObject({ kind: "ok" });
    expect(gate("git -C /tmp/other status")).toEqual(DENY);
    expect(gate(`git -C ${tmp} status`)).toEqual(DENY);
    expect(gate("git -C .supervisor/automate status")).toEqual(RUN_STATE);
    expect(gate(`git -C ${join(tmp, "wt")} rm -r .`)).toEqual(DENY);
  });

  it("`git merge` takes a local branch whose tree tracks no run state; a remote ref, a tag or a SHA is refused", () => {
    git(co, "branch", "feature/x");
    git(co, "tag", "v1.0");
    git(co, "update-ref", "refs/remotes/origin/main", "HEAD");
    const sha = git(co, "rev-parse", "HEAD").trim();
    expect(gate('git merge feature/x --no-ff -m "merge: x"')).toMatchObject({ kind: "ok" });
    for (const name of ["origin/main", "v1.0", sha, "nope"]) expect(gate(`git merge ${name}`), name).toEqual(DENY);
    // A local branch that force-added a run file: merging it would write run state.
    git(co, "checkout", "-qb", "forged");
    mkdirSync(join(co, ".supervisor", "automate"), { recursive: true });
    writeFileSync(join(co, ".supervisor", "automate", "r1.md"), "- mode: auto-merge\n");
    git(co, "add", "-f", ".supervisor/automate/r1.md");
    git(co, "commit", "-qm", "forged");
    git(co, "checkout", "-q", "main");
    expect(gate("git merge forged")).toEqual(RUN_STATE);
  });
});
