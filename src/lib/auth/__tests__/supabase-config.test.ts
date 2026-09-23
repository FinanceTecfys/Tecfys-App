/**
 * Guards supabase/config.toml against the misconfiguration that once shipped:
 * `[auth.email] enable_signup = false` looks like "no public sign-up" but
 * disables the whole email provider, so email + password login fails
 * ("Email logins are disabled"). Public sign-up is closed by `[auth]`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { authSwitchesFromConfig, authSwitchesFromSettings, REQUIRED_AUTH_SWITCHES, tomlValue } from "../supabase-config";

const CONFIG = path.join(__dirname, "..", "..", "..", "..", "supabase", "config.toml");
const bytes = readFileSync(CONFIG);
const text = bytes.toString("utf8");

describe("supabase/config.toml auth settings", () => {
  it("closes public sign-up and keeps the email provider (login) on", () => {
    expect(tomlValue(text, "auth", "enable_signup")).toBe("false");
    expect(tomlValue(text, "auth.email", "enable_signup")).toBe("true");
    expect(authSwitchesFromConfig(text)).toEqual(REQUIRED_AUTH_SWITCHES);
  });

  it("requires no email confirmation, so admin-created users can log in locally", () => {
    expect(tomlValue(text, "auth.email", "enable_confirmations")).toBe("false");
  });

  it("is UTF-8 without a BOM and without mojibake", () => {
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(text).not.toContain("�");
    // "—" saved through Windows-1252 and back turns into "â€”".
    expect(text).not.toMatch(/â€|Ã./);
  });
});

describe("auth switch readers", () => {
  const toml = (auth: string, email: string) =>
    `[auth]\nenabled = true\nenable_signup = ${auth}\n\n[auth.rate_limit]\nenable_signup = true\n\n[auth.email]\nenable_signup = ${email}\n\n[auth.sms]\nenable_signup = false\n`;

  it("reads each flag from its own section, not a neighbouring one", () => {
    expect(tomlValue(toml("false", "true"), "auth", "enable_signup")).toBe("false");
    expect(tomlValue(toml("false", "true"), "auth.email", "enable_signup")).toBe("true");
    expect(tomlValue(toml("false", "true"), "auth.sms", "enable_signup")).toBe("false");
    expect(tomlValue(toml("false", "true"), "auth", "missing")).toBeUndefined();
    expect(tomlValue("[auth]\r\nenable_signup = false\r\n", "auth", "enable_signup")).toBe("false");
  });

  it("flags the shipped bug: email provider off means no login", () => {
    expect(authSwitchesFromConfig(toml("false", "false"))).toEqual({ signupDisabled: true, emailProviderEnabled: false });
    expect(authSwitchesFromConfig(toml("true", "true"))).toEqual({ signupDisabled: false, emailProviderEnabled: true });
  });

  it("maps GoTrue's /settings the same way, so a stale running stack is detectable", () => {
    expect(authSwitchesFromSettings({ disable_signup: true, external: { email: true } })).toEqual(REQUIRED_AUTH_SWITCHES);
    expect(authSwitchesFromSettings({ disable_signup: true, external: { email: false } }).emailProviderEnabled).toBe(false);
    expect(authSwitchesFromSettings({})).toEqual({ signupDisabled: false, emailProviderEnabled: false });
  });
});
