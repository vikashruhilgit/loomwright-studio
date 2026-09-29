#!/usr/bin/env bash
# Deterministic docs gate for CI (the `ci` job) and for local use: `bash scripts/check-docs.sh`.
# Fails closed on:
#   1. a relative markdown link in docs/, CLAUDE.md or README.md whose target does not exist
#   2. a duplicated decision number in docs/DECISIONS.md
#   3. a path named in CLAUDE.md's "Where things are" table that does not exist
# No dependencies beyond bash 3.2, grep, sed, awk (macOS-green and CI-green alike).
set -u
cd "$(dirname "$0")/.."
fail=0

note() { printf '%s\n' "$*"; }
err()  { printf 'FAIL: %s\n' "$*"; fail=1; }

# 1. Relative links resolve. Targets like `docs/UI.md`, `research/GROK_BOT.md`, `../LICENSE.md`.
#    Skips http(s), mailto, anchors-only and claude.ai artefact links.
while IFS= read -r file; do
  dir=$(dirname "$file")
  # one link per line: [text](target) — target up to the first ')' or '#'
  grep -o '\]([^)]*)' "$file" | sed 's/^\](//; s/)$//; s/#.*$//' | while IFS= read -r target; do
    [ -z "$target" ] && continue
    case "$target" in
      http://*|https://*|mailto:*) continue ;;
    esac
    if [ ! -e "$dir/$target" ] && [ ! -e "$target" ]; then
      err "$file links to '$target' which does not exist"
      echo 1 > "${TMPDIR:-/tmp}/check-docs.failed"
    fi
  done
done < <(find docs CLAUDE.md README.md -name '*.md' 2>/dev/null)
[ -f "${TMPDIR:-/tmp}/check-docs.failed" ] && { fail=1; rm -f "${TMPDIR:-/tmp}/check-docs.failed"; }

# 2. Decision numbers are unique.
dups=$(grep -o '^| D[0-9]* |' docs/DECISIONS.md | sort | uniq -d)
[ -n "$dups" ] && err "duplicated decision numbers in docs/DECISIONS.md: $dups"

# 3. Every path the CLAUDE.md table names exists.
grep -o '`[^`]*`' CLAUDE.md | tr -d '`' | grep -E '^(docs/|LICENSE|README)' | sed 's/[,;].*$//' | sort -u | while IFS= read -r p; do
  [ -e "$p" ] || { err "CLAUDE.md names '$p' which does not exist"; echo 1 > "${TMPDIR:-/tmp}/check-docs.failed"; }
done
[ -f "${TMPDIR:-/tmp}/check-docs.failed" ] && { fail=1; rm -f "${TMPDIR:-/tmp}/check-docs.failed"; }

# 4. Identity is not state: a semantic colour (ok, attention, danger, parked) must never be an
#    avatar identity hue. Found in review of PR #1: agents were tinted with state colours.
if grep -nE "HUES=\{[^}]*(ok|attention|danger|parked):" docs/design/avatar/avatar.js docs/design/mockups/gui-v1.html docs/design/design-system/components/*/preview.html 2>/dev/null; then
  err "an avatar HUES map uses a semantic token; identity hues must be crew-* (or accent for Wright)"
fi
if grep -nE "hue:'(ok|attention|danger|parked)'" docs/design/mockups/gui-v1.html docs/design/design-system/components/*/preview.html 2>/dev/null; then
  err "an agent is assigned a semantic colour as its identity hue; use a crew-* hue"
fi

if [ "$fail" -eq 0 ]; then note "check-docs: OK"; fi
exit "$fail"
