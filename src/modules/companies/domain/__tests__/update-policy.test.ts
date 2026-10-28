import { describe, expect, it } from "vitest";
import { operationCompanyFields } from "@/modules/contracts/domain/operation";
import { EMPTY_FINANCIALS, type Financials } from "@/modules/scoring/domain/financials";
import {
  COMPANY_FIELDS,
  comparable,
  companyValuesFromFinancials,
  type CurrentCompany,
  decideCompanyUpdate,
  FILL_ONLY_FIELDS,
  INFORMA_FIELDS,
} from "../update-policy";

const COMPANY: CurrentCompany = {
  id: "company-1",
  cif: "B00000001",
  name: "ALFA DEMO SL.",
  address: "CALLE MAYOR, 3",
  fiscal_postal_code: "08006",
  fiscal_city: "BARCELONA",
  fiscal_province: "BARCELONA",
  admin_name: "ANA GARCIA LOPEZ",
  admin_nif: "12345678Z",
  cnae: "6201",
  sector: "Information technology",
  constitution_date: "2016-05-26",
  phone: "934000000",
  email: "info@alfa.es",
  web: "www.alfa.es",
  employees: 12,
};

/** The scoring data as the wizard sends it, identical to the stored company unless overridden. */
const incoming = (over: Partial<Financials> = {}) =>
  companyValuesFromFinancials({
    ...EMPTY_FINANCIALS,
    cif: "B00000001", name: "ALFA DEMO SL.", country: "ES", address: "CALLE MAYOR, 3", fiscalPostalCode: "08006", fiscalCity: "BARCELONA",
    fiscalProvince: "BARCELONA", adminName: "ANA GARCIA LOPEZ", adminNif: "12345678Z", cnae: "6201", sector: "Information technology",
    constitutionDate: "26/05/2016", phone: "934000000", email: "info@alfa.es", web: "www.alfa.es", employees: 12,
    ...over,
  });

const decide = (over: Partial<Financials>, actorRole: "owner" | "admin" | "sales" | "partner" = "sales", current: CurrentCompany | null = COMPANY) =>
  decideCompanyUpdate({ current, incoming: incoming(over), actorRole, source: "informa_pdf" });

describe("field groups", () => {
  it("cover every company field exactly once", () => {
    expect(new Set(COMPANY_FIELDS).size).toBe(INFORMA_FIELDS.length + FILL_ONLY_FIELDS.length);
    expect([...FILL_ONLY_FIELDS]).toEqual(["phone", "email", "web"]);
    expect(INFORMA_FIELDS).toContain("employees");
  });
});

describe("decideCompanyUpdate", () => {
  it("creates a brand-new CIF, for staff and partners alike", () => {
    for (const role of ["sales", "partner"] as const) {
      const d = decide({}, role, null);
      expect(d.kind).toBe("create");
      if (d.kind === "create") expect(d.values).toMatchObject({ cif: "B00000001", name: "ALFA DEMO SL.", constitution_date: "2016-05-26" });
    }
  });

  it("finds nothing when the report says the same thing", () => {
    expect(decide({})).toEqual({ kind: "update", companyId: "company-1", apply: {}, changes: [] });
  });

  it("ignores cosmetic differences: spacing, case, accents, legal-form punctuation, formats", () => {
    const d = decide({
      name: "  alfa   demo, s.l ",
      address: "calle  mayor , 3",
      fiscalCity: "Barcelona",
      fiscalProvince: "BARCELÓNA",
      adminName: "Ana García López",
      adminNif: "12.345.678-z",
      cnae: "62.01",
      fiscalPostalCode: " 08006 ",
      constitutionDate: "2016-05-26",
      email: "INFO@ALFA.ES",
      web: "https://www.alfa.es/",
      phone: "934 00 00 00",
    });
    expect(d).toEqual({ kind: "update", companyId: "company-1", apply: {}, changes: [] });
  });

  it("staff: applies and records a real change of an Informa field", () => {
    const d = decide({ name: "ALFA NUEVA SL.", adminName: "LUIS PEREZ" }, "sales");
    if (d.kind !== "update") throw new Error("expected update");
    expect(d.apply).toEqual({ name: "ALFA NUEVA SL.", admin_name: "LUIS PEREZ" });
    expect(d.changes).toEqual([
      { field: "name", kind: "change", oldValue: "ALFA DEMO SL.", newValue: "ALFA NUEVA SL.", status: "applied" },
      { field: "admin_name", kind: "change", oldValue: "ANA GARCIA LOPEZ", newValue: "LUIS PEREZ", status: "applied" },
    ]);
    for (const role of ["owner", "admin"] as const) expect(decide({ name: "ALFA NUEVA SL." }, role)).toMatchObject({ apply: { name: "ALFA NUEVA SL." } });
  });

  it("partner: never applies anything; every difference waits as pending", () => {
    const d = decide({ name: "ALFA NUEVA SL.", constitutionDate: "01/01/2010" }, "partner", { ...COMPANY, phone: null });
    if (d.kind !== "update") throw new Error("expected update");
    expect(d.apply).toEqual({});
    expect(d.changes.map((c) => [c.field, c.kind, c.status])).toEqual([
      ["name", "change", "pending"],
      ["constitution_date", "change", "pending"],
      ["phone", "fill", "pending"],
    ]);
  });

  it("never replaces a value with an empty one", () => {
    const d = decide({ name: "", address: null, adminName: "   ", phone: null, email: "", employees: null, constitutionDate: "not a date" });
    expect(d).toEqual({ kind: "update", companyId: "company-1", apply: {}, changes: [] });
  });

  it("Tecfys-maintained fields: fills an empty one, never overwrites a set one", () => {
    const overwrite = decide({ phone: "911111111", email: "otro@alfa.es", web: "alfa.com" });
    expect(overwrite).toEqual({ kind: "update", companyId: "company-1", apply: {}, changes: [] });

    const fill = decide({ phone: "911111111", web: "alfa.com" }, "sales", { ...COMPANY, phone: null, web: "" });
    if (fill.kind !== "update") throw new Error("expected update");
    expect(fill.apply).toEqual({ phone: "911111111", web: "alfa.com" });
    expect(fill.changes.every((c) => c.kind === "fill" && c.oldValue === null && c.status === "applied")).toBe(true);
  });

  it("fills an empty Informa field too, recorded as a fill", () => {
    const d = decide({ cnae: "6201" }, "admin", { ...COMPANY, cnae: null });
    expect(d).toMatchObject({ apply: { cnae: "6201" }, changes: [{ field: "cnae", kind: "fill", oldValue: null, newValue: "6201", status: "applied" }] });
  });

  it("employees is authoritative: applied with history for staff, pending for a partner", () => {
    expect(decide({ employees: 40 }, "sales")).toMatchObject({ apply: { employees: 40 }, changes: [{ field: "employees", kind: "change", oldValue: "12", newValue: "40", status: "applied" }] });
    expect(decide({ employees: 40 }, "partner")).toMatchObject({ apply: {}, changes: [{ field: "employees", status: "pending" }] });
  });

  it("refuses to create a company without its CIF and name", () => {
    expect(() => decideCompanyUpdate({ current: null, incoming: { address: "X" }, actorRole: "owner", source: "operation" })).toThrow();
  });

  it("leaves an existing company alone for a scoring typed by hand (no Informa source)", () => {
    const d = decideCompanyUpdate({ current: COMPANY, incoming: incoming({ name: "OTRO NOMBRE SL" }), actorRole: "owner", source: null });
    expect(d).toEqual({ kind: "update", companyId: "company-1", apply: {}, changes: [] });
  });

  it("stores the applied values cleaned up", () => {
    const d = decide({ fiscalCity: "  SANT   CUGAT  " }, "sales");
    expect(d).toMatchObject({ apply: { fiscal_city: "SANT CUGAT" }, changes: [{ newValue: "SANT CUGAT", oldValue: "BARCELONA" }] });
  });
});

