// scripts/build.mjs removes its out dir recursively; scripts/out-dir-guard.mjs
// decides what it may remove. These tests run the REAL scripts, copied into a
// fake kernel tree under mkdtemp (never the real repo), with a stub tsc, and
// assert after every refusal that nothing was deleted.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

function expectRefused(kernel: string, args: string[], message: string, extraSentinels: string[] = []): void {
  const r = runBuild(kernel, args);
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain(message);
  for (const f of [join(kernel, "src", "sentinel.txt"), join(kernel, "dist", "sentinel.txt"), ...extraSentinels]) {
    expect(existsSync(f), f).toBe(true);
  }
  expect(existsSync(join(kernel, "dist", "stub-output.js"))).toBe(false);
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
    const child = `
const { resolveBuildOutDir } = await import(process.env.GUARD_URL);
try { resolveBuildOutDir(process.env.KERNEL_DIR, "/"); console.log("allowed"); }
catch (err) { console.log(err.message); }
`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      env: {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        GUARD_URL: pathToFileURL(join(kernel, "scripts", "out-dir-guard.mjs")).href,
        KERNEL_DIR: kernel,
      },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("refusing to use / as the build output directory: it is a filesystem root");
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
