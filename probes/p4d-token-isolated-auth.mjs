// Probe 4d: does a long-lived subscription token (from `claude setup-token`) authenticate a fully
// isolated session (settingSources [] and Loomwright by path, nothing else of the user's), and
// which models can it use? One tiny call per model; reports which model actually answered, so a
// silent fallback cannot pass as success.
//
// Owner run (the token is a real credential; it is read from the environment and never printed):
//   CLAUDE_CODE_OAUTH_TOKEN="$(security find-generic-password -s loomwright-studio-oauth -w)" \
//   LW_PATH="$HOME/.claude/plugins/cache/atelier/loomwright/<version>" node p4d-token-isolated-auth.mjs
//
// Baseline (no token; the normal login, which needs settingSources ['user'], see p4c):
//   node p4d-token-isolated-auth.mjs --baseline
import { query } from '@anthropic-ai/claude-agent-sdk';

const MODELS = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'];
const baseline = process.argv.includes('--baseline');

if (!baseline) {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) { console.log('Set CLAUDE_CODE_OAUTH_TOKEN (see header), or pass --baseline.'); process.exit(2); }
  if (!process.env.LW_PATH) { console.log('Set LW_PATH to the installed Loomwright plugin directory.'); process.exit(2); }
  delete process.env.ANTHROPIC_API_KEY; // as D27's provider does: a stray key would win over the token (Q2)
} else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.log('--baseline must run without CLAUDE_CODE_OAUTH_TOKEN.'); process.exit(2);
}
const isolation = baseline
  ? { settingSources: ['user'] }
  : { settingSources: [], plugins: [{ type: 'local', path: process.env.LW_PATH }] };
console.log(baseline ? 'mode: baseline (normal login, user settings)' : 'mode: token, fully isolated (settingSources [], Loomwright by path)');

for (const model of MODELS) {
  let init, result, threw, limit;
  try {
    for await (const m of query({ prompt: 'Reply with exactly: OK', options: { model, maxTurns: 1, allowedTools: [], cwd: process.cwd(), ...isolation } })) {
      if (m.type === 'system' && m.subtype === 'init') init = m;
      if (m.type === 'rate_limit_event') limit = m.rate_limit_info;
      if (m.type === 'result') result = m;
    }
  } catch (e) { threw = String(e.message).replace(/\s+/g, ' ').slice(0, 160); }
  const answered = Object.keys(result?.modelUsage || {}).filter(k => !k.startsWith('claude-haiku') || model.startsWith('claude-haiku')).join(',') || '-';
  const status = threw ? 'FAILED' : result?.is_error ? 'ERROR' : 'ok';
  console.log(`${model.padEnd(28)} ${status.padEnd(6)} apiKeySource=${init?.apiKeySource} answered_by=${answered} rate_limit_event=${limit ? `${limit.status}/${limit.rateLimitType}` : 'none'} plugins=[${(init?.plugins || []).map(p => p.name).join(',')}] commands=${(init?.slash_commands || []).length}${threw ? ' :: ' + threw : result?.is_error ? ' :: ' + String(result.result).slice(0, 160) : ''}`);
}
if (!baseline) console.log('\n(isolated: plugins should be loomwright plus the CLI builtins agents-md and telemetry, path "builtin")');
