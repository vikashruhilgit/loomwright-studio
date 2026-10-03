// The `STUDIO_AUTH_PROVIDER` override, in one place. A leaf module with no
// imports: the kernel (which loads the Agent SDK) and the launchd plist writer
// (which the CLI loads, and must not load the SDK) share this one check, so the
// plist carries the variable exactly when the kernel would honour it.

/** Selects the auth provider when `--auth-provider` is not given. */
export const AUTH_PROVIDER_ENV = "STUDIO_AUTH_PROVIDER";

/** The provider id `env` selects: its `STUDIO_AUTH_PROVIDER` unless unset, empty or whitespace. */
export function authProviderFromEnv(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const value = env[AUTH_PROVIDER_ENV];
  return value === undefined || value.trim() === "" ? undefined : value;
}
