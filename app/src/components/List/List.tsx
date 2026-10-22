// List (docs/design/design-system/components/List): the app's main surface,
// the sidebar, the Crew roster, sessions and approvals. Three row kinds:
//
// - `nav`: 28px (`row-height`), a 16px icon slot, the label, and either a kbd
//   shortcut in `ink-tertiary` or the attention count pill. Selected:
//   `accent-soft` ground, `accent` text, weight 500, `aria-current="page"`.
// - `data`: 44px, an 8px StatusDot, the subject in `body-strong`, a `caption`
//   meta line in `ink-tertiary` with tabular numbers, and a right column.
// - `crew`: 44px, a 24px `avatar` slot (this component never imports Avatar),
//   the name at weight 600 with an `accent` dot when unread, a tabular time and
//   a `caption` second line. Never a StatusDot beside an avatar.
//
// The rows form a `listbox` with a roving tabindex: Tab reaches the selected
// row (or the first), `ArrowDown`/`j` and `ArrowUp`/`k` move the selection one
// row and the focus with it, `Enter` (or Space, or a click) opens the row.
// Rows carry no actions of their own: a row opens.
//
// Scroll anchoring: the List is its own scroll container. After every commit
// it re-measures its anchor (the selected row when it is on screen, otherwise
// the first visible row, kept as a fallback in case the anchor row itself is
// removed) and, when rows were inserted or removed above it, adds the
// anchor's shift to `scrollTop`, so nothing visible moves. Chromium's
// native `overflow-anchor` is off (List.css) so this effect is the one owner.
// The first visible row is found by binary search over the rows in DOM order
// (their tops only grow), so a scroll event costs O(log n) layout reads.
//
// Focus never falls to <body> while a row it knew survives: when the focused
// row is removed, focus moves to its nearest surviving neighbour by key (the
// next row that was below it, else the one above), never to a row inserted in
// the same update, with `preventScroll` so anchoring holds. An uncontrolled List
// selects it. If no previous row survives, focus is not moved.
//
// `loading` renders skeleton rows at the real row height on `surface-sunken`
// (never a spinner), so nothing shifts when data lands. `emptyText` is shown
// when there are no items (the Crew group's `CREW_EMPTY_TEXT`); a screen's own
// empty state replaces an empty list everywhere else. Streaming meta updates
// change text only: every line is a single ellipsised line at a fixed height.
import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CountPill } from "../Badge/Badge";
import { type StatusState, StatusDot } from "../StatusDot/StatusDot";
import "./List.css";

/** The empty Crew group's words (List README). */
export const CREW_EMPTY_TEXT = "No specialists yet. Wright proposes one when a duty needs it.";

export interface ListNavItem {
  readonly kind: "nav";
  readonly key: string;
  readonly label: string;
  /** A 16px `currentColor` icon. A slot: no icon library ships here. */
  readonly icon?: ReactNode;
  /** A shortcut shown in `ink-tertiary`, for example "⌘1". Ignored when `count` is set. */
  readonly kbd?: string;
  /** The attention count pill; `label` carries the unit ("3 pending"). */
  readonly count?: { readonly value: number; readonly label: string };
}

export interface ListDataItem {
  readonly kind: "data";
  readonly key: string;
  readonly status: StatusState;
  /** The state word for the dot's accessible name; defaults to StatusDot's word. */
  readonly statusLabel?: string;
  /** Required for an `ok` dot: the kernel's verification time (StatusDot's honest-ok rule). */
  readonly verified?: { readonly at: string };
  readonly subject: string;
  readonly meta?: string;
  /** The right-aligned secondary fact: model, tokens or time. */
  readonly aside?: string;
}

export interface ListCrewItem {
  readonly kind: "crew";
  readonly key: string;
  readonly name: string;
  /** The agent's 24px avatar, which carries its state. */
  readonly avatar?: ReactNode;
  readonly unread?: boolean;
  readonly time?: string;
  /** The last thing that happened in the thread, or "Waiting on you · <the approval>". */
  readonly lastLine?: string;
}

export type ListItem = ListNavItem | ListDataItem | ListCrewItem;
export type ListRowKind = ListItem["kind"];

