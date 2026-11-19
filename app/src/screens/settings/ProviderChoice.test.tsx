// @vitest-environment jsdom
// D42: the provider choice and the API key field, rendered against a stub bridge.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiRequest, StudioBridge } from "../../api/contract";
import { SETTINGS_TEST_IDS as IDS, type SettingsView } from "./model";
import { ProviderChoice, RESTART_CHECK_MS, choiceNote, keyNote } from "./ProviderChoice";

const KEY = "sk-ant-api03-test-key-value";

afterEach(cleanup);

function view(overrides: Partial<SettingsView> = {}): SettingsView {
  return {
    provider: { id: "subscription-token", account: null, health: { status: "ok" }, tokenCreatedAt: null },
    providers: [
      { id: "subscription-token", account: null, health: { status: "ok" }, inUse: true },
      { id: "api-key", account: null, health: { status: "ok" }, inUse: false },
    ],
    providerSource: "default",
    pendingProvider: null,
    dataDir: "/d",
    notifier: "none",
    loomwright: { ok: true, installPath: "/p" },
    ...overrides,
  };
}

function bridge(answer: (req: ApiRequest) => { status: number; body: unknown }) {
  const calls: ApiRequest[] = [];
  const api = {
    request: vi.fn(async (req: ApiRequest) => {
      calls.push(req);
      const { status, body } = answer(req);
      return { ok: status >= 200 && status < 300, status, body };
    }),
  } as unknown as StudioBridge;
  return { api, calls };
}

describe("ProviderChoice (D42)", () => {
  it("marks the provider in use and offers the other, then sends the switch and says the kernel is restarting", async () => {
    const { api, calls } = bridge(() => ({ status: 202, body: { in_use: "subscription-token", chosen: "api-key", restarting: true } }));
    render(<ProviderChoice api={api} view={view()} offline={false} onChanged={() => {}} />);
    expect(screen.getAllByTestId(IDS.choiceInUse)).toHaveLength(1);
    fireEvent.click(screen.getByTestId(IDS.choiceUse));
    await waitFor(() => expect(screen.getByTestId(IDS.choiceNote).textContent).toContain("restarting"));
    expect(calls).toEqual([{ method: "PUT", path: "/settings/auth-provider", body: { provider: "api-key" } }]);
  });

  it("disables the switch to a provider with no usable credential, and while a flag or env var overrides the choice", () => {
    const { api } = bridge(() => ({ status: 500, body: {} }));
    const missing = view({ providers: [view().providers[0]!, { id: "api-key", account: null, health: { status: "missing" }, inUse: false }] });
    const { unmount } = render(<ProviderChoice api={api} view={missing} offline={false} onChanged={() => {}} />);
    expect((screen.getByTestId(IDS.choiceUse) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    render(<ProviderChoice api={api} view={view({ providerSource: "env" })} offline={false} onChanged={() => {}} />);
    expect((screen.getByTestId(IDS.choiceUse) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId(IDS.choiceOverridden).textContent).toContain("STUDIO_AUTH_PROVIDER");
  });

  it("sends the key once, clears the field before the answer, never shows it, and reads the settings again", async () => {
    const onChanged = vi.fn();
    const { api, calls } = bridge(() => ({ status: 200, body: { stored: true, health: { status: "ok" } } }));
    const { container } = render(<ProviderChoice api={api} view={view()} offline={false} onChanged={onChanged} />);
    const input = screen.getByTestId(IDS.apiKeyInput) as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: KEY } });
    fireEvent.click(screen.getByTestId(IDS.apiKeySave));
    expect(input.value).toBe("");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ method: "PUT", path: "/settings/api-key", body: { key: KEY } }]);
    expect(container.textContent).not.toContain(KEY);
    expect(screen.getByTestId(IDS.apiKeyNote).textContent).toContain("loomwright-studio-api-key");
  });

  // 23u: a restart can be deferred (a session started in its delay). The screen reads the settings again after it, and
  // a recorded choice that the kernel is not running on is shown, with a way to keep the provider in use.
  it("reads the settings again after a restarting answer, so a deferred restart does not stay 'restarting'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onChanged = vi.fn();
      const { api } = bridge(() => ({ status: 202, body: { in_use: "subscription-token", chosen: "api-key", restarting: true } }));
      render(<ProviderChoice api={api} view={view()} offline={false} onChanged={onChanged} />);
      fireEvent.click(screen.getByTestId(IDS.choiceUse));
      await waitFor(() => expect(screen.getByTestId(IDS.choiceNote).textContent).toContain("restarting"));
      expect(onChanged).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(RESTART_CHECK_MS);
      expect(onChanged).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByTestId(IDS.choiceNote)).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a pending choice, and Keep sends the provider in use and reads the settings again", async () => {
    const onChanged = vi.fn();
    const { api, calls } = bridge(() => ({ status: 200, body: { in_use: "subscription-token", chosen: "subscription-token", restarting: false } }));
    render(<ProviderChoice api={api} view={view({ pendingProvider: "api-key" })} offline={false} onChanged={onChanged} />);
    expect(screen.getByTestId(IDS.choicePending).textContent).toContain("You chose the Anthropic API key");
    expect(screen.getByTestId(IDS.choicePending).textContent).toContain("next kernel start");
    fireEvent.click(screen.getByTestId(IDS.choiceKeep));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ method: "PUT", path: "/settings/auth-provider", body: { provider: "subscription-token" } }]);
  });

  it("shows no pending choice when there is none", () => {
    const { api } = bridge(() => ({ status: 200, body: {} }));
    render(<ProviderChoice api={api} view={view()} offline={false} onChanged={() => {}} />);
    expect(screen.queryByTestId(IDS.choicePending)).toBeNull();
  });

  it("draws nothing for an older kernel that names no providers", () => {
    const { api } = bridge(() => ({ status: 200, body: {} }));
    const { container } = render(<ProviderChoice api={api} view={view({ providers: [] })} offline={false} onChanged={() => {}} />);
    expect(container.textContent).toBe("");
  });
});

describe("the answers in words", () => {
  it("says each refusal of a switch", () => {
    expect(choiceNote(409, { error: "sessions_running", count: 2 }, "api-key").text).toContain("2 sessions are running");
    expect(choiceNote(409, { error: "provider_not_ready" }, "api-key").text).toContain("Save an API key first");
    expect(choiceNote(409, { error: "provider_overridden", source: "env" }, "api-key").text).toContain("STUDIO_AUTH_PROVIDER");
    expect(choiceNote(202, { restarting: false }, "api-key").text).toContain("next time the kernel starts");
    expect(choiceNote(0, undefined, "api-key").tone).toBe("danger");
  });

  it("says each answer to a saved key", () => {
    expect(keyNote(200, {}).tone).toBe("ok");
    expect(keyNote(400, { error: "invalid_key" }).text).toContain("Nothing was stored");
    expect(keyNote(500, { error: "keychain_write_failed" }).text).toContain("Keychain refused");
    // 23u: what happened to the previous key, as the kernel reports it.
    expect(keyNote(500, { error: "keychain_write_failed", previous_key: "kept" }).text).toContain("previous key is still in place");
    expect(keyNote(500, { error: "keychain_write_failed", previous_key: "removed" }).text).toContain("there is no API key now");
    expect(keyNote(500, { error: "keychain_write_failed", previous_key: "none" }).text).toContain("No key was stored");
  });
});
