// Probe 4a: which plugins, agents, skills and commands does an SDK session load, and what controls it?
// Reads only the init message for each option set, so it spends no tokens.
import { query } from '@anthropic-ai/claude-agent-sdk';

async function init(label, extra) {
  const ac = new AbortController();
  try {
    for await (const m of query({ prompt: 'Reply with OK.', options: { abortController: ac, maxTurns: 1, cwd: process.cwd(), model: 'claude-haiku-4-5-20251001', ...extra } })) {
      if (m.type === 'system' && m.subtype === 'init') {
        const lw = (xs) => (xs || []).filter(x => String(x).toLowerCase().includes('loomwright'));
        console.log(`\n### ${label}`);
        console.log(`plugins: ${(m.plugins || []).map(p => p.name + (p.version ? '@' + p.version : '')).join(', ') || '(none)'}`);
        console.log(`agents: ${m.agents?.length} (loomwright: ${lw(m.agents).length}) e.g. ${lw(m.agents).slice(0, 3).join(', ')}`);
        console.log(`skills: ${m.skills?.length} (loomwright: ${lw(m.skills).length}) e.g. ${lw(m.skills).slice(0, 3).join(', ')}`);
        console.log(`slash_commands: ${m.slash_commands?.length} (loomwright: ${lw(m.slash_commands).length}) e.g. ${lw(m.slash_commands).slice(0, 3).join(', ')}`);
        console.log(`mcp_servers: ${JSON.stringify((m.mcp_servers || []).map(s => s.name))}`);
        ac.abort(); break;
      }
    }
  } catch (e) { if (!String(e).toLowerCase().includes('abort')) console.log(label, 'ERROR', e.message); }
}

await init('default options', {});
await init("settingSources: [] (no filesystem settings)", { settingSources: [] });
await init("settingSources: ['project']", { settingSources: ['project'] });
await init("settingSources: [] + plugins: [loomwright by local path]", { settingSources: [], plugins: [{ type: 'local', path: process.env.LW_PATH }] });
