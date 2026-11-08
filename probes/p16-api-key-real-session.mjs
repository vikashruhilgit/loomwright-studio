// Probe 16 (the auth-switch side track in docs/ROADMAP.md): does a REAL API key, read by the kernel's own `api-key` provider from
// the Keychain item `loomwright-studio-api-key`, authenticate a fully isolated session
// (settingSources [] and Loomwright by path), and which models answer on it? Also checks that the
// provider's env strips a stray subscription token, and how fast a bad key fails.
//
// The key is never read from or printed to the shell: the kernel's provider reads the Keychain and
// builds the child env. Nothing here prints, logs or writes the key, and the evidence file is checked
// for it before it is written. Each model call is one tiny turn (a few cents in all).
//
// Prerequisites: the key saved once, prompted (not in shell history):
//   security add-generic-password -a loomwright-studio -s loomwright-studio-api-key -w
// and the kernel built (the probe imports its dist):  (cd ../kernel && npm run build)
//
// Owner run:
//   LW_PATH="$HOME/.claude/plugins/cache/atelier/loomwright/<version>" node p16-api-key-real-session.mjs \
//     --out ../docs/evidence/p16-api-key-real-session.json
// Options:
//   --models a,b,c   models to try (default: the four p4d tried)
//   --bad-key        instead, run ONE session on a deliberately invalid key and time the first
//                    api_retry (status + seconds), then abort; no Keychain read, no spend
//   --failing-key    run ONE session on the real Keychain key and stop at the first api_retry, for a
//                    revoked or out-of-credit key: records the status the API returns for it
import { writeFileSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createApiKeyProvider } from '../kernel/dist/auth/api-key.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const MODELS = (opt('--models') ?? 'claude-fable-5-1,claude-opus-5-5,claude-sonnet-5,claude-haiku-4-5-20251001').split(',');
const DECOY_TOKEN = 'sk-ant-oat01-p16-decoy-not-a-real-token';
const mode = flag('--bad-key') ? 'bad-key' : flag('--failing-key') ? 'failing-key' : 'real-key';

if (!process.env.LW_PATH) { console.log('Set LW_PATH to the installed Loomwright plugin directory (see header).'); process.exit(2); }
const sdkVersion = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./node_modules/@anthropic-ai/claude-agent-sdk/package.json', import.meta.url))).version;
const evidence = { probe: 'p16-api-key-real-session', mode, date: new Date().toISOString(), sdk: sdkVersion, results: [] };

// The child env: the parent env plus a decoy subscription token (the AC's "token also set" case),
// then the kernel's provider strips every credential and sets only the key.
let env, secret;
if (mode === 'bad-key') {
  secret = 'sk-ant-api03-' + 'x'.repeat(95); // well-shaped, never valid
  env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ANTHROPIC_') && k !== 'CLAUDE_CODE_OAUTH_TOKEN')), ANTHROPIC_API_KEY: secret };
} else {
  const provider = createApiKeyProvider();
  evidence.provider_health = provider.health();
  console.log(`provider: api-key  health: ${JSON.stringify(evidence.provider_health)}`);
  if (evidence.provider_health.status !== 'ok') { console.log('The provider is not healthy; save the key first (see header).'); process.exit(2); }
  env = provider.buildEnv({ ...process.env, CLAUDE_CODE_OAUTH_TOKEN: DECOY_TOKEN });
  secret = env.ANTHROPIC_API_KEY;
}
evidence.strip_check = {
  decoy_token_reached_child: Object.values(env).includes(DECOY_TOKEN),
  credential_vars_in_child: Object.keys(env).filter(k => k.startsWith('ANTHROPIC_') || k === 'CLAUDE_CODE_OAUTH_TOKEN').sort(),
};
console.log(`strip check: decoy token reached child = ${evidence.strip_check.decoy_token_reached_child}; credential vars = [${evidence.strip_check.credential_vars_in_child}]`);

