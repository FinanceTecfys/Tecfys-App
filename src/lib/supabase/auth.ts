import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { serverEnv } from "@/lib/env";

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

export interface SessionUser {
  id: string;
  email: string | null;
}

/** The signed-in user, from a verified JWT; null without a valid session. */
export async function currentUser(): Promise<SessionUser | null> {
  const { data, error } = await (await authClient()).auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

/**
 * Guard for every page, Server Action and route handler. The proxy already
 * gates each request; this is the second check the Next.js docs require,
 * so a matcher change can never silently expose one of them.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(LOGIN_PATH);
  return user;
}
