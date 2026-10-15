// Probe 9: two Loomwright hook behaviours phase 2 depends on, in a real SDK session.
//   (1) What do Loomwright's SessionStart hooks write into the repo a session works in?
//       (snapshot every file in a throwaway git repo before and after)
//   (2) Does SubagentStop fire, and do Loomwright's matchers hit, when the session runs a
//       Loomwright agent? (rubric-grader: the cheapest, a read-only Haiku agent)
// Run from a throwaway git repo:  PROBE_CWD=<dir> node p9-loomwright-hooks.mjs
// With --host-mode (phase 2, D32): the session runs with LOOMWRIGHT_HOST_MODE=1 and
// LOOMWRIGHT_HOST_STATE_DIR=<a fresh temp dir>, and (3) prints `git status --porcelain --ignored`
// of PROBE_CWD before and after, and the files under the state dir. Without the flag the
// output is unchanged.
// Normal login, so settingSources ['user'] (D27's isolated token path is the owner's): Loomwright
// comes from the user's ACTIVE install. The output records its version; Loomwright evolves.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { readdirSync, statSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

process.on('unhandledRejection', (e) => { console.log(`THREW: ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)}`); process.exit(1); });

const cwd = process.env.PROBE_CWD;
if (!cwd || !existsSync(join(cwd, '.git'))) { console.log('Set PROBE_CWD to a throwaway git repo.'); process.exit(2); }

function snapshot(dir) {
  const out = new Map();
  const walk = (d) => { for (const n of readdirSync(d)) { if (n === '.git') continue; const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else out.set(relative(dir, p), `${s.size}:${s.mtimeMs}`); } };
  walk(dir); return out;
}
const hostMode = process.argv.slice(2).includes('--host-mode');
const gitStatus = () => execFileSync('git', ['status', '--porcelain', '--ignored'], { cwd, encoding: 'utf8' });
const stateDir = hostMode ? mkdtempSync(join(tmpdir(), 'p9-host-state-')) : undefined;
const gitBefore = hostMode ? gitStatus() : undefined;
const before = snapshot(cwd);
const hooks = [];
let init, result, said = '';
for await (const m of query({ prompt: 'Use the Agent tool (subagent_type "loomwright:loomwright:rubric-grader") with this prompt: "No PR here; reply with exactly: rubric_score: 0/0". Then reply DONE.', options: {
  model: 'claude-haiku-4-5-20251001', maxTurns: 4, cwd, settingSources: ['user'], permissionMode: 'default',
  allowedTools: ['Agent', 'Task', 'Read', 'Glob', 'Grep'], includeHookEvents: true,
  ...(hostMode ? { env: { ...process.env, LOOMWRIGHT_HOST_MODE: '1', LOOMWRIGHT_HOST_STATE_DIR: stateDir } } : {}),
} })) {
  if (m.type === 'system' && m.subtype === 'init') init = m;
  if (m.type === 'system' && m.subtype === 'hook_response') hooks.push(m);
  if (m.type === 'assistant' && !m.parent_tool_use_id) said += m.message.content.map(c => c.type === 'tool_use' ? `[${c.name} ${c.input?.subagent_type ?? ''}] ` : '').join('');
  if (m.type === 'result') result = m;
}
const after = snapshot(cwd);
const lw = (init?.plugins || []).find(p => p.name === 'loomwright');
console.log(`loomwright ${lw?.version} (${lw?.path}); result ${result?.subtype}; main-thread tool calls: ${said.trim() || 'none'}`);

console.log('\n(1) files the session added or changed in the repo:');
for (const [f, sig] of after) if (before.get(f) !== sig) console.log(`  ${before.has(f) ? 'changed' : 'added  '} ${f}`);
const sl = join(cwd, '.claude', 'settings.local.json');
if (existsSync(sl)) { try { const j = JSON.parse(readFileSync(sl, 'utf8')); console.log(`  settings.local.json keys: ${JSON.stringify(Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v && typeof v === 'object' ? Object.keys(v) : typeof v])))}`); } catch { console.log('  settings.local.json: unparseable'); } }

console.log('\n(2) hook responses by event (Loomwright ones flagged):');
const byEv = {};
for (const h of hooks) { const k = h.hook_event; byEv[k] ??= []; byEv[k].push(h); }
for (const [ev, list] of Object.entries(byEv)) {
  console.log(`  ${ev}: ${list.length}`);
  if (ev === 'SubagentStop' || ev === 'SessionStart') for (const h of list) console.log(`    ${h.outcome} exit=${h.exit_code ?? 'n/a'} ${String(h.hook_name).slice(0, 110)}`);
}
if (!byEv.SubagentStop) console.log('  SubagentStop: NONE fired');

if (hostMode) {
  const show = (text) => (text.trim() === '' ? '    (clean)' : text.trimEnd().split('\n').map((l) => `    ${l}`).join('\n'));
  console.log(`\n(3) host mode: LOOMWRIGHT_HOST_MODE=1 LOOMWRIGHT_HOST_STATE_DIR=${stateDir}`);
  console.log('  git status --porcelain --ignored, before:');
  console.log(show(gitBefore));
  console.log('  git status --porcelain --ignored, after:');
  console.log(show(gitStatus()));
  console.log('  files under the state dir:');
  const files = [...snapshot(stateDir).keys()].sort();
  console.log(files.length === 0 ? '    (none)' : files.map((f) => `    ${f}`).join('\n'));
}
process.exit(0);
