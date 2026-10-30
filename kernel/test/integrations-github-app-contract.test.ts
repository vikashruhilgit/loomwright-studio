// The GitHub App connect's contract in code (D36): the closed lists, the stub
// port, and the two owner routes and three browser routes the setup flow
// serves. The port has no behaviour: every method resolves `not_implemented`,
// never throwing; the tokens item replaces it and its assertions in its own
// tests, not here. The owner routes open and close the setup window (behind the
// API token like every route); the setup flow's own tests
// (`integrations-github-app-setup.test.ts`) pin the rest.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { PHASE1_RESERVED, mergeContributions } from "../src/features/index.js";
import { githubAppPort } from "../src/integrations/github/app-port.js";
import { githubAppRoutesPart } from "../src/integrations/github/app-routes.js";
import {
  CONNECTOR_METHODS,
  GITHUB_APP_SETUP_REFUSALS,
  INTEGRATIONS_PARTS,
  githubAppPort as exportedPort,
  githubAppRoutesPart as exportedPart,
  integrationsContribution,
} from "../src/integrations/index.js";
import type { GitHubAppConversion, GitHubAppPort, GitHubAppPortResult } from "../src/integrations/index.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const T0 = "2026-10-29T10:00:00.000Z";
const API_TOKEN = "0123456789abcdef".repeat(4);
const SETUP = "/connectors/github/app/setup";
const CANCEL = "/connectors/github/app/setup/cancel";

const CONVERSION: GitHubAppConversion = {
  app_id: 4242,
  slug: "loomwright-studio-owner",
  name: "Loomwright Studio (owner)",
  owner_login: "owner-one",
  html_url: "https://github.com/apps/loomwright-studio-owner",
  client_id: "Iv1.0123456789abcdef",
};

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

describe("the stub port (AC5)", () => {
  const CALLS: ReadonlyArray<readonly [string, (port: GitHubAppPort) => Promise<GitHubAppPortResult<unknown>>]> = [
    ["storeApp", (p) => p.storeApp(env.store, CONVERSION, "-----BEGIN RSA PRIVATE KEY-----\nstub\n-----END RSA PRIVATE KEY-----\n", env.now)],
    ["recordInstallation", (p) => p.recordInstallation(env.store, 987654, env.now)],
    ["removeApp", (p) => p.removeApp(env.store, env.now)],
  ];

  it("is the one the integrations index exports, frozen", () => {
    expect(exportedPort).toBe(githubAppPort);
    expect(Object.isFrozen(githubAppPort)).toBe(true);
  });

  for (const [name, call] of CALLS) {
    it(`${name} resolves not_implemented with a message`, async () => {
      const result = await call(githubAppPort);
      expect(result).toEqual({ ok: false, error: "not_implemented", message: expect.stringMatching(/not implemented/) });
    });
  }

  it("never throws or rejects, whatever it is given", async () => {
    const port = githubAppPort as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const weird: unknown[][] = [[], [undefined], [null, null, null, null], [{}, "x", 1, "y"], [env.store, {}, "", () => new Date(Number.NaN)], [NaN, -1, Symbol("s")]];
    for (const method of ["storeApp", "recordInstallation", "removeApp"]) {
      for (const args of weird) {
        const result = (await port[method]?.(...args)) as GitHubAppPortResult<unknown>;
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe("not_implemented");
      }
    }
  });
});

describe("the owner and browser routes", () => {
  let server: ApiServer;
  const BROWSER = ["/connectors/github/app/start", "/connectors/github/app/return", "/connectors/github/app/installed"];

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

  it("the shipped contribution serves all five under the App part, last in the parts", () => {
    expect(exportedPart).toBe(githubAppRoutesPart);
    expect(INTEGRATIONS_PARTS.at(-1)).toBe(githubAppRoutesPart);
    expect(githubAppRoutesPart.routes.map((r) => `${r.method} ${r.path}`)).toEqual([`POST ${SETUP}`, `POST ${CANCEL}`, ...BROWSER.map((p) => `GET ${p}`)]);
    expect(Object.isFrozen(githubAppRoutesPart)).toBe(true);
  });

  it("POST setup with the API token answers 200 {setup_url, expires_at} on the API's own origin, 10 minutes out; cancel closes it", async () => {
    const res = await call(SETUP, `Bearer ${API_TOKEN}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { setup_url: string; expires_at: string };
    expect(Object.keys(body).sort()).toEqual(["expires_at", "setup_url"]);
    expect(body.setup_url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${server.port}/connectors/github/app/start\\?state=[A-Za-z0-9_-]{32,}$`));
    expect(body.expires_at).toBe("2026-10-29T10:10:00.000Z");

    const cancelled = await call(CANCEL, `Bearer ${API_TOKEN}`);
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ cancelled: true });
    expect(await (await call(CANCEL, `Bearer ${API_TOKEN}`)).json()).toEqual({ cancelled: false });
  });

  for (const path of [SETUP, CANCEL]) {
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