describe("comparable", () => {
  it("treats empty as null and keeps real differences apart", () => {
    expect(comparable("name", "  ")).toBeNull();
    expect(comparable("name", "ALFA SL")).toBe(comparable("name", "Alfa, S.L."));
    expect(comparable("name", "ALFA SL")).not.toBe(comparable("name", "ALFA SA"));
    expect(comparable("constitution_date", "26/05/2016")).toBe("2016-05-26");
    expect(comparable("employees", 12)).toBe(comparable("employees", "12"));
  });
});

describe("an operation as the source", () => {
  /** What "Nueva operación" says about the company (domain/operation.ts), the same as the master unless overridden. */
  const typed = (over: Partial<Parameters<typeof operationCompanyFields>[0]> = {}) =>
    operationCompanyFields({
      fiscalAddress: "CALLE MAYOR, 3", fiscalPostalCode: "08006", fiscalCity: "BARCELONA", fiscalProvince: "BARCELONA",
      signatoryName: "ANA GARCIA LOPEZ", signatoryNif: "12345678Z", contactPhone: "934000000", contactEmail: "info@alfa.es",
      ...over,
    });
  const fromOperation = (over: Parameters<typeof typed>[0], actorRole: "sales" | "partner") =>
    decideCompanyUpdate({ current: COMPANY, incoming: typed(over), actorRole, source: "operation" });

  it("staff: a different fiscal address or signatory is applied and recorded; cosmetic edits are nothing", () => {
    expect(fromOperation({ fiscalAddress: "Calle  mayor, 3", signatoryName: "Ana García López" }, "sales")).toEqual({ kind: "update", companyId: "company-1", apply: {}, changes: [] });
    const d = fromOperation({ fiscalAddress: "AVENIDA DIAGONAL 1", signatoryNif: "87654321X" }, "sales");
    expect(d).toMatchObject({
      apply: { address: "AVENIDA DIAGONAL 1", admin_nif: "87654321X" },
      changes: [
        { field: "address", kind: "change", newValue: "AVENIDA DIAGONAL 1", status: "applied" },
        { field: "admin_nif", kind: "change", newValue: "87654321X", status: "applied" },
      ],
    });
  });

  it("partner: nothing applied, the same differences pending", () => {
    const d = fromOperation({ fiscalAddress: "AVENIDA DIAGONAL 1" }, "partner");
    expect(d).toMatchObject({ apply: {}, changes: [{ field: "address", status: "pending" }] });
  });

  it("contact data typed in an operation only fills an empty master field", () => {
    expect(fromOperation({ contactPhone: "600111222", contactEmail: "otra@alfa.es" }, "sales")).toEqual({ kind: "update", companyId: "company-1", apply: {}, changes: [] });
    const fill = decideCompanyUpdate({ current: { ...COMPANY, phone: null }, incoming: typed({ contactPhone: "600111222" }), actorRole: "sales", source: "operation" });
    expect(fill).toMatchObject({ apply: { phone: "600111222" }, changes: [{ field: "phone", kind: "fill", status: "applied" }] });
  });

  it("an empty field typed in the form never empties the master", () => {
    expect(fromOperation({ fiscalProvince: "", signatoryNif: " ", contactEmail: "" }, "sales")).toEqual({ kind: "update", companyId: "company-1", apply: {}, changes: [] });
  });
});
