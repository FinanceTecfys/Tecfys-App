import { type NextRequest, NextResponse } from "next/server";
import { authDecision } from "@/lib/auth/routes";
import { redirectWithCookies, refreshSession } from "@/lib/supabase/session";

/**
 * Auth gate: every route except /login needs a valid Supabase session and a
 * role that may open it. Unauthenticated requests go to /login; a signed-in
 * user on /login goes into the app; a role hitting a route it cannot use goes
 * to its home page (a partner on /contracts or /settings lands on /scoring/new).
 * The decision itself is pure (src/lib/auth/routes.ts + permissions.ts), and
 * every page, action and route handler re-checks the role (requireRole).
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { authenticated, role, response } = await refreshSession(request);
  const decision = authDecision({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    authenticated,
    role,
  });
  return decision.action === "redirect" ? redirectWithCookies(request, response, decision.location) : response;
}

export const config = {
  // Everything but Next's own assets and static images (logo, favicon).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
