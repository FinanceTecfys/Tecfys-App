import { describe, expect, it } from "vitest";
import { createdByFilter, dataScopeFor, inScope, operationDistributorId } from "../scope";

const PARTNER_A = "11111111-1111-4111-8111-111111111111";
const PARTNER_B = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";

describe("dataScopeFor", () => {
  it("owner, admin and sales see every record", () => {
    for (const role of ["owner", "admin", "sales"] as const) {
      const scope = dataScopeFor({ id: STAFF, role });
      expect(scope, role).toEqual({ all: true });
      expect(createdByFilter(scope), role).toBeNull();
      for (const createdBy of [PARTNER_A, PARTNER_B, STAFF, null]) expect(inScope(scope, createdBy), `${role} ${createdBy}`).toBe(true);
    }
  });

  it("a partner only matches the records it created", () => {
    const scope = dataScopeFor({ id: PARTNER_A, role: "partner" });
    expect(scope).toEqual({ all: false, createdBy: PARTNER_A });
    expect(createdByFilter(scope)).toBe(PARTNER_A);
    expect(inScope(scope, PARTNER_A)).toBe(true);
    expect(inScope(scope, PARTNER_B)).toBe(false);
    expect(inScope(scope, STAFF)).toBe(false);
  });

  it("a partner never matches a record with no creator (imported loan book, rows older than RBAC)", () => {
    const scope = dataScopeFor({ id: PARTNER_A, role: "partner" });
    expect(inScope(scope, null)).toBe(false);
    expect(inScope(scope, undefined)).toBe(false);
  });
});

describe("operationDistributorId", () => {
  const DIST_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const DIST_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("Tecfys roles keep the distributor they chose", () => {
    for (const role of ["owner", "admin", "sales"] as const) {
      expect(operationDistributorId({ id: STAFF, role, partnerDistributorId: null }, DIST_B)).toBe(DIST_B);
      expect(operationDistributorId({ id: STAFF, role, partnerDistributorId: null }, null)).toBeNull();
    }
  });

  it("a partner always originates for its own distributor, whatever it sends", () => {
    const partner = { id: PARTNER_A, role: "partner" as const, partnerDistributorId: DIST_A };
    expect(operationDistributorId(partner, DIST_B)).toBe(DIST_A);
    expect(operationDistributorId(partner, null)).toBe(DIST_A);
    expect(operationDistributorId({ ...partner, partnerDistributorId: null }, DIST_B)).toBeNull();
  });
});
