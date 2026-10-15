// Probe 11: which native notifier can post a macOS notification FROM A LAUNCHD AGENT (the way the
// kernel runs after `studio service install`, D31), and can its click open Terminal on a command?
// Phase 2's notifications feature (docs/architecture/notifications.md) needs a click that runs
// `studio notifications show <id>` in Terminal; plain `osascript display notification` has no click
// action. This loads a throwaway launchd agent into the user's GUI domain, runs each candidate from
// inside it with argv arrays only (never a shell string), records each one's exit status, output and
// duration, then ALWAYS boots the agent out and deletes its plist. It installs nothing and grants
// nothing; it posts two or three visible test notifications. No SDK, no network.
//
// Candidates (the same argv shapes the kernel's notifier uses, kernel/src/notifications/notifier.ts):
//   osascript         /usr/bin/osascript, `on run argv` + `display notification`: ships with macOS, no click.
//   terminal-notifier /opt/homebrew/bin or /usr/local/bin (Homebrew, third-party; never installed here):
//                     title as a quoted plist string, body on stdin, a fixed `-group`, and `-execute` whose
//                     click opens Terminal (`osascript … do script`) on a harmless command that touches a
//                     marker file, so a click can be checked afterwards. `-list <group>` reads back what
//                     Notification Center holds for that group.
//
// Run:  node p11-notifier-under-launchd.mjs          (the inner mode, `--inner <out.json>`, is launchd's)
// What the probe cannot see (did a banner appear, did the click open Terminal, any permission prompt)
// is for the owner: docs/evidence/phase-2-notifier-probe.md, "Owner observation".
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = 'dev.loomwright-studio.p11-notifier-probe';
const OSASCRIPT = '/usr/bin/osascript';
const TERMINAL_NOTIFIER_PATHS = ['/opt/homebrew/bin/terminal-notifier', '/usr/local/bin/terminal-notifier'];
const STEP_TIMEOUT_MS = 15_000;
const home = homedir();
const tilde = (p) => (typeof p === 'string' && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p);

