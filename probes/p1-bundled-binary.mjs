// Probe 1: does the SDK run its own bundled CLI, with no `claude` on PATH?
// Reads the CLI's system/init message (emitted before any API call) and aborts, so it spends no tokens.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { execFileSync } from 'node:child_process';

let onPath = 'none';
try { onPath = execFileSync('/usr/bin/which', ['claude'], { env: process.env }).toString().trim(); } catch {}
console.log(`PATH=${process.env.PATH}`);
console.log(`claude on PATH: ${onPath}`);

const ac = new AbortController();
const t0 = Date.now();
try {
  for await (const m of query({ prompt: 'Reply with OK.', options: { abortController: ac, maxTurns: 1, cwd: process.cwd() } })) {
    if (m.type === 'system' && m.subtype === 'init') {
      console.log(JSON.stringify({
        ms_to_init: Date.now() - t0,
        claude_code_version: m.claude_code_version,
        apiKeySource: m.apiKeySource,
        model: m.model,
        permissionMode: m.permissionMode,
        tools: m.tools?.length,
        plugins: m.plugins,
        slash_commands: m.slash_commands?.length,
        agents: m.agents?.length,
      }, null, 2));
      ac.abort();
      break;
    }
  }
} catch (e) {
  if (e.name !== 'AbortError' && !String(e).includes('abort')) { console.log('ERROR', e.message); process.exitCode = 1; }
}
