"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { LOCALE_COOKIE } from "@/i18n/config";
import { requireRole } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import { preferencesSchema } from "./domain/preferences";

export type PreferencesResult = { ok: true } | { ok: false; error: string };

/**
 * Save the signed-in user's own language and theme mode on their profile.
 * Every role may do it, and only ever for itself: the row written is the one
 * of the session's user, whatever the request carries. The language is also
 * left in a cookie so the pages shown before signing in (login) use it.
 */
export async function updatePreferences(input: { language: string; theme: string }): Promise<PreferencesResult> {
  const user = await requireRole("preferences.manage");
  const t = await getTranslations("preferences.errors");
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalid") };

  const { data, error } = await db()
    .from("profiles")
    .update({ language: parsed.data.language, theme: parsed.data.theme })
    .eq("user_id", user.id)
    .select("user_id");
  if (error || data.length === 0) return { ok: false, error: t("notSaved") };

  (await cookies()).set(LOCALE_COOKIE, parsed.data.language, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  // Every page is rendered in the user's language and theme: all of them are stale now.
  revalidatePath("/", "layout");
  return { ok: true };
}
