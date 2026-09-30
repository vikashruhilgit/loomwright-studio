// Probe 4c: which settingSources values keep the subscription login working?
// One tiny Haiku call per variant; reports auth success/failure and what loaded.
import { query } from '@anthropic-ai/claude-agent-sdk';

async function call(label, extra) {
  let init, result, threw;
  try {
    for await (const m of query({ prompt: 'Reply with exactly: OK', options: { model: 'claude-haiku-4-5-20251001', maxTurns: 1, allowedTools: [], cwd: process.cwd(), ...extra } })) {
      if (m.type === 'system' && m.subtype === 'init') init = m;
      if (m.type === 'result') result = m;
    }
  } catch (e) { threw = String(e.message).slice(0, 160); }
  const plugins = (init?.plugins || []).map(p => p.name).join(',');
  console.log(`${label.padEnd(44)} auth=${threw ? 'FAILED' : result?.is_error ? 'ERROR' : 'ok'} apiKeySource=${init?.apiKeySource} plugins=[${plugins}]${threw ? ' :: ' + threw : ''}`);
}

await call('default (no settingSources)', {});
await call('settingSources: []', { settingSources: [] });
await call("settingSources: ['user']", { settingSources: ['user'] });
await call("settingSources: ['project']", { settingSources: ['project'] });
await call("settingSources: ['local']", { settingSources: ['local'] });
