/** Every long-lived subscription token starts with this. */
export const SUBSCRIPTION_TOKEN_PREFIX = "sk-ant-oat01-";

/** A whole token is strictly longer than this (a 59-character cut-off failed with a 401). */
export const SUBSCRIPTION_TOKEN_MIN_EXCLUSIVE_LENGTH = 80;

/**
 * True when `value` is a whole subscription token: the right prefix, more than
 * 80 characters, and no whitespace anywhere (a leftover newline or an inner
 * space means the value was mangled when it was saved).
 */
export function isWholeToken(value: string): boolean {
  return (
    value.startsWith(SUBSCRIPTION_TOKEN_PREFIX) &&
    value.length > SUBSCRIPTION_TOKEN_MIN_EXCLUSIVE_LENGTH &&
    !/\s/.test(value)
  );
}

/**
 * True when `value` could be an API key: non-empty with no whitespace. No
 * published prefix rule is asserted for API keys.
 */
export function isPlausibleApiKey(value: string): boolean {
  return value.length > 0 && !/\s/.test(value);
}
