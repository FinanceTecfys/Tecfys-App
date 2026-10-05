import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type AuthIdentity, createGuards } from "@/lib/auth/guard";
import { serverEnv } from "@/lib/env";
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
const guards = createGuards({
  identity: cache(identity),
  profile: cache((userId: string) => readProfile(db(), userId)),
  redirect,
});

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
