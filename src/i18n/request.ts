import { getRequestConfig } from "next-intl/server";
import { currentPreferences } from "@/lib/supabase/auth";

/**
 * next-intl's per-request configuration, without locale routing: the language
 * is not in the URL, it is the signed-in user's stored preference (see
 * resolveLocale). It is resolved here, on the server, so the first render is
 * already in the right language - Server Components, client components (through
 * NextIntlClientProvider in the root layout) and Server Actions alike.
 *
 * Numbers, currency and dates are NOT taken from this locale: they stay es-ES
 * in every language (src/lib/format.ts).
 */
export default getRequestConfig(async () => {
  const { language } = await currentPreferences();
  return {
    locale: language,
    messages: (await import(`./messages/${language}.json`)).default,
    timeZone: "Europe/Madrid",
  };
});
