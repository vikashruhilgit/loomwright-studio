// Kernel daemon entry point. Phase 1 scaffold: nothing here runs a session yet.
import { kernelVersion } from "./version.js";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log(kernelVersion());
} else {
  console.log("loomwright-studio-kernel: daemon not implemented yet");
}
process.exitCode = 0;
