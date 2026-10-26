/**
 * "Nueva operación" input: identification (A), SEPA mandate (B) and economic
 * terms (C). One schema, used by the form for field errors and re-applied by
 * the server action, which is the only authority. Every message is a key of
 * the catalogue (validation.operation.*, validation.sepa.*) that the action
 * translates before it reaches the form.
 */
import { z } from "zod";
import { deriveBic, IBAN_ERROR_MESSAGES, isValidBic, normalizeBic, normalizeIban, validateIban } from "./sepa";

const text = (message: string) => z.string().trim().min(1, message);
const optionalText = z.string().trim().optional().transform((v) => (v ? v : null));
const taxId = (message: string) => text(message).transform((v) => v.replace(/[\s.-]/g, "").toUpperCase());

export const operationSchema = z
  .object({
    scoringId: z.uuid(),

    // A. Datos identificativos (snapshot on the contract)
    clientName: text("validation.operation.clientName"),
    clientCif: taxId("validation.operation.clientCif"),
    fiscalAddress: text("validation.operation.fiscalAddress"),
    fiscalPostalCode: text("validation.operation.fiscalPostalCode").pipe(z.string().regex(/^[0-9A-Z -]{4,10}$/i, "validation.operation.fiscalPostalCodeInvalid")),
    fiscalCity: text("validation.operation.fiscalCity"),
    fiscalProvince: optionalText,
    signatoryName: text("validation.operation.signatoryName"),
    signatoryNif: taxId("validation.operation.signatoryNif"),
    signatoryAddress: optionalText,
    contactName: text("validation.operation.contactName"),
    contactPhone: optionalText,
    contactEmail: z.email("validation.operation.contactEmail"),
    deliverySameAsFiscal: z.boolean(),
    deliveryAddress: optionalText,

    // B. Orden de domiciliación SEPA
    sepaIban: z.string(),
    sepaDebtorName: text("validation.operation.sepaDebtorName"),
    sepaBic: optionalText,

    // C. Condiciones económicas
    distributorId: z.uuid().nullable(),
    assetTypeId: z.uuid({ error: "validation.operation.assetType" }),
    productDescription: text("validation.operation.productDescription").pipe(z.string().max(500, "validation.operation.productDescriptionMax")),
    contractType: z.string().min(1),
    signingDate: z.iso.date({ error: "validation.operation.signingDate" }),
    durationMonths: z.number().int().min(1, "validation.operation.durationMin").max(120, "validation.operation.durationMax"),
    installment: z.number().positive("validation.operation.installmentPositive"),
    residualValue: z.number().min(0, "validation.operation.notNegative").nullable(),
    purchaseValue: z.number().positive("validation.operation.purchaseValue"),
    quantity: z.number().int().min(1).default(1),
    hasGuarantor: z.boolean(),
    guarantorName: optionalText,
    guarantorNif: optionalText,
    guarantorAddress: optionalText,
    guarantorRepresentative: optionalText,
    guarantorRepresentativeNif: optionalText,
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    const iban = validateIban(v.sepaIban);
    if (!iban.ok) ctx.addIssue({ code: "custom", path: ["sepaIban"], message: IBAN_ERROR_MESSAGES[iban.error] });
    if (v.sepaBic && !isValidBic(v.sepaBic)) ctx.addIssue({ code: "custom", path: ["sepaBic"], message: "validation.operation.bicInvalid" });
    if (!v.deliverySameAsFiscal && !v.deliveryAddress) ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "validation.operation.deliveryAddress" });
    if (v.hasGuarantor) {
      if (!v.guarantorName) ctx.addIssue({ code: "custom", path: ["guarantorName"], message: "validation.operation.guarantorName" });
      if (!v.guarantorNif) ctx.addIssue({ code: "custom", path: ["guarantorNif"], message: "validation.operation.guarantorNif" });
      if (!v.guarantorAddress) ctx.addIssue({ code: "custom", path: ["guarantorAddress"], message: "validation.operation.guarantorAddress" });
      if (v.guarantorRepresentative && !v.guarantorRepresentativeNif) {
        ctx.addIssue({ code: "custom", path: ["guarantorRepresentativeNif"], message: "validation.operation.guarantorRepresentativeNif" });
      }
    }
  })
  .transform((v) => {
    const iban = normalizeIban(v.sepaIban);
    return {
      ...v,
      sepaIban: iban,
      // Keep the analyst's BIC; otherwise derive it for known Spanish entities.
      sepaBic: v.sepaBic ? normalizeBic(v.sepaBic) : deriveBic(iban),
      deliveryAddress: v.deliverySameAsFiscal ? null : v.deliveryAddress,
      guarantorNif: v.guarantorNif?.toUpperCase() ?? null,
      guarantorRepresentativeNif: v.guarantorRepresentativeNif?.toUpperCase() ?? null,
    };
  });

