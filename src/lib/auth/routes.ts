/**
 * The auth gate's decisions, pure so they are unit-tested: which paths are
 * public, where an unauthenticated request goes, and where a login returns to.
 *
 * Everything is private except the login screen, and each private path needs
 * the role its capability asks for (permissions.ts). Static assets never reach
 * this logic: the proxy matcher excludes them.
 */
import { canAccessPath, homePathFor, type Role } from "./permissions";

export const LOGIN_PATH = "/login";
export const HOME_PATH = "/";
/** Signed in, but with no active role in the app: back to the login screen with a notice. */
export const NO_ACCESS_ERROR = "no-access";
export const NO_ACCESS_PATH = `${LOGIN_PATH}?error=${NO_ACCESS_ERROR}`;

/** The only page reachable without a session. */
export const isPublicPath = (pathname: string): boolean => pathname === LOGIN_PATH || pathname === `${LOGIN_PATH}/`;

const ORIGIN = "http://tecfys.invalid";

/**
 * Sanitise the post-login destination: a same-origin path only, never the
 * login page itself. Anything else (absolute or protocol-relative URLs,
 * backslash tricks, garbage) lands on the dashboard - no open redirect.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return HOME_PATH;
  let url: URL;
  try {
    url = new URL(raw, ORIGIN);
  } catch {
    return HOME_PATH;
  }
  if (url.origin !== ORIGIN || isPublicPath(url.pathname)) return HOME_PATH;
  return `${url.pathname}${url.search}`;
}

/** /login, remembering where the user was going (not for the dashboard itself). */
export function loginRedirectPath(pathname: string, search = ""): string {
  const target = safeNextPath(`${pathname}${search}`);
  return target === HOME_PATH ? LOGIN_PATH : `${LOGIN_PATH}?${new URLSearchParams({ next: target })}`;
}

/** Where a role goes after login: the sanitised `next` if the role may open it, else its home. */
export function landingPath(role: Role, rawNext: string | null | undefined): string {
  const target = safeNextPath(rawNext);
  const pathname = target.split("?")[0];
  return rawNext && canAccessPath(role, pathname) ? target : homePathFor(role);
}

export type AuthDecision = { action: "next" } | { action: "redirect"; location: string };

/**
 * What the proxy does with a request. `role` is the signed-in user's active
 * role, null when it has none (no profile, or deactivated).
 *  - private path, no session         -> /login?next=<path>
 *  - private path, session, no role   -> /login?error=no-access
 *  - private path the role cannot use -> the role's home page
 *  - /login with a session and a role -> into the app (the sanitised `next`)
 *  - otherwise                        -> let it through
 */
export function authDecision({
  pathname,
  search,
  authenticated,
  role,
}: {
  pathname: string;
  search: string;
  authenticated: boolean;
  role: Role | null;
}): AuthDecision {
  if (isPublicPath(pathname)) {
    if (!authenticated || !role) return { action: "next" };
    return { action: "redirect", location: landingPath(role, new URLSearchParams(search).get("next")) };
  }
  if (!authenticated) return { action: "redirect", location: loginRedirectPath(pathname, search) };
  if (!role) return { action: "redirect", location: NO_ACCESS_PATH };
  if (!canAccessPath(role, pathname)) return { action: "redirect", location: homePathFor(role) };
  return { action: "next" };
}
