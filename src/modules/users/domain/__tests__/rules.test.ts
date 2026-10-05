import { describe, expect, it } from "vitest";
import { OWNER_EMAIL, ROLES, type Role } from "@/lib/auth/permissions";
import {
  assignableRoles,
  checkCanManage,
  checkDeleteUser,
  checkInviteUser,
  checkRoleChange,
  checkSetActive,
  inviteProfileStep,
  inviteUserSchema,
  isInvitePending,
  type RoleAssignment,
  roleChangeSchema,
  USER_RULE_ERRORS,
} from "../rules";

const DIST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor = (role: Role) => ({ id: `actor-${role}`, role });
const target = (role: Role | null, id = "target") => ({ id, role });
/** Invite a fresh address with this role. */
const invite = (by: { id: string; role: Role }, assignment: RoleAssignment) => checkInviteUser(by, { email: "nueva@tecfys.com", ...assignment });
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

  it("nobody can invite a second owner or promote someone to owner", () => {
    for (const by of ROLES) {
      expect(invite(actor(by), { role: "owner", distributorId: null }).ok, by).toBe(false);
      for (const from of [null, "admin", "sales", "partner"] as const) {
        expect(checkRoleChange(actor(by), target(from), { role: "owner", distributorId: null }).ok, `${by} ${from}`).toBe(false);
      }
    }
    expect(error(invite(actor("owner"), { role: "owner", distributorId: null }))).toBe(USER_RULE_ERRORS.owner);
    expect(error(invite(actor("admin"), { role: "owner", distributorId: null }))).toBe(USER_RULE_ERRORS.owner);
  });
});

