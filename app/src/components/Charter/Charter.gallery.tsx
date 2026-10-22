// Every Charter state from its README and preview.html, with canned data, for the conversation
// components evidence page (app/e2e/components.conversation.spec.ts).
// Never imported by App.tsx, so it stays out of the app bundle.
//
// The avatar slot gets a neutral placeholder here: the Avatar primitive is built by a sibling
// lane and is passed in by each screen, never imported by this component.
import type { ReactElement } from "react";
import { Charter, type CharterProps } from "./Charter";

const noop = () => undefined;

function AvatarSlot({ label }: { readonly label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      style={{ display: "block", width: 28, height: 28, borderRadius: "var(--radius-full)", border: "1px dashed var(--ink-tertiary)" }}
    />
  );
}

const pim: CharterProps = {
  name: { value: "Pim", proposed: true },
  avatar: <AvatarSlot label="Pim · idle" />,
  shape: "octopus",
  summary: "personal assistant",
  persona: "Brief and direct. Morning digest in bullets, most urgent first. Never chatty.",
  duties: [
    "Daily digest at 08:00 of calendar, mail and Slack",
    "Remind you of commitments you made in chat or mail",
    "Prepare a short brief before each meeting",
  ],
  tools: [
    { name: "Calendar", connected: false },
    { name: "Mail", connected: false },
    { name: "Slack", connected: true },
  ],
  boundaries: ["Reads only: never sends mail or messages", "Never moves or declines meetings"],
  model: { value: "Haiku 4.5", proposed: true },
  limits: { tokensPerDay: 100_000, sessionsAtOnce: 1, proposed: true },
  firstPlaybookDryRun: { text: "Daily digest · cron 08:00 Mon–Fri · would summarise 4 meetings, 32 mails, 6 Slack threads", costEstimate: 0.08 },
  onCreate: noop,
  onEditInEnglish: noop,
  onPickShape: noop,
};

const XSS_IMG = "<img src=x onerror=alert(1)>";

export const galleryStates: readonly { id: string; title: string; element: ReactElement }[] = [
  {
    id: "drafted",
    title: "A crew member Wright drafted from one sentence, with proposed values",
    element: <Charter {...pim} />,
  },
  {
    id: "user-set",
    title: "Every value set by the user (no proposed tags), all tools connected",
    element: (
      <Charter
        {...pim}
        name={{ value: "Mason" }}
        avatar={<AvatarSlot label="Mason · idle" />}
        shape="crab"
        summary="reviewer"
        persona="Careful and specific. Cites the line, proposes the fix."
        duties={["Review PRs where I'm the requested reviewer"]}
        tools={[{ name: "GitHub", connected: true }]}
        boundaries={["Never approves or merges a PR", "Never pushes to a branch it did not create"]}
        model={{ value: "Sonnet 5" }}
        limits={{ tokensPerDay: 1_500_000, sessionsAtOnce: 2 }}
        firstPlaybookDryRun={{ text: "Review PRs · poll every 5 min · would review vikashruhilgit/loomwright #412, #409" }}
      />
    ),
  },
  {
    id: "estimates",
    title: "Dollar figures appear only as estimates labelled at API rates",
    element: <Charter {...pim} limits={{ tokensPerDay: 100_000, sessionsAtOnce: 1, proposed: true, costEstimate: 2.4 }} />,
  },
  {
    id: "no-boundaries-no-playbook",
    title: "No extra boundaries and no playbook drafted yet: both sections still shown",
    element: <Charter {...pim} shape={undefined} boundaries={[]} duties={[]} tools={[]} firstPlaybookDryRun={undefined} />,
  },
  {
    id: "untrusted-text",
    title: "Untrusted text renders inert: <img onerror> in every field",
    element: (
      <Charter
        {...pim}
        name={{ value: XSS_IMG, proposed: true }}
        summary={XSS_IMG}
        persona={XSS_IMG}
        duties={[XSS_IMG, "[x](javascript:alert(1))"]}
        tools={[{ name: XSS_IMG, connected: false }]}
        boundaries={[XSS_IMG]}
        model={{ value: XSS_IMG }}
        firstPlaybookDryRun={{ text: XSS_IMG }}
      />
    ),
  },
];
