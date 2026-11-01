// Fixtures shared by the Settings screen's jsdom tests (`SettingsScreen.test.tsx`, `polish.test.tsx`):
// one scripted `/status` body, the unreachable answer, one `/settings` body builder and the title bar's
// subtitle slot. Not imported by the app.
import { render } from "@testing-library/react";
import type { ApiResult, AuthHealth, StatusBody, StudioBridge } from "../../api/contract";
import { SettingsSubtitleView } from "./SettingsSubtitle";

export const STATUS: StatusBody = {
  kernel: { version: "1.0.0", uptime_s: 1, pid: 7 },
  kill_switch: { engaged: false, since: null },
  auth: [],
  sessions: [],
  kill_unconfirmed: [],
  orphaned: [],
  queue: { pending: 0, events: [] },
  wakeups: { pending: 0, items: [] },
  tokens_today: { day: "2026-10-30", agents: [] },
  cap_state: [],
};

export const UNREACHABLE: ApiResult<unknown> = { ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } };

/** Slightly less than `n` days ago, so the whole days left are exactly 365 - n however long the test takes to run. */
export const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000 + 3_600_000).toISOString();

export interface Body {
  readonly id?: string;
  readonly health?: AuthHealth;
  readonly created?: string | null;
  readonly account?: string | null;
  readonly dataDir?: string;
  readonly installPath?: string;
  readonly notifier?: string;
  readonly loomwright?: unknown;
  /** Extra fields a kernel might add, at the top and in the provider. */
  readonly extra?: Record<string, unknown>;
}

export function settingsBody(o: Body = {}): Record<string, unknown> {
  return {
    provider: {
      id: o.id ?? "subscription-token",
      account: o.account === undefined ? "personal subscription" : o.account,
      health: o.health ?? { status: "ok" },
      token_created_at: o.created === undefined ? daysAgo(100) : o.created,
      ...o.extra,
    },
    data_dir: o.dataDir ?? "/Users/owner/.loomwright-studio",
    notifier: o.notifier ?? "osascript",
    loomwright: o.loomwright ?? { status: "ok", install_path: o.installPath ?? "/Users/owner/.claude/plugins/loomwright", plugin_version: "17.22.0", contract_schema_version: 1, host_switch: true },
    ...o.extra,
  };
}

/** The title bar's subtitle slot (`Titlebar.tsx`) around the screen's `Subtitle`, over the same bridge as the screen. */
export const mountSubtitle = (api: StudioBridge) =>
  render(
    <span data-testid="titlebar-subtitle">
      <SettingsSubtitleView api={api} />
    </span>,
  );
