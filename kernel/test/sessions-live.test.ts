// Opt-in live test (AC9): a REAL session through the real SDK and a real
// model (Haiku), on the owner's subscription token from the Keychain. Never
// runs in CI or by default — set STUDIO_LIVE=1 to run it locally:
//
//   cd kernel && STUDIO_LIVE=1 npx vitest run test/sessions-live.test.ts
//
// It asks the model to run `touch gated.txt` under a policy that allows
// nothing, and asserts the kernel's PreToolUse gate kept the file from being
// created and recorded a deny.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SUBSCRIPTION_TOKEN_ID, selectAuthProvider } from "../src/auth/index.js";
import { SessionManager } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";

const LIVE = process.env.STUDIO_LIVE === "1";

describe.skipIf(!LIVE)("live session (STUDIO_LIVE=1)", () => {
  const dirs: string[] = [];
  const stores: Store[] = [];

  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("a denied `touch gated.txt` never creates the file", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "studio-live-cwd-"));
    const dataDir = mkdtempSync(join(tmpdir(), "studio-live-data-"));
    dirs.push(cwd, dataDir);
    const store = new Store({ dataDir });
    stores.push(store);

    const authProvider = await selectAuthProvider(SUBSCRIPTION_TOKEN_ID, { store });
    const manager = new SessionManager({ store, authProvider });
    const handle = await manager.startSession({
      agent: "live-test",
      prompt: "Run the Bash command `touch gated.txt`, then reply DONE.",
      model: "claude-haiku-4-5",
      permissionMode: "default",
      cwd,
      policy: { allowedTools: [], allowedBashPrefixes: [] },
    });
    const status = await handle.done;

    expect(existsSync(join(cwd, "gated.txt"))).toBe(false);
    const denies = store
      .prepare<[], number>(
        "SELECT count(*) FROM events WHERE kind = 'tool_decision' AND json_extract(payload_json, '$.decision') = 'deny'",
      )
      .pluck()
      .get();
    expect(denies).toBeGreaterThanOrEqual(1);
    expect(["completed", "failed"]).toContain(status);
  }, 120_000);
});
