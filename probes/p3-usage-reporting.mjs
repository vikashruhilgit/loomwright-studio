// Probe 3: is the result's `usage` cumulative over a multi-turn query or last-turn only?
// Is `total_cost_usd` per query, or does it carry over between queries in one process?
// Forces three model turns (two Bash tool calls, then a final answer) on Haiku, records each API
// call's own usage (deduped by message id), and compares the sum with the result's usage.
import { query } from '@anthropic-ai/claude-agent-sdk';

const KEYS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
const sum = (xs) => Object.fromEntries(KEYS.map(k => [k, xs.reduce((a, u) => a + (u[k] || 0), 0)]));

async function run(label, prompt) {
  const perCall = new Map();
  let result;
  for await (const m of query({ prompt, options: {
    model: 'claude-haiku-4-5-20251001', maxTurns: 6, cwd: process.cwd(),
    allowedTools: ['Bash(echo:*)'], permissionMode: 'default',
  } })) {
    if (m.type === 'assistant' && m.message?.usage) perCall.set(m.message.id, m.message.usage);
    if (m.type === 'result') result = m;
  }
  const calls = [...perCall.values()];
  const summed = sum(calls);
  const last = calls.length ? Object.fromEntries(KEYS.map(k => [k, calls.at(-1)[k] || 0])) : {};
  const reported = Object.fromEntries(KEYS.map(k => [k, result.usage?.[k] || 0]));
  console.log(`\n### ${label}`);
  console.log(`result: subtype=${result.subtype} num_turns=${result.num_turns} api_calls_seen=${calls.length} total_cost_usd=${result.total_cost_usd}`);
  console.log('per-call usage:', JSON.stringify(calls.map(u => Object.fromEntries(KEYS.map(k => [k, u[k] || 0])))));
  console.log('sum of per-call :', JSON.stringify(summed));
  console.log('last call       :', JSON.stringify(last));
  console.log('result.usage    :', JSON.stringify(reported));
  console.log(`result.usage equals sum-of-calls: ${KEYS.every(k => reported[k] === summed[k])} | equals last-call: ${KEYS.every(k => reported[k] === last[k])}`);
  console.log('modelUsage:', JSON.stringify(result.modelUsage));
  return result.total_cost_usd;
}

const c1 = await run('query 1: three turns', 'Use the Bash tool to run `echo one`. After it returns, use the Bash tool again to run `echo two`. After that returns, reply with exactly: DONE');
const c2 = await run('query 2: one turn, same process', 'Reply with exactly: OK');
console.log(`\ncost q1=${c1} q2=${c2} -> q2 carries q1's cost: ${c2 >= c1}`);
