// The Playbooks title-bar subtitle (phase 7 item 15): the shell's `Titlebar` draws `ScreenDefinition.Subtitle` beside
// the title, outside the screen. The list shows its count line ("3 playbooks · 2 on", "· last known" while the kernel
// does not answer); a playbook's detail shows that playbook's slug; the edit and history views show nothing.
//
// The subtitle is a prop-less component the shell mounts, so it cannot be handed the screen's state. It reads the
// playbooks from the live store (`window.api`, as the screen does) and learns which view is open from a tiny
// module-level hold that `PlaybooksView` sets while it is mounted and resets when it unmounts.
//
// The slug is the kernel's own text: through `safe`, a React text child, never markup.
import { useLayoutEffect, useSyncExternalStore } from "react";
import type { StudioBridge } from "../../api/contract";
import { getBridge } from "../../api/bridge";
import { useKernelReach } from "../../shell/last-known";
import { useResource } from "../../store/react";
import { PLAYBOOKS_TEST_IDS as IDS, countText, safe } from "./model";

/** What the subtitle shows: the list's count line, one playbook's slug, or nothing. */
export type SubtitleView = { readonly kind: "none" } | { readonly kind: "list" } | { readonly kind: "detail"; readonly slug: string };

const NONE: SubtitleView = { kind: "none" };

let current: SubtitleView = NONE;
const listeners = new Set<() => void>();

function setView(next: SubtitleView): void {
  const same = next.kind === current.kind && (next.kind !== "detail" || (current.kind === "detail" && current.slug === next.slug));
  if (same) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getView = (): SubtitleView => current;

/** Publish the open view for the title bar while the caller is mounted; the view is reset to nothing on unmount. */
export function usePublishSubtitle(view: SubtitleView): void {
  const kind = view.kind;
  const slug = view.kind === "detail" ? view.slug : "";
  useLayoutEffect(() => {
    setView(kind === "detail" ? { kind, slug } : { kind });
  }, [kind, slug]);
  useLayoutEffect(() => () => setView(NONE), []);
}

function ListCount({ api }: { readonly api: StudioBridge }) {
  const playbooks = useResource("playbooks", api)?.data?.playbooks;
  const { offline } = useKernelReach(api);
  if (playbooks === undefined) return null;
  return <span data-testid={IDS.count}>{countText(playbooks, offline)}</span>;
}

/** The count line on the list and the slug on a playbook's detail; nothing on the other views or with no bridge. */
export function PlaybooksSubtitle() {
  const view = useSyncExternalStore(subscribe, getView);
  const bridge = getBridge() as StudioBridge | undefined;
  if (bridge === undefined) return null;
  if (view.kind === "list") return <ListCount api={bridge} />;
  if (view.kind === "detail") {
    return (
      <span className="pb-mono" data-testid={IDS.slug}>
        {safe(view.slug)}
      </span>
    );
  }
  return null;
}
