import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import type { Role } from "@/lib/auth/permissions";
import { serverEnv } from "@/lib/env";
import type { Database } from "./database.types";
import { readProfile } from "./profile";

let profiles: SupabaseClient<Database> | null = null;

/** Service-role client for the role lookup only (profiles has no RLS policies). */
function profilesClient(): SupabaseClient<Database> {
  if (!profiles) {
    const env = serverEnv();
    profiles = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return profiles;
}

/**
 * Per-request Supabase Auth client for the proxy: reads the session cookies
 * from the request and writes refreshed ones to both the request (so the page
 * rendered next sees them) and the response (so the browser keeps them).
 *
 * Returns whether the request carries a valid session, the user's active role
 * (null with no profile or a deactivated one) and the response to continue with.
 */
export async function refreshSession(request: NextRequest): Promise<{ authenticated: boolean; role: Role | null; response: NextResponse }> {
  const env = serverEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // getClaims verifies the JWT (and refreshes an expired session through the cookies above).
  const { data, error } = await supabase.auth.getClaims();
  const userId = error ? undefined : data?.claims?.sub;
  if (!userId) return { authenticated: false, role: null, response };
  const profile = await readProfile(profilesClient(), userId);
  return { authenticated: true, role: profile?.active ? profile.role : null, response };
}

/** A redirect that keeps any cookie the session refresh just set. */
export function redirectWithCookies(request: NextRequest, from: NextResponse, location: string): NextResponse {
  const redirect = NextResponse.redirect(new URL(location, request.url));
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
