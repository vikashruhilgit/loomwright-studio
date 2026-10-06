// Probe 8: does the CLI run a Bash tool command inside the session's process group?
// The kernel spawns the CLI as the leader of a new process group (detached: true, as in
// kernel/src/sessions/spawner.ts) and relies on killing that group to stop everything the
// session started. The phase 1 live exit test timed out waiting for `sleep` in that group.
// This probe spawns the same way, has the model run `sleep 19.37` (a unique duration, so no unrelated sleep matches), and reports the pgid, the session id (getsid(); `ps -o sess` prints 0 for everything on macOS) and
// parent chain of every `sleep` it finds, plus the CLI leader's own pgid.
// Normal login (settingSources ['user']; process-group behaviour does not depend on auth); Haiku.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { spawn, execFileSync } from 'node:child_process';

process.on('unhandledRejection', (e) => { console.log(`THREW: ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)}`); process.exit(1); });

let leaderPid;
const TAG = `STUDIO_SESSION_TAG=probe8-${process.pid}-${Date.now()}`;
// Can the kernel find a session's processes by an inherited env tag? `ps -E` prints the environment of the user's own processes.
const hasTag = (pid) => { try { return execFileSync('/bin/ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).includes(TAG); } catch { return false; } };
const getsid = (pid) => { try { return execFileSync('/usr/bin/python3', ['-c', `import os; print(os.getsid(${pid}))`], { encoding: 'utf8' }).trim(); } catch { return 'gone'; } };
const ps = () => execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,sess=,args='], { encoding: 'utf8' })
  .split('\n').map(l => l.trim().split(/\s+/)).filter(r => r.length >= 5)
  .map(([pid, ppid, pgid, sess, ...c]) => ({ pid: +pid, ppid: +ppid, pgid: +pgid, sess, comm: c.join(' ') }));

function report(tag) {
  const rows = ps();
  const byPid = new Map(rows.map(r => [r.pid, r]));
  const chain = (pid) => { const out = []; for (let p = pid, i = 0; p && i < 8; i++) { const r = byPid.get(p); if (!r) break; out.push(`${r.pid}:${r.comm.split(' ')[0].split('/').pop()}(pgid ${r.pgid})`); if (r.pid === leaderPid) break; p = r.ppid; } return out.join(' <- '); };
  const descends = (pid) => { for (let p = pid, i = 0; p > 1 && i < 20; i++) { if (p === leaderPid) return true; p = byPid.get(p)?.ppid; } return false; };
  // Only the session's own `sleep 15` (args match), whether or not it descends from the CLI leader.
  const sleeps = rows.filter(r => /(^|\/)sleep 19\.37$/.test(r.comm)).map(r => ({ ...r, descends: descends(r.pid) }));
  console.log(`[${tag}] CLI leader pid=${leaderPid} pgid=${byPid.get(leaderPid)?.pgid} sid=${getsid(leaderPid)}; sleep processes: ${sleeps.length}`);
  for (const s of sleeps) console.log(`  sleep pid=${s.pid} pgid=${s.pgid} sid=${getsid(s.pid)} same_session_as_leader=${getsid(s.pid) === getsid(leaderPid)} env_tag_leader=${hasTag(leaderPid)} env_tag_sleep=${hasTag(s.pid)} env_tag_shell=${hasTag(s.ppid)} shell_env_vars=${(() => { try { return execFileSync('/bin/ps', ['-E', '-ww', '-o', 'command=', '-p', String(s.ppid)], { encoding: 'utf8' }).split(' ').filter(w => /^[A-Z_][A-Z0-9_]*=/.test(w)).map(w => w.split('=')[0]).filter(k => /CLAUDE|STUDIO|ANTHROPIC/.test(k)).join(',') || 'none-matching'; } catch { return 'unreadable'; } })()} in_leader_group=${s.pgid === leaderPid} descends_from_leader=${s.descends} chain: ${chain(s.pid)}`);
  return sleeps.length > 0;
}

let seen = false, polling;
for await (const m of query({ prompt: 'Use the Bash tool to run exactly: sleep 19.37 && echo slept. Then reply DONE.', options: {
  model: 'claude-haiku-4-5-20251001', maxTurns: 3, cwd: process.cwd(), settingSources: ['user'],
  permissionMode: 'default', allowedTools: ['Bash(sleep:*)'],
  spawnClaudeCodeProcess: (o) => {
    const child = spawn(o.command, o.args, { cwd: o.cwd, env: { ...o.env, [TAG.split('=')[0]]: TAG.split('=')[1] }, stdio: ['pipe', 'pipe', 'pipe'], detached: true, signal: o.signal });
    leaderPid = child.pid;
    child.stderr.on('data', () => {});
    return child;
  },
} })) {
  if (m.type === 'assistant' && m.message.content.some(c => c.type === 'tool_use') && !polling) {
    polling = setInterval(() => { if (!seen && report('poll')) { seen = true; clearInterval(polling); } }, 250);
  }
  if (m.type === 'result') { clearInterval(polling); console.log(`result: ${m.subtype}; sleep seen while running: ${seen}`); }
}
process.exit(0);
