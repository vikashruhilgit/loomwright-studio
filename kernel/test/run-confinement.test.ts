// Phase 8 item 25c: a kernel run session's file operations, `git -C` and `git merge` stay inside its checkout.
//
// The pure half (`src/sessions/run-confinement.ts`): which words are operands, the closed option sets, the refused
// operand forms, the `git -C` split, the resolved-path verdict, 23f's install-root derivation and the Monitor input.
// The I/O half (`src/loomwright/run-state-checkout.ts`): the worktree roots, segment-by-segment resolution, the
// local-branch lookup and the gate's whole check, against a real git repository in a temp dir.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTOMATE_RUN_POLICY } from "../src/automate/launch.js";
import { checkoutConfinement, confinementRoots, isLocalBranch, physicalPath, refTracksRunState, writeTargetInGitDir } from "../src/loomwright/run-state-checkout.js";
import { isInsideResolved } from "../src/protected-paths.js";
import { decideToolUse, runGateView } from "../src/sessions/policy.js";
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

  it("25d: a fetch refspec naming a destination, or a push destination that could name a remote-tracking or replace ref, is `ref_destination`", () => {
    for (const command of [
      "git fetch . +HEAD:refs/remotes/origin/main",
      "git fetch . HEAD:refs/remotes/origin/main",
      "git fetch . run:remotes/origin/main",
      "git fetch . HEAD:refs/REMOTES/origin/main",
      "git fetch origin +main",
      "git fetch origin main:main",
      "git fetch -q . -- HEAD:refs/replace/abc",
      "git push . HEAD:refs/remotes/origin/main",
      "git push . +run:refs/remotes/origin/main",
      "git push ../worktree HEAD:origin/main",
      "git push . HEAD:origin",
      "git push . HEAD:remotes/origin/main",
      "git push . run:refs/replace/0123456789abcdef0123456789abcdef01234567",
      "git push . HEAD:refs/Remotes/origin/main",
      "git push . refs/remotes/origin/main",
      "git push -q . '+refs/heads/*:refs/remotes/origin/*'",
      "git stash export --to-ref refs/remotes/origin/main",
      "git stash export --print",
    ]) {
      expect(shape(command), command).toEqual({ kind: "refuse", why: "ref_destination" });
    }
    // An option outside fetch's, push's or ls-remote's closed set is `option` (review iteration 2): git takes any
    // unambiguous abbreviation of a long option and a value as the next word, so `--refm=` is `--refmap=` and
    // `--upload-pa=` is `--upload-pack=` (each reproduced with git 2.55.0).
    for (const command of [
      "git fetch '--refmap=+refs/heads/*:refs/remotes/origin/*' . run",
      "git fetch --refmap '+refs/heads/*:refs/remotes/origin/*' . run",
      "git fetch --refm=+refs/heads/run:refs/remotes/origin/main . run",
      "git fetch --refma=+refs/heads/run:refs/remotes/origin/main . run",
      "git fetch \"--upload-pack=sh -c 'touch PWNED' --\" .",
      "git fetch \"--upload-pa=sh -c 'touch PWNED' --\" .",
      "git fetch --upload-pack 'sh -c x' .",
      "git fetch --multiple . +HEAD:refs/remotes/origin/main",
      "git fetch --stdin .",
      "git fetch -j 2 origin",
      "git fetch -qf origin",
      "git fetch --depth 1 origin",
      "git ls-remote \"--upload-pack=sh -c 'touch PWNED' --\" .",
      "git ls-remote \"--upload-pa=sh -c 'touch PWNED' --\" .",
      "git ls-remote -u 'sh -c x' .",
      "git ls-remote -o x origin",
      "git push \"--receive-pack=sh -c 'touch PWNED' --\" . HEAD:refs/heads/x",
      "git push \"--receive-pa=sh -c x\" . HEAD:refs/heads/x",
      "git push \"--exec=sh -c x\" . HEAD:refs/heads/x",
      "git push \"--exe=sh -c x\" . HEAD:refs/heads/x",
      "git push --repo=. HEAD:refs/remotes/origin/main",
      "git push --mirror .",
      "git push --force origin main",
      "git push -f origin main",
      "git push -o x origin main",
      "git push --prune . '+refs/heads/*:refs/remotes/origin/*'",
      "git push - origin main",
    ]) {
      expect(shape(command), command).toEqual({ kind: "refuse", why: "option" });
    }
    // `--output` on the log / diff family writes the output to any path, `.git/` included (review iteration 2).
    for (const command of [
      "git log -1 --format=%H --output=.git/refs/remotes/origin/main HEAD",
      "git log -1 --output .git/refs/remotes/origin/main HEAD",
      "git show --output=.git/config HEAD",
      "git diff --output=.git/config",
      "git diff --stat --output x",
      "git stash show -p --output=.git/config",
      "git stash list --output=.git/config",
    ]) {
      expect(shape(command), command).toEqual({ kind: "refuse", why: "file_output" });
    }
    for (const command of ["git log --oneline -5", "git diff --stat", "git show HEAD", "git diff --output-indicator-new=+ HEAD", "git stash", "git stash list", "git status"]) {
      expect(shape(command), command).toEqual({ kind: "none" });
    }
    // Loomwright's own forms (the conformance fixture, 18.1.2) stay `none`.
    for (const command of [
      "git fetch",
      "git fetch origin",
      "git fetch -q origin",
      "git fetch --quiet origin main",
      "git fetch origin main",
      "git push",
      "git push -u origin feature/x-1",
      "git push origin HEAD:feature/widget-config",
      "git push origin HEAD:refs/heads/main",
      "git push -q origin main",
      "git push origin HEAD",
      "git push origin --delete eval/a/arm-2",
      "git push origin v1.0:refs/tags/v1.0",
      "git push -qu origin feature/x-1",
      "git fetch -qp origin",
      "git fetch --prune --tags origin",
      "git ls-remote --exit-code --heads origin main",
      "git ls-remote --heads origin",
      "git ls-remote",
    ]) {
      expect(shape(command), command).toEqual({ kind: "none" });
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
    // Review iteration 3: in every position, not only a sweeping one: a move's destination, a plain chmod target.
    expect(confinementVerdict([op("/w/co/automate"), op("/w/co/.supervisor")], roots, false, 1)).toBe("run_state");
    expect(confinementVerdict([op("/w/co/.SUPERVISOR")], roots, false)).toBe("run_state");
    // The brief move into a job folder names `.supervisor/jobs/...`, never `.supervisor` itself.
    expect(confinementVerdict([op("/w/co/.supervisor/jobs/in-progress/x.md"), op("/w/co/.supervisor/jobs/failed")], roots, false, 1)).toBeUndefined();
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

  it("drops a forged entry naming an EXISTING directory: its `.git` must link back to the entry (review iteration 2)", () => {
    const victim = join(tmp, "victim");
    mkdirSync(join(victim, "data"), { recursive: true });
    const forged = join(co, ".git", "worktrees", "evil");
    mkdirSync(forged, { recursive: true });
    writeFileSync(join(forged, "gitdir"), `${join(victim, ".git")}\n`);
    writeFileSync(join(forged, "HEAD"), `${git(co, "rev-parse", "HEAD").trim()}\n`);
    writeFileSync(join(forged, "commondir"), "../..\n");
    // A `.git` directory in the victim (an existing repo): not prunable to git, still no root.
    mkdirSync(join(victim, ".git"));
    expect(git(co, "worktree", "list", "--porcelain")).not.toContain("prunable");
    expect(confinementRoots(co)).toEqual([co]);
    expect(gate(`rm -rf ${join(victim, "data")}`)).toEqual(DENY);
    // A `.git` file pointing at the forged entry is not enough while the entry is a forgery of another worktree's;
    // and one pointing at a legitimate worktree's entry fails the link back.
    rmSync(join(victim, ".git"), { recursive: true });
    git(co, "worktree", "add", "-q", "-b", "sub", join(tmp, "wt"));
    writeFileSync(join(victim, ".git"), `gitdir: ${join(co, ".git", "worktrees", "wt")}\n`);
    expect(confinementRoots(co)).toEqual([co, join(tmp, "wt")]);
    // A symlinked `.git` file is never trusted, even one whose target links back.
    rmSync(join(victim, ".git"));
    writeFileSync(join(tmp, "dotgit"), `gitdir: ${forged}\n`);
    symlinkSync(join(tmp, "dotgit"), join(victim, ".git"));
    expect(confinementRoots(co)).toEqual([co, join(tmp, "wt")]);
  });

  it("keeps every worktree `git worktree add` made, absolute or relative links", () => {
    git(co, "worktree", "add", "-q", "-b", "abs", join(tmp, "wt-abs"));
    git(co, "worktree", "add", "-q", "--relative-paths", "-b", "rel", join(tmp, "wt-rel"));
    mkdirSync(join(co, ".claude", "worktrees"), { recursive: true });
    git(co, "worktree", "add", "-q", "-b", "w1", join(co, ".claude", "worktrees", "w1"));
    const all = [co, join(tmp, "wt-abs"), join(tmp, "wt-rel"), join(co, ".claude", "worktrees", "w1")].sort();
    expect([...(confinementRoots(co) ?? [])].sort()).toEqual(all);
    // From inside a linked worktree, the main checkout is a root too.
    expect([...(confinementRoots(join(tmp, "wt-abs")) ?? [])].sort()).toEqual(all);
  });

  it("writeTargetInGitDir resolves a file tool's path on disk: a committed link into `.git`, a final-component link, a dangling one (review iteration 2)", () => {
    symlinkSync(".git", join(co, "docs"));
    expect(writeTargetInGitDir("docs/worktrees/evil/gitdir", co)).toBe(true);
    expect(writeTargetInGitDir(join(co, "docs", "config"), co)).toBe(true);
    expect(writeTargetInGitDir(join(co, "docs"), co)).toBe(true);
    // A final-component link, existing target or dangling (a write through it creates the target).
    symlinkSync(join(co, ".git", "config"), join(co, "cfg"));
    symlinkSync(join(co, ".git", "hooks", "pre-commit"), join(co, "hook"));
    symlinkSync("../.git/worktrees/evil/gitdir", join(co, "sub-link"));
    mkdirSync(join(co, "sub"));
    symlinkSync("../.git/worktrees/evil/gitdir", join(co, "sub", "x"));
    expect(writeTargetInGitDir("cfg", co)).toBe(true);
    expect(writeTargetInGitDir("hook", co)).toBe(true);
    expect(writeTargetInGitDir("sub/x", co)).toBe(true);
    // The text forms the policy also refuses, case-folded.
    expect(writeTargetInGitDir(".GIT/config", co)).toBe(true);
    expect(writeTargetInGitDir("w/.git", co)).toBe(true);
    // Ordinary writes: an existing file, a new file in a new directory, a link to a work file.
    symlinkSync("a.txt", join(co, "alias"));
    for (const path of ["a.txt", join(co, "src", "new", "x.ts"), "alias", "gitdir-notes.md", ".github/workflows/ci.yml"]) expect(writeTargetInGitDir(path, co), path).toBe(false);
    // Fail closed: a relative path with no absolute cwd, a link loop.
    expect(writeTargetInGitDir("a.txt", undefined)).toBe(true);
    expect(writeTargetInGitDir("a.txt", "relative")).toBe(true);
    symlinkSync("loop2", join(co, "loop1"));
    symlinkSync("loop1", join(co, "loop2"));
    expect(writeTargetInGitDir("loop1", co)).toBe(true);
  });

  it("refuses a `git -C` directory in `.supervisor`: git reads the rest's words against it, the guard reads them as text (review iteration 2)", () => {
    mkdirSync(join(co, ".supervisor", "jobs"), { recursive: true });
    mkdirSync(join(co, ".supervisor", "automate"), { recursive: true });
    mkdirSync(join(co, "kernel"));
    for (const command of [
      "git -C .supervisor add -f automate/r1.md",
      "git -C .supervisor checkout -- automate/r1.md",
      "git -C .supervisor/jobs checkout -- ../automate/r1.md",
      "git -C .SUPERVISOR status",
      `git -C ${join(co, ".supervisor")} rm --cached automate/r1.md`,
    ]) {
      expect(gate(command), command).toEqual(RUN_STATE);
    }
    // A symlink to `.supervisor` is the same directory once resolved.
    symlinkSync(".supervisor", join(co, "sv"));
    expect(gate("git -C sv add -f automate/r1.md")).toEqual(RUN_STATE);
    // A directory outside `.supervisor` is admitted by the gate; its words naming run state are the policy's
    // (sessions-policy.test.ts pins `git -C kernel add -f ../.supervisor/automate/x` as loomwright_run_state).
    expect(gate("git -C kernel status")).toEqual({ kind: "ok", gitCwd: join(co, "kernel") });
  });

  it("refuses a move destination or chmod target that resolves to `.supervisor` through a committed link (review iteration 3)", () => {
    mkdirSync(join(co, ".supervisor", "jobs", "in-progress"), { recursive: true });
    mkdirSync(join(co, ".supervisor", "jobs", "failed"), { recursive: true });
    writeFileSync(join(co, ".supervisor", "jobs", "in-progress", "x.md"), "x\n");
    mkdirSync(join(co, "automate"));
    writeFileSync(join(co, "automate", "r1.md"), "- mode: auto-merge\n");
    symlinkSync(".supervisor", join(co, "sv"));
    git(co, "add", "sv");
    git(co, "commit", "-qm", "link");
    for (const command of ["mv automate sv", "mv automate sv/", "mv -f automate sv", "chmod 000 sv", "chmod +x sv/", "git mv automate sv", "git rm --cached sv"]) {
      expect(gate(command), command).toEqual(RUN_STATE);
    }
    // The brief moves into a job folder stay admitted (observed events 30444, 33369).
    expect(gate("mv .supervisor/jobs/in-progress/x.md .supervisor/jobs/failed/")).toMatchObject({ kind: "ok" });
    expect(gate("mv sv/jobs/in-progress/x.md sv/jobs/failed/")).toMatchObject({ kind: "ok" });
  });

  it("refuses `git -C <dir>` into a directory the session wrote as a bare repository; git there would run its config (review iteration 3)", () => {
    const marker = join(tmp, "PWNED");
    const evil = join(co, "evil");
    mkdirSync(join(evil, "objects"), { recursive: true });
    mkdirSync(join(evil, "refs"));
    writeFileSync(join(evil, "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(evil, "config"), `[core]\n\trepositoryformatversion = 0\n\tbare = true\n\tsshCommand = touch ${marker}; false\n`);
    // Committed as a PR could ship it: git reads `evil/` as a bare repository and runs its sshCommand.
    git(co, "add", "evil");
    git(co, "commit", "-qm", "evil");
    try {
      git(evil, "ls-remote", "ssh://h/x");
    } catch {
      // The command fails (`false`); the marker is what matters.
    }
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);
    for (const command of ["git -C evil fetch", "git -C evil ls-remote ssh://h/x", "git -C evil status", `git -C ${evil} push`, "git -C evil/refs status", "git -C evil merge main"]) {
      expect(gate(command), command).toEqual(DENY);
    }
    expect(existsSync(marker)).toBe(false);
    // A nested repository (a separate common dir) is not the checkout's repository either.
    const nested = join(co, "nested");
    mkdirSync(nested);
    git(nested, "init", "-q");
    expect(gate("git -C nested status")).toEqual(DENY);
    // A `.git` file pointing at the checkout's own `.git` (same common dir) redirects the work tree: its top level is
    // no root, so it is refused too (the session cannot write a `.git` file; this pins the top-level half).
    const redir = join(co, "redir");
    mkdirSync(redir);
    writeFileSync(join(redir, ".git"), `gitdir: ${join(co, ".git")}\n`);
    expect(git(redir, "rev-parse", "--path-format=absolute", "--git-common-dir").trim()).toBe(join(co, ".git"));
    expect(gate("git -C redir status")).toEqual(DENY);
    // A subdirectory of the checkout and a linked worktree stay admitted.
    git(co, "worktree", "add", "-q", "-b", "sub", join(tmp, "wt"));
    mkdirSync(join(co, "kernel"));
    expect(gate("git -C kernel status")).toEqual({ kind: "ok", gitCwd: join(co, "kernel") });
    expect(gate("git -C ../wt log")).toEqual({ kind: "ok", gitCwd: join(tmp, "wt") });
    expect(gate(`git -C ${co} diff`)).toEqual({ kind: "ok", gitCwd: co });
  });

  it("the plain path never runs git in a session-chosen directory: the hook cwd cannot move (`cd` is no run prefix), and a lookup refuses an implicit bare repository (review iteration 3)", () => {
    expect(decideToolUse(AUTOMATE_RUN_POLICY, "Bash", { command: "cd evil" })).toMatchObject({ decision: "deny" });
    expect(decideToolUse(AUTOMATE_RUN_POLICY, "Bash", { command: "pushd evil" })).toMatchObject({ decision: "deny" });
    // Were the hook cwd ever a planted bare repository, the gate's own lookups fail closed there.
    const evil = join(co, "evil");
    mkdirSync(join(evil, "objects"), { recursive: true });
    mkdirSync(join(evil, "refs", "heads"), { recursive: true });
    writeFileSync(join(evil, "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(evil, "config"), "[core]\n\trepositoryformatversion = 0\n\tbare = true\n");
    writeFileSync(join(evil, "refs", "heads", "main"), `${git(co, "rev-parse", "HEAD").trim()}\n`);
    expect(isLocalBranch(evil, "main")).toBe(false);
    expect(refTracksRunState(evil, "main")).toBe(true);
    expect(gate("git merge main", evil)).toEqual(DENY);
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