export type OperationInput = z.input<typeof operationSchema>;
export type Operation = z.output<typeof operationSchema>;

/** Section A prefill, from the company behind the approved scoring. */
export interface IdentityPrefill {
  clientName: string;
  clientCif: string;
  fiscalAddress: string;
  fiscalPostalCode: string;
  fiscalCity: string;
  fiscalProvince: string;
  signatoryName: string;
  signatoryNif: string;
  signatoryAddress: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
}

export function identityFromCompany(c: {
  name: string;
  cif: string;
  address: string | null;
  fiscal_postal_code: string | null;
  fiscal_city: string | null;
  fiscal_province: string | null;
  admin_name: string | null;
  admin_nif: string | null;
  phone: string | null;
  email: string | null;
}): IdentityPrefill {
  return {
    clientName: c.name,
    clientCif: c.cif,
    fiscalAddress: c.address ?? "",
    fiscalPostalCode: c.fiscal_postal_code ?? "",
    fiscalCity: c.fiscal_city ?? "",
    fiscalProvince: c.fiscal_province ?? "",
    signatoryName: c.admin_name ?? "",
    signatoryNif: c.admin_nif ?? "",
    signatoryAddress: "",
    contactName: c.admin_name ?? "",
    contactPhone: c.phone ?? "",
    contactEmail: c.email ?? "",
  };
}

// ---------------------------------------------------------------------------
// Operation -> rows. One mapping, shared by the creation of a draft and by its
// edit, so both store exactly the same inputs and the schedule engine
// recomputes from them on the next read.
// ---------------------------------------------------------------------------

/** The contract columns an operation writes (not its company, scoring, creator or distributor). */
export function operationContractFields(v: Operation) {
  return {
    asset_type_id: v.assetTypeId,
    contract_type: v.contractType,
    signing_date: v.signingDate,
    duration_months: v.durationMonths,
    installment: v.installment,
    residual_value: v.residualValue,
    purchase_value: v.purchaseValue,
    has_guarantor: v.hasGuarantor,
    guarantor_name: v.hasGuarantor ? v.guarantorName : null,
    guarantor_nif: v.hasGuarantor ? v.guarantorNif : null,
    guarantor_address: v.hasGuarantor ? v.guarantorAddress : null,
    guarantor_representative: v.hasGuarantor ? v.guarantorRepresentative : null,
    guarantor_representative_nif: v.hasGuarantor && v.guarantorRepresentative ? v.guarantorRepresentativeNif : null,
    client_name: v.clientName,
    client_cif: v.clientCif,
    fiscal_address: v.fiscalAddress,
    fiscal_postal_code: v.fiscalPostalCode,
    fiscal_city: v.fiscalCity,
    fiscal_province: v.fiscalProvince,
    signatory_name: v.signatoryName,
    signatory_nif: v.signatoryNif,
    signatory_address: v.signatoryAddress,
    contact_name: v.contactName,
    contact_phone: v.contactPhone,
    contact_email: v.contactEmail,
    delivery_same_as_fiscal: v.deliverySameAsFiscal,
    delivery_address: v.deliveryAddress,
    product_description: v.productDescription,
    notes: v.notes || null,
  };
}

/** The equipment line of the contract. */
export function operationAssetFields(v: Operation) {
  return {
    asset_type_id: v.assetTypeId,
    quantity: v.quantity,
    description: v.productDescription,
    unit_cost: Math.round((v.purchaseValue / v.quantity) * 100) / 100,
  };
}

/** The SEPA mandate fields that follow the operation (its reference and date are set once, at creation). */
export function operationMandateFields(v: Operation) {
  return {
    debtor_name: v.sepaDebtorName,
    debtor_address: v.fiscalAddress,
    debtor_postal_code: v.fiscalPostalCode,
    debtor_city: v.fiscalCity,
    debtor_province: v.fiscalProvince,
    iban: v.sepaIban,
    bic: v.sepaBic,
    signed_place: v.fiscalCity,
  };
}

