// scripts/build.mjs removes its out dir recursively; scripts/out-dir-guard.mjs
// decides what it may remove. These tests run the REAL scripts, copied into a
// fake kernel tree under mkdtemp (never the real repo), with a stub tsc, and
// assert after every refusal that nothing was deleted.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REAL_SCRIPTS = fileURLToPath(new URL("../scripts/", import.meta.url));
const MARKER = ".studio-kernel-build";

// Writes "stub-output.js" into --outDir, standing in for tsc.
const STUB_TSC = `
const args = process.argv.slice(2);
const out = args[args.indexOf("--outDir") + 1];
require("node:fs").writeFileSync(require("node:path").join(out, "stub-output.js"), "// stub\\n");
`;

const roots: string[] = [];

// Runtime probes of the tmp filesystem, so alias tests run only where the
// alias exists (case-insensitive APFS/HFS+ on macOS; never Linux CI).
const PROBES = (() => {
  const dir = mkdtempSync(join(tmpdir(), "studio-build-guard-probe-"));
  try {
    writeFileSync(join(dir, "case-probe"), "");
    const caseInsensitive = existsSync(join(dir, "CASE-PROBE"));
    const firmlinked = join("/System/Volumes/Data", realpathSync(dir));
    const firmlink = process.platform === "darwin" && existsSync(join(firmlinked, "case-probe"));
    return { caseInsensitive, firmlink };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

// A fresh root dir, deliberately NOT realpathed (on macOS tmpdir() is under the
// /var -> /private/var alias, which the guard must see through).
function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "studio-build-guard-"));
  roots.push(root);
  return root;
}

// Lays out <parent>/kernel with the real build scripts, a stub typescript and
// sentinel files in kernel/src and kernel/dist. Returns the kernel dir.
function fakeKernel(parent: string): string {
  const kernel = join(parent, "kernel");
  mkdirSync(join(kernel, "scripts"), { recursive: true });
  for (const f of ["build.mjs", "out-dir-guard.mjs"]) {
    copyFileSync(join(REAL_SCRIPTS, f), join(kernel, "scripts", f));
  }
  const ts = join(kernel, "node_modules", "typescript");
  mkdirSync(join(ts, "bin"), { recursive: true });
  writeFileSync(join(ts, "package.json"), '{"name":"typescript","version":"0.0.0-stub"}\n');
  writeFileSync(join(ts, "bin", "tsc"), STUB_TSC);
  mkdirSync(join(kernel, "src"));
  writeFileSync(join(kernel, "src", "sentinel.txt"), "keep\n");
  mkdirSync(join(kernel, "dist"));
  writeFileSync(join(kernel, "dist", "sentinel.txt"), "keep\n");
  return kernel;
}

function runBuild(kernel: string, args: string[]): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [join(kernel, "scripts", "build.mjs"), ...args], {
    cwd: kernel,
    encoding: "utf8",
    timeout: 20_000,
  });
  return { status: r.status, stderr: r.stderr };
}

// `distSentinel: false` is for a tree with no real kernel/dist (a fresh
// checkout, a dangling kernel/dist symlink); every other caller keeps the check.
function expectRefused(
  kernel: string,
  args: string[],
  message: string,
  extraSentinels: string[] = [],
  { distSentinel = true }: { distSentinel?: boolean } = {},
): void {
  const r = runBuild(kernel, args);
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain(message);
  const sentinels = [join(kernel, "src", "sentinel.txt"), ...(distSentinel ? [join(kernel, "dist", "sentinel.txt")] : [])];
  for (const f of [...sentinels, ...extraSentinels]) {
    expect(existsSync(f), f).toBe(true);
  }
  expect(existsSync(join(kernel, "dist", "stub-output.js"))).toBe(false);
}

// Calls resolveBuildOutDir in a child process and returns what it printed: the
// refusal message, or "allowed". For targets the real build must NEVER run
// against ("/", a mount point): a guard regression there would wipe it.
function guardDirect(kernel: string, outDir: string): { status: number | null; stdout: string } {
  const child = `
const { resolveBuildOutDir } = await import(process.env.GUARD_URL);
try { resolveBuildOutDir(process.env.KERNEL_DIR, process.env.OUT_DIR); console.log("allowed"); }
catch (err) { console.log(err.message); }
`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      GUARD_URL: pathToFileURL(join(kernel, "scripts", "out-dir-guard.mjs")).href,
      KERNEL_DIR: kernel,
      OUT_DIR: outDir,
    },
    encoding: "utf8",
    timeout: 20_000,
  });
  return { status: r.status, stdout: r.stdout };
}

