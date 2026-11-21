// The instruction extractor behind `test/loomwright-conformance.test.ts` (phase 8 item 25a). It reads
// Loomwright's instruction files (markdown) and its four drivers (bash), and returns every command,
// script call, Claude tool name and slash command they tell a session to use, each with its source
// `file:line`. It also reads the per-script facts the exclusions table states (a `claude` process,
// `eval` / `bash -c`) and the line text the "runs past the rail" table cites, so the committed fixture
// can answer for the install in CI, where there is none.
//
// What is extracted (and what is not), per file kind:
// - markdown: every line of a shell fence (`bash`, `sh`, `shell`, `zsh`, `console`); lines of an untagged
//   fence only when they start with a known program or a Loomwright script; every inline backtick span
//   that starts with a known program (with at least one argument, except `ls`, `pwd`, `date`) or a
//   Loomwright script; a Claude tool name in backticks, as `Name(`, as "the Name tool", or in a front-matter
//   `tools:` / `allowed-tools:` list; and every `scripts/<name>.sh` or bare `<name>.sh` reference (a script
//   of the install) outside those spans, as a call with no arguments. A shell-fence line the extractor
//   cannot model (a keyword, an assignment, an unbalanced quote) is kept as `unparsed`, never dropped.
// - drivers (`scripts/*.sh` in a file set): the text a driver prints for the session, read on its
//   non-comment lines: backtick spans (bash's `\``), the `push: [...]` array, `/loomwright:` slash
//   commands, a `tools: [...]` list, and a printed field (`invocation`, `then`, ...) that starts with a
//   tool name. A span whose program is a shell variable (`$w`) is the driver's dynamic text: `unparsed`.
//   The driver's own code (what it runs itself) is not an instruction: that is the "runs past the rail"
//   table's concern (`kernel/src/automate/run-exclusions.ts`).
//
// Honest limits: a mention in prose of a command in backticks is extracted as an instruction (the
// exclusions table's `advisory, never instructed` class covers those); a driver's printed text built
// from shell variables is read only as far as its literals go.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** What an entry is: a Bash command, a Loomwright script call, a Claude tool, a slash command, or a shape the extractor cannot read. */
export type EntryType = "command" | "script" | "tool" | "slash" | "unparsed";

/** Where on its line an entry was found. */
export type EntrySource = "fence" | "backtick" | "prose" | "frontmatter" | "driver";

/** One extracted instruction, before the test assigns its session kinds. `file` is install-relative. */
export interface RawEntry {
  readonly file: string;
  readonly line: number;
  readonly type: EntryType;
  readonly source: EntrySource;
  readonly text: string;
}

/** Facts about one script (the script plus its `<name>.d/*.sh` modules, non-comment lines): the first `file:line` showing each, or null. */
export interface ScriptFacts {
  readonly claude: string | null;
  readonly eval_or_bash_c: string | null;
  /** `bash "$…"`: runs a file named by a variable (a pin test, a lane script). */
  readonly bash_file: string | null;
  /** The other install scripts it names on a non-comment line, sorted. */
  readonly calls: readonly string[];
}

/** The Claude tool names the extractor recognises. */
export const KNOWN_TOOLS: readonly string[] = Object.freeze([
  "Agent", "Task", "TaskOutput", "TaskStop", "Bash", "BashOutput", "KillShell", "KillBash", "Read", "Write", "Edit", "MultiEdit",
  "NotebookEdit", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "TodoWrite", "Skill", "SlashCommand", "AskUserQuestion",
  "ExitPlanMode", "EnterPlanMode", "Monitor", "SendMessage", "LSP", "TeamCreate", "TeamDelete", "ToolSearch",
]);

