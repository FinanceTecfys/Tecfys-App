import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type AuthIdentity, createGuards } from "@/lib/auth/guard";
import { LOCALE_COOKIE } from "@/i18n/config";
import { serverEnv } from "@/lib/env";
import { resolvePreferences, type UserPreferences } from "@/lib/theme";
import { readProfile } from "./profile";
import { db } from "./server";

/**
 * Supabase Auth client bound to this request's cookies, for Server Components,
 * Server Actions and route handlers. Auth only: the data layer stays on db().
 */
export async function authClient() {
  const env = serverEnv();
  const store = await cookies();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) store.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}

/** The signed-in user, from a verified JWT; null without a valid session. */
async function identity(): Promise<AuthIdentity | null> {
  const { data, error } = await (await authClient()).auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

// cache(): the layout, the page and its data functions share one lookup per request.
const cachedIdentity = cache(identity);
const cachedProfile = cache((userId: string) => readProfile(db(), userId));
const guards = createGuards({ identity: cachedIdentity, profile: cachedProfile, redirect });

/**
 * The language and theme mode of this request: the signed-in user's stored
 * preferences, and for the pages shown before signing in the language last
 * chosen on this browser (a plain cookie), else the defaults. Never redirects
 * and never denies - it only decides how the page is rendered - and shares the
 * guards' per-request lookups, so it costs no extra query.
 */
export async function currentPreferences(): Promise<UserPreferences> {
  const cookieLanguage = (await cookies()).get(LOCALE_COOKIE)?.value;
  const who = await cachedIdentity();
  const profile = who ? await cachedProfile(who.id) : null;
  return resolvePreferences(profile, cookieLanguage);
}

/**
 * Guards for every page, Server Action and route handler (logic and tests in
 * src/lib/auth/guard.ts). The proxy already gates each request; these are the
 * real gate, so a matcher change or a hidden button can never expose anything:
 *  - requireUser()            signed in with an active role
 *  - requireRole(capability)  ...and the role holds the capability
 *  - requireAnyRole(...roles) ...and the role is one of those listed
 * A denied call redirects (never returns), so nothing after it runs.
 */
export const { requireUser, requireRole, requireAnyRole } = guards;
export type { SessionUser } from "@/lib/auth/guard";
