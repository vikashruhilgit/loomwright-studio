// Probe 12 (owner-run, phase 6 item 03): how does GitHub expose a fine-grained token's own
// permissions? The connector refuses every real token `token_permissions_unknown` until this
// answers (docs/OPEN_QUESTIONS.md). Public docs show no endpoint listing a fine-grained token's
// permissions: only `x-accepted-github-permissions` (what an endpoint needs) and
// `github-authentication-token-expiration`. This script shows what a real token's answers carry.
//
// It makes two read-only calls and nothing else: GET /user and GET /user/repos (100 a page, at
// most 10 pages), to https://api.github.com only, never following a redirect. It prints, as JSON:
// each response's status and the headers below, the login, and the repo names. It NEVER prints the
// token, and never prints an error's message (Node's fetch can quote a header value in one).
//   headers: github-authentication-token-expiration, x-oauth-scopes, x-accepted-github-permissions,
//            x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-ratelimit-used,
//            x-ratelimit-resource
//
// The token comes from stdin (`--stdin`: piped, or typed with echo off at a terminal), or else from
// the Keychain item `loomwright-studio-github` (`/usr/bin/security find-generic-password -s
// loomwright-studio-github -w`, argv only, never a shell). No dependency; not run by CI or tests.
//
// Run (from probes/):
//   node p12-github-token-permissions.mjs --stdin < token.txt      (or type it: echo is off)
//   node p12-github-token-permissions.mjs                          (reads the Keychain item)
// Then record the output's headers (never the token) in docs/OPEN_QUESTIONS.md.
import { execFileSync } from 'node:child_process';

const ORIGIN = 'https://api.github.com';
const KEYCHAIN_SERVICE = 'loomwright-studio-github';
const SECURITY_BIN = '/usr/bin/security';
const TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 10;
const HEADERS = [
  'github-authentication-token-expiration',
  'x-oauth-scopes',
  'x-accepted-github-permissions',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-used',
  'x-ratelimit-resource',
];
/** The shape the kernel's Keychain writer and GitHub client accept: no whitespace, quote or control character. */
const TOKEN_SHAPE = /^[A-Za-z0-9_.@][A-Za-z0-9_.@-]*$/;

function fail(message) {
  process.stderr.write(`p12: ${message}\n`);
  process.exit(1);
}

/** Reads all of piped stdin. */
async function readPipedStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads one line from a terminal with echo off (raw mode); Ctrl-C aborts. */
function readHiddenLine(prompt) {
  return new Promise((resolve) => {
    process.stderr.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let line = '';
    const done = (value) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stderr.write('\n');
      resolve(value);
    };
    const onData = (text) => {
      for (const ch of text) {
        if (ch === '\u0003') {
          done('');
          fail('aborted');
        } else if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          done(line);
          return;
        } else if (ch === '\u007f' || ch === '\b') {
          line = line.slice(0, -1);
        } else {
          line += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}

function readKeychain() {
  try {
    const out = execFileSync(SECURITY_BIN, ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return out.endsWith('\n') ? out.slice(0, -1) : out;
  } catch (err) {
    // Never the error itself: it carries the process's output.
    const status = typeof err?.status === 'number' ? err.status : null;
    fail(status === 44 ? `no Keychain item "${KEYCHAIN_SERVICE}"; pass --stdin` : `Keychain read failed (exit status ${status})`);
  }
}

async function readToken() {
  if (process.argv.length > 2 && process.argv[2] !== '--stdin') fail('the only argument is --stdin; never pass the token as an argument');
  if (process.argv[2] !== '--stdin') return readKeychain();
  const raw = process.stdin.isTTY ? await readHiddenLine('GitHub token (echo is off): ') : await readPipedStdin();
  return raw.replace(/\r?\n$/, '');
}

/** Reads at most MAX_BODY_BYTES of a body. */
async function boundedText(res) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('body over bound');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** One read-only GET. Returns status, the chosen headers and the parsed body (null on a non-2xx). */
async function get(token, path) {
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN) fail('refusing a request off api.github.com');
  let res;
  try {
    res = await fetch(url.href, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'loomwright-studio-p12-probe',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // The message is dropped on purpose: it can quote the authorization header.
    return { path, status: null, error: err?.name === 'TimeoutError' ? 'timeout' : 'unreachable', headers: {}, body: null };
  }
  const headers = Object.fromEntries(HEADERS.map((h) => [h, res.headers.get(h)]));
  if (res.status < 200 || res.status > 299) {
    await res.body?.cancel().catch(() => undefined);
    return { path, status: res.status, headers, body: null };
  }
  try {
    return { path, status: res.status, headers, body: JSON.parse(await boundedText(res)) };
  } catch {
    return { path, status: res.status, error: 'unreadable body', headers, body: null };
  }
}

const token = await readToken();
if (!token) fail('empty token');
if (token.length > 255 || !TOKEN_SHAPE.test(token)) fail('the token has whitespace or a character a GitHub token never has; nothing was sent');

const user = await get(token, '/user');
const responses = [{ path: user.path, status: user.status, error: user.error, headers: user.headers }];
const login = user.body && typeof user.body.login === 'string' ? user.body.login : null;

const repos = [];
let truncated = false;
if (user.status === 200) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await get(token, `/user/repos?per_page=100&page=${page}`);
    responses.push({ path: r.path, status: r.status, error: r.error, headers: r.headers });
    if (!Array.isArray(r.body)) break;
    for (const repo of r.body) if (typeof repo?.full_name === 'string') repos.push(repo.full_name);
    if (r.body.length < 100) break;
    if (page === MAX_PAGES) truncated = true;
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      probe: 'p12-github-token-permissions',
      ran_at: new Date().toISOString(),
      node: process.version,
      token_source: process.argv[2] === '--stdin' ? 'stdin' : `keychain:${KEYCHAIN_SERVICE}`,
      login,
      responses,
      repos,
      repos_truncated_at_page_cap: truncated,
    },
    null,
    2,
  )}\n`,
);
