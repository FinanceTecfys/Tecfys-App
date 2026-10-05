import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/auth/permissions";
import {
  assignableRoles,
  checkCanManage,
  checkCreateUser,
  checkRoleChange,
  checkSetActive,
  createUserSchema,
  roleChangeSchema,
  USER_RULE_ERRORS,
} from "../rules";

const DIST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = (role: Role) => ({ id: `actor-${role}`, role });
const target = (role: Role | null, id = "target") => ({ id, role });
const error = (r: { ok: true } | { ok: false; error: string }) => (r.ok ? null : r.error);

describe("assignableRoles", () => {
  it("nobody can assign owner; only the owner assigns admin", () => {
    expect(assignableRoles("owner")).toEqual(["admin", "sales", "partner"]);
    expect(assignableRoles("admin")).toEqual(["sales", "partner"]);
    expect(assignableRoles("sales")).toEqual([]);
    expect(assignableRoles("partner")).toEqual([]);
  });
});

describe("owner invariant", () => {
  it("the owner cannot be demoted, by anyone, to any role", () => {
    for (const by of ROLES) {
      for (const role of ROLES) {
        const distributorId = role === "partner" ? DIST : null;
        expect(checkRoleChange(actor(by), target("owner"), { role, distributorId }).ok, `${by} -> ${role}`).toBe(false);
      }
    }
    expect(error(checkRoleChange(actor("owner"), target("owner"), { role: "admin", distributorId: null }))).toBe(USER_RULE_ERRORS.owner);
    expect(error(checkRoleChange(actor("admin"), target("owner"), { role: "sales", distributorId: null }))).toBe(USER_RULE_ERRORS.owner);
  });

  it("the owner cannot be deactivated (the app has no delete), by anyone", () => {
    for (const by of ROLES) expect(checkSetActive(actor(by), target("owner")).ok, by).toBe(false);
    expect(error(checkSetActive(actor("admin"), target("owner")))).toBe(USER_RULE_ERRORS.owner);
    // The owner acting on its own row is still the owner row.
    expect(error(checkSetActive({ id: "o", role: "owner" }, { id: "o", role: "owner" }))).toBe(USER_RULE_ERRORS.owner);
  });

  it("nobody can create a second owner or promote someone to owner", () => {
    for (const by of ROLES) {
      expect(checkCreateUser(actor(by), { role: "owner", distributorId: null }).ok, by).toBe(false);
      for (const from of [null, "admin", "sales", "partner"] as const) {
        expect(checkRoleChange(actor(by), target(from), { role: "owner", distributorId: null }).ok, `${by} ${from}`).toBe(false);
      }
    }
    expect(error(checkCreateUser(actor("owner"), { role: "owner", distributorId: null }))).toBe(USER_RULE_ERRORS.owner);
    expect(error(checkCreateUser(actor("admin"), { role: "owner", distributorId: null }))).toBe(USER_RULE_ERRORS.owner);
  });
});

describe("admins are managed by the owner only", () => {
  it("an admin cannot create an admin", () => {
    expect(error(checkCreateUser(actor("admin"), { role: "admin", distributorId: null }))).toBe(USER_RULE_ERRORS.adminsOnlyByOwner);
    expect(checkCreateUser(actor("owner"), { role: "admin", distributorId: null })).toEqual({ ok: true });
  });

  it("an admin cannot modify or deactivate another admin, nor promote to admin", () => {
    expect(error(checkRoleChange(actor("admin"), target("admin"), { role: "sales", distributorId: null }))).toBe(USER_RULE_ERRORS.adminsOnlyByOwner);
    expect(error(checkSetActive(actor("admin"), target("admin")))).toBe(USER_RULE_ERRORS.adminsOnlyByOwner);
    expect(error(checkRoleChange(actor("admin"), target("sales"), { role: "admin", distributorId: null }))).toBe(USER_RULE_ERRORS.adminsOnlyByOwner);
  });

  it("the owner can do all of that", () => {
    expect(checkRoleChange(actor("owner"), target("admin"), { role: "sales", distributorId: null }).ok).toBe(true);
    expect(checkRoleChange(actor("owner"), target("sales"), { role: "admin", distributorId: null }).ok).toBe(true);
    expect(checkSetActive(actor("owner"), target("admin")).ok).toBe(true);
  });
});

