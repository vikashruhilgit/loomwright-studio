// DiffView gallery: every README / preview.html state with canned data, for the
// conversation evidence page (subtask 4). Never imported by App.tsx.
import type { ReactElement } from "react";
import { DiffView, type DiffHunk } from "./DiffView";

const XSS = "<img src=x onerror=alert(1)>";

/** The hook change from DiffView/preview.html. */
export const hookHunks: readonly DiffHunk[] = [
  {
    header: '@@ -12,7 +12,15 @@ "hooks": {',
    lines: [
      { kind: "context", oldNumber: 12, newNumber: 12, text: '    "SubagentStop": [' },
      { kind: "context", oldNumber: 13, newNumber: 13, text: "      {" },
      { kind: "del", oldNumber: 14, text: '        "matcher": "loomwright:worker",' },
      { kind: "add", newNumber: 14, text: '        "matcher": "loomwright:worker|loomwright:code-reviewer",' },
      { kind: "context", oldNumber: 15, newNumber: 15, text: '        "hooks": [' },
      { kind: "add", newNumber: 16, text: "          {" },
      { kind: "add", newNumber: 17, text: '            "type": "command",' },
      { kind: "add", newNumber: 18, text: '            "command": "$CLAUDE_PLUGIN_ROOT/scripts/validate-worker-result.py",' },
      { kind: "add", newNumber: 19, text: '            "timeout": 30' },
      { kind: "add", newNumber: 20, text: "          }," },
      { kind: "context", oldNumber: 16, newNumber: 21, text: "          {" },
    ],
  },
];

const twoHunks: readonly DiffHunk[] = [
  {
    header: "@@ -1,3 +1,3 @@",
    lines: [
      { kind: "context", oldNumber: 1, newNumber: 1, text: "name: Review PRs where I'm requested" },
      { kind: "del", oldNumber: 2, text: "model: sonnet" },
      { kind: "add", newNumber: 2, text: "model: opus" },
      { kind: "context", oldNumber: 3, newNumber: 3, text: "approval: ask before posting each review" },
    ],
  },
  {
    header: "@@ -20,2 +20,3 @@ dedupe:",
    lines: [
      { kind: "context", oldNumber: 20, newNumber: 20, text: "  key: pr-head-sha" },
      { kind: "add", newNumber: 21, text: "  window: 24h" },
      { kind: "context", oldNumber: 21, newNumber: 22, text: "" },
    ],
  },
];

const longLine: readonly DiffHunk[] = [
  {
    header: "@@ -1,1 +1,1 @@",
    lines: [
      { kind: "del", oldNumber: 1, text: `export const PATTERN = "${"a".repeat(40)}";` },
      { kind: "add", newNumber: 1, text: `export const PATTERN = "${"ab-".repeat(80)}"; // a long line scrolls inside the diff, never the page` },
    ],
  },
];

export const galleryStates: readonly { id: string; title: string; element: ReactElement }[] = [
  { id: "hook-change", title: "Hook change in an approval (project scope)", element: <DiffView path=".claude/settings.json" scope="project" hunks={hookHunks} /> },
  { id: "playbook-edit", title: "Playbook edit, two hunks, none collapsed (global scope)", element: <DiffView path="playbooks/review-prs.md" scope="global" hunks={twoHunks} /> },
  { id: "long-line", title: "Long line scrolls horizontally inside the diff", element: <DiffView path="src/patterns.ts" scope="project" hunks={longLine} /> },
  { id: "empty", title: "No changes (Allow stays gated)", element: <DiffView path="notes/empty.md" scope="project" hunks={[]} /> },
  {
    id: "untrusted-text",
    title: "Untrusted text stays inert",
    element: (
      <DiffView
        path={XSS}
        scope="project"
        hunks={[{ header: `@@ -1,1 +1,1 @@ ${XSS}`, lines: [{ kind: "del", oldNumber: 1, text: XSS }, { kind: "add", newNumber: 1, text: XSS }] }]}
      />
    ),
  },
];
