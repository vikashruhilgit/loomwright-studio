// Every ChatBubble state from its README and preview.html, with canned data, for the
// conversation components evidence page (app/e2e/components.conversation.spec.ts).
// Never imported by App.tsx, so it stays out of the app bundle.
//
// The avatar slot gets a neutral placeholder here: the Avatar primitive is built by a sibling
// lane and is passed in by each screen, never imported by this component.
import type { ReactElement } from "react";
import { ChatBubble, type PlaybookDraft } from "./ChatBubble";

const noop = () => undefined;

function AvatarSlot({ label }: { readonly label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      style={{ display: "block", width: 24, height: 24, borderRadius: "var(--radius-full)", border: "1px dashed var(--ink-tertiary)" }}
    />
  );
}

const reviewDraft: PlaybookDraft = {
  name: { value: "Review PRs where I'm requested" },
  runsAs: "Mason",
  trigger: { value: "Poll GitHub every 5 min for PRs requesting my review" },
  action: { value: "Mason runs Loomwright /review-pr and posts one review" },
  dedupeKey: { value: "{pr.head_sha}", proposed: true },
  model: { value: "Sonnet 5", proposed: true },
  approval: { value: "Ask before posting each review" },
  dryRun: "would review vikashruhilgit/loomwright #412, #409, ntfs-tool #7 · skipped 0",
  costEstimate: 0.6,
};

const XSS_IMG = "<img src=x onerror=alert(1)>";

export const galleryStates: readonly { id: string; title: string; element: ReactElement }[] = [
  {
    id: "user",
    title: "User turn: right, accent-soft, no edge",
    element: <ChatBubble speaker="You" from="user" time="14:06" body="Find PRs where I'm the requested reviewer, run a review agent, and post the review." />,
  },
  {
    id: "wright",
    title: "Wright turn: left, surface, hairline edge",
    element: (
      <ChatBubble
        speaker="Wright"
        from="wright"
        time="14:06"
        avatar={<AvatarSlot label="Wright" />}
        body={"I found three open PRs on your personal repos where you're the requested reviewer.\n\nRun `npm test` first, then **push**."}
      />
    ),
  },
  {
    id: "specialist",
    title: "Specialist turn",
    element: <ChatBubble speaker="Mason" from="specialist" time="14:09" avatar={<AvatarSlot label="Mason" />} body={"Review posted on #412.\nTwo comments, no blockers."} />,
  },
  {
    id: "playbook-draft",
    title: "Wright turn with a drafted playbook and its dry run",
    element: (
      <ChatBubble
        speaker="Wright"
        from="wright"
        time="14:06"
        avatar={<AvatarSlot label="Wright" />}
        body="Here's the duty I'd set up. I've proposed a dedupe key and a model; they're yours to change."
        draft={reviewDraft}
        onEnable={noop}
        onEditInEnglish={noop}
        onEditFields={noop}
      />
    ),
  },
  {
    id: "playbook-draft-user-set",
    title: "Drafted playbook with every value set by the user (no proposed tags)",
    element: (
      <ChatBubble
        speaker="Wright"
        from="wright"
        time="14:11"
        avatar={<AvatarSlot label="Wright" />}
        body="Updated with your choices."
        draft={{ ...reviewDraft, dedupeKey: { value: "{pr.number}" }, model: { value: "Opus 5" }, costEstimate: undefined }}
        onEnable={noop}
        onEditInEnglish={noop}
        onEditFields={noop}
      />
    ),
  },
  {
    id: "streaming",
    title: "Streaming turn: meta reads streaming, static caret at the live end",
    element: (
      <ChatBubble
        speaker="Wright"
        from="wright"
        time="14:07"
        avatar={<AvatarSlot label="Wright" />}
        streaming
        body="Enabled. Mason will pick up #412 first because it has a review requested 3 hours ago. I'll ask before anything is posted"
      />
    ),
  },
  {
    id: "long-wrap",
    title: "Long text wraps at the 520px cap",
    element: (
      <ChatBubble
        speaker="Wright"
        from="wright"
        time="14:12"
        avatar={<AvatarSlot label="Wright" />}
        body={`A long path wraps rather than overflowing: /Users/owner/Documents/work/loomwright-studio/memory/mason/role-and-duties-and-boundaries.md ${"and the sentence keeps going so the bubble reaches its cap. ".repeat(3)}`}
      />
    ),
  },
  {
    id: "untrusted-text",
    title: "Untrusted text renders inert: <img onerror>, raw and markdown javascript: links",
    element: (
      <ChatBubble
        speaker="Mason"
        from="specialist"
        time="14:13"
        avatar={<AvatarSlot label="Mason" />}
        body={`${XSS_IMG}\n\nRaw: javascript:alert(1)\nMarkdown: [x](javascript:alert(1))`}
        draft={{ ...reviewDraft, name: { value: XSS_IMG }, dryRun: XSS_IMG }}
        onEnable={noop}
        onEditInEnglish={noop}
        onEditFields={noop}
      />
    ),
  },
];
