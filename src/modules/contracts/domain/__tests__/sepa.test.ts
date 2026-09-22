import { describe, expect, it } from "vitest";
import { bicMatchesIbanCountry, deriveBic, formatIban, isValidBic, validateIban } from "../sepa";

// ES9121000418450200051332 is the Banco de España / ECBS reference Spanish IBAN.
const ES = "ES9121000418450200051332";

describe("validateIban", () => {
  it("accepts valid IBANs, ignoring spaces and case", () => {
    expect(validateIban(ES)).toEqual({ ok: true, iban: ES });
    expect(validateIban("es91 2100 0418 4502 0005 1332")).toEqual({ ok: true, iban: ES });
    expect(validateIban("DE89370400440532013000").ok).toBe(true);
    expect(validateIban("GB29NWBK60161331926819").ok).toBe(true);
    expect(validateIban("FR1420041010050500013M02606").ok).toBe(true);
  });

  it("rejects a single-digit typo (mod-97)", () => {
    expect(validateIban("ES9121000418450200051333")).toEqual({ ok: false, error: "checksum" });
  });

  it("rejects wrong length, unknown country and garbage", () => {
    expect(validateIban("ES91210004184502000513")).toEqual({ ok: false, error: "length" });
    expect(validateIban("US12345678901234567890")).toEqual({ ok: false, error: "country" });
    expect(validateIban("hola")).toEqual({ ok: false, error: "format" });
    expect(validateIban("  ")).toEqual({ ok: false, error: "empty" });
  });

  it("checks the Spanish CCC control digits even when mod-97 passes", () => {
    // Same BBAN with CCC digits 45 -> 46, IBAN check digits recomputed so mod-97 is valid.
    const bban = "21000418460200051332";
    const check = 98 - Number(BigInt(`${bban}142800`) % BigInt(97));
    const tampered = `ES${String(check).padStart(2, "0")}${bban}`;
    expect(validateIban(tampered)).toEqual({ ok: false, error: "national_check" });
  });
});

describe("BIC", () => {
  it("derives the BIC of known Spanish entities", () => {
    expect(deriveBic(ES)).toBe("CAIXESBBXXX");
    expect(deriveBic("ES7620770024003102575766")).toBeNull(); // entity not in the table
    expect(deriveBic("DE89370400440532013000")).toBeNull();
  });

  it("validates the ISO 9362 format", () => {
    expect(isValidBic("CAIXESBBXXX")).toBe(true);
    expect(isValidBic("caixesbb")).toBe(true);
    expect(isValidBic("CAIX1SBB")).toBe(false);
    expect(isValidBic("CAIXESBBXX")).toBe(false);
  });

  it("flags a BIC from another country", () => {
    expect(bicMatchesIbanCountry("CAIXESBBXXX", ES)).toBe(true);
    expect(bicMatchesIbanCountry("DEUTDEFFXXX", ES)).toBe(false);
  });
});

it("formats in groups of four", () => {
  expect(formatIban("es9121000418450200051332")).toBe("ES91 2100 0418 4502 0005 1332");
});
