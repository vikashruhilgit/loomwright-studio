// AC6 / D29: a STUDIO_DISTRIBUTION=1 build leaves the subscription-token
// provider out of the output entirely. Builds with the real scripts/build.mjs
// into mkdtemp dirs outside kernel/, then loads the BUILT registry in a plain
// Node child (never in the vitest process: its module runner reports a
// missing module differently from Node, and the registry's narrow catch must
// be tested against Node's real ERR_MODULE_NOT_FOUND).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const KERNEL_DIR = fileURLToPath(new URL("..", import.meta.url));
const BUILD_SCRIPT = join(KERNEL_DIR, "scripts", "build.mjs");
const BUILD_TIMEOUT_MS = 60_000;

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function build(distribution: boolean): string {
  const out = mkdtempSync(join(tmpdir(), distribution ? "studio-dist-" : "studio-personal-"));
  dirs.push(out);
  const env: Record<string, string | undefined> = { ...process.env };
  delete env["STUDIO_DISTRIBUTION"];
  if (distribution) env["STUDIO_DISTRIBUTION"] = "1";
  execFileSync(process.execPath, [BUILD_SCRIPT, "--out-dir", out], {
    cwd: KERNEL_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: BUILD_TIMEOUT_MS,
  });
  // The out dir is outside kernel/: mark it ESM for the plain Node child.
  writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
  return out;
}

function filesUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, encoding: "utf8" }) as string[])
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile());
}

// Runs in a plain Node child against the built registry, printing JSON.
const CHILD_SCRIPT = `
const reg = await import(process.env.REGISTRY_URL);
const keychain = { read: (service) => (service === "loomwright-studio-api-key" ? "fake-api-key" : undefined) };
const ids = await reg.availableProviderIds();
let subscription;
try {
  const p = await reg.selectAuthProvider("subscription-token", { keychain });
  subscription = { selected: p.id };
} catch (err) {
  subscription = { code: err.code ?? null, name: err.name ?? null };
}
const api = await reg.selectAuthProvider("api-key", { keychain });
const env = api.buildEnv({ PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "stray" });
console.log(JSON.stringify({ ids, subscription, apiEnvKeys: Object.keys(env).sort() }));
`;

interface ChildReport {
  ids: string[];
  subscription: { selected?: string; code?: string | null; name?: string | null };
  apiEnvKeys: string[];
}

function loadBuiltRegistry(out: string): ChildReport {
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", CHILD_SCRIPT], {
    cwd: out,
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      REGISTRY_URL: pathToFileURL(join(out, "auth", "registry.js")).href,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
  });
  return JSON.parse(stdout.trim()) as ChildReport;
}

describe("distribution build (AC6, D29)", () => {
  it(
    "STUDIO_DISTRIBUTION=1 emits no subscription provider and its registry refuses it",
    () => {
      const out = build(true);
      expect(existsSync(join(out, "auth", "registry.js"))).toBe(true);
      expect(existsSync(join(out, "auth", "subscription-token.js"))).toBe(false);

      const files = filesUnder(out);
      expect(files.some((f) => f.includes("subscription-token"))).toBe(false);
      const naming = files.filter((f) => readFileSync(f, "utf8").includes("loomwright-studio-oauth"));
      expect(naming).toEqual([]);

      const report = loadBuiltRegistry(out);
      expect(report.ids).toEqual(["api-key"]);
      expect(report.ids).not.toContain("subscription-token");
      expect(report.subscription).toEqual({ code: "unavailable", name: "AuthProviderError" });
      // The rest of the auth layer still works in the distribution build.
      expect(report.apiEnvKeys).toEqual(["ANTHROPIC_API_KEY", "PATH"]);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "control: the personal build (no flag) emits it and its registry selects it",
    () => {
      const out = build(false);
      expect(existsSync(join(out, "auth", "subscription-token.js"))).toBe(true);
      expect(readFileSync(join(out, "auth", "subscription-token.js"), "utf8")).toContain(
        "loomwright-studio-oauth",
      );

      const report = loadBuiltRegistry(out);
      expect(report.ids).toEqual(["api-key", "subscription-token"]);
      expect(report.subscription).toEqual({ selected: "subscription-token" });
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "a module missing INSIDE the provider is rethrown, never mistaken for a distribution build",
    () => {
      const out = build(false);
      writeFileSync(
        join(out, "auth", "subscription-token.js"),
        'import "./no-such-module.js";\nexport function createSubscriptionTokenProvider() {}\n',
      );
      let failure: { status: number | null; stderr: string } | undefined;
      try {
        loadBuiltRegistry(out);
      } catch (err) {
        const e = err as { status: number | null; stderr: string };
        failure = { status: e.status, stderr: String(e.stderr) };
      }
      expect(failure?.status).not.toBe(0);
      expect(failure?.stderr).toContain("ERR_MODULE_NOT_FOUND");
      expect(failure?.stderr).toContain("no-such-module.js");
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "a distribution build into a dir holding a stale personal build removes the stale provider",
    () => {
      const out = build(false);
      expect(existsSync(join(out, "auth", "subscription-token.js"))).toBe(true);
      execFileSync(process.execPath, [BUILD_SCRIPT, "--out-dir", out], {
        cwd: KERNEL_DIR,
        env: { ...process.env, STUDIO_DISTRIBUTION: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: BUILD_TIMEOUT_MS,
      });
      expect(existsSync(join(out, "auth", "registry.js"))).toBe(true);
      expect(existsSync(join(out, "auth", "subscription-token.js"))).toBe(false);
    },
    BUILD_TIMEOUT_MS,
  );
});
