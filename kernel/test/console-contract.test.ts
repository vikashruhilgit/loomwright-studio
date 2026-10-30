// The app's API contract, pinned from the kernel side (phase 5 item 01).
// `app/src/api/contract.ts` is read as TEXT, never imported: the kernel's
// tsconfig includes only `src` and `test`, and its build stays `rootDir src`,
// so no kernel file may depend on the app package. Four pins:
//
//   1. `CONTRACT_ROUTES`' methods, paths and origins equal the list written
//      literally below, each route once, so a route can't be added, dropped or
//      renamed in the contract without this test saying so.
//   2. Every route the contract marks existing (an origin that is not a phase 5
//      `item-NN` or a phase 6 `p6-item-NN`) is one the kernel serves today: a
//      phase 1 route or a shipped contribution's route, same method and same
//      declared path. The routes phase 5 and phase 6 items add are not checked
//      here; each item's own test pins its route against the contract.
//   3. The contract's `SessionOutputKind` union carries exactly the values of
//      `SESSION_OUTPUT_KINDS` (`kernel/src/console/output.ts`).
//   4. The playbook card's `POLICY_FIELDS` and `READ_ONLY_POLICY_FIELDS`
//      (`app/src/screens/chat/cards.tsx`, also read as text) are together exactly
//      `PLAYBOOK_POLICY_FIELDS` (`kernel/src/playbooks/store.ts`), in order.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENT_FEED_PATH } from "../src/api/feed.js";
import { SESSION_OUTPUT_KINDS } from "../src/console/output.js";
import { PHASE1_RESERVED, PHASE1_ROUTES, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { PLAYBOOK_POLICY_FIELDS } from "../src/playbooks/store.js";

const CONTRACT = new URL("../../app/src/api/contract.ts", import.meta.url);
const PLAYBOOK_CARDS = new URL("../../app/src/screens/chat/cards.tsx", import.meta.url);

interface ContractEntry {
  readonly method: string;
  readonly path: string;
  readonly origin: string;
}

/** One `CONTRACT_ROUTES` entry, on one line, as contract.ts's header asks. */
const ENTRY_LINE = /^\{ method: "([A-Z]+)", path: "([^"]+)", origin: "([a-z0-9-]+)" \},$/;

/**
 * The `CONTRACT_ROUTES` entries in `text`, in order. Every non-blank line
 * between the declaration and its closing `]);` must be one entry: a line in
 * any other shape (an entry split over lines, a comment, a spread) throws,
 * so a reformatted contract fails loudly instead of losing entries silently.
 */
function contractRoutes(text: string): ContractEntry[] {
  const open = text.indexOf("export const CONTRACT_ROUTES");
  if (open === -1) throw new Error("contract.ts has no `export const CONTRACT_ROUTES`");
  const start = text.indexOf("Object.freeze([", open);
  const end = text.indexOf("]);", start);
  if (start === -1 || end === -1) throw new Error("CONTRACT_ROUTES is not an `Object.freeze([ … ]);` list");
  const body = text.slice(start + "Object.freeze([".length, end);
  const entries: ContractEntry[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const match = ENTRY_LINE.exec(line);
    if (match === null) throw new Error(`CONTRACT_ROUTES line is not one entry: ${line}`);
    entries.push({ method: match[1] ?? "", path: match[2] ?? "", origin: match[3] ?? "" });
  }
  return entries;
}

/** The string literals of `export type SessionOutputKind = "…" | "…";`, refusing anything else in the union. */
function sessionOutputKindUnion(text: string): string[] {
  const match = /export type SessionOutputKind =([^;]*);/.exec(text);
  if (match === null) throw new Error("contract.ts has no `export type SessionOutputKind = …;`");
  const members = (match[1] ?? "").split("|").map((m) => m.trim());
  return members.map((member) => {
    const literal = /^"([a-z_]+)"$/.exec(member);
    if (literal === null) throw new Error(`SessionOutputKind member is not a string literal: ${member}`);
    return literal[1] ?? "";
  });
}

/**
 * Every route the app calls, written out here so a change to the contract's
 * list is a change to this test too. The existing routes are the kernel's at
 * the phase 5 base; `item-NN` routes are the ones phase 5 items 02-06 add
 * (item 07 adds none: it widens `POST /agents/:id/set`), and `p6-item-NN`
 * routes the ones phase 6 items 03 and 07 add (item 08 adds none: it widens
 * `POST /agents/:id/set` to take `connectors`); `github-app` routes are the
 * GitHub App connect's two owner routes (D36), which the kernel serves as 501 stubs.
 */
