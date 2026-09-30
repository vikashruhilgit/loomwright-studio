// Probe 6: what does the SDK tell the kernel about subscription usage limits, without hitting the cap?
// One tiny Haiku call on the normal login. Prints every rate_limit_event (the structured signal that
// carries status 'rejected' when a cap is hit) and the plan windows from the experimental usage call.
// The cap-hit path itself cannot be exercised on purpose; its shape comes from sdk.d.ts (see OPEN_QUESTIONS Q6).
import { query } from '@anthropic-ai/claude-agent-sdk';

process.on('unhandledRejection', (e) => { console.log(`THREW: ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)}`); process.exit(1); });

let release;
const done = new Promise(r => { release = r; });
async function* prompt() {
  yield { type: 'user', message: { role: 'user', content: 'Reply with exactly: OK' }, parent_tool_use_id: null };
  await done; // keep the session open until the usage call has answered
}

const q = query({ prompt: prompt(), options: { model: 'claude-haiku-4-5-20251001', maxTurns: 1, allowedTools: [], cwd: process.cwd(), settingSources: ['user'] } });
const events = [];
let result;
for await (const m of q) {
  if (m.type === 'rate_limit_event') events.push(m.rate_limit_info);
  if (m.type === 'assistant' && m.error) console.log(`assistant error field: ${m.error}`);
  if (m.type === 'result') {
    result = m;
    try {
      const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      console.log(`usage: subscription_type=${u.subscription_type} rate_limits_available=${u.rate_limits_available}`);
      console.log(JSON.stringify(u.rate_limits, null, 1));
    } catch (e) { console.log(`usage call failed: ${String(e.message).slice(0, 200)}`); }
    release();
    break;
  }
}
console.log(`result: ${result?.subtype} is_error=${result?.is_error}`);
console.log(`rate_limit_event count: ${events.length}`);
for (const e of events) console.log(JSON.stringify(e));
process.exit(0);