export interface ListProps<T extends ListItem> {
  /** The rows, each with a stable `key`. */
  readonly items: readonly T[];
  /** The list's accessible name. */
  readonly label: string;
  /** An optional group header in the `label` type style ("Crew"). */
  readonly heading?: string;
  /** Controlled selection. Omit it (and use `defaultSelectedKey`) to let the List own it. */
  readonly selectedKey?: string | null;
  readonly defaultSelectedKey?: string | null;
  /** Called when the selection moves (keyboard, click or Enter). */
  readonly onSelect?: (item: T) => void;
  /** Called when a row is opened (Enter, Space or click). */
  readonly onOpen?: (item: T) => void;
  /** Render skeleton rows instead of the items. */
  readonly loading?: boolean;
  /** The kind of row the skeleton imitates, for its height. Defaults to `data`. */
  readonly skeletonKind?: ListRowKind;
  /** How many skeleton rows to show. Defaults to 3. */
  readonly skeletonRows?: number;
  /** Shown instead of the rows when `items` is empty (and not loading). */
  readonly emptyText?: string;
  readonly className?: string;
  /** Layout only (the scroll viewport's height); colour comes from List.css tokens. */
  readonly style?: CSSProperties;
}

interface Anchor {
  readonly key: string;
  /** The anchor row's top relative to the top of the List's viewport. */
  readonly top: number;
}

