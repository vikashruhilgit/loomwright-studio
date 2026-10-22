// The one D24 dollar shape, shared by Charter, ChatBubble and StreamingLog:
// "≈$2.40 at API rates" (with an optional unit suffix such as "/day"). A figure is
// only ever an estimate at API rates, never a budget or limit. A missing, non-finite
// or negative figure renders no estimate at all. Two decimals with thousands
// separators, never exponent form, so the same number always reads the same.

const USD = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "≈$1,234.50/day at API rates", or null when there is no showable estimate. */
export function formatEstimate(usd: number | undefined, suffix = ""): string | null {
  if (usd === undefined || !Number.isFinite(usd) || usd < 0) return null;
  // `+ 0` turns -0 into 0, which Intl would otherwise print as "-0.00".
  return `≈$${USD.format(usd + 0)}${suffix} at API rates`;
}
