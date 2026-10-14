# Loomwright contract fixtures

Modelled on the real Loomwright 17.2.0 `capabilities.json` (`contract_schema_version` 1): a subset of its agents, commands, skills, result schemas and hooks, with every field shape kept, including the fields the adapter drops (`generated_by`, an agent's `tools`/`model`, a hook's `script`/`matcher`/`writes`).

| File | What it is |
|---|---|
| `capabilities.json` | Valid. Host switch `LOOMWRIGHT_HOST_MODE` / `LOOMWRIGHT_HOST_STATE_DIR`. |
| `capabilities-renamed-host-switch.json` | Valid. Host switch renamed to `TEST_HOST_FLAG` / `TEST_HOST_STATE`; version `17.2.0-renamed-test`. |
| `capabilities-no-host-switch.json` | Valid, but no `host_switch`; hypothetical version `17.1.0-test` (every real contract so far, 17.0.2 and 17.2.0, has one). |

A 17.0.0-style install (no `capabilities.json` at all) is `writeLoomwrightInstall(dir, null)` in `helpers.ts`, which also writes fake installs and a fake `installed_plugins.json` under a temp dir. No test reads the real `~/.claude/plugins/installed_plugins.json`.
