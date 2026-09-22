/**
 * Parser for the text of a standard Informa D&B company report (PDF).
 * Ported from the scoring mockup. Works on the text produced by
 * extractInformaText(): each page's text items joined by single spaces.
 *
 * The balance sheet and P&L tables are read row-aligned: the latest year is
 * always the leftmost column, so each row's first number is the one we want.
 */
import { EMPTY_FINANCIALS, type Financials } from "../domain/financials";
import { cnaeToSector } from "./cnae";

/** Spanish-formatted number ("1.234.567,89") to a JS number. */
const toNumber = (s: string | null): number | null => {
  if (!s) return null;
  const v = parseFloat(s.replace(/\./g, "").replace(",", ".").replace(/[€\s]/g, ""));
  return Number.isNaN(v) ? null : v;
};

const NUMBER_RE = /(-?\d{1,3}(?:\.\d{3})*,\d{2})/g;

export interface InformaParseResult {
  financials: Financials;
  /** Fields the parser could not find - shown to the analyst for manual entry. */
  missing: (keyof Financials)[];
}

export function parseInformaText(text: string, today = new Date()): InformaParseResult {
  const grab = (re: RegExp) => text.match(re)?.[1] ?? null;

  const name =
    grab(/Informa Comercial\s+([A-ZÁÉÍÓÚÑ0-9 ,.\-&]+SL\.?|[A-ZÁÉÍÓÚÑ0-9 ,.\-&]+S\.A\.?)/) ??
    grab(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 .,&-]+(?:SL|S\.L|S\.A|SA))\.?/m);
  const cif = grab(/NIF\s+([A-Z][0-9]{8})/);
  const fiscal = parseFiscalAddress(text);
  const cnae =
    grab(/CNAE 2009\)\s+(\d{4})/) ?? grab(/CNAE 2009:\s+(\d{4})/) ?? grab(/ACTIVIDAD CNAE\s+(?:CNAE 2009:\s+)?(\d{4})/);
  const constitutionDate = grab(/FECHA DE CONSTITUCIÓN\s+(\d{2}\/\d{2}\/\d{4})/);
  const adminName = parseAdministrator(text);

  // Executive-summary fallbacks (rounded euros), overridden by the detailed P&L.
  let totalRevenue = toNumber(grab(/VENTAS BALANCE.*?([\d.,]+)\s*€\s*\(Registro/));
  let netResult = toNumber(grab(/RESULTADOS BALANCE.*?(-?[\d.,]+)\s*€\s*\(Registro/));

  // Balance sheet: each row has yearCount x (value, %). Rows: NCA, CA, Equity, NCL, CL.
  let nonCurrentAssets: number | null = null;
  let currentAssets: number | null = null;
  let equity: number | null = null;
  let nonCurrentLiabilities: number | null = null;
  let currentLiabilities: number | null = null;
  const balance = text.match(/Análisis del Balance([\s\S]{0,2500}?)(?=Balance Activo|Balance Pasivo|Comentarios del Balance|Datos financieros|$)/);
  if (balance) {
    const section = balance[1];
    const yearCount = clampYears((section.match(/31\/12\/\d{4}/g) ?? []).length);
    const nums = [...section.matchAll(NUMBER_RE)].map((m) => toNumber(m[1]));
    const stride = yearCount * 2;
    if (nums.length >= 5 * stride) {
      nonCurrentAssets = nums[0];
      currentAssets = nums[stride];
      equity = nums[2 * stride];
      nonCurrentLiabilities = nums[3 * stride];
      currentLiabilities = nums[4 * stride];
    }
  }

  // P&L: Sales row has yearCount values; margin/EBITDA/EBIT/net rows have value + %.
  let grossMargin: number | null = null;
  let ebitda: number | null = null;
  let ebit: number | null = null;
  const pl = text.match(/Análisis de la Cuenta de Pérdidas y Ganancias([\s\S]{0,3000}?)(?=Comentarios de la Cuenta|Distribución de resultados|Datos financieros|Comparativa Sectorial|$)/);
  if (pl) {
    const section = pl[1];
    const yearCount = clampYears((section.match(/31\/12\/\d{4}/g) ?? []).length);
    const nums = [...section.matchAll(NUMBER_RE)].map((m) => toNumber(m[1]));
    if (nums.length >= 7 * yearCount + 1) {
      grossMargin = nums[yearCount];
      ebitda = nums[3 * yearCount];
      ebit = nums[5 * yearCount];
      if (nums[0] != null) totalRevenue = nums[0];
      if (nums[7 * yearCount] != null) netResult = nums[7 * yearCount];
    }
  }

  let maturityYears: number | null = null;
  if (constitutionDate) {
    const [d, m, y] = constitutionDate.split("/").map(Number);
    maturityYears = Math.floor((today.getTime() - Date.UTC(y, m - 1, d)) / (365.25 * 24 * 3600 * 1000));
  }

  const referenceYear = grab(/VENTAS BALANCE\s+\((\d{4})\)/) ?? grab(/ACTIVO TOTAL\s+\((\d{4})\)/) ?? grab(/DEPÓSITO INDIVIDUAL\s+(\d{4})/);
  const informaRating = grab(/(?:RATING INFORMA|NOTA INFORMA)\s+(\d+\/\d+)/);

  const financials: Financials = {
    ...EMPTY_FINANCIALS,
    cif: cif ?? "",
    name: name?.trim() ?? "",
    address: fiscal.street,
    fiscalPostalCode: fiscal.postalCode,
    fiscalCity: fiscal.city,
    fiscalProvince: fiscal.province,
    cnae,
    sector: cnaeToSector(cnae),
    phone: grab(/TELÉFONOS\s+(\d+)/),
    web: grab(/PÁGINA WEB\s+(\S+)/),
    email: grab(/EMAIL CORPORATIVO\s+(\S+@\S+)/),
    constitutionDate,
    maturityYears,
    employees: toNumber(grab(/EMPLEADOS\s+(\d+)/)),
    adminName,
    referenceYear: referenceYear ? Number(referenceYear) : null,
    informaRating,
    creditOpinionInforma: toNumber(grab(/OPINIÓN DE CRÉDITO\s+([\d.,]+)\s*€/)),
    scoreLiquidez: grab(/SCORE LIQUIDEZ\s+(\d+\/\d+)/),
    resilience: grab(/RESILIENCIA\s+(\d+\/\d+)/),
    totalRevenue,
    netResult,
    totalAssets: toNumber(grab(/ACTIVO TOTAL.*?([\d.,]+)\s*€/)),
    shareCapital: toNumber(grab(/CAPITAL SOCIAL\s+([\d.,]+)\s*€/)),
    nonCurrentAssets,
    currentAssets,
    equity,
    nonCurrentLiabilities,
    currentLiabilities,
    grossMargin,
    ebitda,
    ebit,
    adjustedEbitda: ebitda,
    paymentPeriodDays: toNumber(grab(/Periodo medio de pago a proveedores\s+(\d+)/)),
  };

  const required: (keyof Financials)[] = [
    "cif", "name", "address", "fiscalPostalCode", "fiscalCity", "adminName", "totalRevenue", "netResult", "ebitda", "nonCurrentAssets", "currentAssets",
    "equity", "nonCurrentLiabilities", "currentLiabilities", "maturityYears",
  ];
  const missing = required.filter((k) => financials[k] === null || financials[k] === "");
  return { financials, missing };
}

/**
 * "DOMICILIO SOCIAL RONDA GENERAL MITRE, 172 - BJ DR 08006 BARCELONA (BARCELONA) TELÉFONOS ..."
 * -> street / postal code / city / province. The city runs until the province
 * in brackets or the next upper-case section label.
 */
export function parseFiscalAddress(text: string): { street: string | null; postalCode: string | null; city: string | null; province: string | null } {
  const m = text.match(
    /DOMICILIO SOCIAL\s+(.+?),?\s+(\d{5})\s+([A-ZÁÉÍÓÚÑÜÀÈÒÇ'][A-ZÁÉÍÓÚÑÜÀÈÒÇ'. -]*?)\s*(?:\(([^)]+)\)|(?=\s+(?:TELÉFONOS?|PÁGINA WEB|EMAIL|FAX|CNAE|ACTIVIDAD|FORMA JURÍDICA|FECHA|OBJETO|CAPITAL)\b)|$)/,
  );
  if (!m) return { street: null, postalCode: null, city: null, province: null };
  return { street: m[1].trim(), postalCode: m[2], city: m[3].trim(), province: m[4]?.trim() ?? null };
}

const ADMIN_ROLES = "ADMINISTRADOR ÚNICO|ADMINISTRADOR SOLIDARIO|ADMINISTRADOR MANCOMUNADO|CONSEJERO DELEGADO|PRESIDENTE";

/** First administrator listed, "GIL MARSA, DAVID" reordered to "DAVID GIL MARSA". */
export function parseAdministrator(text: string): string | null {
  const m = text.match(new RegExp(`(?:${ADMIN_ROLES})\\s+([A-ZÁÉÍÓÚÑÜÀÈÒÇ ,.'-]+?)\\s+(?:Estructura|ACCIONISTA|Cargo|ADMINISTRADOR|CONSEJERO|PRESIDENTE|Fecha|FECHA|Órgano)`));
  if (!m) return null;
  const raw = m[1].trim().replace(/\s+/g, " ");
  const [surnames, names] = raw.split(/\s*,\s*/);
  return names ? `${names} ${surnames}` : raw;
}

const clampYears = (headers: number) => Math.max(1, Math.min(5, headers || 3));
