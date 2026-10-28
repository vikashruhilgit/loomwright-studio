// The modal focus behaviour Dialog and the Connect GitHub sheet share: focus
// moves in on open (to the first non-destructive control, else the panel), Tab
// and Shift+Tab cycle inside the panel, focus that escapes is brought back,
// Escape is handed to the caller, and on close focus returns to the element
// that had it when the panel opened (if it is still in the document).
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** The first control that is not destructive (`Button`'s `data-variant="danger"`), else the panel. */
function initialFocusTarget(panel: HTMLElement): HTMLElement {
  return focusables(panel).find((el) => el.dataset.variant !== "danger") ?? panel;
}

/**
 * While `active`, trap focus in `panelRef`'s element. `onEscape` is called after Escape's default is prevented; it is
 * read through a ref, so a new function each render never re-subscribes the listeners.
 */
export function useModalFocus(panelRef: RefObject<HTMLElement | null>, active: boolean, onEscape: () => void): void {
  const latestEscape = useRef(onEscape);
  useLayoutEffect(() => {
    latestEscape.current = onEscape;
  });

  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    if (!panel) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let lastInside: HTMLElement = initialFocusTarget(panel);
    lastInside.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        latestEscape.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(panel);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const current = document.activeElement;
      const outside = !panel.contains(current);
      const atStart = outside || current === first || current === panel;
      const atEnd = outside || current === last;
      const wrapTo = event.shiftKey ? (atStart ? last : null) : atEnd ? first : null;
      if (wrapTo) {
        event.preventDefault();
        wrapTo.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && panel.contains(target)) {
        lastInside = target;
        return;
      }
      // Focus escaped (a click on the overlay, a programmatic focus): bring it back.
      lastInside.focus();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      // Released here, in the commit, so the focusin guard is gone before focus is restored below.
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [active, panelRef]);

  // Restore focus to the opener in a passive cleanup, which runs after the commit.
  // A layout cleanup runs inside the commit, where React's own selection restore
  // would refocus the still-mounted panel control (a panel kept for its exit animation).
  useEffect(() => {
    if (!active) return;
    return () => {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus();
    };
  }, [active]);
}
