// Kernel daemon entry point (item 08): starts the kernel and stops it
// gracefully on SIGTERM/SIGINT. launchd runs it in item 09 with `--launchd`,
// which changes only the exit statuses (H01, see daemon-exit.ts).
//
//   node dist/daemon.js [--auth-provider <id>] [--launchd]
//   node dist/daemon.js --version
import { daemonKernelDeps } from "./daemon-deps.js";
import { DAEMON_NAME, RESTART_EXIT_STATUS, parseArgs, startFailureExit, stopFailureExit, underLaunchd } from "./daemon-exit.js";
import type { DaemonExit } from "./daemon-exit.js";
import { startKernel } from "./kernel.js";
import type { Kernel } from "./kernel.js";
import { kernelVersion } from "./version.js";

/** Never an exit without its one stderr line. */
function exitWith(exit: DaemonExit): never {
  console.error(exit.line);
  process.exit(exit.status);
}

async function main(args: readonly string[]): Promise<void> {
  const launchd = underLaunchd(args);
  let kernel: Kernel;
  // D48: under launchd a Settings switch of the auth provider stops the kernel
  // gracefully and exits 1, so KeepAlive {SuccessfulExit: false} starts it
  // again on the new choice. Started by hand, nothing would restart it, so no
  // restart is wired and the choice applies at the next start.
  let restarting = false;
  const onRestartRequested = (): void => {
    if (restarting) return;
    restarting = true;
    kernel.stop().then(
      () => exitWith({ status: RESTART_EXIT_STATUS, line: `${DAEMON_NAME}: stopped to switch the auth provider; launchd starts it again` }),
      (err: unknown) => exitWith(stopFailureExit(err, "SIGTERM", launchd)),
    );
  };
  try {
    kernel = await startKernel({ ...parseArgs(args), ...(launchd ? { onRestartRequested } : {}) }, daemonKernelDeps());
  } catch (err) {
    exitWith(startFailureExit(err, launchd));
  }
  console.log(`${DAEMON_NAME} ${kernelVersion()}: listening on ${kernel.api.host}:${kernel.api.port} (pid ${process.pid})`);

  // `once`: a second signal during the graceful stop gets Node's default (an
  // immediate exit); the next start's `reapOrphans` then cleans up.
  const shutdown = (signal: NodeJS.Signals): void => {
    kernel.stop().then(
      () => process.exit(0),
      (err: unknown) => exitWith(stopFailureExit(err, signal, launchd)),
    );
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log(kernelVersion());
  process.exitCode = 0;
} else {
  void main(args);
}
