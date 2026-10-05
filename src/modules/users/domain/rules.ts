/**
 * User-management rules, pure so the owner invariant is unit-tested:
 *  - there is exactly one owner (OWNER_EMAIL); the app never creates another
 *    one and never demotes, deactivates, deletes or otherwise modifies it;
 *  - only the owner invites, modifies or deletes an admin;
 *  - an admin manages sales and partners only;
 *  - nobody changes their own role, deactivates or deletes themselves;
 *  - a partner is tied to a distributor, the other roles to none.
 * The Server Actions apply these after requireRole("users.manage"); the UI
 * uses the same functions to decide what to offer.
 */
import { z } from "zod";
import { can, OWNER_EMAIL, type Role, ROLES } from "@/lib/auth/permissions";

export interface Actor {
  id: string;
  role: Role;
}

/** The user being changed; role null = an auth user with no profile yet. */
export interface Target {
  id: string;
  role: Role | null;
}

export type RuleResult = { ok: true } | { ok: false; error: string };

const OK: RuleResult = { ok: true };
const deny = (error: string): RuleResult => ({ ok: false, error });

export const USER_RULE_ERRORS = {
  notAllowed: "No tienes permiso para gestionar usuarios",
  owner: "El owner no se puede modificar, desactivar, eliminar ni duplicar",
  adminsOnlyByOwner: "Solo el owner puede invitar, modificar o eliminar administradores",
  self: "No puedes cambiar tu propio rol, ni desactivar o eliminar tu usuario",
  distributorRequired: "Selecciona el distribuidor que representa el partner",
  distributorOnlyForPartners: "Solo un partner se vincula a un distribuidor",
  noProfile: "El usuario todavía no tiene rol asignado",
} as const;

/** The roles an actor may give to a user. Never owner: the single owner is seeded, not assigned. */
export function assignableRoles(actorRole: Role): Role[] {
  if (!can(actorRole, "users.manage")) return [];
  return ROLES.filter((role) => role !== "owner" && (role !== "admin" || can(actorRole, "admins.manage")));
}

/** May the actor touch this user at all (change its role, deactivate it)? */
export function checkCanManage(actor: Actor, target: Target): RuleResult {
  if (!can(actor.role, "users.manage")) return deny(USER_RULE_ERRORS.notAllowed);
  if (target.role === "owner") return deny(USER_RULE_ERRORS.owner);
  if (target.id === actor.id) return deny(USER_RULE_ERRORS.self);
  if (target.role === "admin" && !can(actor.role, "admins.manage")) return deny(USER_RULE_ERRORS.adminsOnlyByOwner);
  return OK;
}

export interface RoleAssignment {
  role: Role;
  distributorId: string | null;
}

/** May the actor give this role (with this distributor) to anyone? */
export function checkAssignment(actorRole: Role, { role, distributorId }: RoleAssignment): RuleResult {
  if (!can(actorRole, "users.manage")) return deny(USER_RULE_ERRORS.notAllowed);
  if (role === "owner") return deny(USER_RULE_ERRORS.owner);
  if (!assignableRoles(actorRole).includes(role)) return deny(USER_RULE_ERRORS.adminsOnlyByOwner);
  if (role === "partner" && !distributorId) return deny(USER_RULE_ERRORS.distributorRequired);
  if (role !== "partner" && distributorId) return deny(USER_RULE_ERRORS.distributorOnlyForPartners);
  return OK;
}

const isOwnerEmail = (email: string | null | undefined) => (email ?? "").trim().toLowerCase() === OWNER_EMAIL;

/**
 * Invite a user by email with a role. The owner's address is never invited:
 * that account is the seeded root owner (migration + trigger), not an invitee.
 */
export function checkInviteUser(actor: Actor, invite: RoleAssignment & { email: string }): RuleResult {
  const assignment = checkAssignment(actor.role, invite);
  if (!assignment.ok) return assignment;
  return isOwnerEmail(invite.email) ? deny(USER_RULE_ERRORS.owner) : OK;
}

/**
 * What an invitation does with the profile, given the role the invited
 * account already holds:
 *  - none            -> "create": write the profile now, at invite time, so the
 *                       role is in place the moment the user sets a password;
 *  - a role already  -> "resend": the email went out again for a pending
 *                       invitation; the existing profile is NOT touched (a
 *                       re-invite must never work as a back-door role change).
 */
export const inviteProfileStep = (existingRole: Role | null): "create" | "resend" => (existingRole === null ? "create" : "resend");

/** Change (or assign for the first time) the role of an existing user. */
export function checkRoleChange(actor: Actor, target: Target, assignment: RoleAssignment): RuleResult {
  const manage = checkCanManage(actor, target);
  return manage.ok ? checkAssignment(actor.role, assignment) : manage;
}

/** Deactivate or reactivate a user. */
export function checkSetActive(actor: Actor, target: Target): RuleResult {
  if (target.role === null) return can(actor.role, "users.manage") ? deny(USER_RULE_ERRORS.noProfile) : deny(USER_RULE_ERRORS.notAllowed);
  return checkCanManage(actor, target);
}

/**
 * Delete a user (profile + Supabase Auth account). The owner is protected by
 * its role AND by its email, so the root account survives even if its profile
 * row were missing. A user with no profile can be deleted by owner or admin.
 */
export function checkDeleteUser(actor: Actor, target: Target & { email: string | null }): RuleResult {
  if (!can(actor.role, "users.manage")) return deny(USER_RULE_ERRORS.notAllowed);
  if (isOwnerEmail(target.email)) return deny(USER_RULE_ERRORS.owner);
  return checkCanManage(actor, target);
}

/** An invitation the user has not accepted yet: invited, email never confirmed. */
export const isInvitePending = (user: { invited_at?: string | null; email_confirmed_at?: string | null }): boolean =>
  Boolean(user.invited_at) && !user.email_confirmed_at;

const assignmentShape = {
  role: z.enum(ROLES, { error: "Selecciona un rol" }),
  distributorId: z.union([z.uuid(), z.literal(""), z.null()]).optional().transform((v) => v || null),
};

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Email no válido")),
  ...assignmentShape,
});
export type InviteUserInput = z.input<typeof inviteUserSchema>;

export const roleChangeSchema = z.object({ userId: z.uuid(), ...assignmentShape });
export type RoleChangeInput = z.input<typeof roleChangeSchema>;
