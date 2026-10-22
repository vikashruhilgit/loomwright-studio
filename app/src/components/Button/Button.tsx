// Button (docs/design/design-system/components/Button): one action, labelled
// in sentence case as a verb phrase. Four variants (primary, secondary, ghost,
// danger) and two sizes: 32px standalone (`--control-height`) and 28px inside
// rows (`--row-height`).
//
// - `icon` is a slot (no icon library ships here): pass a 14px `currentColor`
//   SVG. It is decorative, so the label alone names the button.
// - `kbd` shows the shortcut chip after the label. The chip is hidden from
//   assistive tech so the accessible name stays the label; pass
//   `aria-keyshortcuts` (for example "Meta+Shift+K") to announce the shortcut.
// - `loading` sets `aria-busy="true"`, swaps the icon for a 12px CSS spinner in
//   the same slot and keeps the label. A loading button ignores clicks
//   (`aria-disabled`) but stays focusable, so focus is never lost mid-action.
// - `disabled` is the native attribute; the label never changes to explain it.
import type { ComponentPropsWithRef, MouseEvent, ReactNode } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "standalone" | "row";

export interface ButtonProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
  readonly kbd?: string;
  readonly loading?: boolean;
  readonly children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "standalone",
  icon,
  kbd,
  loading = false,
  className,
  type = "button",
  onClick,
  children,
  ...rest
}: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  const slot = loading ? (
    <span className="btn-icon" aria-hidden="true">
      <span className="btn-spinner" data-testid="btn-spinner" />
    </span>
  ) : icon ? (
    <span className="btn-icon" aria-hidden="true">
      {icon}
    </span>
  ) : null;
  return (
    <button
      {...rest}
      type={type}
      className={className ? `btn ${className}` : "btn"}
      data-variant={variant}
      data-size={size}
      aria-busy={loading ? "true" : undefined}
      aria-disabled={loading ? "true" : rest["aria-disabled"]}
      onClick={handleClick}
    >
      {slot}
      <span className="btn-label">{children}</span>
      {kbd ? (
        <kbd className="btn-kbd" aria-hidden="true">
          {kbd}
        </kbd>
      ) : null}
    </button>
  );
}
