#!/usr/bin/env bash
# Regenerate the Loomwright instruction fixture from the active install (phase 8 item 25a), then show what changed.
#   bash scripts/refresh-loomwright-fixture.sh
# The conformance test's own update mode does the extraction (one code path): it resolves the install the kernel
# loads (`resolveLoomwrightInstall()`, which reads ~/.claude/plugins/installed_plugins.json), writes
# kernel/test/fixtures/loomwright-<version>-instructions.json (install-relative paths only), removes any other
# version's fixture, and runs the checks against it. A failing check is printed, not hidden: a new release's
# denials need exclusion rows (kernel/src/automate/run-exclusions.ts) or a policy change.
# Needs: node and the kernel's dev dependencies (`cd kernel && npm ci`). bash 3.2 compatible.
set -u
cd "$(dirname "$0")/.." || exit 1
fixtures=kernel/test/fixtures

( cd kernel && LOOMWRIGHT_FIXTURE_UPDATE=1 npx vitest run test/loomwright-conformance.test.ts )
rc=$?

# A new version's fixture is a new file: mark it intent-to-add so `git diff` shows it (as a rename of the old one).
for f in "$fixtures"/loomwright-*-instructions.json; do
  [ -e "$f" ] || continue
  git ls-files --error-unmatch "$f" >/dev/null 2>&1 || git add --intent-to-add "$f"
done
echo
echo "fixture changes (git diff -M --stat; read the entries with: git diff -M -- $fixtures):"
git diff -M --stat -- "$fixtures"
exit "$rc"
