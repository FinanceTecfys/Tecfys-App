/**
 * User-management rules, pure so the owner invariant is unit-tested:
 *  - there is exactly one owner (OWNER_EMAIL); the app never creates another
 *    one and never demotes, deactivates or otherwise modifies it;
 *  - only the owner creates or modifies an admin;
 *  - an admin manages sales and partners only;
 *  - nobody changes their own role or deactivates themselves;
 *  - a partner is tied to a distributor, the other roles to none.
 * The Server Actions apply these after requireRole("users.manage"); the UI
 * uses the same functions to decide what to offer.
 */
import { z } from "zod";
import { can, type Role, ROLES } from "@/lib/auth/permissions";

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
  owner: "El owner no se puede modificar, desactivar ni duplicar",
  adminsOnlyByOwner: "Solo el owner puede crear o modificar administradores",
  self: "No puedes cambiar tu propio rol ni desactivar tu usuario",
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

/** Create a user with a role. */
export const checkCreateUser = (actor: Actor, assignment: RoleAssignment): RuleResult => checkAssignment(actor.role, assignment);

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

export const MIN_PASSWORD_LENGTH = 10;

const assignmentShape = {
  role: z.enum(ROLES, { error: "Selecciona un rol" }),
  distributorId: z.union([z.uuid(), z.literal(""), z.null()]).optional().transform((v) => v || null),
};

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Email no válido")),
  password: z.string().min(MIN_PASSWORD_LENGTH, `La contraseña inicial necesita al menos ${MIN_PASSWORD_LENGTH} caracteres`).max(72, "Máximo 72 caracteres"),
  ...assignmentShape,
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const roleChangeSchema = z.object({ userId: z.uuid(), ...assignmentShape });
export type RoleChangeInput = z.input<typeof roleChangeSchema>;
