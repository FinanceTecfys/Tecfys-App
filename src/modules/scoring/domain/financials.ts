import { z } from "zod";

const money = z.number().finite().nullable();

/** Company identity + latest-year financials used by the scoring engine. */
export const financialsSchema = z.object({
  cif: z.string().trim().min(1, "CIF obligatorio"),
  name: z.string().trim().min(1, "Razón social obligatoria"),
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

/** Numeric fields editable in the financials form, grouped for display. */
export const FINANCIAL_FIELDS = {
  "Cuenta de resultados": [
    ["totalRevenue", "Ventas"],
    ["grossMargin", "Margen bruto"],
    ["procurement", "Aprovisionamientos"],
    ["ebitda", "EBITDA"],
    ["adjustedEbitda", "EBITDA ajustado"],
    ["ebit", "EBIT"],
    ["netResult", "Resultado neto"],
    ["financialExpenses", "Gastos financieros"],
  ],
  "Balance": [
    ["nonCurrentAssets", "Activo no corriente"],
    ["currentAssets", "Activo corriente"],
    ["equity", "Patrimonio neto"],
    ["nonCurrentLiabilities", "Pasivo no corriente"],
    ["currentLiabilities", "Pasivo corriente"],
    ["receivables", "Clientes"],
    ["payables", "Proveedores"],
    ["shareCapital", "Capital social"],
  ],
} as const satisfies Record<string, readonly (readonly [keyof Financials, string])[]>;