export function List<T extends ListItem>({
  items,
  label,
  heading,
  selectedKey,
  defaultSelectedKey = null,
  onSelect,
  onOpen,
  loading = false,
  skeletonKind = "data",
  skeletonRows = 3,
  emptyText,
  className,
  style,
}: ListProps<T>) {
  const headingId = useId();
  const idBase = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  /** The anchor first, then the first visible row as a fallback if the anchor row is removed. */
  const anchorRef = useRef<readonly Anchor[]>([]);
  const prevSelectedRef = useRef<string | null>(null);
  /** The row that holds focus, while focus is inside the listbox. */
  const focusedKeyRef = useRef<string | null>(null);
  /** The row keys in order at the last commit, to find a removed row's neighbours. */
  const prevKeysRef = useRef<readonly string[]>([]);

  const controlled = selectedKey !== undefined;
  const [innerSelected, setInnerSelected] = useState<string | null>(defaultSelectedKey);
  const current = controlled ? selectedKey : innerSelected;
  const selectedIndex = current === null ? -1 : items.findIndex((item) => item.key === current);
  // The one row Tab reaches: the selected row, else the first.
  const tabbableKey = selectedIndex >= 0 ? current : (items[0]?.key ?? null);

  const select = (item: T) => {
    if (!controlled) setInnerSelected(item.key);
    onSelect?.(item);
  };

  const measureAnchor = useCallback((): readonly Anchor[] => {
    const list = scrollRef.current;
    if (!list) return [];
    const view = list.getBoundingClientRect();
    const visible = (row: HTMLElement) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > view.top && rect.top < view.bottom;
    };
    const selectedRow = current === null ? undefined : rowRefs.current.get(current);
    // Rows are stacked in DOM order, so the first whose bottom is below the
    // viewport's top is found by binary search.
    const rows = listboxRef.current?.children;
    let firstVisible: HTMLElement | undefined;
    if (rows && rows.length > 0) {
      let lo = 0;
      let hi = rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const row = rows[mid];
        if (row && row.getBoundingClientRect().bottom > view.top) hi = mid;
        else lo = mid + 1;
      }
      const row = rows[lo];
      if (row instanceof HTMLElement && visible(row)) firstVisible = row;
    }
    const candidates = selectedRow && visible(selectedRow) ? [selectedRow, firstVisible] : [firstVisible];
    const anchors: Anchor[] = [];
    for (const row of candidates) {
      const key = row?.dataset.key;
      if (!row || key === undefined || anchors.some((anchor) => anchor.key === key)) continue;
      anchors.push({ key, top: row.getBoundingClientRect().top - view.top });
    }
    return anchors;
  }, [current]);

  // Runs after every commit, before paint.
  useLayoutEffect(() => {
    const list = scrollRef.current;
    if (!list) return;
    // 1. Scroll anchoring: keep the previous anchor row (or, if it was removed, the
    //    previous first visible row) where it was on screen.
    const anchor = anchorRef.current.find((candidate) => rowRefs.current.has(candidate.key));
    const anchorRow = anchor ? rowRefs.current.get(anchor.key) : undefined;
    if (anchor && anchorRow) {
      const top = anchorRow.getBoundingClientRect().top - list.getBoundingClientRect().top;
      const shift = top - anchor.top;
      if (shift !== 0) list.scrollTop += shift;
    }
    // 2. Focus follows a selection that moved while focus was inside the list.
    if (current !== prevSelectedRef.current) {
      prevSelectedRef.current = current;
      const row = current === null ? undefined : rowRefs.current.get(current);
      if (row && listboxRef.current?.contains(document.activeElement) && document.activeElement !== row) row.focus();
    }
    // 3. Focus never falls to <body>: if the focused row was removed, focus its
    //    nearest surviving neighbour by key, and select it when uncontrolled.
    const focusedKey = focusedKeyRef.current;
    if (focusedKey !== null && !rowRefs.current.has(focusedKey)) {
      focusedKeyRef.current = null;
      const lost = document.activeElement === null || document.activeElement === document.body;
      const targetKey = lost ? survivingNeighbour(prevKeysRef.current, focusedKey, (key) => rowRefs.current.has(key)) : undefined;
      const target = targetKey === undefined ? undefined : items.find((item) => item.key === targetKey);
      const row = targetKey === undefined ? undefined : rowRefs.current.get(targetKey);
      if (target && row) {
        // No scroll: the anchoring above already placed the rows; focusing must not move them.
        row.focus({ preventScroll: true });
        if (!controlled && target.key !== current) select(target);
      }
    }
    prevKeysRef.current = items.map((item) => item.key);
    // 4. Record the anchor for the next commit.
    anchorRef.current = measureAnchor();
  });

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    focusedKeyRef.current = (event.target as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset.key ?? null;
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    // A row removed while focused may blur on its way out; keep its key so the
    // layout effect can re-home focus.
    const key = focusedKeyRef.current;
    if (key !== null && !rowRefs.current.has(key)) return;
    focusedKeyRef.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Cmd/Ctrl/Alt chords belong to the app (Cmd+K is the palette).
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (items.length === 0) return;
    const step = (delta: number) => {
      const from = selectedIndex >= 0 ? selectedIndex : delta > 0 ? -1 : 0;
      const next = items[Math.min(items.length - 1, Math.max(0, from + delta))];
      event.preventDefault();
      if (next && next.key !== current) select(next);
    };
    switch (event.key) {
      case "j":
      case "ArrowDown":
        step(1);
        break;
      case "k":
      case "ArrowUp":
        step(-1);
        break;
      case "Enter":
      case " ": {
        const rowKey = (event.target as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset.key ?? current;
        const item = items.find((candidate) => candidate.key === rowKey);
        if (!item) return;
        event.preventDefault();
        if (item.key !== current) select(item);
        onOpen?.(item);
        break;
      }
      default:
        break;
    }
  };

  const setRowRef = (key: string) => (node: HTMLDivElement | null) => {
    if (node) rowRefs.current.set(key, node);
    else rowRefs.current.delete(key);
  };

  let body: ReactNode;
  if (loading) {
    body = (
      <div className="list-rows" aria-hidden="true">
        {Array.from({ length: Math.max(0, skeletonRows) }, (_, index) => (
          <div key={index} className="list-skeleton" data-kind={skeletonKind}>
            {skeletonKind === "nav" ? (
              <>
                <i className="list-skeleton-icon" />
                <i className="list-skeleton-bar" />
              </>
            ) : (
              <>
                <i className={skeletonKind === "crew" ? "list-skeleton-avatar" : "list-skeleton-dot"} />
                <span className="list-skeleton-lines">
                  <i className="list-skeleton-bar" />
                  <i className="list-skeleton-bar list-skeleton-bar-short" />
                </span>
                {skeletonKind === "data" ? <i className="list-skeleton-aside" /> : null}
              </>
            )}
          </div>
        ))}
      </div>
    );
  } else if (items.length === 0 && emptyText) {
    body = <p className="list-empty">{emptyText}</p>;
  } else {
    body = (
      <div ref={listboxRef} className="list-rows" role="listbox" aria-label={label} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={onBlur}>
        {items.map((item, index) => {
          const selected = item.key === current;
          const id = `${idBase}-${index}`;
          return (
            <div
              key={item.key}
              ref={setRowRef(item.key)}
              id={id}
              className="list-row"
              data-kind={item.kind}
              data-key={item.key}
              role="option"
              aria-selected={selected}
              aria-current={item.kind === "nav" && selected ? "page" : undefined}
              tabIndex={item.key === tabbableKey ? 0 : -1}
              onClick={() => {
                if (!selected) select(item);
                onOpen?.(item);
              }}
              {...rowContent(item, id)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={className ? `list ${className}` : "list"}
      style={style}
      aria-busy={loading ? true : undefined}
      onScroll={() => {
        anchorRef.current = measureAnchor();
      }}
    >
      {heading ? (
        <div className="list-heading" id={headingId}>
          {heading}
        </div>
      ) : null}
      {body}
    </div>
  );
}

/**
 * The key nearest to `removed` in the previous order that is still present:
 * the first one after it, else the last one before it. Chosen by key, never by
 * index, so rows inserted in the same update are never picked.
 */
function survivingNeighbour(previous: readonly string[], removed: string, present: (key: string) => boolean): string | undefined {
  const index = previous.indexOf(removed);
  if (index < 0) return undefined;
  for (let i = index + 1; i < previous.length; i++) {
    const key = previous[i];
    if (key !== undefined && present(key)) return key;
  }
  for (let i = index - 1; i >= 0; i--) {
    const key = previous[i];
    if (key !== undefined && present(key)) return key;
  }
  return undefined;
}

/** A row's children plus the ids that name and describe it. */
function rowContent(item: ListItem, id: string) {
  switch (item.kind) {
    case "nav":
      return {
        "aria-labelledby": item.count ? `${id}-label ${id}-count` : `${id}-label`,
        "aria-describedby": item.count || !item.kbd ? undefined : `${id}-kbd`,
        children: (
          <>
            {item.icon ? (
              <span className="list-icon" aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span className="list-label" id={`${id}-label`}>
              {item.label}
            </span>
            {item.count ? (
              <span className="list-end" id={`${id}-count`}>
                <CountPill count={item.count.value} aria-label={item.count.label} />
              </span>
            ) : item.kbd ? (
              <span className="list-end list-kbd" id={`${id}-kbd`}>
                {item.kbd}
              </span>
            ) : null}
          </>
        ),
      };
    case "data":
      return {
        "aria-labelledby": `${id}-subject`,
        "aria-describedby": [`${id}-status`, item.meta ? `${id}-meta` : "", item.aside ? `${id}-aside` : ""]
          .filter(Boolean)
          .join(" "),
        children: (
          <>
            <span className="list-status" id={`${id}-status`}>
              <StatusDot state={item.status} label={item.statusLabel} verified={item.verified} hideLabel />
            </span>
            <span className="list-text">
              <span className="list-subject" id={`${id}-subject`}>
                {item.subject}
              </span>
              {item.meta ? (
                <span className="list-meta" id={`${id}-meta`}>
                  {item.meta}
                </span>
              ) : null}
            </span>
            {item.aside ? (
              <span className="list-aside" id={`${id}-aside`}>
                {item.aside}
              </span>
            ) : null}
          </>
        ),
      };
    case "crew":
      return {
        "aria-labelledby": `${id}-name`,
        "aria-describedby":
          [item.unread ? `${id}-unread` : "", item.lastLine ? `${id}-last` : "", item.time ? `${id}-time` : ""]
            .filter(Boolean)
            .join(" ") || undefined,
        children: (
          <>
            <span className="list-avatar">{item.avatar}</span>
            <span className="list-text">
              <span className="list-crew-top">
                <span className="list-name" id={`${id}-name`}>
                  {item.name}
                </span>
                {item.unread ? <span className="list-unread" id={`${id}-unread`} role="img" aria-label="unread" /> : null}
                {item.time ? (
                  <span className="list-time" id={`${id}-time`}>
                    {item.time}
                  </span>
                ) : null}
              </span>
              {item.lastLine ? (
                <span className="list-meta" id={`${id}-last`}>
                  {item.lastLine}
                </span>
              ) : null}
            </span>
          </>
        ),
      };
  }
}
