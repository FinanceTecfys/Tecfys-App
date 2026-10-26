import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { can, canAccessPath, CAPABILITIES, type Capability, homePathFor, isRole, type Role, ROLES, routeCapability } from "../permissions";

// The matrix as agreed, written out in full: owner, admin, sales, partner.
const EXPECTED: Record<Capability, [boolean, boolean, boolean, boolean]> = {
  "dashboard.view": [true, true, true, false],
  "loanBook.view": [true, true, true, false],
  "waterfall.view": [true, true, true, false],
  "pipeline.view": [true, true, true, false],
  "erp.view": [true, true, false, false],
  "erp.sync": [true, true, false, false],
  "scoring.view": [true, true, true, true],
  "scoring.run": [true, true, true, true],
  "scoring.review": [true, true, false, false],
  "scoringModel.edit": [true, true, false, false],
  "scoringModel.viewBreakdown": [true, true, true, false],
  "operation.create": [true, true, true, true],
  "contract.view": [true, true, true, true],
  "contract.manage": [true, true, false, false],
  "settings.access": [true, true, false, false],
  "preferences.manage": [true, true, true, true],
  "records.viewAll": [true, true, true, false],
  "users.manage": [true, true, false, false],
  "admins.manage": [true, false, false, false],
};

describe("can (role x capability)", () => {
  it("covers every capability", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...CAPABILITIES].sort());
    expect(ROLES).toEqual(["owner", "admin", "sales", "partner"]);
  });

  for (const capability of CAPABILITIES) {
    ROLES.forEach((role, i) => {
      it(`${role} ${EXPECTED[capability][i] ? "can" : "cannot"} ${capability}`, () => {
        expect(can(role, capability)).toBe(EXPECTED[capability][i]);
      });
    });
  }

  it("the owner holds every capability", () => {
    for (const capability of CAPABILITIES) expect(can("owner", capability), capability).toBe(true);
  });

  it("owner-only actions reject the admin", () => {
    expect(can("admin", "admins.manage")).toBe(false);
    expect(can("owner", "admins.manage")).toBe(true);
  });

  it("a partner only runs scoring, creates operations and sets its own preferences", () => {
    const allowed = CAPABILITIES.filter((c) => can("partner", c)).sort();
    expect(allowed).toEqual(["contract.view", "operation.create", "preferences.manage", "scoring.run", "scoring.view"]);
  });

  it("every role sets its own preferences, but the administration of Settings stays with owner and admin", () => {
    for (const role of ROLES) expect(can(role, "preferences.manage"), role).toBe(true);
    for (const role of ["sales", "partner"] as const) expect(can(role, "settings.access"), role).toBe(false);
  });

  it("the pipeline is for owner, admin and sales; a partner never sees the other partners' activity", () => {
    for (const role of ["owner", "admin", "sales"] as const) expect(can(role, "pipeline.view"), role).toBe(true);
    expect(can("partner", "pipeline.view")).toBe(false);
  });

  it("the weights and scores of a scoring breakdown are for Tecfys staff - sales included - and never for a partner", () => {
    for (const role of ["owner", "admin", "sales"] as const) expect(can(role, "scoringModel.viewBreakdown"), role).toBe(true);
    expect(can("partner", "scoringModel.viewBreakdown")).toBe(false);
    // Seeing the breakdown is not editing the model.
    expect(can("sales", "scoringModel.edit")).toBe(false);
  });

  it("sales cannot edit the scoring model, reach settings or ERP, or manage users", () => {
    for (const c of ["scoringModel.edit", "settings.access", "users.manage", "erp.view"] as const) expect(can("sales", c), c).toBe(false);
  });
});

describe("isRole", () => {
  it("accepts the four roles only", () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true);
    for (const r of ["", "root", "OWNER", null, undefined, 1, "toString"]) expect(isRole(r), String(r)).toBe(false);
  });
});

