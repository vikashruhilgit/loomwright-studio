// Every Input state its README and preview.html show, for unit tests and the
// component gallery. Contained and static: no portal, overlay or timer.
import type { ReactElement } from "react";
import { Composer, SelectField, TextField } from "./Input";

const grid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3) var(--space-4)", maxWidth: "720px" } as const;
const noop = () => undefined;

export const states: ReadonlyArray<{ readonly id: string; readonly title: string; readonly render: () => ReactElement }> = [
  {
    id: "fields",
    title: "Text, search, select and error",
    render: () => (
      <div style={grid}>
        <TextField id="state-agent-name" label="Agent name" defaultValue="Mason" hint="Shown in chat and in the menu bar." />
        <TextField id="state-search" variant="search" label="Search sessions" placeholder="Agent, task or PR…" kbd="/" />
        <SelectField id="state-model" label="Model" defaultValue="sonnet-5" hint="Policy is yours; Wright only proposes.">
          <option value="sonnet-5">Sonnet 5 (proposed by Wright)</option>
          <option value="opus-5-5">Opus 5.5</option>
          <option value="haiku-4-5">Haiku 4.5</option>
        </SelectField>
        <TextField
          id="state-dedupe"
          label="Dedupe key"
          defaultValue="pr.head_sha"
          error="Unknown field. Try pr.number or pr.head_sha in braces: {pr.head_sha}"
        />
      </div>
    ),
  },
  {
    id: "disabled",
    title: "Disabled",
    render: () => (
      <div style={grid}>
        <TextField id="state-disabled" label="Data directory" defaultValue="~/.loomwright-studio" disabled />
      </div>
    ),
  },
  {
    id: "composer",
    title: "Composer",
    render: () => (
      <Composer aria-label="Message Wright" placeholder="Ask Wright anything, or tell it a duty…" onSend={noop} />
    ),
  },
  {
    id: "composer-streaming",
    title: "Composer while Wright is streaming",
    render: () => (
      <Composer aria-label="Message Wright" placeholder="Ask Wright anything, or tell it a duty…" onSend={noop} onStop={noop} streaming />
    ),
  },
];
