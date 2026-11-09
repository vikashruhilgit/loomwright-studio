// Shared set-up for the automate runner's tests (`automate-runner.test.ts`,
// `automate-merge-check.test.ts`): a git checkout of a fictitious repo, a crew
// member whose settings list it as a workspace, and Loomwright's run-file
// fixtures (this folder's scenario subfolders) copied into the checkout. Nothing
// here touches the network, the Keychain or a real Loomwright.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentSettingsPath } from "../../../src/agents/index.js";
import type { ContributedTool } from "../../../src/features/index.js";
import { Store } from "../../../src/store/index.js";
import { contributedToolHandler } from "../../../src/tools/server.js";
import type { KernelToolContext } from "../../../src/tools/server.js";

/** The folder holding the scenario subfolders. */
const FIXTURE_DIR = fileURLToPath(new URL(".", import.meta.url));

/** The head every fixture run file marks READY, and the PR number they all park. */
export const HEAD = "a".repeat(40);
export const PR = 7;
export const READY_AT = "2026-11-08T07:36:18Z";
export const PARKED_RUN_ID = "2026-11-08-072502-stories";
export const LIVE_RUN_ID = "2026-11-09-100000-stories";

/** One of this folder's scenario subfolders. */
export type Scenario = "live" | "parked" | "done" | "escalated";

/** A fresh temp directory under the OS temp dir. */
export function tempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A git checkout of `url`'s repo under `root/<name>`: a `.git/config` with one `origin` remote, which is all the kernel reads. */
export function makeCheckout(root: string, name: string, url = "https://github.com/o/r.git"): string {
  const dir = join(root, name);
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "config"), `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
  return dir;
}

/** Copies each `scenario` folder's files into `checkout/.supervisor/automate/`. */
export function installRunFiles(checkout: string, ...scenarios: readonly Scenario[]): void {
  const dest = join(checkout, ".supervisor", "automate");
  mkdirSync(dest, { recursive: true });
  for (const s of scenarios) cpSync(join(FIXTURE_DIR, s), dest, { recursive: true });
}

/** Writes `.supervisor/run.lock/meta` as `run-lock.sh` does (tab-separated), naming `pid` as the holder. */
export function writeRunLock(checkout: string, pid: number): void {
  const dir = join(checkout, ".supervisor", "run.lock");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta"), `pid\t${pid}\nowner\tautomate\nsession_id\ts1\nts\t2026-11-09T10:00:00Z\npid_source\tclaude_pid\n`);
}

/** A crew member's settings file (`config/agents/<id>.json`): the GitHub write grant and `workspaces`. */
export function writeCrewSettings(dataDir: string, id: string, workspaces: readonly string[], connectors: unknown = { github: "write" }): void {
  const file = agentSettingsPath(dataDir, id);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      model: "claude-haiku-4-5",
      permission_mode: "default",
      tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] },
      connectors,
      workspaces,
    }),
  );
}

/** The clock the tools see. */
export const NOW = new Date("2026-11-09T10:00:00.000Z");

/** The session a tool is called from. `playbook: null` is a chat session; `dry` writes the `session_dry_run` event the manager writes with a dry run's row. */
export interface CallingSession {
  readonly playbook: number | null;
  readonly agent?: string | null;
  readonly dry?: boolean;
}

/** What a tool call answered: `isError` with its text, or the JSON value. */
export type ToolAnswer = { readonly isError: true; readonly text: string } | { readonly isError: false; readonly value: unknown };

/** A temp data dir and store, a crew member `mason` whose workspace is a checkout of `o/r`, and a way to call a tool as a session of a playbook. */
export interface ToolEnv {
  readonly root: string;
  readonly dataDir: string;
  readonly store: Store;
  /** The checkout of `o/r` (mason's workspace). */
  readonly checkout: string;
  /** Inserts a playbook of mason's; returns its id. */
  playbook(mode: "draft" | "live", mergeRequirement?: string): number;
  /** The context a tool handler (or a `beforeHold`) gets, as a call from `session` (each call is a new session id). */
  context(session: CallingSession): KernelToolContext;
  /** Calls `name` of `tools` through the tool server's own handler (zod-validated, never throws). */
  call(tools: readonly ContributedTool[], name: string, args: unknown, session: CallingSession): Promise<ToolAnswer>;
  close(): void;
}

/** A tool environment. `close()` removes every file and closes the store. */
export function toolEnv(prefix = "studio-automate-"): ToolEnv {
  const root = tempRoot(prefix);
  const dataDir = join(root, "data");
  const store = new Store({ dataDir });
  const checkout = makeCheckout(root, "o-r");
  writeCrewSettings(dataDir, "mason", [checkout]);
  let sessions = 0;
  let playbooks = 0;
  const context = (session: CallingSession): KernelToolContext => {
    const sessionId = ++sessions;
    if (session.dry === true) {
      store.prepare("INSERT INTO events (at, kind, actor, session_id, payload_json) VALUES (?, 'session_dry_run', 'kernel', ?, '{}')").run(NOW.toISOString(), sessionId);
    }
    const row = { id: sessionId, agent: session.agent === undefined ? "mason" : session.agent, playbook: session.playbook };
    return {
      store,
      sessions: { stopSession: async () => "stopped", getSession: () => row } as unknown as KernelToolContext["sessions"],
      sessionId,
      now: () => NOW,
    };
  };
  return {
    root,
    dataDir,
    store,
    checkout,
    playbook(mode, mergeRequirement = "none") {
      const slug = `pb${++playbooks}`;
      return Number(
        store
          .prepare("INSERT INTO playbooks (slug, name, owning_agent, intent, version, mode, merge_requirement) VALUES (?, ?, 'mason', 'Hand tickets over', 1, ?, ?)")
          .run(slug, slug, mode, mergeRequirement).lastInsertRowid,
      );
    },
    context,
    async call(tools, name, args, session) {
      const tool = tools.find((t) => t.name === name);
      if (tool === undefined) throw new Error(`no tool ${name}`);
      const result = await contributedToolHandler(tool, context(session))(args);
      const text = result.content[0]?.text ?? "";
      return result.isError === true ? { isError: true, text } : { isError: false, value: JSON.parse(text) as unknown };
    },
    close() {
      if (store.isOpen) store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
