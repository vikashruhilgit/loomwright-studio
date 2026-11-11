// What every actionable card in the thread shares: its in-flight guard with the
// pending action's name, the refusal line, and what an approval decision
// invalidates. `cards.tsx` (approval, playbook, trigger cards), `CharterCard.tsx`
// and `CharterAsk.tsx` all import these, so the cards cannot drift apart.
import { useState } from "react";
import type { ResourceName } from "../../store/resources";
import { inFlightGuard } from "./model";

/** The kernel's refusal, as text; nothing when there is none. */
export function Refusal({ text }: { readonly text: string }) {
  return text === "" ? null : (
    <p className="chat-card-refusal" role="alert">
      {text}
    </p>
  );
}

/**
 * A card's actions share one in-flight guard: while one write is pending, any
 * second click on the card is dropped (two Run now clicks would queue two
 * runs). `busy` names the pending action, for its Button's `loading`. Each
 * card that calls this gets its own guard: it is component state, never shared.
 */
export function useCardAction(): { readonly busy: string | null; readonly act: (key: string, fn: () => Promise<void>) => void } {
  const [guard] = useState(inFlightGuard);
  const [busy, setBusy] = useState<string | null>(null);
  const act = (key: string, fn: () => Promise<void>): void => {
    void guard.run(async () => {
      setBusy(key);
      try {
        await fn();
      } finally {
        setBusy(null);
      }
    });
  };
  return { busy, act };
}

/** What an approval decision in `agent`'s thread changes, for the store to read again. */
export function approvalChanges(agent: string): ResourceName[] {
  return [`thread:${agent}`, "approvals", "grants", "agents", "playbooks", "triggers"];
}
