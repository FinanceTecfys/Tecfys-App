import { describe, expect, it } from "vitest";
import { SIGN_IN_MESSAGES, signInErrorMessage, signInSchema } from "../sign-in";

describe("signInErrorMessage", () => {
  it("never reveals whether the account exists: every credential failure reads the same", () => {
    const credentialFailures = [
      { status: 400, code: "invalid_credentials" },
      { status: 400, code: "email_not_confirmed" },
      { status: 400, code: "user_not_found" },
      { status: 403, code: "user_banned" },
      { status: 422, code: "validation_failed" },
      {},
      null,
      undefined,
    ];
    for (const e of credentialFailures) expect(signInErrorMessage(e), JSON.stringify(e)).toBe(SIGN_IN_MESSAGES.invalid);
  });

  it("tells rate limiting and outages apart (neither says anything about the account)", () => {
    expect(signInErrorMessage({ status: 429 })).toBe(SIGN_IN_MESSAGES.rateLimited);
    expect(signInErrorMessage({ status: 400, code: "over_request_rate_limit" })).toBe(SIGN_IN_MESSAGES.rateLimited);
    expect(signInErrorMessage({ status: 500 })).toBe(SIGN_IN_MESSAGES.unavailable);
    expect(signInErrorMessage({ status: 503 })).toBe(SIGN_IN_MESSAGES.unavailable);
  });
});

describe("signInSchema", () => {
  it("accepts an email (trimmed) and a password, with an optional next", () => {
    expect(signInSchema.parse({ email: "  ana@tecfys.com ", password: "x" })).toEqual({ email: "ana@tecfys.com", password: "x" });
    expect(signInSchema.parse({ email: "ana@tecfys.com", password: "x", next: "/contracts" }).next).toBe("/contracts");
  });

  it("rejects a missing password or a malformed email", () => {
    expect(signInSchema.safeParse({ email: "ana@tecfys.com", password: "" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "ana", password: "x" }).success).toBe(false);
    expect(signInSchema.safeParse({ password: "x" }).success).toBe(false);
  });
});
