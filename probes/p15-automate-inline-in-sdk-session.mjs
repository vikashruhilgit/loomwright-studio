// Probe 15 (phase 8 item 01, owner-run): does Loomwright's `/automate --inline-phases` run to a PR
// inside an Agent SDK session started the way the kernel starts one? Phase 8's runner (D40) rests on
// this, and nothing builds on it before it is probed (docs/OPEN_QUESTIONS.md, "Phase 8: probe p15").
//   1. Does the session offer Loomwright's `automate` command when Loomwright is loaded by path with
//      settingSources [] and the host switch on (LOOMWRIGHT_HOST_MODE=1), as D27 and D32 set up?
//   2. Does `/automate --folder <dir> --limit 1 --inline-phases` (safe mode, so no --auto-merge) run
//      one item to an open PR in that session?
//   3. Which AskUserQuestion prompts does it raise, and does answering them through `canUseTool`
//      (what the kernel's approval path would do) let the run continue?
//
// What it does: ONE real session on the owner's Claude subscription, kernel-like options: streaming
// input, settingSources [], Loomwright by path, host-mode env, the GitHub and Anthropic credential
// variables stripped, tool deferral off, a PreToolUse hook and `canUseTool`. It spends real tokens
// (a full /autonomous run plus the review drain for one item; the count is printed from the result's
// modelUsage) and, if it works, OPENS A REAL PR on the sandbox repo using the owner's own stored `gh`
// login. That is NOT a test of D39's down-scoped session token, which does not exist yet.
//
// Target: ONLY a clone of vikashruhilgit/studio-sandbox (the owner's personal throwaway repo). The
// probe refuses any other `origin`, and a clone inside a macOS-protected folder (D31). Never
// `vendsy/*`, never any Tray system. It never merges: it denies `gh pr merge` (invariant 4), a forced
// push and `gh repo delete` in its PreToolUse hook. It never prints a token, and it never cleans up:
// it prints the commands, you run them.
//
// Owner run (D33: or the agent on the owner's word, with the owner watching), from probes/:
//   cd probes && npm install
//   git clone https://github.com/vikashruhilgit/studio-sandbox ~/p15-sandbox     # outside ~/Documents etc.
//   # in the clone: a folder with ONE story file, e.g. stories/01-add-greeting.md, committed and pushed
//   CLAUDE_CODE_OAUTH_TOKEN="$(security find-generic-password -s loomwright-studio-oauth -w)" \
//   LW_PATH="$HOME/.claude/plugins/cache/atelier/loomwright/<version>" \
//   node p15-automate-inline-in-sdk-session.mjs --repo ~/p15-sandbox --folder stories
// Options: --model <id> (default claude-sonnet-5), --max-turns <n> (default 300), --timeout-min <n>
// (default 60), --command <name> (default: the session's own command ending in `automate`).
// Record the printed JSON summary, the date and the Loomwright version in docs/OPEN_QUESTIONS.md.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SANDBOX_ORIGIN = /^(https:\/\/github\.com\/|git@github\.com:)vikashruhilgit\/studio-sandbox(\.git)?$/i;
const SANDBOX_SLUG = 'vikashruhilgit/studio-sandbox';
const STRIPPED_ENV = /^(ANTHROPIC_|GH_TOKEN$|GITHUB_TOKEN$|GH_ENTERPRISE_TOKEN$|GITHUB_ENTERPRISE_TOKEN$|LOOMWRIGHT_HOST_)/;

function stop(message, code = 2) { console.log(`p15: ${message}`); process.exit(code); }
process.on('unhandledRejection', (e) => stop(`THREW: ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300)}`, 1));

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const repo = opt('--repo') ? resolve(opt('--repo').replace(/^~(?=\/|$)/, homedir())) : undefined;
const folder = opt('--folder');
const model = opt('--model', 'claude-sonnet-5');
const maxTurns = Number(opt('--max-turns', '300'));
const timeoutMin = Number(opt('--timeout-min', '60'));
if (folder !== undefined && !/^[\w./-]+$/.test(folder)) stop('--folder may hold only letters, digits, . / _ and -.');
if (!repo || !folder) stop('usage: node p15-automate-inline-in-sdk-session.mjs --repo <clone of studio-sandbox> --folder <story folder in it> (see the header)');
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) stop('set CLAUDE_CODE_OAUTH_TOKEN (see the header).');
const lwPath = process.env.LW_PATH;
if (!lwPath || !existsSync(join(lwPath, '.claude-plugin', 'plugin.json'))) stop('set LW_PATH to the installed Loomwright plugin directory (it holds .claude-plugin/plugin.json).');
if (!Number.isInteger(maxTurns) || maxTurns < 1 || !(timeoutMin > 0)) stop('--max-turns and --timeout-min must be positive numbers.');

