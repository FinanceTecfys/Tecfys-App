/**
 * The auth gate's decisions, pure so they are unit-tested: which paths are
 * public, where an unauthenticated request goes, and where a login returns to.
 *
 * Everything is private except the login screen and the set-password page an
 * emailed invitation links to, and each private path needs
 * the role its capability asks for (permissions.ts). Static assets never reach
 * this logic: the proxy matcher excludes them.
 */
import { canAccessPath, homePathFor, type Role } from "./permissions";

export const LOGIN_PATH = "/login";
export const HOME_PATH = "/";
/** Signed in, but with no active role in the app: back to the login screen with a notice. */
export const NO_ACCESS_ERROR = "no-access";
export const NO_ACCESS_PATH = `${LOGIN_PATH}?error=${NO_ACCESS_ERROR}`;

/** Where an invitation (or recovery) email lands: the user sets a password there, with no session yet. */
export const SET_PASSWORD_PATH = "/auth/set-password";

const PUBLIC_PATHS: readonly string[] = [LOGIN_PATH, SET_PASSWORD_PATH];
const withoutTrailingSlash = (pathname: string) => (pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname);

/** The only pages reachable without a session. */
export const isPublicPath = (pathname: string): boolean => PUBLIC_PATHS.includes(withoutTrailingSlash(pathname));

/** The set-password page opened from an emailed link (it carries the token). */
const isPasswordLink = (pathname: string, search: string): boolean =>
  withoutTrailingSlash(pathname) === SET_PASSWORD_PATH && new URLSearchParams(search).has("token_hash");

const ORIGIN = "http://tecfys.invalid";

/**
 * Sanitise the post-login destination: a same-origin path only, never a
 * public page (login, set-password). Anything else (absolute or protocol-relative URLs,
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
 *  - an emailed set-password link     -> always shown: whoever is signed in on this
 *                                        browser, the link's owner may use it
 *  - public page, session and a role  -> into the app (the sanitised `next`)
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
    if (!authenticated || !role || isPasswordLink(pathname, search)) return { action: "next" };
    return { action: "redirect", location: landingPath(role, new URLSearchParams(search).get("next")) };
  }
  if (!authenticated) return { action: "redirect", location: loginRedirectPath(pathname, search) };
  if (!role) return { action: "redirect", location: NO_ACCESS_PATH };
  if (!canAccessPath(role, pathname)) return { action: "redirect", location: homePathFor(role) };
  return { action: "next" };
}
