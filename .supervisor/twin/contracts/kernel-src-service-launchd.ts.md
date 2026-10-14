SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/service/launchd.ts"
invariants:
  - "Touches exactly one file in LaunchAgents: <homeDir>/Library/LaunchAgents/com.loomwright.studio.kernel.plist (SERVICE_LABEL); never a glob, listing or any other LaunchAgents file."
  - "macOS only: resolveDeps checks platform first and throws ServiceError('studio service is macOS only') before anything is run, read or written; a non-integer or negative uid is refused."
  - "launchctl is always invoked by absolute path /bin/launchctl (LAUNCHCTL_PATH), never resolved through PATH; its output is never shown or returned (stdio ignored)."
  - "The plist never carries a token: EnvironmentVariables holds only STUDIO_DATA_DIR (always the resolve()-normalized absolute dataDir the logs go under) and STUDIO_AUTH_PROVIDER only when authProviderFromEnv(env) selects one; every other env key is ignored."
  - "KeepAlive is {SuccessfulExit: false} with RunAtLoad true: launchd restarts after a crash or kill -9, never after a graceful exit 0."
  - "ProgramArguments are [absolute nodePath, absolute daemonPath]; a non-absolute path is refused; every string is XML-escaped and a newline, CR or NUL in any value is refused with ServiceError."
  - "installService renders (and validates) the plist before writing anything, refuses unless the built daemon.js exists, and writes the plist atomically (same-dir temp + rename, chmod 0644, temp removed on failure)."
  - "Every failure surfaces as a one-line ServiceError naming the launchctl exit status (a signal-killed launchctl is never status 0)."
dependencies:
  - "kernel/src/auth/provider-env.ts"
  - "kernel/src/store/store.ts"
  - "kernel/src/daemon.ts"
behavioral_specs:
  - "install: mkdir <dataDir>/logs mode 0700, write plist, boot out the agent if `launchctl print gui/<uid>/<label>` exits 0, then `launchctl bootstrap gui/<uid> <plist>`; returns {label, plistPath}."
  - "uninstall is idempotent: boot out only when loaded, rmSync the plist with force; nothing loaded and no plist is success."
  - "stdout/stderr go to <dataDir>/logs/kernel.out.log and kernel.err.log."
  - "dataDir defaults to resolveDataDir(env, homeDir); nodePath to process.execPath; daemonPath to ../daemon.js relative to this module."
incident_history:
  - {date: "2026-10-03T03:01:18Z", kind: self_heal_fix, summary: "self-heal fixed 2 issue(s) in kernel/src/service/launchd.ts", source: "2a862f5f-b84e-4eea-9b81-4865d87034c0"}
provenance:
  derived_from: "b4edca817a656f07ee61918f1b28e6d1cf28cf60 (git diff origin/main...b4edca8)"
  written_at: "2026-10-03T03:01:18Z"
  source: "2a862f5f-b84e-4eea-9b81-4865d87034c0"