describe("admins are managed by the owner only", () => {
  it("an admin cannot invite an admin", () => {
    expect(error(invite(actor("admin"), { role: "admin", distributorId: null }))).toBe(USER_RULE_ERRORS.adminsOnlyByOwner);
    expect(invite(actor("owner"), { role: "admin", distributorId: null })).toEqual({ ok: true });
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
      expect(invite(actor(by), { role: "sales", distributorId: null }).ok, by).toBe(true);
      expect(invite(actor(by), { role: "partner", distributorId: DIST }).ok, by).toBe(true);
      expect(checkRoleChange(actor(by), target("sales"), { role: "partner", distributorId: DIST }).ok, by).toBe(true);
      expect(checkRoleChange(actor(by), target("partner"), { role: "sales", distributorId: null }).ok, by).toBe(true);
      expect(checkSetActive(actor(by), target("partner")).ok, by).toBe(true);
      // An auth user created outside the app (no profile) can be given a first role.
      expect(checkRoleChange(actor(by), target(null), { role: "sales", distributorId: null }).ok, by).toBe(true);
    }
  });

  it("a partner needs a distributor and the other roles take none", () => {
    expect(error(invite(actor("owner"), { role: "partner", distributorId: null }))).toBe(USER_RULE_ERRORS.distributorRequired);
    expect(error(invite(actor("owner"), { role: "sales", distributorId: DIST }))).toBe(USER_RULE_ERRORS.distributorOnlyForPartners);
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
        expect(error(invite(actor(by), { role, distributorId })), `${by} create ${role}`).toBe(USER_RULE_ERRORS.notAllowed);
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
  it("an invitation is email + role (+ distributor): no password travels through the app", () => {
    const parsed = inviteUserSchema.parse({ email: "  Ana@Tecfys.com ", role: "sales", distributorId: "", password: "ignored" });
    expect(parsed).toEqual({ email: "ana@tecfys.com", role: "sales", distributorId: null });
    expect(inviteUserSchema.parse({ email: "p@partner.es", role: "partner", distributorId: DIST })).toEqual({ email: "p@partner.es", role: "partner", distributorId: DIST });
  });

  it("rejects a bad email, an unknown role and a non-uuid id", () => {
    expect(inviteUserSchema.safeParse({ email: "ana", role: "sales" }).success).toBe(false);
    expect(inviteUserSchema.safeParse({ email: "ana@tecfys.com", role: "root" }).success).toBe(false);
    expect(inviteUserSchema.safeParse({ email: "ana@tecfys.com", role: "partner", distributorId: "1" }).success).toBe(false);
    expect(roleChangeSchema.safeParse({ userId: "1", role: "sales" }).success).toBe(false);
    expect(roleChangeSchema.safeParse({ userId: DIST, role: "partner", distributorId: DIST }).success).toBe(true);
  });
});

describe("inviting by email", () => {
  it("owner and admin invite sales and partners; only the owner invites admins", () => {
    for (const by of ["owner", "admin"] as const) {
      expect(invite(actor(by), { role: "sales", distributorId: null })).toEqual({ ok: true });
      expect(invite(actor(by), { role: "partner", distributorId: DIST })).toEqual({ ok: true });
    }
    expect(invite(actor("owner"), { role: "admin", distributorId: null })).toEqual({ ok: true });
    expect(error(invite(actor("admin"), { role: "admin", distributorId: null }))).toBe(USER_RULE_ERRORS.adminsOnlyByOwner);
  });

  it("the owner's address is never invited, whatever the role or the casing", () => {
    for (const by of ["owner", "admin"] as const) {
      for (const email of [OWNER_EMAIL, "Finance@Tecfys.com", "  finance@tecfys.com "]) {
        expect(error(checkInviteUser(actor(by), { email, role: "sales", distributorId: null })), `${by} ${email}`).toBe(USER_RULE_ERRORS.owner);
      }
    }
  });

  it("a partner invitation needs its distributor", () => {
    expect(error(invite(actor("admin"), { role: "partner", distributorId: null }))).toBe(USER_RULE_ERRORS.distributorRequired);
    expect(error(invite(actor("admin"), { role: "sales", distributorId: DIST }))).toBe(USER_RULE_ERRORS.distributorOnlyForPartners);
  });

  it("the profile is created at invite time, and a re-sent invitation never changes an existing role", () => {
    expect(inviteProfileStep(null)).toBe("create");
    for (const role of ROLES) expect(inviteProfileStep(role), role).toBe("resend");
  });

  it("an invitation is pending until the email is confirmed by setting the password", () => {
    expect(isInvitePending({ invited_at: "2026-10-05T10:00:00Z", email_confirmed_at: null })).toBe(true);
    expect(isInvitePending({ invited_at: "2026-10-05T10:00:00Z" })).toBe(true);
    expect(isInvitePending({ invited_at: "2026-10-05T10:00:00Z", email_confirmed_at: "2026-10-05T11:00:00Z" })).toBe(false);
    // Created with a password (the owner, older accounts): never "pending".
    expect(isInvitePending({ invited_at: null, email_confirmed_at: "2026-10-05T11:00:00Z" })).toBe(false);
    expect(isInvitePending({})).toBe(false);
  });
});

describe("deleting users", () => {
  const victim = (role: Role | null, email: string | null = "alguien@tecfys.com", id = "target") => ({ id, role, email });

  it("the owner is never deletable, by anyone", () => {
    for (const by of ROLES) expect(checkDeleteUser(actor(by), victim("owner", OWNER_EMAIL)).ok, by).toBe(false);
    expect(error(checkDeleteUser(actor("owner"), victim("owner", OWNER_EMAIL)))).toBe(USER_RULE_ERRORS.owner);
    expect(error(checkDeleteUser(actor("admin"), victim("owner", OWNER_EMAIL)))).toBe(USER_RULE_ERRORS.owner);
    // The owner on its own row: still the owner row, not a "self" case.
    expect(error(checkDeleteUser({ id: "o", role: "owner" }, { id: "o", role: "owner", email: OWNER_EMAIL }))).toBe(USER_RULE_ERRORS.owner);
  });

  it("the owner account is protected by its email even without the owner profile", () => {
    for (const role of [null, "admin", "sales", "partner"] as const) {
      for (const by of ["owner", "admin"] as const) {
        expect(error(checkDeleteUser(actor(by), victim(role, "Finance@Tecfys.com"))), `${by} ${role}`).toBe(USER_RULE_ERRORS.owner);
      }
    }
  });

  it("the owner role is protected whatever email the row carries", () => {
    expect(error(checkDeleteUser(actor("admin"), victim("owner", "otro@tecfys.com")))).toBe(USER_RULE_ERRORS.owner);
    expect(error(checkDeleteUser(actor("admin"), victim("owner", null)))).toBe(USER_RULE_ERRORS.owner);
  });

  it("an admin cannot delete another admin; the owner can", () => {
    expect(error(checkDeleteUser(actor("admin"), victim("admin")))).toBe(USER_RULE_ERRORS.adminsOnlyByOwner);
    expect(checkDeleteUser(actor("owner"), victim("admin"))).toEqual({ ok: true });
  });

  it("owner and admin delete sales, partners and accounts with no role", () => {
    for (const by of ["owner", "admin"] as const) {
      for (const role of ["sales", "partner", null] as const) expect(checkDeleteUser(actor(by), victim(role)), `${by} ${role}`).toEqual({ ok: true });
    }
  });

  it("nobody deletes themselves", () => {
    for (const role of ["admin", "sales", "partner"] as const) {
      expect(checkDeleteUser({ id: "same", role }, { id: "same", role, email: "yo@tecfys.com" }).ok, role).toBe(false);
    }
    expect(error(checkDeleteUser({ id: "same", role: "admin" }, { id: "same", role: "admin", email: "yo@tecfys.com" }))).toBe(USER_RULE_ERRORS.self);
  });

  it("sales and partners delete nobody", () => {
    for (const by of ["sales", "partner"] as const) {
      for (const role of [null, ...ROLES]) expect(error(checkDeleteUser(actor(by), victim(role))), `${by} ${role}`).toBe(USER_RULE_ERRORS.notAllowed);
    }
  });
});
