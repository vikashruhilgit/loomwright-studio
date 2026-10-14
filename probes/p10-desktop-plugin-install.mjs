// Probe 10: what does Claude Code's installed_plugins.json record, per scope, and what lives
// under ~/.claude/plugins/synced/? Phase 2's Loomwright adapter (D32) reads the active install
// from installed_plugins.json, an internal Claude Code format (docs/OPEN_QUESTIONS.md): this
// prints every entry's key, scope, version, installPath and the names of its other fields
// (projectPath, installedAt, ...), so the owner can check the adapter's assumptions against the
// real file, including after installing a plugin from the desktop app or at project/local scope.
// Read-only: no SDK, no network, writes nothing. Paths under the home dir print as ~/....
// Run:  node p10-desktop-plugin-install.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = homedir();
const tilde = (p) => (typeof p === 'string' && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p);
const pluginsDir = join(home, '.claude', 'plugins');
const file = join(pluginsDir, 'installed_plugins.json');

console.log(`(1) ${tilde(file)}:`);
let parsed;
if (!existsSync(file)) console.log('  missing');
else {
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`  unparseable: ${String(e?.message || e).slice(0, 200)}`);
  }
}
if (parsed !== undefined) {
  console.log(`  top-level keys: ${Object.keys(parsed ?? {}).join(', ') || '(none)'}; version: ${JSON.stringify(parsed?.version)}`);
  const plugins = parsed?.plugins;
  if (plugins === null || typeof plugins !== 'object' || Array.isArray(plugins)) console.log('  no plugins object');
  else {
    for (const [key, entries] of Object.entries(plugins)) {
      if (!Array.isArray(entries)) { console.log(`  ${key}: not an array (${typeof entries})`); continue; }
      for (const [i, e] of entries.entries()) {
        if (e === null || typeof e !== 'object') { console.log(`  ${key}[${i}]: not an object`); continue; }
        const other = Object.keys(e).filter((k) => !['scope', 'version', 'installPath'].includes(k));
        console.log(`  ${key}[${i}] scope=${JSON.stringify(e.scope)} version=${JSON.stringify(e.version)} installPath=${JSON.stringify(tilde(e.installPath))}`);
        console.log(`    other fields: ${other.join(', ') || '(none)'}${typeof e.projectPath === 'string' ? `; projectPath=${JSON.stringify(tilde(e.projectPath))}` : ''}`);
      }
    }
  }
}

const names = (dir) => { try { return readdirSync(dir).sort(); } catch { return undefined; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

console.log(`\n(2) ${tilde(pluginsDir)}/ holds: ${(names(pluginsDir) ?? ['(missing)']).join(', ') || '(empty)'}`);
const synced = join(pluginsDir, 'synced');
console.log(`\n(3) ${tilde(synced)}/: ${existsSync(synced) ? 'exists' : 'does not exist'}`);
for (const n of names(synced) ?? []) {
  const p = join(synced, n);
  console.log(`  ${n}${isDir(p) ? `/  (${(names(p) ?? []).join(', ') || 'empty'})` : ''}`);
}

console.log('\nCannot tell from these files: whether a plugin installed from the Claude desktop app (or synced');
console.log('from claude.ai) is recorded in installed_plugins.json. Install one that way, rerun, and compare.');
