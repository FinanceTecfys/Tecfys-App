/**
 * The two Supabase Auth switches that are easy to confuse, read from
 * supabase/config.toml (a minimal reader: `key = value` under a `[section]`).
 *
 *  - `[auth] enable_signup`       public sign-up. Must be false.
 *  - `[auth.email] enable_signup` the email PROVIDER. Must be true, otherwise
 *                                 email + password login is disabled as well.
 */

/** Raw value of `key` directly under `[section]` (not in a sub-table). */
export function tomlValue(text: string, section: string, key: string): string | undefined {
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) current = header[1];
    else if (current === section) {
      const kv = line.match(/^([\w-]+)\s*=\s*(.+?)\s*$/);
      if (kv && kv[1] === key) return kv[2];
    }
  }
  return undefined;
}

export interface AuthSwitches {
  /** GoTrue DISABLE_SIGNUP: no public registration. */
  signupDisabled: boolean;
  /** GoTrue EXTERNAL_EMAIL_ENABLED: email + password login works. */
  emailProviderEnabled: boolean;
}

export function authSwitchesFromConfig(text: string): AuthSwitches {
  return {
    signupDisabled: tomlValue(text, "auth", "enable_signup") === "false",
    emailProviderEnabled: tomlValue(text, "auth.email", "enable_signup") === "true",
  };
}

/** The same switches as the running GoTrue reports them (GET /auth/v1/settings). */
export function authSwitchesFromSettings(settings: { disable_signup?: boolean; external?: { email?: boolean } }): AuthSwitches {
  return {
    signupDisabled: settings.disable_signup === true,
    emailProviderEnabled: settings.external?.email === true,
  };
}

/** What this app needs: closed sign-up, working email login. */
export const REQUIRED_AUTH_SWITCHES: AuthSwitches = { signupDisabled: true, emailProviderEnabled: true };
