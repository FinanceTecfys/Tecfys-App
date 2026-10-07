"use server";

import { revalidatePath } from "next/cache";
import { getTranslate } from "@/i18n/server";
import { z } from "zod";
import { requireRole } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import { getAuthUser, getUserRole } from "./data";
import {
  checkDeleteUser,
  checkInviteUser,
  checkRoleChange,
  checkSetActive,
  inviteProfileStep,
  type InviteUserInput,
  inviteUserSchema,
  type RoleChangeInput,
  roleChangeSchema,
} from "./domain/rules";

export type UserResult = { ok: true; notice?: string } | { ok: false; error: string };

const FOREIGN_KEY_VIOLATION = "23503";

const done = (notice?: string): UserResult => {
  revalidatePath("/settings");
  return { ok: true, notice };
};

/**
 * Invite a user by email with a role (owner / admin only; an admin cannot
 * invite admins, nobody invites an owner). Supabase Auth creates the account
 * and emails a link to /auth/set-password, where the user chooses their own
 * password. The profile (role + distributor) is written here, at invite time,
 * keyed by the id of the account the invitation just created: the role is in
 * place before the first login, and until the password is set the account
 * simply cannot sign in.
 */
export async function inviteUser(input: InviteUserInput): Promise<UserResult> {
  const actor = await requireRole("users.manage");
  const translate = await getTranslate();
  const parsed = inviteUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: translate(parsed.error.issues[0].message) };
  const { email, role, distributorId } = parsed.data;
  const allowed = checkInviteUser(actor, { email, role, distributorId });
  if (!allowed.ok) return { ok: false, error: translate(allowed.error) };

  const { data, error } = await db().auth.admin.inviteUserByEmail(email);
  if (error || !data.user) {
    return { ok: false, error: error?.code === "email_exists" ? translate("errors.users.emailExists") : (error?.message ?? translate("errors.users.inviteFailed")) };
  }

  // Supabase re-sends the email when the address has a pending invitation.
  if (inviteProfileStep(await getUserRole(data.user.id)) === "resend") {
    return done(translate("users.notices.resent"));
  }

  const { error: profileError } = await db()
    .from("profiles")
    .insert({ user_id: data.user.id, role, partner_distributor_id: distributorId, created_by: actor.id });
  if (profileError) {
    // No account without a role: undo the invitation.
    await db().auth.admin.deleteUser(data.user.id);
    return { ok: false, error: profileError.code === FOREIGN_KEY_VIOLATION ? translate("errors.users.distributorMissing") : profileError.message };
  }
  return done(translate("users.notices.sentTo", { email }));
}

/** Change a user's role, or give a first role to an auth user that has none. Never the owner. */
export async function updateUserRole(input: RoleChangeInput): Promise<UserResult> {
  const actor = await requireRole("users.manage");
  const translate = await getTranslate();
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: translate(parsed.error.issues[0].message) };
  const { userId, role, distributorId } = parsed.data;
  const current = await getUserRole(userId);
  const allowed = checkRoleChange(actor, { id: userId, role: current }, { role, distributorId });
  if (!allowed.ok) return { ok: false, error: translate(allowed.error) };

  const fields = { role, partner_distributor_id: distributorId };
  const { error } = current
    ? // The owner row is excluded in the statement too, whatever was read above.
      await db().from("profiles").update(fields).eq("user_id", userId).neq("role", "owner")
    : await db().from("profiles").insert({ user_id: userId, ...fields, created_by: actor.id });
  if (error) return { ok: false, error: error.code === FOREIGN_KEY_VIOLATION ? translate("errors.users.userOrDistributorMissing") : error.message };
  return done();
}

const setActiveSchema = z.object({ userId: z.uuid(), active: z.boolean() });

/** Deactivate (no access, effective on the next request) or reactivate a user. Never the owner. */
export async function setUserActive(input: z.input<typeof setActiveSchema>): Promise<UserResult> {
  const actor = await requireRole("users.manage");
  const translate = await getTranslate();
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: translate("errors.users.invalidData") };
  const { userId, active } = parsed.data;
  const allowed = checkSetActive(actor, { id: userId, role: await getUserRole(userId) });
  if (!allowed.ok) return { ok: false, error: translate(allowed.error) };

  const { error } = await db().from("profiles").update({ active }).eq("user_id", userId).neq("role", "owner");
  if (error) return { ok: false, error: error.message };
  return done();
}

const deleteSchema = z.object({ userId: z.uuid() });

/**
 * Delete a user: its profile and its Supabase Auth account, so the email can
 * be invited again. Never the owner, never oneself; an admin never another
 * admin. The scorings and operations the user created are NOT deleted: their
 * created_by becomes null (foreign key on delete set null).
 */
export async function deleteUser(input: z.input<typeof deleteSchema>): Promise<UserResult> {
  const actor = await requireRole("users.manage");
  const translate = await getTranslate();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: translate("errors.users.invalidData") };
  const { userId } = parsed.data;
  const [account, role] = await Promise.all([getAuthUser(userId), getUserRole(userId)]);
  if (!account) return { ok: false, error: translate("errors.users.userMissing") };
  const allowed = checkDeleteUser(actor, { id: userId, role, email: account.email });
  if (!allowed.ok) return { ok: false, error: translate(allowed.error) };

  // The owner row is excluded in the statement too; if it were this user, stop before the account.
  const { error: profileError } = await db().from("profiles").delete().eq("user_id", userId).neq("role", "owner");
  if (profileError) return { ok: false, error: profileError.message };
  if ((await getUserRole(userId)) !== null) return { ok: false, error: translate("errors.users.cannotDelete") };

  const { error } = await db().auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: translate("errors.users.accountNotDeleted", { detail: error.message }) };
  return done(translate("users.notices.deleted", { email: account.email ?? "" }).replace("  ", " "));
}
