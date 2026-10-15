// The triggers crash test's kernel process (phase 2 item 04, AC4): the BUILT
// kernel's store and event loop over a data dir, ticking once with the shipped
// triggers contribution's due work, so the test can `kill -9` it at a chosen
// point and run it again. Plain JS, like `crash-harness.mjs`: it runs as its
// own `node` process against `<outDir>` (tsconfig has no allowJs). Test-only:
// nothing in kernel/src/ knows about it; the pause and the fault are injected
// here, never flags of the kernel.
//
//   node triggers-crash.mjs --out-dir <dist> --data-dir <dir> --now <iso>
//        [--register <json> --register-now <iso>] [--pause | --fault notification-insert]
//
// --register   first register one trigger (RegisterParams JSON) at --register-now
// --pause      run the tick with a second due-work function after the triggers'
//              one: it prints `{"ready":true,"pid":<pid>}` (so the fire has
//              committed) and blocks forever, before the tick ends
// --fault notification-insert
//              SIGKILL this process right after the INSERT INTO notifications
//              statement runs, inside the fire's work step, before it commits
// (neither)    tick once, print `{"done":true,"pid":<pid>}` and exit 0
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const out = { pause: false, fault: undefined };
  const value = (i) => {
    const v = argv[i + 1];
    if (v === undefined || v === "") throw new Error(`${argv[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out-dir") out.outDir = value(i++);
    else if (a === "--data-dir") out.dataDir = value(i++);
    else if (a === "--now") out.now = value(i++);
    else if (a === "--register") out.register = JSON.parse(value(i++));
    else if (a === "--register-now") out.registerNow = value(i++);
    else if (a === "--pause") out.pause = true;
    else if (a === "--fault") {
      out.fault = value(i++);
      if (out.fault !== "notification-insert") throw new Error(`unknown fault: ${out.fault}`);
    } else throw new Error(`unknown argument: ${a}`);
  }
  for (const k of ["outDir", "dataDir", "now"]) if (out[k] === undefined) throw new Error(`--${k} is required`);
  if (out.pause && out.fault !== undefined) throw new Error("--pause and --fault are exclusive");
  if (out.register !== undefined && out.registerNow === undefined) throw new Error("--register needs --register-now");
  return out;
}

/**
 * The fault, installed ONLY here: the store's `INSERT INTO notifications`
 * statement runs, then the process SIGKILLs itself, before the work step's
 * transaction (the notification, the trigger's bookkeeping, its audit event
 * and the `work_steps` row) commits.
 */
function withNotificationInsertFault(store) {
  const prepare = store.prepare.bind(store);
  store.prepare = (sql) => {
    const stmt = prepare(sql);
    if (!/^\s*INSERT INTO notifications\b/.test(sql)) return stmt;
    return new Proxy(stmt, {
      get(target, prop) {
        if (prop !== "run") {
          const v = Reflect.get(target, prop, target);
          return typeof v === "function" ? v.bind(target) : v;
        }
        return (...args) => {
          target.run(...args);
          // kill(2) on oneself delivers an unblocked SIGKILL before it returns;
          // the loop only guards that nothing after it can ever run.
          process.kill(process.pid, "SIGKILL");
          for (;;);
        };
      },
    });
  };
  return store;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dist = (p) => pathToFileURL(join(args.outDir, p)).href;
  const { Store } = await import(dist("store/store.js"));
  const { EventLoop } = await import(dist("loop/loop.js"));
  const { mergeContributions } = await import(dist("features/contribution.js"));
  const { triggersContribution, registerTrigger } = await import(dist("triggers/index.js"));

  const store = new Store({ dataDir: args.dataDir });
  if (args.register !== undefined) {
    const registered = registerTrigger(store, args.register, new Date(args.registerNow));
    process.stderr.write(`triggers-crash: registered ${JSON.stringify(registered)}\n`);
  }
  if (args.fault === "notification-insert") withNotificationInsertFault(store);

  const pause = {
    owner: "test-pause",
    run: () => {
      process.stdout.write(`${JSON.stringify({ ready: true, pid: process.pid })}\n`);
      // Keeps the process alive, blocked before the tick ends, until the test's SIGKILL.
      setInterval(() => {}, 60_000);
      return new Promise(() => {});
    },
  };
  const now = new Date(args.now);
  const dueWork = [...mergeContributions([triggersContribution]).dueWork, ...(args.pause ? [pause] : [])];
  const loop = new EventLoop({ store, handlers: {}, dueWork }, { now: () => now });
  await loop.tick();
  store.close();
  process.stdout.write(`${JSON.stringify({ done: true, pid: process.pid })}\n`);
}

main().catch((err) => {
  process.stderr.write(`triggers-crash: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
