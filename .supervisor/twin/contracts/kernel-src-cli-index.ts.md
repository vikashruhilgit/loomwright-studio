SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/cli/index.ts"
invariants:
  - "SCOPE NOTE: derived from the item-09 diff (service install|uninstall subcommand) and the H04 session-manager-hardening diff (session abandon, orphaned in status, ended_on_its_own in stop --all) only."
  - "`studio service install|uninstall` is dispatched before api.json or the Keychain is read: it needs no daemon and never touches the API token."
  - "The CLI never loads the Agent SDK: it imports leaf modules only (service/launchd.ts, sessions/spawner.ts, sessions/types.ts), not the sessions index; api/server.ts is imported as a type only."
  - "runCli never throws, never sets process.exitCode and never prints the token; a ServiceError or CliFailure message is written verbatim as one stderr line with exit 1, any other error is prefixed `studio:` and truncated to its first line."
  - "Non-service commands only connect to 127.0.0.1 and read/send the token only after checking api.json's pid is alive."
  - "`session abandon <id>` without --yes asks for confirmation after the api.json pid check and before the Keychain is read or anything is sent; only a y/yes answer proceeds, anything else exits 1 with nothing sent."
  - "EOF means no: readlineConfirm settles false when stdin has already ended or is destroyed, ends before an answer, or errors; it always settles."
  - "Without --yes and without a TTY on stdin, `session abandon` refuses at once (usage, exit 2) instead of waiting for an answer."
  - "The abandon request is sent with the x-studio-client: cli header; a 400/404/409 answer prints only the API's stable error code (matched /^[a-z_]{1,64}$/, else unknown)."
  - "summarizeStopAll counts only stopped as stopped; an outcome is already ended when ended_on_its_own === true or its status is in ALREADY_ENDED (completed, interrupted, failed:auth); anything else is not confirmed stopped and makes the command exit non-zero."
dependencies:
  - "kernel/src/service/launchd.ts"
  - "kernel/src/api/server.ts"
  - "kernel/src/api/token.ts"
  - "kernel/src/auth/keychain.ts"
  - "kernel/src/store/store.ts"
  - "kernel/src/sessions/spawner.ts"
  - "kernel/src/sessions/types.ts"
behavioral_specs:
  - "parse accepts `service install` or `service uninstall`, and `session abandon <id>` with an optional trailing --yes where id matches /^[1-9]\\d*$/ and is a safe integer; anything else prints USAGE and exits 2."
  - "install: deps.dataDir (when set) is passed as options.dataDir, overridable by deps.service.options; prints `studio: service <label> installed and loaded (<plistPath>)`, exit 0."
  - "uninstall prints `studio: service <label> unloaded and removed (<plistPath>)`, exit 0."
  - "USAGE ends with `| studio session abandon <id> [--yes] | studio service install|uninstall`."
  - "A successful abandon prints `studio: session <id> abandoned; the kernel will never signal its process group`, exit 0; a declined confirm prints `studio: session <id> not abandoned (not confirmed)`, exit 1."
  - "formatStatus lists orphaned rows (status.orphaned ?? [] for an older daemon) with pgid and reason, plus a hint naming `studio session abandon <id>`."
incident_history:
  - {date: "2026-10-04T17:15:00Z", kind: self_heal_fix, summary: "self-heal fixed 2 issue(s) in kernel/src/cli/index.ts", source: "6ba5be39-ea98-45b3-ae38-b44676e0e3ce"}
provenance:
  derived_from: "c044695c2032cc2b2e598d20fab41d2facb41142 (git diff origin/main...c044695)"
  written_at: "2026-10-04T17:15:00Z"
  source: "6ba5be39-ea98-45b3-ae38-b44676e0e3ce"
