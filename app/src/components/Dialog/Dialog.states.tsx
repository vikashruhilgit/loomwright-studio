// Every Dialog state its README and preview.html show, for unit tests and the
// component gallery. Contained and static: each panel is `inline` (no portal,
// overlay, focus trap or initial-focus move), so they can share one page.
import { useState, type ReactElement } from "react";
import { Dialog } from "./Dialog";

const noop = () => {};

function DecisionWithCheckbox() {
  const [stillAsk, setStillAsk] = useState(false);
  return (
    <Dialog
      inline
      kind="decision"
      title="Always allow for this playbook?"
      description={
        <>
          Mason will post reviews on PRs matched by <b>Review PRs where I'm requested</b> without asking. This never applies to
          other playbooks.
        </>
      }
      payload={"action: github.pr.review.post\nscope: playbook:pb_01J9K…"}
      checkbox={{ label: "Still ask when the review is blocking", checked: stillAsk, onChange: setStillAsk }}
      action={{ label: "Always allow", kbd: "⇧A", keyshortcuts: "Shift+A", onAction: noop }}
      onCancel={noop}
    />
  );
}

export const states: ReadonlyArray<{ readonly id: string; readonly title: string; readonly render: () => ReactElement }> = [
  {
    id: "confirm",
    title: "Confirm (destructive): the kill switch",
    render: () => (
      <Dialog
        inline
        kind="confirm"
        title="Kill everything?"
        description="Aborts 2 running sessions and disables all 4 triggers. Mason's review of PR 412 loses its current step; the task stays and can be resumed."
        action={{ label: "Kill all", kbd: "⌘⏎", keyshortcuts: "Meta+Enter", onAction: noop }}
        onCancel={noop}
      />
    ),
  },
  {
    id: "decision",
    title: "Decision: always allow, with a mono well and a narrowing checkbox",
    render: () => <DecisionWithCheckbox />,
  },
  {
    id: "decision-wide",
    title: "Decision, wide (480px) for a diff",
    render: () => (
      <Dialog
        inline
        wide
        kind="decision"
        title="Apply this change to the playbook?"
        description="Wright edits the trigger of Review PRs where I'm requested. Nothing runs until you enable it again."
        payload={"- poll: every 10 minutes\n+ poll: every 5 minutes\n  dedupe: pr.head_sha"}
        action={{ label: "Apply change", kbd: "⌘⏎", keyshortcuts: "Meta+Enter", onAction: noop }}
        onCancel={noop}
      />
    ),
  },
];
