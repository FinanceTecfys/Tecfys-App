/**
 * "Nueva operación" input: identification (A), SEPA mandate (B) and economic
 * terms (C). One schema, used by the form for field errors and re-applied by
 * the server action, which is the only authority.
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
    clientName: text("Indica la razón social"),
    clientCif: taxId("Indica el CIF/NIF"),
    fiscalAddress: text("Indica la dirección fiscal"),
    fiscalPostalCode: text("Indica el código postal").pipe(z.string().regex(/^[0-9A-Z -]{4,10}$/i, "Código postal no válido")),
    fiscalCity: text("Indica la ciudad"),
    fiscalProvince: optionalText,
    signatoryName: text("Indica el administrador / firmante"),
    signatoryNif: taxId("Indica el DNI del firmante"),
    signatoryAddress: optionalText,
    contactName: text("Indica la persona de contacto"),
    contactPhone: optionalText,
    contactEmail: z.email("Email no válido"),
    deliverySameAsFiscal: z.boolean(),
    deliveryAddress: optionalText,

    // B. Orden de domiciliación SEPA
    sepaIban: z.string(),
    sepaDebtorName: text("Indica el titular de la cuenta"),
    sepaBic: optionalText,

    // C. Condiciones económicas
    distributorId: z.uuid().nullable(),
    assetTypeId: z.uuid({ error: "Selecciona el tipo de activo" }),
    productDescription: text("Describe el producto").pipe(z.string().max(500, "Máximo 500 caracteres")),
    contractType: z.string().min(1),
    signingDate: z.iso.date({ error: "Fecha no válida" }),
    durationMonths: z.number().int().min(1, "Mínimo 1 mes").max(120, "Máximo 120 meses"),
    installment: z.number().positive("La cuota debe ser positiva"),
    residualValue: z.number().min(0, "No puede ser negativo").nullable(),
    purchaseValue: z.number().positive("Indica el coste del equipo"),
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
    if (v.sepaBic && !isValidBic(v.sepaBic)) ctx.addIssue({ code: "custom", path: ["sepaBic"], message: "BIC no válido (8 u 11 caracteres)" });
    if (!v.deliverySameAsFiscal && !v.deliveryAddress) ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Indica el domicilio de entrega" });
    if (v.hasGuarantor) {
      if (!v.guarantorName) ctx.addIssue({ code: "custom", path: ["guarantorName"], message: "Indica el avalista" });
      if (!v.guarantorNif) ctx.addIssue({ code: "custom", path: ["guarantorNif"], message: "Indica el NIF del avalista" });
      if (!v.guarantorAddress) ctx.addIssue({ code: "custom", path: ["guarantorAddress"], message: "Indica el domicilio del avalista" });
      if (v.guarantorRepresentative && !v.guarantorRepresentativeNif) {
        ctx.addIssue({ code: "custom", path: ["guarantorRepresentativeNif"], message: "Indica el DNI del representante" });
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

