import { describe, expect, it } from "vitest";
import {
  type DraftContractSnapshot,
  identityFromOperationInput,
  isEditableDraft,
  operationAssetFields,
  operationCompanyFields,
  operationContractFields,
  type OperationInput,
  operationInputFromContract,
  operationMandateFields,
  operationSchema,
} from "../operation";
import { buildSchedule } from "../schedule";

const SCORING_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ASSET_TYPE_ID = "0b0e7a3c-1b1d-4c57-9b0e-3f6a1f0c2d11";
const DISTRIBUTOR_ID = "5d3c2b1a-9f8e-4d7c-8b6a-1a2b3c4d5e6f";

const input = (over: Partial<OperationInput> = {}): OperationInput => ({
  scoringId: SCORING_ID,
  clientName: "Alfa Hostelería SL",
  clientCif: "b-12.345.678",
  fiscalAddress: "Calle Mayor 1",
  fiscalPostalCode: "28013",
  fiscalCity: "Madrid",
  fiscalProvince: "Madrid",
  signatoryName: "Ana Pérez",
  signatoryNif: "12345678z",
  signatoryAddress: "",
  contactName: "Ana Pérez",
  contactPhone: "600 000 000",
  contactEmail: "ana@alfa.example",
  deliverySameAsFiscal: true,
  deliveryAddress: "",
  sepaIban: "ES91 2100 0418 4502 0005 1332",
  sepaDebtorName: "Alfa Hostelería SL",
  sepaBic: "",
  distributorId: DISTRIBUTOR_ID,
  assetTypeId: ASSET_TYPE_ID,
  productDescription: "12 portátiles",
  contractType: "Renting",
  signingDate: "2026-10-01",
  durationMonths: 36,
  installment: 340,
  residualValue: 500,
  purchaseValue: 10000,
  quantity: 3,
  hasGuarantor: false,
  guarantorName: "",
  guarantorNif: "",
  guarantorAddress: "",
  guarantorRepresentative: "",
  guarantorRepresentativeNif: "",
  notes: "",
  ...over,
});

const parse = (over: Partial<OperationInput> = {}) => operationSchema.parse(input(over));

/** What the database holds after operationContractFields / operationMandateFields were written. */
function stored(over: Partial<OperationInput> = {}): { snapshot: DraftContractSnapshot; quantity: number } {
  const v = parse(over);
  const c = operationContractFields(v);
  const m = operationMandateFields(v);
  return {
    quantity: operationAssetFields(v).quantity,
    snapshot: {
      ...c,
      scoring_id: SCORING_ID,
      distributor: v.distributorId ? { id: v.distributorId } : null,
      asset_type: { id: c.asset_type_id },
      mandate: { iban: m.iban, debtor_name: m.debtor_name, bic: m.bic },
    },
  };
}