// Preflight: only the sandbox, not in a protected folder (D31), clean, with the story folder present.
const sh = (cmd, args, cwd = repo) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
if (!existsSync(join(repo, '.git'))) stop(`${repo} is not a git clone.`);
const realRepo = realpathSync(repo);
for (const p of ['Documents', 'Desktop', 'Downloads', 'Library/Mobile Documents']) {
  if (realRepo === join(homedir(), p) || realRepo.startsWith(join(homedir(), p) + '/')) stop(`${realRepo} is inside a macOS-protected folder (D31); clone elsewhere.`);
}
const origin = sh('git', ['remote', 'get-url', 'origin']);
if (!SANDBOX_ORIGIN.test(origin)) stop(`origin is not ${SANDBOX_SLUG}; this probe runs only against the owner's sandbox.`);
if (sh('git', ['status', '--porcelain'])) stop('the clone has uncommitted changes; use a clean clone.');
const storyDir = join(realRepo, folder);
if (!(storyDir + '/').startsWith(realRepo + '/')) stop(`--folder ${folder} leaves the clone.`);
if (!existsSync(storyDir) || !statSync(storyDir).isDirectory() || !readdirSync(storyDir).some((n) => n.endsWith('.md'))) stop(`--folder ${folder} must be a folder in the clone holding at least one .md story.`);
try { sh('gh', ['auth', 'status'], realRepo); } catch { stop('gh is not logged in; the PR step needs the owner\'s stored login.'); }

const lwVersion = JSON.parse(readFileSync(join(lwPath, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const openPrs = () => JSON.parse(sh('gh', ['pr', 'list', '--repo', SANDBOX_SLUG, '--state', 'open', '--json', 'number,headRefName,title,url'], realRepo));
const prsBefore = openPrs();
const headBefore = sh('git', ['rev-parse', 'HEAD'], realRepo);

// The kernel's env rules: no Anthropic or GitHub token variable inherited, tool deferral off, host switch on.
const stateDir = mkdtempSync(join(tmpdir(), 'p15-host-state-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !STRIPPED_ENV.test(k)));
Object.assign(env, { LOOMWRIGHT_HOST_MODE: '1', LOOMWRIGHT_HOST_STATE_DIR: stateDir, ENABLE_TOOL_SEARCH: 'false' });

const toolCalls = {};
const denied = [];
const questions = [];
let init, result, timedOut = false;
const abortController = new AbortController();
const timer = setTimeout(() => { timedOut = true; abortController.abort(); }, timeoutMin * 60_000);

// Invariant 4: the probe never merges. Denied before any permission flow.
const FORBIDDEN = [/\bgh\s+pr\s+merge\b/, /\bgit\s+push\b[^\n]*(--force|-f\b|--force-with-lease)/, /\bgh\s+repo\s+delete\b/];
const preToolUse = async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return {};
  toolCalls[input.tool_name] = (toolCalls[input.tool_name] ?? 0) + 1;
  const cmd = input.tool_name === 'Bash' ? String(input.tool_input?.command ?? '') : '';
  if (FORBIDDEN.some((re) => re.test(cmd))) {
    denied.push(cmd.slice(0, 160));
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'p15 never merges, force-pushes or deletes a repo.' } };
  }
  return {};
};

// AskUserQuestion goes to the owner at the terminal (the kernel's path would be an approval card);
// every other tool the hook did not deny is allowed, because the probe is the owner-watched run.
const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
const canUseTool = async (toolName, input) => {
  if (toolName !== 'AskUserQuestion') return { behavior: 'allow', updatedInput: input };
  const answers = {};
  for (const q of input.questions ?? []) {
    const labels = (q.options ?? []).map((o) => o.label);
    const entry = { header: q.header, question: q.question, options: labels, multiSelect: !!q.multiSelect };
    questions.push(entry);
    if (!rl) { entry.answer = null; return { behavior: 'deny', message: 'p15 has no terminal to answer on.' }; }
    console.log(`\n[AskUserQuestion] ${q.header}: ${q.question}`);
    labels.forEach((l, i) => console.log(`  ${i + 1}) ${l}`));
    const typed = (await rl.question('answer (number, or text; multi-select: comma-separated numbers): ')).trim();
    entry.answer = typed.split(',').map((s) => labels[Number(s.trim()) - 1] ?? s.trim()).join(', ');
    answers[q.question] = entry.answer;
  }
  return { behavior: 'allow', updatedInput: { ...input, answers } };
};

// The first user message waits for the command name, which comes from the session's own command list
// (`supportedCommands()`), never from an assumed namespace. Whether that call answers before any input
// is sent is itself unverified; if it does not answer in 30 s, the probe stops and asks for --command.
let release;
const released = new Promise((r) => { release = r; });
let prompt;
async function* input() {
  await released;
  if (abortController.signal.aborted) return;
  yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null };
  while (!result && !abortController.signal.aborted) await new Promise((r) => setTimeout(r, 500));
}

const q = query({ prompt: input(), options: {
  model, maxTurns, cwd: realRepo, env, abortController, canUseTool,
  settingSources: [], plugins: [{ type: 'local', path: lwPath }], permissionMode: 'default',
  hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
} });

let commandName = opt('--command');
let offered = [];
if (!commandName) {
  try {
    const all = await Promise.race([q.supportedCommands(), new Promise((_, no) => setTimeout(() => no(new Error('supportedCommands() did not answer in 30 s')), 30_000))]);
    offered = all.map((c) => c.name).filter((n) => /(^|:)automate$/.test(n));
  } catch (e) { abortController.abort(); release(); stop(`could not list the session's commands (${String(e?.message || e).slice(0, 120)}); pass --command <name>.`, 1); }
  if (offered.length === 0) { abortController.abort(); release(); stop('the session offers no `automate` command with Loomwright loaded by path (settingSources []): that is the answer to question 1; nothing was run.', 0); }
  commandName = offered[0];
}
prompt = `/${commandName} --folder ${folder} --limit 1 --inline-phases`;
console.log(`p15: Loomwright ${lwVersion} at ${lwPath}; model ${model}; repo ${realRepo}; prompt: ${prompt}`);
release();

let streamError;
try {
  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') init = m;
    if (m.type === 'result') result = m;
  }
} catch (e) { streamError = String(e?.message || e).replace(/\s+/g, ' ').slice(0, 300); }
clearTimeout(timer);
rl?.close();

