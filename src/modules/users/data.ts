import "server-only";
import { isRole, type Role, ROLES } from "@/lib/auth/permissions";
import { db } from "@/lib/supabase/server";
import { isInvitePending } from "./domain/rules";

export interface UserRow {
  id: string;
  email: string | null;
  /** null: a Supabase Auth user with no profile, i.e. no access to the app yet. */
  role: Role | null;
  active: boolean;
  /** Invited by email and the password not set yet. */
  invitePending: boolean;
  distributor: { id: string; name: string } | null;
  lastSignInAt: string | null;
}

const PER_PAGE = 200;

/**
 * Every Supabase Auth user with its app profile. Users with no profile are
 * listed too (they cannot enter the app until a role is assigned). Callers
 * must hold "users.manage".
 */
export async function listUsers(): Promise<UserRow[]> {
  const authUsers = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw error;
    authUsers.push(...data.users);
    if (data.users.length < PER_PAGE) break;
  }

  const { data: profiles, error } = await db()
    .from("profiles")
    .select("user_id, role, active, distributor:distributors ( id, name )");
  if (error) throw error;
  const byUser = new Map(profiles.map((p) => [p.user_id, p]));

  const rank = (role: Role | null) => (role ? ROLES.indexOf(role) : ROLES.length);
  return authUsers
    .map((u): UserRow => {
      const profile = byUser.get(u.id);
      return {
        id: u.id,
        email: u.email ?? null,
        role: profile && isRole(profile.role) ? profile.role : null,
        active: profile?.active ?? false,
        invitePending: isInvitePending(u),
        distributor: profile?.distributor ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
      };
    })
    .sort((a, b) => rank(a.role) - rank(b.role) || (a.email ?? "").localeCompare(b.email ?? ""));
}

/** The role a user holds today, for the rule checks of the user actions; null with no profile. */
export async function getUserRole(userId: string): Promise<Role | null> {
  const { data, error } = await db().from("profiles").select("role").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data && isRole(data.role) ? data.role : null;
}

/** The Supabase Auth account behind an id (its email decides the owner protection); null when it does not exist. */
export async function getAuthUser(userId: string): Promise<{ id: string; email: string | null } | null> {
  const { data, error } = await db().auth.admin.getUserById(userId);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}
