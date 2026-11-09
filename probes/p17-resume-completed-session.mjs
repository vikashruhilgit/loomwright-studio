// Probe 17: can a COMPLETED SDK session be resumed by its session id with a new prompt?
// Decides when the brain's thread continuity (17b, Part 1) resumes and when it replays.
// Each case seeds its own session (so no case leaks its marker into another) that is told a random
// marker word and ends normally (`result/success`); then a resume asks for the marker.
//   (a) same process  : resume in this process, right after the seed's query() ended.
//   (b) fresh process : resume from a child `node` process (a stand-in for a kernel restart).
//   (c) cwd touched   : the seed Reads notes.txt; then notes.txt is rewritten and new.txt created
//                       in the session's cwd before the resume.
//   (d1) transcript gone: the seed's `<id>.jsonl` under ~/.claude/projects/*/ is deleted, then resumed.
//   (d2) unknown id   : a random UUID that never existed is resumed.
// For every resume it records: getSessionInfo() before the resume (a possible pre-check), each
// streamed message type in order with its time, whether any assistant message (a model turn) came,
// the result's subtype/is_error/errors, any thrown error's name and exact message, and whether the
// model's answer contains the marker.
// Normal login (settingSources ['user']), as p5/p7; Haiku; one or two turns per session.
// Usage: cd probes && npm install && node p17-resume-completed-session.mjs > out.json
//   (internal) node p17-resume-completed-session.mjs child-resume <sessionId> <cwd> <marker>
import { query, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.on('unhandledRejection', (e) => { console.log(`THREW: ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)}`); process.exit(1); });

const MODEL = 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = 180_000;
const one = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const base = (cwd) => ({ model: MODEL, cwd, settingSources: ['user'], permissionMode: 'default' });

const ASK = 'Earlier in this conversation I told you a marker word. Reply with only that word, or UNKNOWN if you do not have it.';

async function run(prompt, opts) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  const r = { seq: [], text: '', init: null, result: null, threw: null, assistantTurns: 0 };
  try {
    for await (const m of query({ prompt, options: { ...opts, abortController: ac } })) {
      const ms = Date.now() - t0;
      r.seq.push(`${m.type}${m.subtype ? '/' + m.subtype : ''}@${ms}ms`);
      if (m.type === 'system' && m.subtype === 'init') r.init = { session_id: m.session_id, claude_code_version: m.claude_code_version, apiKeySource: m.apiKeySource, cwd: m.cwd };
      if (m.type === 'assistant') {
        r.assistantTurns++;
        if (m.error) r.seq.push(`assistant.error=${m.error}`);
        r.text += m.message.content.map((c) => (c.type === 'text' ? c.text : c.type === 'tool_use' ? `[tool_use ${c.name}] ` : '')).join('');
      }
      if (m.type === 'result') {
        const mu = m.modelUsage || {};
        r.result = { subtype: m.subtype, is_error: m.is_error, session_id: m.session_id, errors: m.errors, result: one(m.result, 200), num_turns: m.num_turns, modelUsage: Object.fromEntries(Object.entries(mu).map(([k, u]) => [k, { in: u.inputTokens, out: u.outputTokens, cw: u.cacheCreationInputTokens, cr: u.cacheReadInputTokens }])) };
      }
    }
  } catch (e) {
    r.threw = { name: e?.constructor?.name, message: String(e?.message ?? e), atMs: Date.now() - t0, messagesBefore: r.seq.length, assistantTurnsBefore: r.assistantTurns };
  } finally { clearTimeout(timer); }
  r.text = one(r.text);
  r.ms = Date.now() - t0;
  return r;
}

function scratch(label) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `p17-${label}-`)));
  writeFileSync(join(dir, 'notes.txt'), 'first line: original notes\n');
  return dir;
}

async function seed(cwd, marker, readNotes = false) {
  const prompt = readNotes
    ? `The marker word is ${marker}. Remember it. Use the Read tool to read notes.txt, then reply with exactly: NOTED`
    : `The marker word is ${marker}. Remember it. Reply with exactly: NOTED`;
  return run(prompt, { ...base(cwd), maxTurns: readNotes ? 3 : 1, allowedTools: readNotes ? ['Read'] : [] });
}