/** The company record is refreshed with the corrected identification (never its CIF, which identifies it). */
export function operationCompanyFields(v: Operation) {
  return {
    address: v.fiscalAddress,
    fiscal_postal_code: v.fiscalPostalCode,
    fiscal_city: v.fiscalCity,
    fiscal_province: v.fiscalProvince,
    admin_name: v.signatoryName,
    admin_nif: v.signatoryNif,
    phone: v.contactPhone,
    email: v.contactEmail,
  };
}

// ---------------------------------------------------------------------------
// Editing a draft: the saved contract back into the form's input.
// ---------------------------------------------------------------------------

/** Only a draft is editable: once sent to signature or signed, the terms are the contract. */
export const isEditableDraft = (workflowStatus: string): boolean => workflowStatus === "draft";

/** What the edit form needs from a stored contract (the columns operationContractFields writes, read back). */
export interface DraftContractSnapshot {
  scoring_id: string | null;
  client_name: string | null;
  client_cif: string | null;
  fiscal_address: string | null;
  fiscal_postal_code: string | null;
  fiscal_city: string | null;
  fiscal_province: string | null;
  signatory_name: string | null;
  signatory_nif: string | null;
  signatory_address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  delivery_same_as_fiscal: boolean;
  delivery_address: string | null;
  distributor: { id: string } | null;
  asset_type: { id: string } | null;
  product_description: string | null;
  contract_type: string;
  signing_date: string;
  duration_months: number;
  installment: number | string;
  residual_value: number | string | null;
  purchase_value: number | string;
  has_guarantor: boolean;
  guarantor_name: string | null;
  guarantor_nif: string | null;
  guarantor_address: string | null;
  guarantor_representative: string | null;
  guarantor_representative_nif: string | null;
  notes: string | null;
  mandate: { iban: string; debtor_name: string; bic: string | null } | null;
}

/** The saved draft as the operation form's input, so editing starts from exactly what was stored. */
export function operationInputFromContract(c: DraftContractSnapshot, quantity: number): OperationInput {
  return {
    scoringId: c.scoring_id ?? "",
    clientName: c.client_name ?? "",
    clientCif: c.client_cif ?? "",
    fiscalAddress: c.fiscal_address ?? "",
    fiscalPostalCode: c.fiscal_postal_code ?? "",
    fiscalCity: c.fiscal_city ?? "",
    fiscalProvince: c.fiscal_province ?? "",
    signatoryName: c.signatory_name ?? "",
    signatoryNif: c.signatory_nif ?? "",
    signatoryAddress: c.signatory_address ?? "",
    contactName: c.contact_name ?? "",
    contactPhone: c.contact_phone ?? "",
    contactEmail: c.contact_email ?? "",
    deliverySameAsFiscal: c.delivery_same_as_fiscal,
    deliveryAddress: c.delivery_address ?? "",
    sepaIban: c.mandate?.iban ?? "",
    sepaDebtorName: c.mandate?.debtor_name ?? c.client_name ?? "",
    sepaBic: c.mandate?.bic ?? "",
    distributorId: c.distributor?.id ?? null,
    assetTypeId: c.asset_type?.id ?? "",
    productDescription: c.product_description ?? "",
    contractType: c.contract_type,
    signingDate: c.signing_date,
    durationMonths: c.duration_months,
    installment: Number(c.installment),
    residualValue: c.residual_value === null ? null : Number(c.residual_value),
    purchaseValue: Number(c.purchase_value),
    quantity: Number.isInteger(quantity) && quantity >= 1 ? quantity : 1,
    hasGuarantor: c.has_guarantor,
    guarantorName: c.guarantor_name ?? "",
    guarantorNif: c.guarantor_nif ?? "",
    guarantorAddress: c.guarantor_address ?? "",
    guarantorRepresentative: c.guarantor_representative ?? "",
    guarantorRepresentativeNif: c.guarantor_representative_nif ?? "",
    notes: c.notes ?? "",
  };
}

/** Section A of the form, from an operation input (the edit of a draft). */
export function identityFromOperationInput(input: OperationInput): IdentityPrefill {
  return {
    clientName: input.clientName,
    clientCif: input.clientCif,
    fiscalAddress: input.fiscalAddress,
    fiscalPostalCode: input.fiscalPostalCode,
    fiscalCity: input.fiscalCity,
    fiscalProvince: input.fiscalProvince ?? "",
    signatoryName: input.signatoryName,
    signatoryNif: input.signatoryNif,
    signatoryAddress: input.signatoryAddress ?? "",
    contactName: input.contactName,
    contactPhone: input.contactPhone ?? "",
    contactEmail: input.contactEmail,
  };
}

