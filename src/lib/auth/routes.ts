/**
 * The auth gate's decisions, pure so they are unit-tested: which paths are
 * public, where an unauthenticated request goes, and where a login returns to.
 *
 * Everything is private except the login screen. Static assets never reach
 * this logic: the proxy matcher excludes them.
 */

export const LOGIN_PATH = "/login";
export const HOME_PATH = "/";

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

export type AuthDecision = { action: "next" } | { action: "redirect"; location: string };

/**
 * What the proxy does with a request:
 *  - private path, no session       -> /login?next=<path>
 *  - /login with a session          -> into the app (the sanitised `next`)
 *  - otherwise                      -> let it through
 */
export function authDecision({ pathname, search, authenticated }: { pathname: string; search: string; authenticated: boolean }): AuthDecision {
  if (isPublicPath(pathname)) {
    if (!authenticated) return { action: "next" };
    return { action: "redirect", location: safeNextPath(new URLSearchParams(search).get("next")) };
  }
  if (authenticated) return { action: "next" };
  return { action: "redirect", location: loginRedirectPath(pathname, search) };
}