const EXPECTED_ROUTES: readonly ContractEntry[] = [
  { method: "GET", path: "/status", origin: "phase-1" },
  { method: "POST", path: "/stop-all", origin: "phase-1" },
  { method: "POST", path: "/resume", origin: "phase-1" },
  { method: "POST", path: "/sessions/:id/abandon", origin: "phase-1" },
  { method: "POST", path: "/ask", origin: "brain" },
  { method: "GET", path: "/messages", origin: "brain" },
  { method: "GET", path: "/messages/:id", origin: "brain" },
  { method: "GET", path: "/notifications", origin: "notifications" },
  { method: "GET", path: "/notifications/:id", origin: "notifications" },
  { method: "GET", path: "/approvals", origin: "approvals" },
  { method: "POST", path: "/approvals/:id/approve", origin: "approvals" },
  { method: "POST", path: "/approvals/:id/deny", origin: "approvals" },
  { method: "GET", path: "/approvals/grants", origin: "approvals" },
  { method: "POST", path: "/approvals/grants/:id/revoke", origin: "approvals" },
  { method: "GET", path: "/triggers", origin: "triggers" },
  { method: "POST", path: "/triggers/:id/on", origin: "triggers" },
  { method: "POST", path: "/triggers/:id/off", origin: "triggers" },
  { method: "GET", path: "/playbooks", origin: "playbooks" },
  { method: "GET", path: "/playbooks/:ref", origin: "playbooks" },
  { method: "POST", path: "/playbooks/:id/set", origin: "playbooks" },
  { method: "POST", path: "/playbooks/:id/off", origin: "playbooks" },
  { method: "POST", path: "/playbooks/:id/run", origin: "playbooks" },
  { method: "GET", path: "/agents", origin: "agents" },
  { method: "GET", path: "/agents/:id", origin: "agents" },
  { method: "POST", path: "/agents", origin: "agents" },
  { method: "POST", path: "/agents/:id/rename", origin: "agents" },
  { method: "POST", path: "/agents/:id/set", origin: "agents" },
  { method: "POST", path: "/agents/:id/off", origin: "agents" },
  { method: "POST", path: "/agents/:id/on", origin: "agents" },
  { method: "GET", path: "/events", origin: "item-02" },
  { method: "GET", path: "/events/stream", origin: "item-02" },
  { method: "GET", path: "/sessions", origin: "item-03" },
  { method: "GET", path: "/sessions/:id/output", origin: "item-03" },
  { method: "POST", path: "/sessions/:id/stop", origin: "item-04" },
  { method: "POST", path: "/sessions/:id/kill", origin: "item-04" },
  { method: "POST", path: "/pause", origin: "item-05" },
  { method: "POST", path: "/unpause", origin: "item-05" },
  { method: "GET", path: "/threads/:agent", origin: "item-06" },
  { method: "GET", path: "/connectors", origin: "p6-item-03" },
  { method: "POST", path: "/connectors/github/token", origin: "p6-item-03" },
  { method: "POST", path: "/connectors/github/disconnect", origin: "p6-item-03" },
  { method: "GET", path: "/connectors/github/repos", origin: "p6-item-03" },
  { method: "GET", path: "/drafts", origin: "p6-item-07" },
  { method: "GET", path: "/drafts/:id", origin: "p6-item-07" },
  { method: "POST", path: "/connectors/github/app/setup", origin: "github-app" },
  { method: "POST", path: "/connectors/github/app/setup/cancel", origin: "github-app" },
];

/** A route the contract says the kernel already serves: any origin but a phase 5 item's (`item-NN`) or a phase 6 item's (`p6-item-NN`). */
const isExisting = (entry: ContractEntry): boolean => !/^(p6-)?item-\d{2}$/.test(entry.origin);

const key = (r: { readonly method: string; readonly path: string }): string => `${r.method} ${r.path}`;

const contractText = readFileSync(CONTRACT, "utf8");

