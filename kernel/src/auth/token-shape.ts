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

/** Every Anthropic key, API or subscription, starts with this. */
export const ANTHROPIC_KEY_PREFIX = "sk-ant-";

/** A whole API key is strictly longer than this (the same bound as a subscription token; a real key read 106). */
export const API_KEY_MIN_EXCLUSIVE_LENGTH = 80;

/**
 * True when `value` is a whole API key as the owner enters it in Settings (D42):
 * the `sk-ant-` prefix, more than 80 characters, no whitespace, and not a
 * subscription token (`sk-ant-oat…`), which Studio never stores from the app
 * (D27, D29). `docs/OPEN_QUESTIONS.md` asked for this at the in-app entry: the
 * read-time check below accepts any whitespace-free value, so a truncated or
 * garbled paste would otherwise read back `ok` and fail only in a session.
 */
export function isWholeApiKey(value: string): boolean {
  return (
    value.startsWith(ANTHROPIC_KEY_PREFIX) &&
    !value.startsWith(SUBSCRIPTION_TOKEN_PREFIX) &&
    value.length > API_KEY_MIN_EXCLUSIVE_LENGTH &&
    !/\s/.test(value)
  );
}

/**
 * True when `value` could be an API key: non-empty with no whitespace. The
 * provider's read check, kept loose so a key the owner placed in the Keychain by
 * hand is still read; the in-app entry uses `isWholeApiKey`.
 */
export function isPlausibleApiKey(value: string): boolean {
  return value.length > 0 && !/\s/.test(value);
}
