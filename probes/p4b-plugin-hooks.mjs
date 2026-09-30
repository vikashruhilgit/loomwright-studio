// Probe 4b: do a plugin's hooks.json hooks actually fire in an SDK session?
// Loads Loomwright by local path (settingSources: [] so nothing else of the user's leaks in), asks
// Haiku to run one `echo` via Bash, and records every hook the CLI reports via includeHookEvents.
// Run from a throwaway git repo: some Loomwright hooks write run state into the working directory.
import { query } from '@anthropic-ai/claude-agent-sdk';

const started = new Map(), responses = [];
let result;
try {
for await (const m of query({ prompt: 'Use the Bash tool to run `echo probe`. Then reply with exactly: DONE', options: {
  model: 'claude-haiku-4-5-20251001', maxTurns: 4, cwd: process.env.PROBE_CWD || process.cwd(),
  // SOURCES=user: Loomwright comes from the user's installed plugins (subscription auth needs 'user', see p4c).
  // Otherwise: settingSources [] and Loomwright by local path (fully isolated, but OAuth fails there).
  ...(process.env.SOURCES === 'user' ? { settingSources: ['user'] } : { settingSources: [], plugins: [{ type: 'local', path: process.env.LW_PATH }] }),
  allowedTools: ['Bash(echo:*)'], includeHookEvents: true,
} })) {
  if (m.type === 'system' && m.subtype === 'hook_started') started.set(m.hook_id, m);
  if (m.type === 'system' && m.subtype === 'hook_response') responses.push(m);
  if (m.type === 'result') result = m;
}
} catch (e) { console.log('QUERY THREW:', String(e.message).slice(0, 400)); }
const byEvent = {};
for (const r of responses) {
  const k = r.hook_event; byEvent[k] ??= { fired: 0, success: 0, error: 0, cancelled: 0, exit_codes: {} };
  byEvent[k].fired++; byEvent[k][r.outcome]++; byEvent[k].exit_codes[r.exit_code ?? 'n/a'] = (byEvent[k].exit_codes[r.exit_code ?? 'n/a'] || 0) + 1;
}
console.log(`result: ${result?.subtype} turns=${result?.num_turns}`);
console.log(`hook_started: ${started.size}  hook_response: ${responses.length}`);
console.log(JSON.stringify(byEvent, null, 1));
for (const r of responses) console.log(`- ${r.hook_event.padEnd(12)} ${r.outcome.padEnd(8)} exit=${r.exit_code ?? 'n/a'} ${r.hook_name}`);
const errs = responses.filter(r => r.outcome !== 'success');
for (const r of errs) console.log(`\nNON-SUCCESS ${r.hook_event} ${r.hook_name}\nstderr: ${r.stderr.slice(0, 300)}`);