const isolation = { settingSources: [], plugins: [{ type: 'local', path: process.env.LW_PATH }] };
const t0 = () => { const s = Date.now(); return () => +((Date.now() - s) / 1000).toFixed(1); };

async function run(model, stopAtFirstRetry) {
  const ac = new AbortController();
  const since = t0();
  const r = { model };
  try {
    for await (const m of query({ prompt: 'Reply with exactly: OK', options: { model, maxTurns: 1, allowedTools: [], cwd: process.cwd(), env, abortController: ac, ...isolation } })) {
      // An invalid key can also fail at once with no api_retry: an assistant message carrying `error`
      // (seen 2026-11-08, SDK 0.3.284: `authentication_failed` 0.3 s after init, then the result).
      if (m.type === 'assistant' && m.error && !r.assistant_error) r.assistant_error = { at_s: since(), after_init_s: r.init_at_s === undefined ? null : +(since() - r.init_at_s).toFixed(1), error: m.error };
      if (m.type === 'system' && m.subtype === 'init') {
        r.init_at_s = since(); // includes SessionStart hooks, which run before init
        r.apiKeySource = m.apiKeySource;
        r.plugins = (m.plugins || []).map(p => ({ name: p.name, path: p.path === 'builtin' ? 'builtin' : 'local' }));
      }
      if (m.type === 'system' && m.subtype === 'api_retry' && !r.first_api_retry) {
        r.first_api_retry = { at_s: since(), error_status: m.error_status, error: m.error, attempt: m.attempt, max_retries: m.max_retries };
        if (stopAtFirstRetry) ac.abort();
      }
      if (m.type === 'rate_limit_event') r.rate_limit_event = { status: m.rate_limit_info?.status, type: m.rate_limit_info?.rateLimitType };
      if (m.type === 'result') {
        r.status = m.is_error ? 'ERROR' : 'ok';
        r.answered_by = Object.keys(m.modelUsage || {});
        r.reply = m.is_error ? String(m.result).slice(0, 160) : String(m.result).trim().slice(0, 20);
      }
    }
  } catch (e) {
    r.status = ac.signal.aborted ? 'aborted_at_first_retry' : 'FAILED';
    r.error = String(e.message).replace(/\s+/g, ' ').slice(0, 160);
  }
  r.seconds = since();
  r.rate_limit_event ??= null;
  return r;
}

if (mode === 'real-key') {
  for (const model of MODELS) evidence.results.push(await run(model, false));
} else {
  evidence.results.push(await run(MODELS[MODELS.length - 1], true));
}

for (const r of evidence.results) {
  console.log(`${r.model.padEnd(28)} ${String(r.status).padEnd(22)} apiKeySource=${r.apiKeySource} answered_by=${(r.answered_by || []).join(',') || '-'} rate_limit_event=${r.rate_limit_event ? `${r.rate_limit_event.status}/${r.rate_limit_event.type}` : 'none'} plugins=[${(r.plugins || []).map(p => p.name).join(',')}] ${r.first_api_retry ? `first_api_retry=${r.first_api_retry.error_status}/${r.first_api_retry.error}@${r.first_api_retry.at_s}s` : ''}${r.assistant_error ? `assistant_error=${r.assistant_error.error}@+${r.assistant_error.after_init_s}s_after_init` : ''} init@${r.init_at_s}s total ${r.seconds}s${r.error ? ' :: ' + r.error : ''}`);
}

const out = JSON.stringify(evidence, null, 2) + '\n';
if (secret && out.includes(secret)) { console.log('REFUSED: the evidence would contain the key; nothing written.'); process.exit(1); }
if (opt('--out')) { writeFileSync(opt('--out'), out); console.log(`\nevidence written: ${opt('--out')}`); }
console.log('\n(expected on success: apiKeySource=ANTHROPIC_API_KEY, each model answered by itself, plugins loomwright + builtins agents-md and telemetry, decoy not in child)');
