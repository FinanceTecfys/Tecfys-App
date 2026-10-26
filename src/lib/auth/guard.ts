/**
 * The server-side role guards, with their dependencies injected so they are
 * unit-tested without Next or Supabase. src/lib/supabase/auth.ts wires them to
 * the real session, the profiles table and next/navigation's redirect.
 *
 * A guard either returns the user or redirects (redirect never returns): a
 * denied page, Server Action or route handler never runs past it.
 */
import { can, type Capability, homePathFor, type Role } from "./permissions";
import type { Locale } from "@/i18n/config";
import { resolvePreferences, type ThemeMode } from "@/lib/theme";
import { LOGIN_PATH, NO_ACCESS_PATH } from "./routes";

export interface AuthIdentity {
  id: string;
  email: string | null;
}

export interface UserProfile {
  role: Role;
  partnerDistributorId: string | null;
  active: boolean;
  /** Stored preferences (profiles.language / profiles.theme); validated when the user is built. */
  language?: string | null;
  theme?: string | null;
}

export interface SessionUser extends AuthIdentity {
  role: Role;
  partnerDistributorId: string | null;
  /** The user's interface language; Spanish unless the profile stores another known one. */
  language: Locale;
  /** The user's theme mode; green unless the profile stores another known one. */
  theme: ThemeMode;
}

export interface GuardDeps {
  /** The signed-in user from a verified session; null without one. */
  identity(): Promise<AuthIdentity | null>;
  /** The user's app profile; null when it has none. */
  profile(userId: string): Promise<UserProfile | null>;
  /** Must not return (next/navigation's redirect throws). */
  redirect(path: string): never;
}

export function createGuards(deps: GuardDeps) {
  /** Signed in AND holding an active role. No session -> /login; no role -> /login with a notice. */
  async function requireUser(): Promise<SessionUser> {
    const identity = await deps.identity();
    if (!identity) return deps.redirect(LOGIN_PATH);
    const profile = await deps.profile(identity.id);
    if (!profile?.active) return deps.redirect(NO_ACCESS_PATH);
    return { ...identity, role: profile.role, partnerDistributorId: profile.partnerDistributorId, ...resolvePreferences(profile) };
  }

  /** requireUser + the capability; a role without it is sent to its home page. */
  async function requireRole(capability: Capability): Promise<SessionUser> {
    const user = await requireUser();
    if (!can(user.role, capability)) return deps.redirect(homePathFor(user.role));
    return user;
  }

  /** requireUser + one of the listed roles. Prefer requireRole: capabilities keep the matrix in one place. */
  async function requireAnyRole(...roles: Role[]): Promise<SessionUser> {
    const user = await requireUser();
    if (!roles.includes(user.role)) return deps.redirect(homePathFor(user.role));
    return user;
  }

  return { requireUser, requireRole, requireAnyRole };
}
