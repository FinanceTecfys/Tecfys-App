/**
 * Theme modes and the seam that applies them. Pure and unit-tested.
 *
 * The user's choice is stored in profiles.theme and reaches the page as the
 * `data-theme` attribute of <html> (documentAttributes below, set by the root
 * layout on the server). The palette itself lives in src/app/globals.css as
 * CSS custom properties.
 *
 * TODAY both modes render the green Tecfys palette: "blue" is persisted and
 * applied as data-theme="blue", but its token block in globals.css is empty,
 * so it inherits the green values. To implement the blue / white theme a later
 * branch must, and only needs to:
 *   1. fill the `[data-theme="blue"]` block in globals.css with the blue
 *      values of the --color-ink-* and --color-mint-* tokens (and
 *      color-scheme: light);
 *   2. replace the fixed Tailwind greys the components use for text on a dark
 *      surface (text-slate-*, text-white, border-slate-*) with tokens that the
 *      block can redefine - ink/mint already are tokens, the slate scale is not.
 * No component, action, migration or preference code changes for step 1.
 */
import { DEFAULT_LOCALE, type Locale, resolveLocale } from "@/i18n/config";

export const THEMES = ["green", "blue"] as const;
export type ThemeMode = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeMode = "green";

export const isTheme = (value: unknown): value is ThemeMode => typeof value === "string" && (THEMES as readonly string[]).includes(value);

/** The stored theme, or green for anything unknown or missing. */
export const resolveTheme = (stored: unknown): ThemeMode => (isTheme(stored) ? stored : DEFAULT_THEME);

export interface UserPreferences {
  language: Locale;
  theme: ThemeMode;
}

export const DEFAULT_PREFERENCES: UserPreferences = { language: DEFAULT_LOCALE, theme: DEFAULT_THEME };

/** Preferences as stored (possibly missing or stale values) -> valid preferences. */
export function resolvePreferences(stored: { language?: unknown; theme?: unknown } | null | undefined, cookieLanguage?: unknown): UserPreferences {
  return { language: resolveLocale(stored?.language, cookieLanguage), theme: resolveTheme(stored?.theme) };
}

/** The attributes of <html> that carry the preferences: the language and the theme seam. */
export function documentAttributes(preferences: UserPreferences): { lang: Locale; "data-theme": ThemeMode } {
  return { lang: preferences.language, "data-theme": preferences.theme };
}
