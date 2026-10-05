import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  parsePasswordLink,
  passwordLinkPath,
  SET_PASSWORD_MESSAGES,
  setPasswordSchema,
  setPasswordStep,
  updateErrorMessage,
  verifyErrorMessage,
} from "../set-password";

// The shape Supabase Auth emails: a hex SHA-224, sometimes with a "pkce_" prefix.
const HASH = "3f9a1c0b7d2e4f6a8b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c";
const GOOD = "una-clave-bien-larga";

describe("parsePasswordLink", () => {
  it("reads the token and the type from the page URL", () => {
    expect(parsePasswordLink({ token_hash: HASH, type: "invite" })).toEqual({ tokenHash: HASH, type: "invite" });
    expect(parsePasswordLink({ token_hash: `pkce_${HASH}`, type: "recovery" })).toEqual({ tokenHash: `pkce_${HASH}`, type: "recovery" });
  });

  it("rejects a missing, repeated or malformed token and any other link type", () => {
    for (const params of [
      {},
      { token_hash: HASH },
      { type: "invite" },
      { token_hash: "", type: "invite" },
      { token_hash: "short", type: "invite" },
      { token_hash: `${HASH}<script>`, type: "invite" },
      { token_hash: `${HASH}&type=recovery`, type: "invite" },
      { token_hash: [HASH, HASH], type: "invite" },
      { token_hash: HASH, type: ["invite", "recovery"] },
      { token_hash: HASH, type: "signup" },
      { token_hash: HASH, type: "magiclink" },
      { token_hash: HASH, type: "email_change" },
      { token_hash: "x".repeat(300), type: "invite" },
    ]) {
      expect(parsePasswordLink(params), JSON.stringify(params)).toBeNull();
    }
  });

  it("round-trips with the link the email carries", () => {
    for (const type of ["invite", "recovery"] as const) {
      const href = passwordLinkPath({ tokenHash: HASH, type });
      expect(href).toBe(`/auth/set-password?token_hash=${HASH}&type=${type}`);
      const url = new URL(href, "http://tecfys.invalid");
      expect(parsePasswordLink(Object.fromEntries(url.searchParams))).toEqual({ tokenHash: HASH, type });
    }
  });
});

describe("setPasswordSchema", () => {
  const form = (over: Record<string, string> = {}) => ({ token_hash: HASH, type: "invite", password: GOOD, confirm: GOOD, ...over });
  const firstError = (input: Record<string, string>) => {
    const r = setPasswordSchema.safeParse(input);
    return r.success ? null : r.error.issues[0].message;
  };

  it("accepts a link with a long enough, matching password", () => {
    expect(firstError(form())).toBeNull();
    expect(firstError(form({ type: "recovery" }))).toBeNull();
    expect(firstError(form({ password: "x".repeat(MIN_PASSWORD_LENGTH), confirm: "x".repeat(MIN_PASSWORD_LENGTH) }))).toBeNull();
  });

  it("rejects a short, too long or mismatched password before any token is spent", () => {
    expect(firstError(form({ password: "corta", confirm: "corta" }))).toBe(SET_PASSWORD_MESSAGES.tooShort);
    expect(firstError(form({ password: "x".repeat(MIN_PASSWORD_LENGTH - 1), confirm: "x".repeat(MIN_PASSWORD_LENGTH - 1) }))).toBe(SET_PASSWORD_MESSAGES.tooShort);
    expect(firstError(form({ password: "x".repeat(73), confirm: "x".repeat(73) }))).toBe(SET_PASSWORD_MESSAGES.tooLong);
    expect(firstError(form({ confirm: `${GOOD}!` }))).toBe(SET_PASSWORD_MESSAGES.mismatch);
  });

  it("needs the token unless a previous attempt already verified it", () => {
    expect(firstError({ password: GOOD, confirm: GOOD })).toBe(SET_PASSWORD_MESSAGES.invalidLink);
    expect(firstError({ type: "invite", password: GOOD, confirm: GOOD })).toBe(SET_PASSWORD_MESSAGES.invalidLink);
    expect(firstError({ token_hash: HASH, password: GOOD, confirm: GOOD })).toBe(SET_PASSWORD_MESSAGES.invalidLink);
    expect(firstError({ verified: "1", password: GOOD, confirm: GOOD })).toBeNull();
  });

  it("rejects a malformed token, an unknown type and a forged verified flag", () => {
    expect(setPasswordSchema.safeParse(form({ token_hash: "nope" })).success).toBe(false);
    expect(setPasswordSchema.safeParse(form({ type: "signup" })).success).toBe(false);
    expect(setPasswordSchema.safeParse(form({ verified: "true" })).success).toBe(false);
  });
});

describe("setPasswordStep", () => {
  it("verifies the emailed token on the first submit", () => {
    expect(setPasswordStep({ token_hash: HASH, type: "invite" })).toEqual({ step: "verify", link: { tokenHash: HASH, type: "invite" } });
    expect(setPasswordStep({ token_hash: HASH, type: "recovery" })).toEqual({ step: "verify", link: { tokenHash: HASH, type: "recovery" } });
  });

  it("does not spend the token twice: a retry after a rejected password uses the open session", () => {
    expect(setPasswordStep({ token_hash: HASH, type: "invite", verified: "1" })).toEqual({ step: "session" });
    expect(setPasswordStep({ verified: "1" })).toEqual({ step: "session" });
  });
});

describe("error messages", () => {
  it("a token that cannot be verified reads the same whatever the reason", () => {
    for (const e of [{ status: 403, code: "otp_expired" }, { status: 400, code: "validation_failed" }, { status: 404, code: "user_not_found" }, {}]) {
      expect(verifyErrorMessage(e), JSON.stringify(e)).toBe(SET_PASSWORD_MESSAGES.invalidLink);
    }
    expect(verifyErrorMessage({ status: 429 })).toBe(SET_PASSWORD_MESSAGES.rateLimited);
    expect(verifyErrorMessage({ code: "over_request_rate_limit" })).toBe(SET_PASSWORD_MESSAGES.rateLimited);
    expect(verifyErrorMessage({ status: 503 })).toBe(SET_PASSWORD_MESSAGES.unavailable);
  });

  it("explains a password Supabase rejects", () => {
    expect(updateErrorMessage({ status: 422, code: "weak_password" })).toBe(SET_PASSWORD_MESSAGES.weak);
    expect(updateErrorMessage({ status: 429 })).toBe(SET_PASSWORD_MESSAGES.rateLimited);
    expect(updateErrorMessage({ status: 500 })).toBe(SET_PASSWORD_MESSAGES.unavailable);
    expect(updateErrorMessage({})).toBe(SET_PASSWORD_MESSAGES.unavailable);
  });
});
