import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";

/**
 * Per-request Supabase Auth client for the proxy: reads the session cookies
 * from the request and writes refreshed ones to both the request (so the page
 * rendered next sees them) and the response (so the browser keeps them).
 *
 * Returns whether the request carries a valid session and the response to
 * continue with. Auth only: table access keeps going through db().
 */
export async function refreshSession(request: NextRequest): Promise<{ authenticated: boolean; response: NextResponse }> {
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
  return { authenticated: !error && Boolean(data?.claims?.sub), response };
}

/** A redirect that keeps any cookie the session refresh just set. */
export function redirectWithCookies(request: NextRequest, from: NextResponse, location: string): NextResponse {
  const redirect = NextResponse.redirect(new URL(location, request.url));
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
