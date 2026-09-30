// Probe 2: does the SDK authenticate with the machine's existing Claude Code login, with no key and no login UI?
// Mode "call": one tiny Haiku query with no ANTHROPIC_API_KEY in the environment.
// Mode "precedence": set a bogus ANTHROPIC_API_KEY and read only the init message (no API call) to see which source the CLI picks.
import { query } from '@anthropic-ai/claude-agent-sdk';

const mode = process.argv[2] || 'call';
console.log(`mode=${mode} ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ? 'set' : 'unset'}`);
const ac = new AbortController();
try {
  for await (const m of query({ prompt: 'Reply with exactly: OK', options: { abortController: ac, model: 'claude-haiku-4-5-20251001', maxTurns: 1, allowedTools: [], cwd: process.cwd() } })) {
    if (m.type === 'system' && m.subtype === 'init') {
      console.log(`init: apiKeySource=${m.apiKeySource} model=${m.model}`);
      if (mode === 'precedence') { ac.abort(); break; }
    }
    if (m.type === 'assistant') console.log(`assistant: ${m.message.content.map(c => c.text || '').join('').trim()}`);
    if (m.type === 'result') console.log(`result: subtype=${m.subtype} is_error=${m.is_error} turns=${m.num_turns} ${m.is_error ? 'text=' + JSON.stringify(m.result) : ''}`);
  }
} catch (e) {
  if (!String(e).toLowerCase().includes('abort')) { console.log('ERROR', e.message); process.exitCode = 1; }
}
