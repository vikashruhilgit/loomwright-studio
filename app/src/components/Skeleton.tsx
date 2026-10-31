// Skeleton: four placeholder rows while a read is in flight. The component carries no CSS of its
// own; the caller passes its screen's class prefix and styles `<prefix>-skels`, `<prefix>-skel`
// and `<prefix>-sr-only` (the status text for assistive tech).

export interface SkeletonProps {
  readonly testId: string;
  /** The status text's object ("Loading usage"). */
  readonly what: string;
  /** The screen's class prefix, for example `budget`. */
  readonly prefix: string;
}

export function Skeleton({ testId, what, prefix }: SkeletonProps) {
  return (
    <div className={`${prefix}-skels`} data-testid={testId} aria-busy="true">
      <span className={`${prefix}-sr-only`} role="status">
        {`Loading ${what}`}
      </span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`${prefix}-skel`} aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}
