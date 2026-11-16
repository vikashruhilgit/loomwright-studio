// `sessions/loomwright-scripts.ts` (phase 8 item 22g, AC15/AC16): the exact
// Loomwright script paths a run policy's names admit under an install, and the
// pure matcher `decideToolUse` uses. Every install here is a temp dir; nothing
// reads a real plugin cache.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOOMWRIGHT_SCRIPTS_DIR, loomwrightScriptPaths, matchLoomwrightScript } from "../src/sessions/loomwright-scripts.js";

let tmp: string;
let install: string;
let scripts: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-lw-scripts-"));
  install = join(tmp, "loomwright", "17.38.0");
  scripts = join(install, LOOMWRIGHT_SCRIPTS_DIR);
  mkdirSync(scripts, { recursive: true });
});

afterEach(() => {
  chmodSync(scripts, 0o755);
  rmSync(tmp, { recursive: true, force: true });
});

const script = (dir: string, name: string): string => {
  const path = join(dir, name);
  writeFileSync(path, "#!/bin/bash\n");
  return path;
};

/** The admitted paths, or a test failure naming the refusal. */
function admitted(installPath: string, names: readonly string[] | undefined): readonly string[] {
  const read = loomwrightScriptPaths(installPath, names);
  if (!read.ok) throw new Error(`refused: ${read.message}`);
  return read.paths;
}

describe("loomwrightScriptPaths: the exact admitted set (AC15)", () => {
  it("is the lexical `<install>/scripts/<name>` of each named regular file, in the order named, frozen, without repeats", () => {
    const next = script(scripts, "automate-next-step.sh");
    const helpers = script(scripts, "automate-helpers.sh");
    const paths = admitted(install, ["automate-next-step.sh", "automate-helpers.sh", "automate-next-step.sh"]);
    expect(paths).toEqual([next, helpers]);
    expect(paths).toEqual([join(install, "scripts", "automate-next-step.sh"), join(install, "scripts", "automate-helpers.sh")]);
    expect(Object.isFrozen(paths)).toBe(true);
  });

  it("admits only the named scripts: an unlisted script under scripts/ is denied", () => {
    const next = script(scripts, "automate-next-step.sh");
    const unlisted = script(scripts, "automate-wave.sh");
    script(scripts, "test-automate-next-step.sh");
    const paths = admitted(install, ["automate-next-step.sh"]);
    expect(paths).toEqual([next]);
    expect(matchLoomwrightScript(`bash ${unlisted}`, paths)).toBeUndefined();
    expect(matchLoomwrightScript(`bash ${next} --resume /w`, paths)).toBe(next);
  });

  it("leaves out a named script the install does not hold, a directory, and an empty name", () => {
    const next = script(scripts, "automate-next-step.sh");
    mkdirSync(join(scripts, "drain-rounds.sh"));
    expect(admitted(install, ["automate-next-step.sh", "automate-helpers.sh", "drain-rounds.sh", ""])).toEqual([next]);
  });

  it("does not admit a symlink escaping scripts/", () => {
    const outside = join(tmp, "elsewhere");
    mkdirSync(outside);
    const evil = script(outside, "evil.sh");
    symlinkSync(evil, join(scripts, "automate-helpers.sh"));
    const next = script(scripts, "automate-next-step.sh");
    const paths = admitted(install, ["automate-helpers.sh", "automate-next-step.sh"]);
    expect(paths).toEqual([next]);
    expect(matchLoomwrightScript(`bash ${join(scripts, "automate-helpers.sh")} meta-entry`, paths)).toBeUndefined();
  });

  it("does not admit a renamed script: a symlink to another file inside scripts/ is not that name", () => {
    const wave = script(scripts, "automate-wave.sh");
    symlinkSync(wave, join(scripts, "automate-next-step.sh"));
    expect(admitted(install, ["automate-next-step.sh"])).toEqual([]);
  });

  it("denies a `..` path into scripts/, or out of it beside it", () => {
    script(scripts, "automate-next-step.sh");
    script(install, "beside.sh");
    expect(admitted(install, ["../scripts/automate-next-step.sh"])).toEqual([]);
    expect(admitted(install, ["../beside.sh"])).toEqual([]);
    expect(admitted(install, ["./../beside.sh"])).toEqual([]);
  });

  it("admits through a symlinked install root (the realpath of the file is still <realpath install>/scripts/<name>), as the lexical path the session sees", () => {
    const next = script(scripts, "automate-next-step.sh");
    const link = join(tmp, "active");
    symlinkSync(install, link);
    expect(admitted(link, ["automate-next-step.sh"])).toEqual([join(link, "scripts", "automate-next-step.sh")]);
    expect(admitted(install, ["automate-next-step.sh"])).toEqual([next]);
  });

  it("does not admit through a scripts/ that is itself a symlink elsewhere", () => {
    const real = join(tmp, "other-scripts");
    mkdirSync(real);
    script(real, "automate-next-step.sh");
    const other = join(tmp, "loomwright", "17.39.0");
    mkdirSync(other, { recursive: true });
    symlinkSync(real, join(other, "scripts"));
    expect(admitted(other, ["automate-next-step.sh"])).toEqual([]);
  });

  it("names nothing ⇒ an empty set without reading the install (absent, empty, and a missing scripts/ all answer ok)", () => {
    const bare = join(tmp, "bare-install");
    mkdirSync(bare);
    expect(loomwrightScriptPaths(bare, undefined)).toEqual({ ok: true, paths: [] });
    expect(loomwrightScriptPaths(bare, [])).toEqual({ ok: true, paths: [] });
    expect(loomwrightScriptPaths(join(tmp, "no-such-install"), [])).toEqual({ ok: true, paths: [] });
  });
});