// What the run left behind: PRs, the run file, host-mode writes into the repo.
let prsAfter = [];
try { prsAfter = openPrs(); } catch { /* reported below as null */ }
const newPrs = prsAfter.filter((p) => !prsBefore.some((b) => b.number === p.number));
const runFiles = existsSync(join(realRepo, '.supervisor', 'automate'))
  ? readdirSync(join(realRepo, '.supervisor', 'automate')).filter((n) => n.endsWith('.md')) : [];
const runLines = runFiles.length === 0 ? [] : readFileSync(join(realRepo, '.supervisor', 'automate', runFiles.at(-1)), 'utf8')
  .split('\n').filter((l) => /^## Status|^- item:|^- pause_reason:|^pause_reason:/.test(l)).slice(0, 12);
const usage = Object.entries(result?.modelUsage ?? {}).map(([k, u]) => ({ model: k, input: u.inputTokens, output: u.outputTokens, cacheWrite: u.cacheCreationInputTokens, cacheRead: u.cacheReadInputTokens }));

console.log('\n===== p15 summary (record this in docs/OPEN_QUESTIONS.md) =====');
console.log(JSON.stringify({
  date: new Date().toISOString(), loomwright_version: lwVersion, model, sdk: '0.3.284 (probes/package.json)',
  automate_commands_offered: offered, command_used: commandName, init_plugins: (init?.plugins ?? []).map((p) => p.name),
  prompt, result_subtype: result?.subtype ?? null, result_is_error: result?.is_error ?? null, turns: result?.num_turns ?? null,
  timed_out: timedOut, stream_error: streamError ?? null, result_text_start: String(result?.result ?? '').slice(0, 200),
  reached_pr: newPrs.length > 0, new_prs: newPrs, ask_user_questions: questions,
  tools_called: toolCalls, denied_by_probe: denied, usage,
  run_file: runFiles.at(-1) ?? null, run_file_lines: runLines,
  repo_head_changed_locally: sh('git', ['rev-parse', 'HEAD'], realRepo) !== headBefore,
  host_state_dir_files: readdirSync(stateDir).length,
}, null, 2));
console.log('\nCleanup (run yourself; the probe never does):');
for (const p of newPrs) console.log(`  gh pr close ${p.number} --delete-branch --repo ${SANDBOX_SLUG}`);
console.log(`  rm -rf ${realRepo} ${stateDir}`);
process.exit(0);
