import { describe, expect, it, vi } from "vitest";
import { createGuards, type UserProfile } from "../guard";
import { CAPABILITIES, can, ROLES, type Role } from "../permissions";

/** next/navigation's redirect throws; the mock does the same and records where to. */
class Redirected extends Error {
  constructor(readonly location: string) {
    super(`redirect:${location}`);
  }
}

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "user@tecfys.com" };

function setup(profile: UserProfile | null, signedIn = true) {
  const redirect = vi.fn((location: string): never => {
    throw new Redirected(location);
  });
  const profileOf = vi.fn(async () => profile);
  const guards = createGuards({ identity: async () => (signedIn ? USER : null), profile: profileOf, redirect });
  return { ...guards, redirect, profileOf };
}

const as = (role: Role, active = true) => setup({ role, partnerDistributorId: null, active });

/** Where the guard redirected to; fails if it let the call through. */
const location = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a redirect, the guard let the call through");
    },
    (e: unknown) => {
      if (!(e instanceof Redirected)) throw e;
      return e.location;
    },
  );

describe("requireUser", () => {
  it("returns the user with its role", async () => {
    const guards = setup({ role: "partner", partnerDistributorId: "dist-1", active: true });
    await expect(guards.requireUser()).resolves.toEqual({ ...USER, role: "partner", partnerDistributorId: "dist-1" });
    expect(guards.profileOf).toHaveBeenCalledWith(USER.id);
    expect(guards.redirect).not.toHaveBeenCalled();
  });

  it("sends a request with no session to /login without reading any profile", async () => {
    const guards = setup({ role: "owner", partnerDistributorId: null, active: true }, false);
    expect(await location(guards.requireUser())).toBe("/login");
    expect(guards.profileOf).not.toHaveBeenCalled();
  });

  it("denies a signed-in user with no profile", async () => {
    expect(await location(setup(null).requireUser())).toBe("/login?error=no-access");
  });

  it("denies a deactivated user whatever its role", async () => {
    for (const role of ROLES) expect(await location(as(role, false).requireUser()), role).toBe("/login?error=no-access");
  });
});

describe("requireRole", () => {
  it("passes an allowed capability and redirects a denied one, for the whole matrix", async () => {
    for (const role of ROLES) {
      for (const capability of CAPABILITIES) {
        const guards = as(role);
        if (can(role, capability)) {
          await expect(guards.requireRole(capability), `${role} ${capability}`).resolves.toMatchObject({ id: USER.id, role });
          expect(guards.redirect).not.toHaveBeenCalled();
        } else {
          expect(await location(guards.requireRole(capability)), `${role} ${capability}`).toBe(role === "partner" ? "/scoring/new" : "/");
        }
      }
    }
  });

  it("throws a partner out of the loan book, waterfall, dashboard, ERP, settings and user management", async () => {
    for (const capability of ["loanBook.view", "waterfall.view", "dashboard.view", "erp.view", "settings.access", "users.manage", "contract.manage", "scoring.review"] as const) {
      expect(await location(as("partner").requireRole(capability)), capability).toBe("/scoring/new");
    }
  });

  it("never returns after a denial: code behind the guard does not run", async () => {
    const guards = as("sales");
    const sideEffect = vi.fn();
    const action = async () => {
      await guards.requireRole("settings.access");
      sideEffect();
    };
    await expect(action()).rejects.toBeInstanceOf(Redirected);
    expect(sideEffect).not.toHaveBeenCalled();
  });

  it("checks session and active role before the capability", async () => {
    expect(await location(setup(null, false).requireRole("scoring.run"))).toBe("/login");
    expect(await location(as("owner", false).requireRole("scoring.run"))).toBe("/login?error=no-access");
  });
});

describe("requireAnyRole", () => {
  it("passes a listed role and redirects the others", async () => {
    await expect(as("admin").requireAnyRole("owner", "admin")).resolves.toMatchObject({ role: "admin" });
    expect(await location(as("sales").requireAnyRole("owner", "admin"))).toBe("/");
    expect(await location(as("partner").requireAnyRole("owner", "admin", "sales"))).toBe("/scoring/new");
    expect(await location(as("owner").requireAnyRole())).toBe("/");
  });
});
