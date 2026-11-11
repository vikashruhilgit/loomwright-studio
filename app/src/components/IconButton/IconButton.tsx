// IconButton (phase 8 item 18d; docs/DESIGN.md §"New for approval (charter
// card)", the mockup's `tipBtn`): an icon-only control. Its `label` is the
// accessible name (`aria-label`), and the same words show as a tooltip in
// `caption` type, `surface` text on `ink`, `radius-xs` and `shadow-2`, below
// the button (right-aligned at a card's edge with `tipAlign="right"`). The
// tooltip shows on hover and on keyboard focus; `Esc` hides it until the
// pointer or focus leaves (WCAG 1.4.13); a second `Esc` is left to the
// surrounding control. The tooltip is `aria-hidden`: the name is the label.
//
// Icons are Lucide paths (16px, 1.5px stroke, `currentColor`) copied from
// `docs/design/mockups/charter-card.html`. No new token.
import { useState } from "react";
import type { ComponentPropsWithRef, KeyboardEvent, ReactNode } from "react";
import "./IconButton.css";

export type IconName = "copy" | "copied" | "expand" | "collapse" | "more" | "less" | "folder" | "download";

const PATHS: Readonly<Record<IconName, ReactNode>> = Object.freeze({
  copy: (
    <>
      <rect x="8" y="8" width="14" height="14" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  copied: <path d="m5 12.5 4.5 4.5L19 7" />,
  expand: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  collapse: <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />,
  more: (
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </>
  ),
  less: <path d="m18 15-6-6-6 6" />,
  folder: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
});

/** A Lucide icon at 16px, `currentColor`, decorative (the button's label names it). */
export function Icon({ name }: { readonly name: IconName }) {
  return (
    <svg className="iconbtn-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon={name}>
      {PATHS[name]}
    </svg>
  );
}

export interface IconButtonProps extends Omit<ComponentPropsWithRef<"button">, "children" | "aria-label"> {
  /** The accessible name, and the tooltip's words. */
  readonly label: string;
  readonly icon: IconName;
  /** Where the tooltip sits: centred below the button, or right-aligned at a card's edge. */
  readonly tipAlign?: "center" | "right";
  /** The `ok` colour, for a check shown after a copy. */
  readonly done?: boolean;
}

export function IconButton({ label, icon, tipAlign = "center", done = false, className, type = "button", onKeyDown, onMouseLeave, onBlur, ...rest }: IconButtonProps) {
  // Esc hides the tooltip until the pointer or focus leaves the button.
  const [dismissed, setDismissed] = useState(false);
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "Escape" && !dismissed) {
      setDismissed(true);
      // The first Esc is the tooltip's; a second one reaches the surrounding control.
      event.stopPropagation();
      event.preventDefault();
    }
    onKeyDown?.(event);
  };
  const classes = ["iconbtn", dismissed ? "iconbtn-tip-dismissed" : "", done ? "iconbtn-done" : "", className ?? ""].filter((c) => c !== "").join(" ");
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      aria-label={label}
      onKeyDown={keyDown}
      onMouseLeave={(event) => {
        setDismissed(false);
        onMouseLeave?.(event);
      }}
      onBlur={(event) => {
        setDismissed(false);
        onBlur?.(event);
      }}
    >
      <Icon name={icon} />
      <span className={tipAlign === "right" ? "iconbtn-tip iconbtn-tip-right" : "iconbtn-tip"} aria-hidden="true" data-testid="iconbtn-tip">
        {label}
      </span>
    </button>
  );
}
