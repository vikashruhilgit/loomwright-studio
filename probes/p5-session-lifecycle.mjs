// Probe 5: what the kernel gets from SDK query() sessions, to decide query() vs `claude --bg`.
//   spawn   : start a session that runs `sleep 30` via Bash; writes {nodePid, sessionId} to STATE_FILE
//             so a harness can kill -9 this process mid-session and check whether the CLI child survives.
//   resume  : resume that session by id and ask what it ran earlier (is the transcript on disk?).
//   kernel  : an in-process MCP tool (a stand-in for the kernel's task_create) plus a canUseTool
//             callback (the approval gate): do both run inside this process?
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { writeFileSync, readFileSync } from 'node:fs';
import { z } from 'zod';

process.on('uncaughtException', (e) => { console.log(`THREW: ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)}`); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log(`THREW: ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)}`); process.exit(1); });

const mode = process.argv[2];
const STATE = process.env.STATE_FILE;
const base = { model: 'claude-haiku-4-5-20251001', cwd: process.cwd(), settingSources: ['user'] };

if (mode === 'spawn') {
  for await (const m of query({ prompt: 'Use the Bash tool to run exactly: sleep 30 && echo slept. Then reply DONE.', options: { ...base, maxTurns: 3, allowedTools: ['Bash(sleep:*)'] } })) {
    if (m.type === 'system' && m.subtype === 'init') {
      writeFileSync(STATE, JSON.stringify({ nodePid: process.pid, sessionId: m.session_id }));
      console.log(`spawned session=${m.session_id} nodePid=${process.pid}`);
    }
    if (m.type === 'assistant' && m.message.content.some(c => c.type === 'tool_use')) console.log('tool call issued (sleep 30 running)');
  }
}

if (mode === 'resume') {
  const { sessionId } = JSON.parse(readFileSync(STATE, 'utf8'));
  let text = '', result;
  for await (const m of query({ prompt: 'In one short sentence: what shell command did you run earlier in this session, and did it finish?', options: { ...base, maxTurns: 1, allowedTools: [], resume: sessionId } })) {
    if (m.type === 'assistant') text += m.message.content.map(c => c.text || '').join('');
    if (m.type === 'result') result = m;
  }
  console.log(`resume ${result?.subtype} session=${result?.session_id} same_id=${result?.session_id === sessionId}\nanswer: ${text.trim()}`);
}

if (mode === 'kernel') {
  const calls = [], asked = [];
  const kernel = createSdkMcpServer({ name: 'kernel', version: '0.0.0', tools: [
    tool('kernel_record_task', 'Record a task in the Studio kernel task table (not the built-in TaskCreate).', { title: z.string() }, async ({ title }) => {
      calls.push({ title, pid: process.pid });
      return { content: [{ type: 'text', text: `created task T-1: ${title}` }] };
    }),
  ] });
  let result, init, said = '';
  // In-process MCP servers need streaming input (an async-iterable prompt), not a plain string.
  async function* prompt() {
    yield { type: 'user', message: { role: 'user', content: 'Call the mcp__kernel__kernel_record_task tool with title "probe task". Then use the Bash tool to run: touch gated.txt. Then reply DONE.' }, parent_tool_use_id: null };
  }
  for await (const m of query({ prompt: prompt(), options: {
    ...base, maxTurns: 5, mcpServers: { kernel },
    allowedTools: ['mcp__kernel__kernel_record_task'],
    // The user's settings set defaultMode 'auto', which approves tools before canUseTool is asked; force the gate.
    permissionMode: 'default',
    canUseTool: async (toolName, input) => { asked.push(toolName); return { behavior: 'deny', message: 'Denied by the probe approval gate.' }; },
  } })) {
    if (m.type === 'system' && m.subtype === 'init') init = m;
    if (m.type === 'assistant') said += m.message.content.map(c => c.type === 'tool_use' ? `[tool_use ${c.name}] ` : (c.text || '')).join('');
    if (m.type === 'result') result = m;
  }
  console.log(`session permissionMode: ${init?.permissionMode}`);
  console.log(`kernel tool visible to model: ${(init?.tools || []).filter(t => t.includes('kernel')).join(',') || 'NO'}`);
  console.log(`model did: ${said.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  console.log(`kernel ${result?.subtype}: in-process tool calls=${JSON.stringify(calls)} (probe pid ${process.pid})`);
  console.log(`approval callback asked for: ${JSON.stringify(asked)}`);
}