describe("route allow-list", () => {
  const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  // path -> owner, admin, sales, partner
  const ROUTES: [string, [boolean, boolean, boolean, boolean]][] = [
    ["/", [true, true, true, false]],
    ["/contracts", [true, true, true, false]],
    ["/contracts/", [true, true, true, false]],
    ["/contracts/export", [true, true, true, false]],
    ["/portfolio", [true, true, true, false]],
    ["/pipeline", [true, true, true, false]],
    ["/pipeline/", [true, true, true, false]],
    ["/pipeline/anything", [true, true, false, false]],
    ["/erp", [true, true, false, false]],
    // Open to every role: each one only gets the tabs it may use (settings tabs test).
    ["/settings", [true, true, true, true]],
    ["/settings/", [true, true, true, true]],
    ["/scoring", [true, true, true, true]],
    ["/scoring/new", [true, true, true, true]],
    [`/scoring/${ID}`, [true, true, true, true]],
    ["/contracts/new", [true, true, true, true]],
    [`/contracts/${ID}`, [true, true, true, true]],
    [`/contracts/${ID}/draft`, [true, true, true, true]],
    [`/contracts/${ID}/edit`, [true, true, true, true]],
    [`/contracts/${ID}/edit/x`, [true, true, false, false]],
    [`/contracts/${ID}/attachments/id_document`, [true, true, true, true]],
    [`/contracts/${ID}/attachments/contract`, [true, true, true, true]],
    // No rule: default deny, only the roles that reach Settings.
    ["/admin", [true, true, false, false]],
    ["/contracts/x/y/z", [true, true, false, false]],
    ["/settings/users", [true, true, false, false]],
    ["/api/anything", [true, true, false, false]],
  ];

  for (const [route, expected] of ROUTES) {
    ROLES.forEach((role, i) => {
      it(`${role} ${expected[i] ? "reaches" : "is denied"} ${route}`, () => {
        expect(canAccessPath(role, route)).toBe(expected[i]);
      });
    });
  }

  it("denies a partner the dashboard, loan book, waterfall and ERP; Settings it may open, for its preferences", () => {
    for (const p of ["/", "/contracts", "/contracts/export", "/portfolio", "/pipeline", "/erp", "/settings/users"]) expect(canAccessPath("partner", p), p).toBe(false);
    expect(canAccessPath("partner", "/settings")).toBe(true);
    expect(routeCapability("/settings")).toBe("preferences.manage");
  });

  it("maps the specific routes before the generic ones", () => {
    expect(routeCapability("/scoring/new")).toBe("scoring.run");
    expect(routeCapability("/contracts/new")).toBe("operation.create");
    expect(routeCapability("/contracts/export")).toBe("loanBook.view");
    expect(routeCapability("/contracts/abc")).toBe("contract.view");
    expect(routeCapability("/contracts/abc/edit")).toBe("operation.create");
    expect(routeCapability("/pipeline")).toBe("pipeline.view");
    expect(routeCapability("/nope")).toBeNull();
  });

  it("has an explicit rule for every page and route handler of the app", () => {
    const appDir = path.join(process.cwd(), "src", "app", "(app)");
    const routes: string[] = [];
    const walk = (dir: string, url: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name), `${url}/${entry.name.replace(/^\[(.+)\]$/, "some-$1")}`);
        else if (entry.name === "page.tsx" || entry.name === "route.ts") routes.push(url || "/");
      }
    };
    walk(appDir, "");
    expect(routes.length).toBeGreaterThanOrEqual(12);
    for (const route of routes) expect(routeCapability(route), route).not.toBeNull();
  });

  it("sends every role to a home page it can open", () => {
    for (const role of ROLES) expect(canAccessPath(role, homePathFor(role)), role).toBe(true);
    expect(homePathFor("partner")).toBe("/scoring/new");
    for (const role of ["owner", "admin", "sales"] satisfies Role[]) expect(homePathFor(role)).toBe("/");
  });
});
