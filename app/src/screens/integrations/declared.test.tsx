// @vitest-environment jsdom
// The owner's declaration (phase 6 item 14, AC7), on the connected state. GitHub
// reports no permissions for a fine-grained token, so the kernel records the
// owner's word: `permissions_source: "declared"` with the time. The screen must
// say so and must never present those permissions as read from GitHub or
// verified: the section reads "Read-only, declared by you" with the time, shows
// no checked permission list, and the words "verified" and "read from GitHub"
// are nowhere in it. A reported row is unchanged: the checked list and "read
// from GitHub". The sheet's side (the confirmation box, the request body) is in
// `connect-sheet.test.tsx`.
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Connector } from "../../api/contract";
import { ok } from "../../store/fake-bridge";
import { INTEGRATIONS_TEST_IDS as IDS } from "./model";
import { connector, startScreen } from "./test-support";

afterEach(() => {
  cleanup();
});

const DECLARED_AT = "2026-10-28T09:30:00.000Z";

/** A connected row whose permissions the owner declared: GitHub reported none. */
function declaredRow(overrides: Partial<Connector> = {}): Connector {
  return connector("connected", { permissions: null, permissions_source: "declared", permissions_declared_at: DECLARED_AT, ...overrides });
}

const permissionsSection = (): HTMLElement => screen.getByRole("region", { name: "Permissions" });

describe("a connected row whose permissions the owner declared", () => {
  it("reads 'Read-only, declared by you' with the declaration time, and no checked permission list", async () => {
    await startScreen({ connectors: () => ok({ connectors: [declaredRow()] }) });
    const section = permissionsSection();
    expect(section.textContent).toContain("Read-only, declared by you.");
    expect(section.textContent).toMatch(/declared by you \S+/);
    expect(section.textContent).toContain("Studio keeps this as your word, not as something it checked");
    expect(screen.queryByTestId(IDS.permissions)).toBeNull();
    expect(within(section).queryByRole("list")).toBeNull();
    expect(section.textContent).not.toContain("No permissions reported");
    expect(screen.getByTestId(IDS.detailHeader).textContent).toContain("read-only · declared");
  });

  it("says 'verified' or 'read from GitHub' nowhere in the permissions section or the status line", async () => {
    await startScreen({ connectors: () => ok({ connectors: [declaredRow()] }) });
    for (const text of [permissionsSection().textContent ?? "", screen.getByTestId(IDS.status).textContent ?? ""]) {
      expect(text).not.toMatch(/verified/i);
      expect(text).not.toMatch(/read from GitHub/i);
    }
    // What the kernel did check, said as such.
    expect(screen.getByTestId(IDS.status).textContent).toContain("account and repos checked");
  });

  it("shows the declaration time as the kernel wrote it, 'declared by you' with no time when the row has none", async () => {
    await startScreen({ connectors: () => ok({ connectors: [declaredRow({ permissions_declared_at: null })] }) });
    const section = permissionsSection();
    expect(section.textContent).toContain("declared by you");
    expect(section.textContent).not.toContain("never");
  });

  it("keeps the declared wording when the token is expiring, and on an expired one says only 'checked'", async () => {
    await startScreen({ connectors: () => ok({ connectors: [declaredRow({ status: "expiring", expires_at: new Date(Date.now() + 8 * 86_400_000).toISOString() })] }) });
    expect(permissionsSection().textContent).toContain("Read-only, declared by you.");
    expect(screen.getByTestId(IDS.status).textContent).not.toMatch(/verified/i);
    cleanup();
    await startScreen({ connectors: () => ok({ connectors: [declaredRow({ status: "expired", expires_at: new Date(Date.now() - 3 * 86_400_000).toISOString() })] }) });
    expect(permissionsSection().textContent).toContain("Read-only, declared by you.");
    expect(permissionsSection().textContent).not.toMatch(/verified|read from GitHub/i);
  });

  it("ignores any permission list on a declared row: the owner's word is the whole section", async () => {
    await startScreen({ connectors: () => ok({ connectors: [declaredRow({ permissions: { pull_requests: "read" } })] }) });
    expect(screen.queryByTestId(IDS.permissions)).toBeNull();
    expect(permissionsSection().textContent).not.toContain("Pull requests");
  });
});

describe("a reported row is unchanged", () => {
  it.each([["reported"], [null]] as const)("source %s: the checked list, with 'read from GitHub' and 'verified'", async (source) => {
    await startScreen({ connectors: () => ok({ connectors: [connector("connected", { permissions_source: source, permissions_declared_at: null })] }) });
    const list = screen.getByTestId(IDS.permissions);
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["MetadataRead-only", "ContentsRead-only", "Pull requestsRead-only"]);
    expect(permissionsSection().textContent).toContain("read from GitHub");
    expect(permissionsSection().textContent).not.toContain("declared by you");
    expect(screen.getByTestId(IDS.status).textContent).toMatch(/verified/);
    expect(screen.getByTestId(IDS.detailHeader).textContent).not.toContain("declared");
  });
});