describe("build out-dir guard", () => {
  it("refuses an ancestor of kernel/ given relatively", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    expectRefused(kernel, ["--out-dir", ".."], "refusing");
  });

  it("refuses an ancestor of kernel/ given as an un-realpathed absolute path", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    expectRefused(kernel, ["--out-dir", root], "refusing");
  });

  it("refuses an ancestor whose next segment merely starts with '..'", () => {
    const root = newRoot();
    const kernel = fakeKernel(join(root, "A", "..evil"));
    expectRefused(kernel, ["--out-dir", join(root, "A")], "refusing");
  });

  it("refuses an ancestor reached through a symlinked path segment", () => {
    const root = newRoot();
    const kernel = fakeKernel(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "link"));
    expectRefused(kernel, ["--out-dir", join(root, "link")], "refusing");
  });

  it("refuses kernel/ itself, directly or through a symlink", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    expectRefused(kernel, ["--out-dir", "."], "refusing");
    symlinkSync(kernel, join(root, "kernel-link"));
    expectRefused(kernel, ["--out-dir", join(root, "kernel-link")], "refusing");
  });

  it("refuses a directory inside kernel/ other than kernel/dist", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    expectRefused(kernel, ["--out-dir", "src"], "inside the kernel directory");
  });

  it("refuses a non-empty directory outside kernel/ that no build created", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    const other = join(root, "documents");
    mkdirSync(other);
    writeFileSync(join(other, "precious.txt"), "keep\n");
    expectRefused(kernel, ["--out-dir", other], MARKER, [join(other, "precious.txt")]);
  });

  it("refuses an unknown argument and a missing --out-dir value without touching dist", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    expectRefused(kernel, ["--outdir", "x"], "unknown argument");
    expectRefused(kernel, ["--out-dir"], "--out-dir needs a value");
    expectRefused(kernel, ["--out-dir", ""], "--out-dir needs a value");
  });

  it("refuses a filesystem root (guard called directly: nothing can be deleted)", () => {
    // Never run the real build against "/": a guard regression would wipe it.
    const root = newRoot();
    const kernel = fakeKernel(root);
    const r = guardDirect(kernel, "/");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("refusing to use / as the build output directory: it is a filesystem root");
  });

  it.skipIf(!existsSync("/System/Volumes/Data") || process.platform !== "darwin")(
    "refuses the /System/Volumes/Data and /System/Volumes mount/firmlink ancestors, by the layer-5 marker check only (guard called directly) [skipped unless macOS: the path exists only there]",
    () => {
      // Never run the real build against a mount point: a guard regression
      // would wipe the data volume. kernel/'s real chain (/Users/... -> /)
      // does not pass through these, so layers 1 and 2 cannot catch them.
      const root = newRoot();
      const kernel = fakeKernel(root);
      for (const mount of ["/System/Volumes/Data", "/System/Volumes"]) {
        const r = guardDirect(kernel, mount);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain(`refusing to use ${mount} as the build output directory`);
        expect(r.stdout).toContain(`without the ${MARKER} marker`);
      }
    },
  );

  it("refuses a name other than dist inside kernel/ on a fresh checkout (no kernel/dist), creating nothing", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    rmSync(join(kernel, "dist"), { recursive: true });
    for (const name of ["build", "dist2"]) {
      expectRefused(kernel, ["--out-dir", name], "inside the kernel directory", [], { distSentinel: false });
      expect(existsSync(join(kernel, name)), name).toBe(false);
    }
    expect(existsSync(join(kernel, "dist"))).toBe(false);
  });

  it("refuses a missing path inside kernel/ while kernel/dist exists, creating nothing", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    expectRefused(kernel, ["--out-dir", join("new", "dir")], "inside the kernel directory");
    expect(existsSync(join(kernel, "new"))).toBe(false);
  });

  it("refuses the default build through a dangling kernel/dist symlink (fail closed), leaving the link and its target alone", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    rmSync(join(kernel, "dist"), { recursive: true });
    const nowhere = join(root, "nowhere");
    symlinkSync(nowhere, join(kernel, "dist"));
    expectRefused(kernel, [], "kernel/dist exists but is not a directory", [], { distSentinel: false });
    expect(lstatSync(join(kernel, "dist")).isSymbolicLink()).toBe(true);
    expect(existsSync(nowhere)).toBe(false);
    expect(existsSync(join(kernel, "src", "sentinel.txt"))).toBe(true);
  });

  it.skipIf(!PROBES.caseInsensitive)(
    "refuses a case-altered ancestor even when it carries the build marker [skipped unless the tmp filesystem is case-insensitive]",
    () => {
      const root = newRoot();
      const base = join(root, "base");
      const kernel = fakeKernel(base);
      const marker = join(base, MARKER);
      writeFileSync(marker, "planted\n");
      expectRefused(kernel, ["--out-dir", join(root, "BASE")], "the kernel directory or contains it", [
        marker,
        join(kernel, "scripts", "build.mjs"),
      ]);
    },
  );

  it.skipIf(!PROBES.caseInsensitive)(
    "refuses a case-altered kernel/, kernel/src and kernel subdir [skipped unless the tmp filesystem is case-insensitive]",
    () => {
      const root = newRoot();
      const base = join(root, "base");
      const kernel = fakeKernel(base);
      const empty = join(kernel, "emptydir");
      mkdirSync(empty);
      expectRefused(kernel, ["--out-dir", join(base, "KERNEL")], "the kernel directory or contains it");
      expectRefused(kernel, ["--out-dir", join(base, "KERNEL", "src")], "inside the kernel directory");
      expectRefused(kernel, ["--out-dir", join(base, "kernel", "SRC")], "inside the kernel directory");
      expectRefused(kernel, ["--out-dir", join(base, "KERNEL", "emptydir")], "inside the kernel directory");
      expectRefused(kernel, ["--out-dir", join(base, "KERNEL", "new", "dir")], "inside the kernel directory");
      expect(readdirSync(empty)).toEqual([]);
      expect(existsSync(join(kernel, "new"))).toBe(false);
    },
  );

  it.skipIf(!PROBES.firmlink)(
    "refuses a /System/Volumes/Data firmlink alias of an ancestor and of a kernel subdir [skipped unless /System/Volumes/Data firmlinks exist (macOS)]",
    () => {
      const root = newRoot();
      const base = join(root, "base");
      const kernel = fakeKernel(base);
      const marker = join(base, MARKER);
      writeFileSync(marker, "planted\n");
      const empty = join(kernel, "empty");
      mkdirSync(empty);
      const alias = (p: string): string => join("/System/Volumes/Data", realpathSync(p));
      expectRefused(kernel, ["--out-dir", alias(base)], "the kernel directory or contains it", [marker]);
      expectRefused(kernel, ["--out-dir", alias(kernel)], "the kernel directory or contains it");
      expectRefused(kernel, ["--out-dir", alias(empty)], "inside the kernel directory");
      expect(readdirSync(empty)).toEqual([]);
    },
  );

  it("refuses a kernel/dist that is a symlink into kernel/", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    rmSync(join(kernel, "dist"), { recursive: true });
    symlinkSync(join(kernel, "src"), join(kernel, "dist"));
    expectRefused(kernel, [], "inside the kernel directory");
    expect(readdirSync(join(kernel, "src"))).toEqual(["sentinel.txt"]);
  });

  it("refuses a regular file as --out-dir", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    const file = join(root, "notes.txt");
    writeFileSync(file, "keep\n");
    expectRefused(kernel, ["--out-dir", file], "it exists and is not a directory", [file]);
  });

  it("fails without deleting anything when a parent of --out-dir is a regular file", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    const file = join(root, "notes.txt");
    writeFileSync(file, "keep\n");
    expectRefused(kernel, ["--out-dir", join(file, "sub")], "ENOTDIR", [file]);
  });

  it("control: a nested not-yet-existing dir outside kernel/ is created and built into", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    const out = join(root, "a", "b", "c");
    const r = runBuild(kernel, ["--out-dir", out]);
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(out).sort()).toEqual([MARKER, "stub-output.js"]);
    expect(existsSync(join(kernel, "dist", "sentinel.txt"))).toBe(true);
  });

  it("control: a symlink --out-dir to a marked dir rebuilds the target and keeps the link", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    const target = join(root, "out");
    mkdirSync(target);
    writeFileSync(join(target, MARKER), "");
    writeFileSync(join(target, "stale.js"), "// stale\n");
    const link = join(root, "out-link");
    symlinkSync(target, link);
    const r = runBuild(kernel, ["--out-dir", link]);
    expect(r.status, r.stderr).toBe(0);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readdirSync(target).sort()).toEqual([MARKER, "stub-output.js"]);
  });

  it("control: on a fresh checkout (no kernel/dist) the default build creates it", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    rmSync(join(kernel, "dist"), { recursive: true });
    const r = runBuild(kernel, []);
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(join(kernel, "dist")).sort()).toEqual([MARKER, "stub-output.js"]);
    expect(existsSync(join(kernel, "src", "sentinel.txt"))).toBe(true);
  });

  it("control: the default build wipes and rebuilds kernel/dist", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    const r = runBuild(kernel, []);
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(join(kernel, "dist")).sort()).toEqual([MARKER, "stub-output.js"]);
    expect(existsSync(join(kernel, "src", "sentinel.txt"))).toBe(true);
  });

  it("control: an empty outside dir is built into, and a rebuild clears its stale files", () => {
    const root = newRoot();
    const kernel = fakeKernel(root);
    const out = join(root, "out");
    mkdirSync(out);
    expect(runBuild(kernel, ["--out-dir", out]).status).toBe(0);
    writeFileSync(join(out, "stale.js"), "// stale\n");
    const r = runBuild(kernel, ["--out-dir", out]);
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(out).sort()).toEqual([MARKER, "stub-output.js"]);
    expect(existsSync(join(kernel, "dist", "sentinel.txt"))).toBe(true);
  });
});