/** Programs whose backticked or fenced use reads as a command. A program the run might call that is missing here is not extracted, so the list errs wide. */
const PROGRAMS: ReadonlySet<string> = new Set([
  "bash", "sh", "zsh", "git", "gh", "jq", "ls", "cat", "pwd", "date", "mkdir", "test", "wc", "head", "tail", "grep", "sleep",
  "rm", "mv", "cp", "chmod", "find", "sed", "awk", "echo", "printf", "touch", "npx", "npm", "node", "python", "python3", "pytest",
  "curl", "claude", "cd", "export", "source", "xargs", "sort", "tr", "cut", "diff", "env", "mktemp", "ln", "kill", "pgrep", "pkill",
  "nohup", "make", "cargo", "go", "yarn", "pnpm", "od", "stat", "readlink", "realpath", "basename", "dirname", "tee", "uniq",
  "shasum", "sha256sum", "rg", "tar", "du", "ps", "lsof", "uname", "rsync", "docker", "brew", "pip", "pip3", "tsc", "vitest",
  "jest", "eslint", "prettier", "ruff", "mypy", "flutter", "dart", "swift", "xcodebuild", "osascript", "timeout", "gtimeout",
]);

/** Programs that read as a command with no argument (`ls`); any other lone program word is a mention. */
const BARE_PROGRAMS: ReadonlySet<string> = new Set(["ls", "pwd", "date"]);

/** First words of a shell-fence line the extractor does not model as one command. */
const SHELL_KEYWORDS: ReadonlySet<string> = new Set([
  "if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "function", "{", "}", "[", "[[", ";;", "local", "return",
]);

const SHELL_FENCES: ReadonlySet<string> = new Set(["bash", "sh", "shell", "zsh", "console"]);

/** The run id placeholders are filled with; a merge run's policy is pinned to it. */
export const SAMPLE_RUN_ID = "2026-11-20-sample";

/** A word split with each word's span, or undefined for an unbalanced quote. Quotes are kept in the words. */
function splitWords(text: string): { word: string; start: number; end: number }[] | undefined {
  const out: { word: string; start: number; end: number }[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i] as string)) i += 1;
    if (i >= text.length) break;
    const start = i;
    while (i < text.length && !/\s/.test(text[i] as string)) {
      const c = text[i] as string;
      if (c === "'" || c === '"') {
        const close = text.indexOf(c, i + 1);
        if (close === -1) return undefined;
        i = close + 1;
      } else if (c === "\\") {
        i += 2;
      } else {
        i += 1;
      }
    }
    out.push({ word: text.slice(start, Math.min(i, text.length)), start, end: Math.min(i, text.length) });
  }
  return out;
}

