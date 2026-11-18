// Phase 8 item 23q: a run session may run Loomwright's `release-refold.sh` only while the project has no
// `scripts/bump-version.sh` for it to run (repo code past the rail, invariant 3). Live, 2026-11-17: session 224's
// `bash <install>/scripts/release-refold.sh` was refused `bash_prefix_not_allowed`, and FINALIZE parked the item
// `release_refold_refused` before any push. studio-sandbox has no bump script, so the call runs nothing from the repo.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refoldRunsRepoCode } from "../src/loomwright/release-refold-gate.js";

let tmp: string;
let repo: string;
let refold: string;
let admitted: string[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-refold-"));
  refold = join(tmp, "loomwright", "17.38.0", "scripts", "release-refold.sh");
  admitted = [join(tmp, "loomwright", "17.38.0", "scripts", "supervisor-next-step.sh"), refold];
  repo = join(tmp, "work", "studio-sandbox");
  mkdirSync(join(repo, "sub"), { recursive: true });
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const bumpIn = (dir: string): void => {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "bump-version.sh"), "#!/usr/bin/env bash\n");
};

describe("release-refold.sh in a run session (23q)", () => {
  it("is admitted for a project with no bump script: session 224's own call, unquoted or quoted, from the top or a subfolder", () => {
    expect(refoldRunsRepoCode(`bash ${refold}`, repo, admitted)).toBe(false);
    expect(refoldRunsRepoCode(`bash "${refold}"`, repo, admitted)).toBe(false);
    expect(refoldRunsRepoCode(`bash ${refold}`, join(repo, "sub"), admitted)).toBe(false);
    expect(refoldRunsRepoCode(`bash ${refold} --root ${repo}`, "/elsewhere", admitted)).toBe(false);
  });

  it("is refused when the script would run the project's bump script: in the cwd, any folder above it, or the --root", () => {
    bumpIn(repo);
    expect(refoldRunsRepoCode(`bash ${refold}`, repo, admitted)).toBe(true);
    expect(refoldRunsRepoCode(`bash ${refold}`, join(repo, "sub"), admitted)).toBe(true);
    expect(refoldRunsRepoCode(`bash ${refold} --root ${repo}`, "/elsewhere", admitted)).toBe(true);
  });

  it("is refused with any other arguments, a relative or quoted --root, or no absolute cwd to read the default from", () => {
    for (const args of ["--help", "--root", `--root ${repo} --root /x`, "--root sub", `--root "${repo}"`, `x ${repo}`]) {
      expect(refoldRunsRepoCode(`bash ${refold} ${args}`, repo, admitted), args).toBe(true);
    }
    expect(refoldRunsRepoCode(`bash ${refold}`, undefined, admitted)).toBe(true);
    expect(refoldRunsRepoCode(`bash ${refold}`, "relative/dir", admitted)).toBe(true);
  });

  it("does not apply to any other command, or to a release-refold.sh that is not the admitted one", () => {
    bumpIn(repo);
    expect(refoldRunsRepoCode(`bash ${admitted[0]} --session-id s1`, repo, admitted)).toBe(false);
    expect(refoldRunsRepoCode(`bash ${join(repo, "release-refold.sh")}`, repo, admitted)).toBe(false);
    expect(refoldRunsRepoCode("git status", repo, admitted)).toBe(false);
  });
});
