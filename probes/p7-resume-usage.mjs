// Probe 7: is result.modelUsage cumulative across a resume (a new query() on the same session),
// or per query() call? Raised by the PR #4 review against requirement 06 AC1.
//   clean  : query 1 completes; query 2 resumes it. Compare the two results' modelUsage.
//   abort  : query 1 is aborted mid tool call (no result); query 2 resumes it. Compare with a fresh
//            one-turn baseline and with the usage query 1 reported per message before the abort.
// Normal login (settingSources ['user']); Haiku; a few cents at list price.
import { query } from '@anthropic-ai/claude-agent-sdk';

process.on('unhandledRejection', (e) => { console.log(`THREW: ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)}`); process.exit(1); });

const MODEL = 'claude-haiku-4-5-20251001';
const base = { model: MODEL, cwd: process.cwd(), settingSources: ['user'], permissionMode: 'default' };
const sum = (mu) => { const u = mu?.[MODEL] || {}; return { in: u.inputTokens || 0, out: u.outputTokens || 0, cw: u.cacheCreationInputTokens || 0, cr: u.cacheReadInputTokens || 0 }; };
const fmt = (u) => `in=${u.in} out=${u.out} cacheW=${u.cw} cacheR=${u.cr} total=${u.in + u.out + u.cw + u.cr}`;

async function run(prompt, opts, abortOnTool = false) {
  const ac = new AbortController();
  let sessionId, result, perMsg = { in: 0, out: 0, cw: 0, cr: 0 };
  try {
    for await (const m of query({ prompt, options: { ...base, ...opts, abortController: ac } })) {
      if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
      if (m.type === 'assistant') {
        const u = m.message.usage || {};
        perMsg.in += u.input_tokens || 0; perMsg.out += u.output_tokens || 0; perMsg.cw += u.cache_creation_input_tokens || 0; perMsg.cr += u.cache_read_input_tokens || 0;
        if (abortOnTool && m.message.content.some(c => c.type === 'tool_use')) setTimeout(() => ac.abort(), 1500);
      }
      if (m.type === 'result') result = m;
    }
  } catch (e) { if (!abortOnTool) throw e; }
  return { sessionId, result, perMsg };
}

const mode = process.argv[2] || 'clean';
if (mode === 'clean') {
  const a = await run('Reply with exactly: ONE', { maxTurns: 1, allowedTools: [] });
  const b = await run('Reply with exactly: TWO', { maxTurns: 1, allowedTools: [], resume: a.sessionId });
  console.log(`query1 result          ${fmt(sum(a.result?.modelUsage))}`);
  console.log(`query2 (resume) result ${fmt(sum(b.result?.modelUsage))}  same_session=${b.result?.session_id === a.sessionId}`);
}
if (mode === 'abort') {
  const fresh = await run('Reply with exactly: BASE', { maxTurns: 1, allowedTools: [] });
  const a = await run('Use the Bash tool to run exactly: sleep 20 && echo slept. Then reply DONE.', { maxTurns: 3, allowedTools: ['Bash(sleep:*)'] }, true);
  const b = await run('Reply with exactly: RESUMED', { maxTurns: 1, allowedTools: [], resume: a.sessionId });
  console.log(`fresh one-turn baseline  ${fmt(sum(fresh.result?.modelUsage))}`);
  console.log(`aborted query1: result=${a.result ? a.result.subtype : 'none'}; per-message usage seen before abort ${fmt(a.perMsg)}`);
  console.log(`query2 (resume) result   ${fmt(sum(b.result?.modelUsage))}  same_session=${b.result?.session_id === a.sessionId}`);
}
process.exit(0);