/** The install script a word names (`scripts/x.sh`, `"${CLAUDE_PLUGIN_ROOT}/scripts/x.sh"`, `$HERE/x.sh`, `x.sh`), or undefined. */
export function scriptOfWord(word: string, scripts: ReadonlySet<string>): string | undefined {
  const bare = word.replace(/^["']|["']$/g, "");
  const m = /(?:^|\/)([A-Za-z0-9_.-]+\.sh)$/.exec(bare);
  return m !== null && scripts.has(m[1] as string) ? (m[1] as string) : undefined;
}

/** `text` without a trailing shell comment (` # …` outside quotes): a comment is the doc's note, not the command. */
function stripComment(text: string): string {
  let quote: string | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === "#" && i > 0 && /\s/.test(text[i - 1] as string)) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text;
}

/** Whether `text` leaves a quote open (a multi-line quoted argument in a fence continues on the next line). */
function opensQuote(text: string): boolean {
  return splitWords(fillPlaceholders(text)) === undefined;
}

/** A sample value for a placeholder, chosen by its name. */
function sampleFor(name: string): string {
  const n = name.toLowerCase();
  if (/run[_ -]?file|runfile/.test(n)) return `.supervisor/automate/${SAMPLE_RUN_ID}.md`;
  if (/run[_ -]?id/.test(n)) return SAMPLE_RUN_ID;
  if (/url/.test(n)) return "https://github.com/owner/repo/pull/1";
  if (/\bsha\b|sha$|head|commit/.test(n)) return "0123456789abcdef";
  if (/\bsid\b|session/.test(n)) return "sample-session";
  if (/^(n|pr|number|pr number|num|count)$/.test(n)) return "1";
  return "sample";
}

/** `<name>` and `{name}` placeholders filled with sample values (`sampleFor`); `${VAR}` and JSON braces are kept. */
export function fillPlaceholders(text: string): string {
  return text
    .replace(/<([A-Za-z][^<>]{0,200})>/g, (_m, p: string) => sampleFor(p))
    .replace(/(^|[^$])\{([a-z][a-z0-9_]*)\}/g, (_m, pre: string, p: string) => `${pre}${sampleFor(p)}`);
}

/** Classify one candidate span. `strict`: a shell-fence line, where a non-command is `unparsed` rather than prose. */
function classify(raw: string, scripts: ReadonlySet<string>, strict: boolean, dynamicIsUnparsed: boolean): { type: EntryType; text: string } | undefined {
  const text = stripComment(raw.replace(/^\$ /, "").replace(/\\\|/g, "|")).trim();
  if (text === "" || text.startsWith("#") || /^(\.\.\.|…)$/.test(text)) return undefined;
  const slash = /^(\/[a-z][a-z:-]*)(\s|$)/.exec(text);
  if (slash !== null) return { type: "slash", text: slash[1] as string };
  const tool = /^([A-Z][A-Za-z]+)(\(.*\))?$/.exec(text);
  if (tool !== null && KNOWN_TOOLS.includes(tool[1] as string)) return { type: "tool", text: tool[1] as string };
  const words = splitWords(fillPlaceholders(text));
  if (words === undefined) return strict || looksLikeCommand(text, scripts) ? { type: "unparsed", text } : undefined;
  if (words.length === 0) return undefined;
  let k = 0;
  while (k < words.length - 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k]?.word as string)) k += 1;
  const first = (words[k] as { word: string }).word;
  if (scriptOfWord(first, scripts) !== undefined) return { type: "script", text };
  if (first === "bash" && words[k + 1] !== undefined && scriptOfWord((words[k + 1] as { word: string }).word, scripts) !== undefined) {
    return { type: "script", text };
  }
  if (PROGRAMS.has(first)) return words.length - k > 1 || BARE_PROGRAMS.has(first) ? { type: "command", text } : undefined;
  if (dynamicIsUnparsed && first.startsWith("$")) return { type: "unparsed", text };
  if (strict && (SHELL_KEYWORDS.has(first) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(first))) return { type: "unparsed", text };
  return undefined;
}

