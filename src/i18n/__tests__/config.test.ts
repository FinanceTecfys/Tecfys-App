import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, LOCALES, resolveLocale } from "../config";

describe("languages", () => {
  it("are Spanish (the base and the default) and English", () => {
    expect(LOCALES).toEqual(["es", "en"]);
    expect(DEFAULT_LOCALE).toBe("es");
    expect(LOCALE_COOKIE).toBe("tecfys_lang");
  });

  it("isLocale accepts the known codes only", () => {
    for (const l of LOCALES) expect(isLocale(l)).toBe(true);
    for (const bad of ["", "ES", "en-GB", "fr", "toString", "__proto__", null, undefined, 1, ["es"], { es: true }]) expect(isLocale(bad), String(bad)).toBe(false);
  });
});

describe("resolveLocale (user preference -> fallback)", () => {
  it("uses the signed-in user's stored preference", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("es")).toBe("es");
  });

  it("the user's preference wins over the browser's cookie", () => {
    expect(resolveLocale("es", "en")).toBe("es");
    expect(resolveLocale("en", "es")).toBe("en");
  });

  it("without a user (login, set-password) it is the language last chosen on this browser", () => {
    expect(resolveLocale(null, "en")).toBe("en");
    expect(resolveLocale(undefined, "en")).toBe("en");
  });

  it("falls back to Spanish when nothing usable is stored", () => {
    expect(resolveLocale(null)).toBe("es");
    expect(resolveLocale(undefined, undefined)).toBe("es");
    expect(resolveLocale("", "")).toBe("es");
  });

  it("skips a value it does not know instead of guessing: an unknown preference falls through to the cookie, then to Spanish", () => {
    expect(resolveLocale("fr", "en")).toBe("en");
    expect(resolveLocale("fr", "de")).toBe("es");
    expect(resolveLocale("EN")).toBe("es");
    expect(resolveLocale({ toString: () => "en" })).toBe("es");
    expect(resolveLocale("en-US", "en-US")).toBe("es");
  });
});