describe("what owner and admin can do", () => {
  it("create and change sales and partners", () => {
    for (const by of ["owner", "admin"] as const) {
      expect(checkCreateUser(actor(by), { role: "sales", distributorId: null }).ok, by).toBe(true);
      expect(checkCreateUser(actor(by), { role: "partner", distributorId: DIST }).ok, by).toBe(true);
      expect(checkRoleChange(actor(by), target("sales"), { role: "partner", distributorId: DIST }).ok, by).toBe(true);
      expect(checkRoleChange(actor(by), target("partner"), { role: "sales", distributorId: null }).ok, by).toBe(true);
      expect(checkSetActive(actor(by), target("partner")).ok, by).toBe(true);
      // An auth user created outside the app (no profile) can be given a first role.
      expect(checkRoleChange(actor(by), target(null), { role: "sales", distributorId: null }).ok, by).toBe(true);
    }
  });

  it("a partner needs a distributor and the other roles take none", () => {
    expect(error(checkCreateUser(actor("owner"), { role: "partner", distributorId: null }))).toBe(USER_RULE_ERRORS.distributorRequired);
    expect(error(checkCreateUser(actor("owner"), { role: "sales", distributorId: DIST }))).toBe(USER_RULE_ERRORS.distributorOnlyForPartners);
    expect(error(checkRoleChange(actor("admin"), target("sales"), { role: "partner", distributorId: null }))).toBe(USER_RULE_ERRORS.distributorRequired);
  });

  it("nobody changes their own role or deactivates themselves", () => {
    const admin = { id: "same", role: "admin" as const };
    expect(error(checkRoleChange(admin, { id: "same", role: "admin" }, { role: "sales", distributorId: null }))).toBe(USER_RULE_ERRORS.self);
    expect(error(checkSetActive(admin, { id: "same", role: "admin" }))).toBe(USER_RULE_ERRORS.self);
  });

  it("a user with no profile has nothing to deactivate", () => {
    expect(error(checkSetActive(actor("owner"), target(null)))).toBe(USER_RULE_ERRORS.noProfile);
  });
});

describe("sales and partners manage nobody", () => {
  it("every user action is denied", () => {
    for (const by of ["sales", "partner"] as const) {
      for (const role of ROLES) {
        const distributorId = role === "partner" ? DIST : null;
        expect(error(checkCreateUser(actor(by), { role, distributorId })), `${by} create ${role}`).toBe(USER_RULE_ERRORS.notAllowed);
      }
      for (const current of [null, ...ROLES]) {
        expect(error(checkCanManage(actor(by), target(current))), `${by} manage ${current}`).toBe(USER_RULE_ERRORS.notAllowed);
        expect(error(checkSetActive(actor(by), target(current))), `${by} active ${current}`).toBe(USER_RULE_ERRORS.notAllowed);
        expect(error(checkRoleChange(actor(by), target(current), { role: "sales", distributorId: null })), `${by} change ${current}`).toBe(USER_RULE_ERRORS.notAllowed);
      }
    }
  });
});

describe("schemas", () => {
  it("normalises the email and the empty distributor", () => {
    const parsed = createUserSchema.parse({ email: "  Ana@Tecfys.com ", password: "una-clave-larga", role: "sales", distributorId: "" });
    expect(parsed).toEqual({ email: "ana@tecfys.com", password: "una-clave-larga", role: "sales", distributorId: null });
  });

  it("rejects a short password, a bad email, an unknown role and a non-uuid id", () => {
    expect(createUserSchema.safeParse({ email: "ana@tecfys.com", password: "corta", role: "sales" }).success).toBe(false);
    expect(createUserSchema.safeParse({ email: "ana", password: "una-clave-larga", role: "sales" }).success).toBe(false);
    expect(createUserSchema.safeParse({ email: "ana@tecfys.com", password: "una-clave-larga", role: "root" }).success).toBe(false);
    expect(roleChangeSchema.safeParse({ userId: "1", role: "sales" }).success).toBe(false);
    expect(roleChangeSchema.safeParse({ userId: DIST, role: "partner", distributorId: DIST }).success).toBe(true);
  });
});
