// The GitHub App connect's contract in code (D36), before any of it is built:
// the closed lists and the two stub owner routes wave 2 builds against. The
// stubs have no behaviour: both routes answer `501 {"error":"not_implemented"}`
// (behind the API token like every route). Wave 2's items replace the stubs and
// their assertions in their own tests, not here: the port is real now, and its
// tests are in `integrations-github-app-port.test.ts`.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { PHASE1_RESERVED, mergeContributions } from "../src/features/index.js";
import { githubAppRoutesPart } from "../src/integrations/github/app-routes.js";
import {
  CONNECTOR_METHODS,
  GITHUB_APP_SETUP_REFUSALS,
  INTEGRATIONS_PARTS,
  githubAppRoutesPart as exportedPart,
  integrationsContribution,
} from "../src/integrations/index.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const T0 = "2026-10-29T10:00:00.000Z";
const API_TOKEN = "0123456789abcdef".repeat(4);
const SETUP = "/connectors/github/app/setup";
const CANCEL = "/connectors/github/app/setup/cancel";

let env: LoopEnv;

beforeEach(() => {
  env = loopEnv(T0);
});

afterEach(() => {
  env.cleanup();
});

describe("the closed lists", () => {
  it("CONNECTOR_METHODS is token and app, frozen", () => {
    expect([...CONNECTOR_METHODS]).toEqual(["token", "app"]);
    expect(Object.isFrozen(CONNECTOR_METHODS)).toBe(true);
  });

  it("GITHUB_APP_SETUP_REFUSALS is the six values, frozen, and the app contract names the same six", () => {
    expect([...GITHUB_APP_SETUP_REFUSALS]).toEqual(["setup_not_open", "state_mismatch", "setup_expired", "conversion_failed", "install_failed", "token_write_scoped"]);
    expect(Object.isFrozen(GITHUB_APP_SETUP_REFUSALS)).toBe(true);
    const contract = readFileSync(new URL("../../app/src/api/contract.ts", import.meta.url), "utf8");
    const union = /export type GitHubAppSetupRefusal =([^;]*);/.exec(contract);
    expect(union).not.toBeNull();
    expect((union?.[1] ?? "").split("|").map((m) => m.trim().replace(/^"|"$/g, ""))).toEqual([...GITHUB_APP_SETUP_REFUSALS]);
    const methods = /export type ConnectorMethod =([^;]*);/.exec(contract);
    expect((methods?.[1] ?? "").split("|").map((m) => m.trim().replace(/^"|"$/g, ""))).toEqual([...CONNECTOR_METHODS]);
  });
});

describe("the stub owner routes (AC2, AC7)", () => {
  let server: ApiServer;

  beforeEach(async () => {
    server = await startApiServer(
      {
        store: env.store,
        sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
        loop: { start: () => {}, stop: async () => {} },
        authProviders: [stubProvider()],
        token: API_TOKEN,
        routes: mergeContributions([integrationsContribution], PHASE1_RESERVED).routes,
      },
      { now: env.now },
    );
  });

  afterEach(async () => {
    await server.close();
  });

  const call = (path: string, authorization?: string): Promise<Response> =>
    fetch(`http://127.0.0.1:${server.port}${path}`, {
      method: "POST",
      headers: authorization === undefined ? {} : { Authorization: authorization },
    });

  it("the shipped contribution serves both under the App part, last in the parts", () => {
    expect(exportedPart).toBe(githubAppRoutesPart);
    expect(INTEGRATIONS_PARTS.at(-1)).toBe(githubAppRoutesPart);
    expect(githubAppRoutesPart.routes.map((r) => `${r.method} ${r.path}`)).toEqual([`POST ${SETUP}`, `POST ${CANCEL}`]);
    expect(Object.isFrozen(githubAppRoutesPart)).toBe(true);
  });

  for (const path of [SETUP, CANCEL]) {
    it(`POST ${path} with the API token answers 501 {"error":"not_implemented"}`, async () => {
      const res = await call(path, `Bearer ${API_TOKEN}`);
      expect(res.status).toBe(501);
      expect(await res.text()).toBe('{"error":"not_implemented"}');
    });

    it(`POST ${path} without the token, or with a wrong one, answers 401`, async () => {
      for (const authorization of [undefined, "Bearer wrong", `Bearer ${API_TOKEN}x`, API_TOKEN]) {
        const res = await call(path, authorization);
        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toBe("Bearer");
        expect(await res.text()).toBe('{"error":"unauthorized"}');
      }
    });
  }
});
