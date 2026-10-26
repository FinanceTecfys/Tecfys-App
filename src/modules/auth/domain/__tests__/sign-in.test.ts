import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { SIGN_IN_ERRORS, signInErrorKey, signInSchema } from "../sign-in";

describe("signInErrorKey", () => {
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
    for (const e of credentialFailures) expect(signInErrorKey(e), JSON.stringify(e)).toBe("invalid");
  });

  it("tells rate limiting and outages apart (neither says anything about the account)", () => {
    expect(signInErrorKey({ status: 429 })).toBe("rateLimited");
    expect(signInErrorKey({ status: 400, code: "over_request_rate_limit" })).toBe("rateLimited");
    expect(signInErrorKey({ status: 500 })).toBe("unavailable");
    expect(signInErrorKey({ status: 503 })).toBe("unavailable");
  });

  it("every error it can return has a message in both languages, and the wording is unchanged in Spanish", () => {
    expect(Object.keys(es.auth.login.errors).sort()).toEqual([...SIGN_IN_ERRORS].sort());
    expect(Object.keys(en.auth.login.errors).sort()).toEqual([...SIGN_IN_ERRORS].sort());
    expect(es.auth.login.errors).toEqual({
      invalid: "Email o contraseña incorrectos.",
      rateLimited: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
      unavailable: "No se pudo iniciar sesión. Inténtalo de nuevo más tarde.",
    });
    // The single credential message names no reason in either language.
    for (const m of [es.auth.login.errors.invalid, en.auth.login.errors.invalid]) expect(m).not.toMatch(/exist|registr|bloque|banned|confirm/i);
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