describe("operation -> rows (shared by create and edit)", () => {
  it("writes the economic terms the engine reads, and the identification snapshot", () => {
    const fields = operationContractFields(parse());
    expect(fields).toMatchObject({
      asset_type_id: ASSET_TYPE_ID,
      contract_type: "Renting",
      signing_date: "2026-10-01",
      duration_months: 36,
      installment: 340,
      residual_value: 500,
      purchase_value: 10000,
      client_name: "Alfa Hostelería SL",
      client_cif: "B12345678",
      signatory_nif: "12345678Z",
      delivery_same_as_fiscal: true,
      delivery_address: null,
      product_description: "12 portátiles",
      notes: null,
    });
  });

  it("never writes what an edit must not change: company, scoring, creator, status, number, distributor", () => {
    const keys = Object.keys(operationContractFields(parse()));
    for (const forbidden of ["company_id", "scoring_id", "created_by", "workflow_status", "contract_number", "distributor_id", "rating", "sector", "cancel_date", "expo_adjustment"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  it("stores the guarantor only when the operation has one", () => {
    const filled = { guarantorName: "Beta SA", guarantorNif: "a11111111", guarantorAddress: "Calle 2", guarantorRepresentative: "Luis", guarantorRepresentativeNif: "1z" };
    expect(operationContractFields(parse({ hasGuarantor: true, ...filled }))).toMatchObject({
      has_guarantor: true, guarantor_name: "Beta SA", guarantor_nif: "A11111111", guarantor_representative: "Luis", guarantor_representative_nif: "1Z",
    });
    // Unticking the guarantor on an edit clears what was typed.
    expect(operationContractFields(parse({ hasGuarantor: false, ...filled }))).toMatchObject({
      has_guarantor: false, guarantor_name: null, guarantor_nif: null, guarantor_address: null, guarantor_representative: null, guarantor_representative_nif: null,
    });
  });

  it("maps the equipment line, the SEPA mandate and the company refresh", () => {
    const v = parse();
    expect(operationAssetFields(v)).toEqual({ asset_type_id: ASSET_TYPE_ID, quantity: 3, description: "12 portátiles", unit_cost: 3333.33 });
    expect(operationMandateFields(v)).toMatchObject({
      debtor_name: "Alfa Hostelería SL", debtor_address: "Calle Mayor 1", debtor_postal_code: "28013", debtor_city: "Madrid",
      iban: "ES9121000418450200051332", signed_place: "Madrid",
    });
    // The mandate reference and date are set once at creation, never by this mapping.
    expect(Object.keys(operationMandateFields(v))).not.toEqual(expect.arrayContaining(["mandate_reference", "signed_at"]));
    expect(operationCompanyFields(v)).toEqual({
      address: "Calle Mayor 1", fiscal_postal_code: "28013", fiscal_city: "Madrid", fiscal_province: "Madrid",
      admin_name: "Ana Pérez", admin_nif: "12345678Z", phone: "600 000 000", email: "ana@alfa.example",
    });
    expect(Object.keys(operationCompanyFields(v))).not.toContain("cif");
  });
});

describe("editing a draft", () => {
  it("only a draft is editable", () => {
    expect(isEditableDraft("draft")).toBe(true);
    for (const status of ["pending_signature", "signed", "cancelled", "", "Draft"]) expect(isEditableDraft(status), status).toBe(false);
  });

  it("reopens the form with exactly what was saved: saving it unchanged stores the same rows", () => {
    for (const over of [
      {},
      { deliverySameAsFiscal: false, deliveryAddress: "Polígono 7, nave 3" },
      { residualValue: null, distributorId: null, quantity: 1, notes: "Revisar con comité" },
      { hasGuarantor: true, guarantorName: "Beta SA", guarantorNif: "A11111111", guarantorAddress: "Calle 2", guarantorRepresentative: "Luis", guarantorRepresentativeNif: "1Z" },
      { sepaBic: "BBVAESMMXXX", sepaDebtorName: "Otro Titular SL" },
    ] satisfies Partial<OperationInput>[]) {
      const { snapshot, quantity } = stored(over);
      const reopened = operationSchema.safeParse(operationInputFromContract(snapshot, quantity));
      expect(reopened.success, JSON.stringify(over)).toBe(true);
      if (!reopened.success) continue;
      const original = parse(over);
      expect(operationContractFields(reopened.data)).toEqual(operationContractFields(original));
      expect(operationAssetFields(reopened.data)).toEqual(operationAssetFields(original));
      expect(operationMandateFields(reopened.data)).toEqual(operationMandateFields(original));
      expect(reopened.data.distributorId).toBe(original.distributorId);
      expect(reopened.data.scoringId).toBe(SCORING_ID);
    }
  });

  it("gives the form plain strings for what the contract stores as null", () => {
    const { snapshot } = stored({ residualValue: null });
    const reopened = operationInputFromContract({ ...snapshot, mandate: null, scoring_id: null, asset_type: null, distributor: null }, 0);
    expect(reopened).toMatchObject({
      scoringId: "", assetTypeId: "", distributorId: null, sepaIban: "", sepaBic: "", sepaDebtorName: "Alfa Hostelería SL",
      residualValue: null, quantity: 1, signatoryAddress: "", deliveryAddress: "", guarantorName: "", notes: "",
    });
    // Without its scoring, asset type or IBAN it does not validate: the action refuses it.
    expect(operationSchema.safeParse(reopened).success).toBe(false);
  });

  it("reads numeric columns that arrive as strings", () => {
    const { snapshot, quantity } = stored();
    const reopened = operationInputFromContract({ ...snapshot, installment: "340.50", purchase_value: "10000.00", residual_value: "500" }, quantity);
    expect(reopened).toMatchObject({ installment: 340.5, purchaseValue: 10000, residualValue: 500 });
  });

  it("pre-fills section A from the saved snapshot", () => {
    const { snapshot, quantity } = stored();
    expect(identityFromOperationInput(operationInputFromContract(snapshot, quantity))).toEqual({
      clientName: "Alfa Hostelería SL", clientCif: "B12345678", fiscalAddress: "Calle Mayor 1", fiscalPostalCode: "28013", fiscalCity: "Madrid",
      fiscalProvince: "Madrid", signatoryName: "Ana Pérez", signatoryNif: "12345678Z", signatoryAddress: "", contactName: "Ana Pérez",
      contactPhone: "600 000 000", contactEmail: "ana@alfa.example",
    });
  });

  it("recomputes through the existing engine: the edited inputs alone change the schedule and the IRR", () => {
    // Exactly how the app reads a contract: stored inputs -> buildSchedule. Nothing computed is stored.
    const scheduleOf = (over: Partial<OperationInput>) => {
      const c = operationContractFields(parse(over));
      return buildSchedule(
        {
          signingDate: c.signing_date,
          billingLagMonths: 0,
          durationMonths: c.duration_months,
          installment: c.installment,
          residualValue: c.residual_value,
          purchaseValue: c.purchase_value,
          expoAdjustment: 0,
          cancelDate: null,
          residualWaived: false,
          amortizeOverRealLife: false,
        },
        new Date("2026-10-01T00:00:00Z"),
      );
    };
    const before = scheduleOf({});
    const after = scheduleOf({ durationMonths: 48, installment: 280, purchaseValue: 11000 });
    expect(before.rows.filter((r) => !r.isResidual)).toHaveLength(36);
    expect(after.rows.filter((r) => !r.isResidual)).toHaveLength(48);
    expect(after.assetBase).toBe(11000);
    expect(after.totals.principal).toBeCloseTo(11000, 4);
    expect(after.expectedAnnualIrr).not.toBeNull();
    expect(after.expectedAnnualIrr).not.toBeCloseTo(before.expectedAnnualIrr!, 4);
    // Saving the same terms again gives the same schedule: the edit has no state of its own.
    expect(scheduleOf({})).toEqual(before);
  });
});
