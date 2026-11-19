// Kernel daemon entry point (item 08): starts the kernel and stops it
// gracefully on SIGTERM/SIGINT. launchd runs it in item 09 with `--launchd`,
// which changes only the exit statuses (H01, see daemon-exit.ts).
//
//   node dist/daemon.js [--auth-provider <id>] [--launchd]
//   node dist/daemon.js --version
import { daemonKernelDeps } from "./daemon-deps.js";
import { DAEMON_NAME, daemonStartOptions, startFailureExit, stopFailureExit, underLaunchd } from "./daemon-exit.js";
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
  // D42: under launchd a Settings switch of the auth provider stops the kernel
  // gracefully and exits 1, so KeepAlive {SuccessfulExit: false} starts it
  // again on the new choice (`daemonStartOptions`). A restart fired before
  // `kernel` is assigned finds no kernel to stop: `restartAfterStop` then
  // exits 1 naming the error, and launchd still starts it again.
  try {
    kernel = await startKernel(daemonStartOptions(args, () => kernel, exitWith), daemonKernelDeps());
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
