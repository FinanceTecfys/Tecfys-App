/**
 * The languages of the app and how the active one is chosen. Pure, so the
 * resolution is unit-tested and shared by the request config, the guards and
 * the preferences form.
 *
 * Spanish is the base language: every message is written in es.json first and
 * en.json translates it (a test fails if the two ever differ in keys).
 *
 * Adding a language: add its code here and to the check constraint of
 * profiles.language (a migration), create src/i18n/messages/<code>.json with
 * every key of es.json, and add its name under preferences.languages in each
 * message file. Nothing else in the app names a language.
 */

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

/** Remembers the last language chosen on this browser, for the pages shown before signing in. */
export const LOCALE_COOKIE = "tecfys_lang";

export const isLocale = (value: unknown): value is Locale => typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/**
 * The active language: the signed-in user's stored preference; without a user
 * (login, set-password) the language last chosen on this browser; otherwise
 * Spanish. Anything that is not a known language is skipped, never guessed.
 */
export function resolveLocale(profileLanguage: unknown, cookieLanguage?: unknown): Locale {
  if (isLocale(profileLanguage)) return profileLanguage;
  if (isLocale(cookieLanguage)) return cookieLanguage;
  return DEFAULT_LOCALE;
}