async function resume(sessionId, cwd, marker) {
  const preCheck = await getSessionInfo(sessionId, { dir: cwd }).then((i) => (i ? { found: true, sessionId: i.sessionId } : { found: false }), (e) => ({ threw: one(e?.message) }));
  const preCheckAnyDir = await getSessionInfo(sessionId).then((i) => ({ found: !!i }), (e) => ({ threw: one(e?.message) }));
  const r = await run(ASK, { ...base(cwd), maxTurns: 1, allowedTools: [], resume: sessionId });
  return { preCheck, preCheckAnyDir, ...r, knewMarker: r.text.includes(marker), sameSessionId: (r.result?.session_id ?? r.init?.session_id) === sessionId };
}

function findTranscripts(sessionId) {
  const root = join(homedir(), '.claude', 'projects');
  return readdirSync(root).map((d) => join(root, d, `${sessionId}.jsonl`)).filter((p) => existsSync(p));
}

const mode = process.argv[2] || 'all';

if (mode === 'child-resume') {
  const [, , , sessionId, cwd, marker] = process.argv;
  console.log(JSON.stringify(await resume(sessionId, cwd, marker)));
  process.exit(0);
}

if (mode === 'all') {
  const out = { sdkVersion: JSON.parse(readFileSync(new URL('./node_modules/@anthropic-ai/claude-agent-sdk/package.json', import.meta.url), 'utf8')).version, date: new Date().toISOString(), node: process.version, model: MODEL, cases: {} };
  const mark = () => `MARK${randomBytes(3).toString('hex').toUpperCase()}`;

  { // (a) same process
    const cwd = scratch('a'), marker = mark(), s = await seed(cwd, marker);
    out.cases.a = { cwd, marker, seed: { subtype: s.result?.subtype, session_id: s.init?.session_id, text: s.text, threw: s.threw }, resume: await resume(s.init?.session_id, cwd, marker) };
  }
  { // (b) fresh process
    const cwd = scratch('b'), marker = mark(), s = await seed(cwd, marker);
    const child = execFileSync('node', [fileURLToPath(import.meta.url), 'child-resume', s.init?.session_id, cwd, marker], { encoding: 'utf8', timeout: TIMEOUT_MS + 30_000 });
    out.cases.b = { cwd, marker, seed: { subtype: s.result?.subtype, session_id: s.init?.session_id, text: s.text, threw: s.threw, parentPid: process.pid }, resume: JSON.parse(child.trim().split('\n').pop()) };
  }
  { // (c) files in cwd touched between seed and resume
    const cwd = scratch('c'), marker = mark(), s = await seed(cwd, marker, true);
    writeFileSync(join(cwd, 'notes.txt'), 'first line: REWRITTEN after the seed\n');
    writeFileSync(join(cwd, 'new.txt'), 'created after the seed\n');
    out.cases.c = { cwd, marker, touched: ['notes.txt (rewritten)', 'new.txt (created)'], seed: { subtype: s.result?.subtype, session_id: s.init?.session_id, text: s.text, threw: s.threw }, resume: await resume(s.init?.session_id, cwd, marker) };
  }
  { // (d1) transcript deleted
    const cwd = scratch('d1'), marker = mark(), s = await seed(cwd, marker);
    const files = findTranscripts(s.init?.session_id);
    for (const f of files) unlinkSync(f);
    out.cases.d1 = { cwd, marker, deleted: files, seed: { subtype: s.result?.subtype, session_id: s.init?.session_id, text: s.text, threw: s.threw }, resume: await resume(s.init?.session_id, cwd, marker), transcriptsAfter: findTranscripts(s.init?.session_id) };
  }
  { // (d2) unknown id
    const cwd = scratch('d2'), id = randomUUID();
    out.cases.d2 = { cwd, unknownId: id, resume: await resume(id, cwd, 'NO-MARKER'), transcriptsAfter: findTranscripts(id) };
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