describe("the app contract's routes (app/src/api/contract.ts, read as text)", () => {
  const routes = contractRoutes(contractText);

  it("are exactly the routes listed here, in order: methods, paths and origins", () => {
    expect(routes).toEqual(EXPECTED_ROUTES);
  });

  it("list each route once", () => {
    const keys = EXPECTED_ROUTES.map(key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(routes.map(key)).size).toBe(routes.length);
  });

  it("every route marked existing is one the kernel serves: a phase 1 route or a shipped contribution's, same method and declared path", () => {
    const merged = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED);
    const served = new Set([...PHASE1_ROUTES.map(key), ...merged.routes.map(key)]);
    const existing = routes.filter(isExisting);
    // 31 existing routes: 4 phase 1, then brain, notifications, approvals, triggers, playbooks, agents, and the GitHub App's two owner routes (stubs).
    expect(existing).toHaveLength(31);
    const unserved = existing.filter((r) => !served.has(key(r))).map(key);
    expect(unserved).toEqual([]);
  });

  it("lists phase 6's six routes as not yet served: items 03 and 07 add them", () => {
    const phase6 = routes.filter((r) => r.origin.startsWith("p6-"));
    expect(phase6.map((r) => [r.origin, key(r)])).toEqual([
      ["p6-item-03", "GET /connectors"],
      ["p6-item-03", "POST /connectors/github/token"],
      ["p6-item-03", "POST /connectors/github/disconnect"],
      ["p6-item-03", "GET /connectors/github/repos"],
      ["p6-item-07", "GET /drafts"],
      ["p6-item-07", "GET /drafts/:id"],
    ]);
    expect(phase6.filter(isExisting)).toEqual([]);
  });

  it("the feed route is the path the API server upgrades", () => {
    const feed = routes.filter((r) => r.origin === "item-02" && r.method === "GET" && r.path.endsWith("/stream"));
    expect(feed.map((r) => r.path)).toEqual([EVENT_FEED_PATH]);
  });
});

describe("the contract's session output kinds", () => {
  it("are the same six values as SESSION_OUTPUT_KINDS, each once", () => {
    const union = sessionOutputKindUnion(contractText);
    expect(new Set(union).size).toBe(union.length);
    expect([...union].sort()).toEqual([...SESSION_OUTPUT_KINDS].sort());
    expect([...union].sort()).toEqual(["assistant_text", "result", "system", "tool_call", "tool_decision", "tool_result"]);
  });
});

/** The string literals of `export const <name> = ["…", …] as const;` in `text`, refusing anything else in the list. */
function constStringList(text: string, name: string): string[] {
  const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const;`).exec(text);
  if (match === null) throw new Error(`no \`export const ${name} = [ … ] as const;\``);
  return (match[1] ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m !== "")
    .map((member) => {
      const literal = /^"([a-z_]+)"$/.exec(member);
      if (literal === null) throw new Error(`${name} member is not a string literal: ${member}`);
      return literal[1] ?? "";
    });
}

describe("the playbook card's policy fields (app/src/screens/chat/cards.tsx, read as text)", () => {
  it("POLICY_FIELDS then READ_ONLY_POLICY_FIELDS are exactly the kernel's PLAYBOOK_POLICY_FIELDS, in order", () => {
    const cards = readFileSync(PLAYBOOK_CARDS, "utf8");
    const edited = constStringList(cards, "POLICY_FIELDS");
    const shown = constStringList(cards, "READ_ONLY_POLICY_FIELDS");
    expect([...edited, ...shown]).toEqual([...PLAYBOOK_POLICY_FIELDS]);
    expect(shown).toEqual(["mode"]);
  });
});

describe("the text readers fail loudly on a contract they can't read", () => {
  it("refuses a CONTRACT_ROUTES line that is not one entry (an entry split over two lines)", () => {
    const split = 'export const CONTRACT_ROUTES: readonly ContractRoute[] = Object.freeze([\n  { method: "GET",\n    path: "/status", origin: "phase-1" },\n]);\n';
    expect(() => contractRoutes(split)).toThrow(/not one entry/);
  });

  it("refuses a contract with no CONTRACT_ROUTES", () => {
    expect(() => contractRoutes("export const ROUTES = [];\n")).toThrow(/no `export const CONTRACT_ROUTES`/);
  });

  it("refuses a const list member that is not a string literal, and a missing list", () => {
    expect(() => constStringList('export const POLICY_FIELDS = ["model", OTHER] as const;\n', "POLICY_FIELDS")).toThrow(/not a string literal/);
    expect(() => constStringList("export const OTHER = [] as const;\n", "POLICY_FIELDS")).toThrow(/no `export const POLICY_FIELDS/);
    expect(constStringList('export const POLICY_FIELDS = ["model", "mode"] as const;\n', "POLICY_FIELDS")).toEqual(["model", "mode"]);
  });

  it("refuses a SessionOutputKind member that is not a string literal", () => {
    expect(() => sessionOutputKindUnion('export type SessionOutputKind = "result" | Other;\n')).toThrow(/not a string literal/);
  });

  it("reads a well-formed list and union", () => {
    const text =
      'export const CONTRACT_ROUTES: readonly ContractRoute[] = Object.freeze([\n  { method: "GET", path: "/status", origin: "phase-1" },\n\n  { method: "POST", path: "/pause", origin: "item-05" },\n]);\nexport type SessionOutputKind = "result" | "system";\n';
    expect(contractRoutes(text)).toEqual([
      { method: "GET", path: "/status", origin: "phase-1" },
      { method: "POST", path: "/pause", origin: "item-05" },
    ]);
    expect(sessionOutputKindUnion(text)).toEqual(["result", "system"]);
  });
});
