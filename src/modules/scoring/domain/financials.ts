import { z } from "zod";

const money = z.number().finite().nullable();

/** Company identity + latest-year financials used by the scoring engine. */
export const financialsSchema = z.object({
  // Messages are keys of the catalogue; the server action translates them.
  cif: z.string().trim().min(1, "validation.scoring.cifRequired"),
  name: z.string().trim().min(1, "validation.scoring.nameRequired"),
  country: z.string().default("ES"),
  sector: z.string().nullable(),
  cnae: z.string().nullable(),
  /** Fiscal address: street line (Informa "domicilio social") + postal code / city / province. */
  address: z.string().nullable(),
  fiscalPostalCode: z.string().nullable(),
  fiscalCity: z.string().nullable(),
  fiscalProvince: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  web: z.string().nullable(),
  constitutionDate: z.string().nullable(), // dd/mm/yyyy as printed by Informa
  maturityYears: z.number().nullable(),
  employees: z.number().nullable(),
  adminName: z.string().nullable(),
  /** Not in Informa: typed in by the analyst. */
  adminNif: z.string().nullable(),
  referenceYear: z.number().nullable(),
  // Informa risk indicators (informational)
  informaRating: z.string().nullable(),
  creditOpinionInforma: money,
  scoreLiquidez: z.string().nullable(),
  resilience: z.string().nullable(),
  // P&L
  totalRevenue: money,
  grossMargin: money,
  ebitda: money,
  ebit: money,
  netResult: money,
  financialExpenses: money,
  procurement: money,
  adjustedEbitda: money,
  // Balance sheet
  totalAssets: money,
  nonCurrentAssets: money,
  currentAssets: money,
  equity: money,
  nonCurrentLiabilities: money,
  currentLiabilities: money,
  shareCapital: money,
  receivables: money,
  payables: money,
  paymentPeriodDays: money,
});

export type Financials = z.infer<typeof financialsSchema>;

/**
 * The same shape for the live preview: the score does not depend on the CIF or
 * the name, which are still empty while the analyst starts typing.
 */
export const previewFinancialsSchema = financialsSchema.extend({ cif: z.string(), name: z.string() });

export const EMPTY_FINANCIALS: Financials = {
  cif: "", name: "", country: "ES", sector: null, cnae: null, address: null, fiscalPostalCode: null, fiscalCity: null,
  fiscalProvince: null, phone: null, email: null, web: null,
  constitutionDate: null, maturityYears: null, employees: null, adminName: null, adminNif: null, referenceYear: null,
  informaRating: null, creditOpinionInforma: null, scoreLiquidez: null, resilience: null,
  totalRevenue: null, grossMargin: null, ebitda: null, ebit: null, netResult: null, financialExpenses: null,
  procurement: null, adjustedEbitda: null,
  totalAssets: null, nonCurrentAssets: null, currentAssets: null, equity: null,
  nonCurrentLiabilities: null, currentLiabilities: null, shareCapital: null, receivables: null, payables: null,
  paymentPeriodDays: null,
};

/**
 * Numeric fields editable in the financials form, grouped for display. The
 * group and field names are messages: scoring.fieldGroups.<group> and
 * scoring.fields.<field>.
 */
export const FINANCIAL_FIELDS = [
  { group: "pnl", fields: ["totalRevenue", "grossMargin", "procurement", "ebitda", "adjustedEbitda", "ebit", "netResult", "financialExpenses"] },
  { group: "balance", fields: ["nonCurrentAssets", "currentAssets", "equity", "nonCurrentLiabilities", "currentLiabilities", "receivables", "payables", "shareCapital"] },
] as const satisfies readonly { group: string; fields: readonly (keyof Financials)[] }[];