/** Whether a span that cannot be split still starts like a command (so it is kept as `unparsed`). */
function looksLikeCommand(text: string, scripts: ReadonlySet<string>): boolean {
  const first = text.split(/\s+/)[0] ?? "";
  return PROGRAMS.has(first) || scriptOfWord(first, scripts) !== undefined || /\.sh["']?$/.test(first);
}

/** The inline code spans on a line (single or double backticks), with their offsets. */
function backtickSpans(line: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /(``?)([^`]+?)\1/g;
  for (let m = re.exec(line); m !== null; m = re.exec(line)) out.push({ text: (m[2] as string).trim(), start: m.index, end: m.index + m[0].length });
  return out;
}

/** Script references outside `skip` spans: `scripts/<name>.sh` or a bare install script name; a name built from a variable is `unparsed`. */
function proseScripts(line: string, skip: readonly { start: number; end: number }[], scripts: ReadonlySet<string>): { type: EntryType; text: string }[] {
  const out: { type: EntryType; text: string }[] = [];
  const outside = (i: number): boolean => !skip.some((s) => i >= s.start && i < s.end);
  const re = /(?:[A-Za-z0-9_${}<>.-]*\/)?(?:scripts\/)?([A-Za-z0-9_${}.-]+\.sh)\b/g;
  for (let m = re.exec(line); m !== null; m = re.exec(line)) {
    if (!outside(m.index)) continue;
    const name = m[1] as string;
    if (/scripts\/[^\s`"']*\$[^\s`"']*\.sh/.test(m[0])) out.push({ type: "unparsed", text: m[0] });
    else if (scripts.has(name)) out.push({ type: "script", text: `scripts/${name}` });
  }
  return out;
}

/** Tool names named in prose: `Name(` or "the Name tool". */
function proseTools(line: string, skip: readonly { start: number; end: number }[]): string[] {
  const out: string[] = [];
  const outside = (i: number): boolean => !skip.some((s) => i >= s.start && i < s.end);
  const alt = KNOWN_TOOLS.join("|");
  for (const re of [new RegExp(`\\b(${alt})\\(`, "g"), new RegExp(`\\bthe (${alt}) tool\\b`, "g")]) {
    for (let m = re.exec(line); m !== null; m = re.exec(line)) if (outside(m.index)) out.push(m[1] as string);
  }
  return out;
}

/** Tool names in a front-matter list value (`Read, Write, Bash(git:*)` or `["Read", "Write"]`). */
function listTools(value: string): string[] {
  return value
    .replace(/[[\]"']/g, "")
    .split(",")
    .map((s) => (s.trim().split("(")[0] ?? "").trim())
    .filter((s) => s !== "" && (KNOWN_TOOLS.includes(s) || s.startsWith("mcp__")));
}

/** Every entry of one markdown file. */
export function extractMarkdown(file: string, text: string, scripts: ReadonlySet<string>): RawEntry[] {
  const out: RawEntry[] = [];
  const lines = text.split("\n");
  let fence: { marker: string; lang: string } | undefined;
  let heredoc: string | undefined;
  let pending: { start: number; text: string; quoted: boolean } | undefined;
  let frontmatter = lines[0]?.trim() === "---";
  const push = (line: number, source: EntrySource, c: { type: EntryType; text: string } | undefined): void => {
    if (c !== undefined) out.push({ file, line, type: c.type, source, text: c.text });
  };
  for (let i = 0; i < lines.length; i += 1) {
    const n = i + 1;
    const line = lines[i] as string;
    if (frontmatter) {
      if (i > 0 && line.trim() === "---") frontmatter = false;
      const fm = /^(?:tools|allowed-tools):\s*(.*)$/.exec(line);
      if (fm !== null) for (const t of listTools(fm[1] as string)) push(n, "frontmatter", { type: "tool", text: t });
      continue;
    }
    const open = /^\s*(```+|~~~+)\s*([A-Za-z0-9_-]*)/.exec(line);
    if (fence === undefined && open !== null) {
      fence = { marker: open[1] as string, lang: (open[2] as string).toLowerCase() };
      continue;
    }
    if (fence !== undefined) {
      if (new RegExp(`^\\s*${fence.marker}[\`~]*\\s*$`).test(line)) {
        if (pending !== undefined) push(pending.start, "fence", { type: "unparsed", text: pending.text });
        fence = undefined;
        heredoc = undefined;
        pending = undefined;
        continue;
      }
      const shell = SHELL_FENCES.has(fence.lang);
      if (shell || fence.lang === "") {
        if (heredoc !== undefined) {
          if (line.trim() === heredoc) heredoc = undefined;
          continue;
        }
        // A `\` continuation joins with a space; an open quote (a multi-line `-m "…"`) joins with the newline it holds.
        const joined = pending === undefined ? line : pending.quoted ? `${pending.text}\n${line}` : `${pending.text} ${line.trim()}`;
        if (/\\\s*$/.test(line)) {
          pending = { start: pending?.start ?? n, text: joined.replace(/\\\s*$/, "").trimEnd(), quoted: false };
          continue;
        }
        if ((pending !== undefined || looksLikeCommand(joined.trim(), scripts)) && opensQuote(stripComment(joined)) && n - (pending?.start ?? n) < 20) {
          pending = { start: pending?.start ?? n, text: joined, quoted: true };
          continue;
        }
        const at = pending?.start ?? n;
        pending = undefined;
        const hd = /<<-?\s*['"]?([A-Za-z_]+)['"]?/.exec(joined);
        if (hd !== null) heredoc = hd[1] as string;
        push(at, "fence", classify(joined, scripts, shell, false));
      } else {
        for (const s of proseScripts(line, [], scripts)) push(n, "prose", s);
      }
      continue;
    }
    const spans = backtickSpans(line);
    for (const s of spans) push(n, "backtick", classify(s.text, scripts, false, false));
    for (const s of proseScripts(line, spans, scripts)) push(n, "prose", s);
    for (const t of proseTools(line, spans)) push(n, "prose", { type: "tool", text: t });
  }
  return out;
}

/** Undo the escapes a driver's printed text carries in source (`\``, `\"`, jq's `\u00XX`). */
function unescapeDriver(line: string): string {
  return line.replace(/\\u00([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\(["`])/g, "$1");
}

/** Every entry of one driver script (its printed text only; see the module comment). */
export function extractDriver(file: string, text: string, scripts: ReadonlySet<string>): RawEntry[] {
  const out: RawEntry[] = [];
  const lines = text.split("\n");
  const push = (line: number, c: { type: EntryType; text: string } | undefined): void => {
    if (c !== undefined) out.push({ file, line, type: c.type, source: "driver", text: c.text });
  };
  for (let i = 0; i < lines.length; i += 1) {
    const n = i + 1;
    const raw = lines[i] as string;
    if (/^\s*#/.test(raw)) continue;
    const line = unescapeDriver(raw);
    for (const s of backtickSpans(line)) push(n, classify(s.text, scripts, false, true));
    for (const m of line.matchAll(/(\/loomwright:[a-z][a-z-]*)/g)) push(n, { type: "slash", text: m[1] as string });
    const tools = /\btools:\s*\[([^\]]*)\]/.exec(line);
    if (tools !== null) for (const t of listTools(tools[1] as string)) push(n, { type: "tool", text: t });
    const field = new RegExp(`\\b(?:invocation|drain_invocation|then|launch):\\s*"(${KNOWN_TOOLS.join("|")}) `).exec(line);
    if (field !== null) push(n, { type: "tool", text: field[1] as string });
    const arr = /\bpush:\s*\[(.*)\]/.exec(line);
    if (arr !== null) {
      // `"bash " + $refold, "git push origin HEAD:" + $ref`: literals kept, a variable read from a `--arg <v> "<value>"` up to 6 lines back, else `<v>`.
      const back = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
      for (const el of (arr[1] as string).split(",")) {
        const parts = el.split("+").map((p) => p.trim());
        const cmd = parts
          .map((p) => {
            if (/^".*"$/.test(p)) return p.slice(1, -1);
            const v = /^\$([A-Za-z_]+)$/.exec(p);
            if (v === null) return p;
            const arg = new RegExp(`--arg ${v[1]} "([^"$(]*(?:\\$HERE[^"$(]*)?)"`).exec(back);
            return arg !== null ? (arg[1] as string) : `<${v[1]}>`;
          })
          .join("");
        push(n, classify(cmd, scripts, false, true));
      }
    }
  }
  return out;
}

/** The install's script names (`scripts/*.sh`), sorted. */
export function listScripts(root: string): string[] {
  return readdirSync(join(root, "scripts"))
    .filter((f) => f.endsWith(".sh") && statSync(join(root, "scripts", f)).isFile())
    .sort();
}

const CLAUDE_INVOCATION = /(^|[\s"'(=;|&])claude\s+(-p\b|--[a-z]|"\$)|:-claude\}/;
const EVAL_OR_BASH_C = /(^|[\s;|&(])eval\s|\bbash\s+-c\b|(^|[\s;|&(])sh\s+-c\b/;
const BASH_FILE = /(^|[\s;|&(])bash\s+"\$/;

/** One script's facts (`ScriptFacts`), read from `scripts/<name>` and `scripts/<name minus .sh>.d/*.sh`. */
export function scriptFacts(root: string, name: string, scripts: ReadonlySet<string>): ScriptFacts {
  const files = [`scripts/${name}`];
  const mod = join(root, "scripts", name.replace(/\.sh$/, ".d"));
  if (existsSync(mod) && statSync(mod).isDirectory()) {
    for (const f of readdirSync(mod).filter((x) => x.endsWith(".sh")).sort()) files.push(`scripts/${name.replace(/\.sh$/, ".d")}/${f}`);
  }
  let claude: string | null = null;
  let evalc: string | null = null;
  let bashFile: string | null = null;
  const calls = new Set<string>();
  for (const f of files) {
    const lines = readFileSync(join(root, f), "utf8").split("\n");
    lines.forEach((l, i) => {
      if (/^\s*#/.test(l)) return;
      const at = `${f}:${i + 1}`;
      if (claude === null && CLAUDE_INVOCATION.test(l)) claude = at;
      if (evalc === null && EVAL_OR_BASH_C.test(l)) evalc = at;
      if (bashFile === null && BASH_FILE.test(l)) bashFile = at;
      for (const m of l.matchAll(/([A-Za-z0-9_.-]+\.sh)\b/g)) if (m[1] !== name && scripts.has(m[1] as string)) calls.add(m[1] as string);
    });
  }
  return { claude, eval_or_bash_c: evalc, bash_file: bashFile, calls: [...calls].sort() };
}

/** A file's line count and sha256, so a fixture shows which source files changed. */
export function fileDigest(root: string, file: string): { lines: number; sha256: string } {
  const text = readFileSync(join(root, file), "utf8");
  return { lines: text.split("\n").length, sha256: createHash("sha256").update(text).digest("hex") };
}

/** Every entry of one instruction file: drivers (`scripts/*.sh`) by `extractDriver`, the rest by `extractMarkdown`. */
export function extractFile(root: string, file: string, scripts: ReadonlySet<string>): RawEntry[] {
  const text = readFileSync(join(root, file), "utf8");
  return file.startsWith("scripts/") ? extractDriver(file, text, scripts) : extractMarkdown(file, text, scripts);
}

/** Sort and de-duplicate entries: by file, then line, then text (then type and source), so a fixture's order never moves. */
export function sortEntries<T extends RawEntry>(entries: readonly T[]): T[] {
  const key = (e: RawEntry): string => JSON.stringify([e.file, e.line, e.text, e.type, e.source]);
  const seen = new Map<string, T>();
  for (const e of entries) if (!seen.has(key(e))) seen.set(key(e), e);
  return [...seen.values()].sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0) || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0),
  );
}

/**
 * The Bash command a `command` or `script` entry asks for, as a session would issue it: `<name>` and `{name}`
 * placeholders filled with sample values (`sampleFor`), and a Loomwright script word (with or without a leading
 * `bash`) rewritten to `bash "<root>/scripts/<name>"`, the form the session manager admits. Everything else,
 * `$(…)`, pipes and quotes included, is kept as written: the rail really reads those.
 */
export function bashCommandFor(text: string, root: string, scripts: ReadonlySet<string>): string {
  const filled = fillPlaceholders(text);
  const words = splitWords(filled);
  if (words === undefined) return filled;
  let k = 0;
  while (k < words.length - 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[k]?.word as string)) k += 1;
  if (k > 0) return filled;
  const at = words[0]?.word === "bash" && words[1] !== undefined && scriptOfWord(words[1].word, scripts) !== undefined ? 1 : 0;
  const w = words[at];
  const name = w === undefined ? undefined : scriptOfWord(w.word, scripts);
  if (w === undefined || name === undefined) return filled;
  return `bash "${join(root, "scripts", name)}"${filled.slice(w.end)}`;
}
