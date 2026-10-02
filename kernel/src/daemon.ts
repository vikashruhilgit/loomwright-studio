// Kernel daemon entry point (item 08): starts the kernel and stops it
// gracefully on SIGTERM/SIGINT. launchd runs it in item 09.
//
//   node dist/daemon.js [--auth-provider <id>]
//   node dist/daemon.js --version
import { startKernel } from "./kernel.js";
import type { Kernel } from "./kernel.js";
import { kernelVersion } from "./version.js";

const NAME = "loomwright-studio-kernel";

/** The first line of an error's message: one line on stderr, never a stack. */
function oneLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n", 1)[0] ?? "";
}

function parseArgs(args: readonly string[]): { authProviderId?: string } {
  let authProviderId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--auth-provider") {
      const value = args[i + 1];
      if (value === undefined || value === "") throw new Error("--auth-provider needs a value");
      authProviderId = value;
      i++;
    } else {
      throw new Error(`unknown argument: ${String(arg)}`);
    }
  }
  return authProviderId === undefined ? {} : { authProviderId };
}

async function main(args: readonly string[]): Promise<void> {
  let kernel: Kernel;
  try {
    kernel = await startKernel(parseArgs(args));
  } catch (err) {
    console.error(`${NAME}: failed to start: ${oneLine(err)}`);
    process.exit(1);
  }
  console.log(`${NAME} ${kernelVersion()}: listening on ${kernel.api.host}:${kernel.api.port} (pid ${process.pid})`);

  // `once`: a second signal during the graceful stop gets Node's default (an
  // immediate exit); the next start's `reapOrphans` then cleans up.
  const shutdown = (signal: NodeJS.Signals): void => {
    kernel.stop().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error(`${NAME}: error while stopping on ${signal}: ${oneLine(err)}`);
        process.exit(1);
      },
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
