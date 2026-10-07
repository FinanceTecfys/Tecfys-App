/**
 * The user's own preferences as the form sends them: one of the app's
 * languages and one of its theme modes. Pure; the server action re-applies it.
 */
import { z } from "zod";
import { LOCALES } from "@/i18n/config";
import { THEMES } from "@/lib/theme";

export const preferencesSchema = z.object({
  language: z.enum(LOCALES),
  theme: z.enum(THEMES),
});

export type PreferencesInput = z.input<typeof preferencesSchema>;