/** An old-style plist string: Cocoa parses `-key value` arguments as property lists (`(a, b)` is an array). */
const plistQuote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
/** One POSIX shell word. */
const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Run `file args` with `input` on stdin; never a shell. Resolves with status, signal, output and duration. */
function run(file, args, input = '') {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ status: null, signal: null, error: String(e?.message || e), stdout, stderr, ms: 0 });
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), STEP_TIMEOUT_MS);
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ status: null, signal: null, error: String(e?.message || e), stdout, stderr, ms: Date.now() - started }); });
    child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 2000), ms: Date.now() - started }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function inner(outPath) {
  const runId = String(Date.now());
  const marker = join(tmpdir(), `p11-click-${runId}`);
  const title = 'Studio p11: (a, b) "quoted" $(touch /tmp/p11-never)';
  const body = `p11 probe ${runId}\nline 2: ; | & \` $HOME '"' -execute`;
  const result = {
    run_id: runId,
    ppid: process.ppid,
    uid: process.getuid(),
    xpc_service_name: process.env.XPC_SERVICE_NAME ?? null,
    path_env: process.env.PATH ?? null,
    node: process.version,
    click_marker: marker,
    candidates: [],
  };

  // 1. osascript: ships with macOS; text as AppleScript `argv` items, never in the script source.
  const osa = await run(OSASCRIPT, ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', '--', title, body]);
  result.candidates.push({ name: 'osascript', path: OSASCRIPT, click: false, post: osa });

  // 2. terminal-notifier, from a fixed absolute path only.
  for (const path of TERMINAL_NOTIFIER_PATHS) {
    let executable = false;
    try { accessSync(path, constants.X_OK); executable = true; } catch { /* absent */ }
    if (!executable) { result.candidates.push({ name: 'terminal-notifier', path, present: false }); continue; }
    const version = await run(path, ['-version']);
    const group = `p11-${runId}`;
    // The click: Terminal runs a harmless command (the kernel's runs `studio notifications show <id>`).
    const terminalCommand = `echo ${shellQuote('p11: the click opened Terminal')}; /usr/bin/touch ${shellQuote(marker)}`;
    const execute = [OSASCRIPT, '-e', 'on run argv', '-e', 'tell application "Terminal"', '-e', 'activate', '-e', 'do script (item 1 of argv)', '-e', 'end tell', '-e', 'end run', '--', terminalCommand]
      .map(shellQuote)
      .join(' ');
    const args = ['-title', plistQuote(title), '-group', plistQuote(group), '-execute', plistQuote(execute)];
    const post = await run(path, args, body);
    await new Promise((r) => setTimeout(r, 1_500));
    const list = await run(path, ['-list', group]);
    result.candidates.push({ name: 'terminal-notifier', path, present: true, click: true, version, group, argv: args, post, list });
  }
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
}

function plist(programArguments, out, err) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...programArguments.map((a) => `    <string>${esc(a)}</string>`),
    '  </array>',
    '  <key>RunAtLoad</key><true/>',
    `  <key>StandardOutPath</key><string>${esc(out)}</string>`,
    `  <key>StandardErrorPath</key><string>${esc(err)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

async function outer() {
  if (process.platform !== 'darwin') {
    console.log(`not macOS (${process.platform}): nothing to probe`);
    return;
  }
  const uid = process.getuid();
  const dir = mkdtempSync(join(tmpdir(), 'p11-notifier-'));
  const plistPath = join(dir, `${LABEL}.plist`);
  const outPath = join(dir, 'result.json');
  // A launchd agent can't read a macOS-protected folder (~/Documents, ~/Desktop, ~/Downloads; D31),
  // so it runs a copy of this script from the temp dir, as the kernel runs its install copy.
  const copy = join(dir, 'p11-notifier-under-launchd.mjs');
  copyFileSync(fileURLToPath(import.meta.url), copy);
  writeFileSync(plistPath, plist([process.execPath, copy, '--inner', outPath], join(dir, 'agent.out.log'), join(dir, 'agent.err.log')));
  console.log(`p11 notifier probe — macOS ${spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim()}, node ${process.version}`);
  console.log(`launchd agent ${LABEL} in gui/${uid}, plist ${tilde(plistPath)}`);
  try {
    const boot = spawnSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, plistPath], { encoding: 'utf8' });
    console.log(`launchctl bootstrap: exit ${boot.status}${boot.stderr.trim() ? ` (${boot.stderr.trim()})` : ''}`);
    const deadline = Date.now() + 90_000;
    while (!existsSync(outPath) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      // Ran and exited without a result: no point waiting out the deadline.
      const state = spawnSync('/bin/launchctl', ['print', `gui/${uid}/${LABEL}`], { encoding: 'utf8' }).stdout;
      if (/\bruns = [1-9]/.test(state) && /\bstate = not running\b/.test(state) && !existsSync(outPath)) {
        await new Promise((r) => setTimeout(r, 500));
        if (!existsSync(outPath)) break;
      }
    }
  } finally {
    const out = spawnSync('/bin/launchctl', ['bootout', `gui/${uid}/${LABEL}`], { encoding: 'utf8' });
    console.log(`launchctl bootout: exit ${out.status}${out.stderr.trim() ? ` (${out.stderr.trim()})` : ''}`);
    rmSync(plistPath, { force: true });
    const left = spawnSync('/bin/launchctl', ['print', `gui/${uid}/${LABEL}`], { encoding: 'utf8' });
    console.log(`after cleanup: launchctl print exit ${left.status} (113 = no such service); plist removed: ${!existsSync(plistPath)}`);
  }
  if (!existsSync(outPath)) {
    console.log('no result: the agent exited without one, or did not finish within 90 s');
    for (const f of ['agent.out.log', 'agent.err.log']) if (existsSync(join(dir, f))) console.log(`${f}:\n${readFileSync(join(dir, f), 'utf8').slice(0, 2000)}`);
    return;
  }
  const result = JSON.parse(readFileSync(outPath, 'utf8'));
  console.log(`inside the agent: ppid ${result.ppid} (1 = launchd), XPC_SERVICE_NAME ${JSON.stringify(result.xpc_service_name)}, PATH ${JSON.stringify(result.path_env)}`);
  for (const c of result.candidates) {
    if (c.present === false) { console.log(`\n${c.name} at ${c.path}: not present`); continue; }
    console.log(`\n${c.name} at ${c.path} (click action: ${c.click ? 'yes' : 'no'})`);
    if (c.version) console.log(`  -version: exit ${c.version.status}, ${JSON.stringify(c.version.stdout.trim())}`);
    console.log(`  post: exit ${c.post.status}${c.post.signal ? ` signal ${c.post.signal}` : ''}${c.post.error ? ` error ${c.post.error}` : ''}, ${c.post.ms} ms, stdout ${JSON.stringify(c.post.stdout)}, stderr ${JSON.stringify(c.post.stderr)}`);
    if (c.list) console.log(`  -list ${c.group}: exit ${c.list.status}\n${c.list.stdout.trimEnd().split('\n').map((l) => `    ${l}`).join('\n')}`);
  }
  console.log(`\nclick marker (exists only after the terminal-notifier banner is clicked): ${tilde(result.click_marker)}`);
  console.log(`full result: ${tilde(outPath)}`);
}

if (process.argv[2] === '--inner') await inner(process.argv[3]);
else await outer();