describe("loomwrightScriptPaths: an unreadable scripts/ refuses (AC16)", () => {
  it("a missing scripts/ directory is not ok and names it", () => {
    const bare = join(tmp, "bare-install");
    mkdirSync(bare);
    const read = loomwrightScriptPaths(bare, ["automate-next-step.sh"]);
    expect(read).toMatchObject({ ok: false, path: join(bare, "scripts") });
    expect(!read.ok && read.message).toMatch(/scripts directory .* cannot be read \(ENOENT\)/);
  });

  it("a relative or empty install path is not ok: it would admit paths the session's cwd resolves", () => {
    for (const relative of ["", ".", "loomwright/17.38.0"]) {
      expect(loomwrightScriptPaths(relative, ["automate-next-step.sh"]), JSON.stringify(relative)).toMatchObject({ ok: false, path: relative });
    }
  });

  it("a scripts/ that is a file is not ok", () => {
    const flat = join(tmp, "flat-install");
    mkdirSync(flat);
    writeFileSync(join(flat, "scripts"), "not a directory\n");
    const read = loomwrightScriptPaths(flat, ["automate-next-step.sh"]);
    expect(read).toMatchObject({ ok: false, path: join(flat, "scripts") });
    expect(!read.ok && read.message).toMatch(/is not a directory/);
  });

  it.skipIf(process.getuid?.() === 0)("a scripts/ the kernel cannot read is not ok", () => {
    script(scripts, "automate-next-step.sh");
    chmodSync(scripts, 0o000);
    const read = loomwrightScriptPaths(install, ["automate-next-step.sh"]);
    expect(read).toMatchObject({ ok: false, path: scripts });
    expect(!read.ok && read.message).toMatch(/cannot be read \(EACCES\)/);
  });
});

describe("matchLoomwrightScript: `bash <path>` for an exact admitted path only (AC15)", () => {
  const next = "/lw/17.38.0/scripts/automate-next-step.sh";
  const spaced = "/Users/o/Library/Application Support/lw/scripts/automate-helpers.sh";
  const set = [next, spaced];

  it("admits the double-quoted path form and not a single-quoted one", () => {
    expect(matchLoomwrightScript(`bash "${next}" --resume /w`, set)).toBe(next);
    expect(matchLoomwrightScript(`bash "${next}"`, set)).toBe(next);
    expect(matchLoomwrightScript(`bash '${next}' --resume /w`, set)).toBeUndefined();
    expect(matchLoomwrightScript(`bash '${next}'`, set)).toBeUndefined();
  });

  it("a path with a space matches only double-quoted", () => {
    expect(matchLoomwrightScript(`bash "${spaced}" meta-entry`, set)).toBe(spaced);
    expect(matchLoomwrightScript(`bash ${spaced} meta-entry`, set)).toBeUndefined();
  });

  it("arguments follow one space; nothing may be glued to the path or its closing quote", () => {
    expect(matchLoomwrightScript(`bash ${next} --resume /w --run latest`, set)).toBe(next);
    expect(matchLoomwrightScript(`bash ${next}`, set)).toBe(next);
    for (const command of [`bash "${next}"x`, `bash "${next}"'x'`, `bash ${next}"x"`, `bash ${next}\t--resume`, `bash "${next}`]) {
      expect(matchLoomwrightScript(command, set), command).toBeUndefined();
    }
  });

  it("a quoted path holding a backslash, `$` or backtick, or an unquoted one holding a glob, brace, tilde or quote, is no match even when the set holds that text", () => {
    for (const odd of ["/lw/scr\\ipts/a.sh", "/lw/$x/a.sh", "/lw/`x`/a.sh"]) expect(matchLoomwrightScript(`bash "${odd}"`, [odd]), odd).toBeUndefined();
    for (const odd of ["/lw/*/a.sh", "/lw/{a,b}/a.sh", "/lw/~/a.sh", "/lw/a'b/a.sh", "/lw/a?/a.sh", "/lw/[a]/a.sh", "/lw/!a/a.sh", "/lw/#a/a.sh"]) {
      expect(matchLoomwrightScript(`bash ${odd}`, [odd]), odd).toBeUndefined();
    }
  });

  it("another program, a flag before the path, a relative path, or an empty set is no match", () => {
    for (const command of ["bash", "bash ", `bash -c ${next}`, `bash -x ${next}`, `sh ${next}`, `zsh ${next}`, `${next}`, "bash automate-next-step.sh", `bash  ${next}`, ` bash ${next}`]) {
      expect(matchLoomwrightScript(command, set), command).toBeUndefined();
    }
    expect(matchLoomwrightScript(`bash ${next}`, [])).toBeUndefined();
    // A relative path never matches, quoted or not, even when the set holds that text.
    expect(matchLoomwrightScript('bash "scripts/automate-next-step.sh"', ["scripts/automate-next-step.sh"])).toBeUndefined();
    expect(matchLoomwrightScript("bash scripts/automate-next-step.sh", ["scripts/automate-next-step.sh"])).toBeUndefined();
  });
});
