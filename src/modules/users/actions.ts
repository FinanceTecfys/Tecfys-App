"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import { getUserRole } from "./data";
import {
  checkCreateUser,
  checkRoleChange,
  checkSetActive,
  type CreateUserInput,
  createUserSchema,
  type RoleChangeInput,
  roleChangeSchema,
} from "./domain/rules";

export type UserResult = { ok: true } | { ok: false; error: string };

const FOREIGN_KEY_VIOLATION = "23503";

const done = (): UserResult => {
  revalidatePath("/settings");
  return { ok: true };
};

/**
 * Create a user with a role (owner / admin only; an admin cannot create
 * admins, nobody creates an owner). The account is created with the Supabase
 * Auth admin API, already confirmed, with the initial password typed here:
 * public sign-up stays closed and there is no email invitation to accept.
 */
export async function createUser(input: CreateUserInput): Promise<UserResult> {
  const actor = await requireRole("users.manage");
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { email, password, role, distributorId } = parsed.data;
  const allowed = checkCreateUser(actor, { role, distributorId });
  if (!allowed.ok) return allowed;

  const { data, error } = await db().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    return { ok: false, error: error?.code === "email_exists" ? "Ya existe un usuario con ese email" : (error?.message ?? "No se pudo crear el usuario") };
  }

  const { error: profileError } = await db()
    .from("profiles")
    .insert({ user_id: data.user.id, role, partner_distributor_id: distributorId, created_by: actor.id });
  if (profileError) {
    // No account without a role: undo the auth user.
    await db().auth.admin.deleteUser(data.user.id);
    return { ok: false, error: profileError.code === FOREIGN_KEY_VIOLATION ? "El distribuidor no existe" : profileError.message };
  }
  return done();
}

/** Change a user's role, or give a first role to an auth user that has none. Never the owner. */
export async function updateUserRole(input: RoleChangeInput): Promise<UserResult> {
  const actor = await requireRole("users.manage");
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { userId, role, distributorId } = parsed.data;
  const current = await getUserRole(userId);
  const allowed = checkRoleChange(actor, { id: userId, role: current }, { role, distributorId });
  if (!allowed.ok) return allowed;

  const fields = { role, partner_distributor_id: distributorId };
  const { error } = current
    ? // The owner row is excluded in the statement too, whatever was read above.
      await db().from("profiles").update(fields).eq("user_id", userId).neq("role", "owner")
    : await db().from("profiles").insert({ user_id: userId, ...fields, created_by: actor.id });
  if (error) return { ok: false, error: error.code === FOREIGN_KEY_VIOLATION ? "El usuario o el distribuidor no existe" : error.message };
  return done();
}

const setActiveSchema = z.object({ userId: z.uuid(), active: z.boolean() });

/** Deactivate (no access, effective on the next request) or reactivate a user. Never the owner. */
export async function setUserActive(input: z.input<typeof setActiveSchema>): Promise<UserResult> {
  const actor = await requireRole("users.manage");
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos no válidos" };
  const { userId, active } = parsed.data;
  const allowed = checkSetActive(actor, { id: userId, role: await getUserRole(userId) });
  if (!allowed.ok) return allowed;

  const { error } = await db().from("profiles").update({ active }).eq("user_id", userId).neq("role", "owner");
  if (error) return { ok: false, error: error.message };
  return done();
}
