// Probe 13 (owner-run, GitHub App backlog): does GitHub's App Manifest flow work against Studio's
// loopback API, what does the manifest conversion return, and do installation tokens report their
// permissions and repos? The GitHub App connect is designed on these answers (docs/OPEN_QUESTIONS.md):
//   1. Does GitHub accept a manifest `redirect_url` / `setup_url` on http://127.0.0.1:<port>
//      (or only `localhost`, or only https)?
//   2. Which fields does POST /app-manifests/{code}/conversions return?
//   3. Does POST /app/installations/{id}/access_tokens return `permissions`, `repository_selection`
//      and `expires_at`, and does GET /installation/repositories list exactly the repos chosen at
//      install?
//
// What it does: serves pages on <host>:<random port> only. Its start page posts a manifest (a
// private app, no webhook, Pull requests / Contents / Metadata: read) to github.com with a random
// `state`. You click Create on GitHub; GitHub returns to this probe with a code; the probe checks the
// state and converts the code. Then it opens the app's install page; you pick repos and click
// Install; GitHub returns the installation id. The probe mints one installation token with a JWT
// signed from the app's key, reads the installation's repos, and prints what it learned.
//
// It NEVER prints or writes the app's private key, client secret, webhook secret, the code, the JWT
// or the installation token: the key stays in this process's memory and is dropped at exit. It
// prints the conversion's field NAMES, the app's id, slug and owner, the token response's
// permissions, repository_selection, expires_at and repo names, and how to delete the app after.
// Requests go to github.com (the browser) and api.github.com (this script) only, never following a
// redirect. No dependency; not run by CI or tests.
//
// Run (from probes/), then follow the browser:
//   node p13-github-app-manifest.mjs                     (return address http://127.0.0.1:<port>)
//   node p13-github-app-manifest.mjs --host localhost    (only if GitHub refused 127.0.0.1)
// Record the printed JSON in docs/OPEN_QUESTIONS.md, then delete the app on GitHub (the probe
// prints the link). If GitHub refuses the return address, say which, and stop: no workaround.
import { createServer } from 'node:http';
import { createSign, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const WEB_ORIGIN = process.env.P13_WEB_ORIGIN ?? 'https://github.com';
const API_ORIGIN = process.env.P13_API_ORIGIN ?? 'https://api.github.com';
const TIMEOUT_MS = 15_000;
const OVERALL_MS = 15 * 60_000;
const MAX_BODY_BYTES = 1024 * 1024;
const OPEN_BIN = '/usr/bin/open';
const SECRET_FIELDS = new Set(['pem', 'client_secret', 'webhook_secret']);

function fail(message) {
  process.stderr.write(`p13: ${message}\n`);
  process.exit(1);
}

// The origins can be pointed at a local fake (the probe's own self-check), never anywhere else.
for (const [name, origin, real] of [
  ['P13_WEB_ORIGIN', WEB_ORIGIN, 'https://github.com'],
  ['P13_API_ORIGIN', API_ORIGIN, 'https://api.github.com'],
]) {
  if (origin !== real && !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) fail(`${name} may only be ${real} or a local http://127.0.0.1:<port> fake`);
}

const args = process.argv.slice(2);
let host = '127.0.0.1';
if (args.length === 2 && args[0] === '--host' && (args[1] === 'localhost' || args[1] === '127.0.0.1')) host = args[1];
else if (args.length > 0) fail('the only option is --host localhost (or --host 127.0.0.1)');

const state = randomBytes(24).toString('hex');
const result = {
  probe: 'p13-github-app-manifest',
  ran_at: new Date().toISOString(),
  node: process.version,
  return_host: host,
  q1_return_address: { redirect_url_reached: false, setup_url_reached: false, state_matched: null },
  q2_conversion: null,
  q3_installation: null,
  delete_the_app_at: null,
};
let pem = null;
let appId = null;
let appSlug = null;

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

/** One call to api.github.com. Never returns or throws an error message (it can quote a header). */
async function api(method, path, bearer) {
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) fail('refusing a request off api.github.com');
  let res;
  try {
    res = await fetch(url.href, {
      method,
      redirect: 'manual',
      headers: {
        accept: 'application/vnd.github+json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        'user-agent': 'loomwright-studio-p13-probe',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { status: null, error: err?.name === 'TimeoutError' ? 'timeout' : 'unreachable', body: null };
  }
  let body = null;
  try {
    body = JSON.parse(await boundedText(res));
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** An RS256 app JWT: issued 60 s back for clock skew, 9 minutes' life. */
function appJwt() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${claims}`);
  return `${head}.${claims}.${b64url(signer.sign(pem))}`;
}

function page(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Studio probe 13</title><body style="font-family:system-ui;margin:3rem"><p>${text}</p></body>`);
}

function finish(code) {
  pem = null;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.delete_the_app_at) process.stderr.write(`p13: delete the probe app now: ${result.delete_the_app_at}\n`);
  server.close();
  process.exit(code);
}

let port = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${host}:${port}`);
  if (req.method !== 'GET') return page(res, 405, 'Only GET.');

  if (url.pathname === '/start') {
    const base = `http://${host}:${port}`;
    const manifest = {
      name: `studio-probe-${randomBytes(3).toString('hex')}`,
      url: 'https://github.com/vikashruhilgit/loomwright-studio',
      // No `hook_attributes`: no webhook. GitHub refuses any hook url it can't reach from the internet,
      // a loopback one even when inactive ("Hook url is not supported…", first owner run, 2026-10-29).
      redirect_url: `${base}/return`,
      setup_url: `${base}/installed`,
      setup_on_update: false,
      public: false,
      default_permissions: { pull_requests: 'read', contents: 'read', metadata: 'read' },
      default_events: [],
      request_oauth_on_install: false,
    };
    const action = `${WEB_ORIGIN}/settings/apps/new?state=${state}`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>Studio probe 13</title><body style="font-family:system-ui;margin:3rem">` +
        `<p>Sending you to GitHub to create a private test app (read-only: pull requests, contents, metadata).</p>` +
        `<form id="f" method="post" action="${action}"><input type="hidden" name="manifest" value='${JSON.stringify(manifest).replace(/'/g, '&#39;')}'>` +
        `<button type="submit">Continue to GitHub</button></form><script>document.getElementById('f').submit()</script></body>`,
    );
    return;
  }

  if (url.pathname === '/return') {
    result.q1_return_address.redirect_url_reached = true;
    const matched = url.searchParams.get('state') === state;
    result.q1_return_address.state_matched = matched;
    const code = url.searchParams.get('code');
    if (!matched || !code || !/^[A-Za-z0-9_-]{1,100}$/.test(code)) {
      page(res, 400, 'State or code did not match. The probe stops here; see the terminal.');
      return finish(1);
    }
    const conv = await api('POST', `/app-manifests/${code}/conversions`, null);
    const body = conv.body && typeof conv.body === 'object' ? conv.body : {};
    result.q2_conversion = {
      status: conv.status,
      error: conv.error,
      field_names: Object.keys(body).sort(),
      id: typeof body.id === 'number' ? body.id : null,
      slug: typeof body.slug === 'string' ? body.slug : null,
      owner_login: typeof body.owner?.login === 'string' ? body.owner.login : null,
      permissions: body.permissions ?? null,
      secret_fields_present: [...SECRET_FIELDS].filter((f) => typeof body[f] === 'string'),
    };
    if (conv.status !== 201 || typeof body.pem !== 'string' || typeof body.id !== 'number') {
      page(res, 502, 'The conversion failed. The probe stops here; see the terminal.');
      return finish(1);
    }
    pem = body.pem;
    appId = body.id;
    appSlug = body.slug;
    result.delete_the_app_at = `${WEB_ORIGIN}/settings/apps/${appSlug}/advanced`;
    res.writeHead(302, { location: `${WEB_ORIGIN}/apps/${appSlug}/installations/new?state=${state}`, 'cache-control': 'no-store' });
    res.end();
    return;
  }

  if (url.pathname === '/installed') {
    result.q1_return_address.setup_url_reached = true;
    const stateBack = url.searchParams.get('state');
    const installationId = Number(url.searchParams.get('installation_id'));
    result.q3_installation = {
      setup_action: url.searchParams.get('setup_action'),
      state_returned_on_install: stateBack === null ? 'absent' : stateBack === state ? 'matched' : 'mismatch',
      installation_id: Number.isSafeInteger(installationId) ? installationId : null,
    };
    if (!pem || !Number.isSafeInteger(installationId) || installationId <= 0) {
      page(res, 400, 'No installation id, or the app was not created in this run. The probe stops here; see the terminal.');
      return finish(1);
    }
    const mint = await api('POST', `/app/installations/${installationId}/access_tokens`, appJwt());
    const tok = mint.body && typeof mint.body === 'object' ? mint.body : {};
    Object.assign(result.q3_installation, {
      mint_status: mint.status,
      mint_error: mint.error,
      mint_field_names: Object.keys(tok).sort(),
      permissions: tok.permissions ?? null,
      repository_selection: tok.repository_selection ?? null,
      expires_at: tok.expires_at ?? null,
      repositories_in_mint_response: Array.isArray(tok.repositories) ? tok.repositories.map((r) => r?.full_name ?? null) : null,
    });
    if (mint.status === 201 && typeof tok.token === 'string') {
      const repos = await api('GET', '/installation/repositories?per_page=100', tok.token);
      const list = Array.isArray(repos.body?.repositories) ? repos.body.repositories : null;
      Object.assign(result.q3_installation, {
        installation_repositories_status: repos.status,
        installation_repositories_total: typeof repos.body?.total_count === 'number' ? repos.body.total_count : null,
        installation_repositories: list ? list.map((r) => r?.full_name ?? null) : null,
      });
    }
    page(res, 200, 'Done. Return to the terminal, record the output, then delete the probe app on GitHub.');
    return finish(0);
  }

  page(res, 404, 'Not a probe page.');
});

server.listen(0, host, () => {
  port = server.address().port;
  const start = `http://${host}:${port}/start`;
  process.stderr.write(`p13: listening on ${host}:${port}. Opening ${start}\n`);
  process.stderr.write('p13: on GitHub, click Create, then choose repos and click Install. Ctrl-C aborts.\n');
  try {
    if (!process.env.P13_NO_OPEN) execFileSync(OPEN_BIN, [start], { stdio: 'ignore', timeout: 10_000 });
  } catch {
    process.stderr.write(`p13: could not open the browser; open ${start} yourself.\n`);
  }
});

setTimeout(() => {
  process.stderr.write('p13: no answer from GitHub within 15 minutes. If GitHub refused the return address, record which.\n');
  finish(1);
}, OVERALL_MS).unref();
