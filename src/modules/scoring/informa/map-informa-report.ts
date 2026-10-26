/**
 * Informa API v2 report (get-product, product=INFORME_MAYOR, idioma=es) ->
 * the same Financials the PDF parser produces, so both paths converge.
 *
 * Financials come from the most recent balance in
 * datosProducto.informacionFinanciera.listaBalances (latest fechaCierre), read
 * by codigoPartida. The codes are the NPGC templates of Informa's
 * "Codificación plantillas NPGC (BOE 30/05/2023)":
 *
 *   10000 TOTAL ACTIVO                 20000 A) PATRIMONIO NETO
 *   11000 A) ACTIVO NO CORRIENTE       21100 I. Capital
 *   12000 B) ACTIVO CORRIENTE          21700 VII. Resultado del ejercicio
 *   12310 | 12380 Clientes (*)         31000 B) PASIVO NO CORRIENTE
 *   12300 Deudores comerciales         32000 C) PASIVO CORRIENTE
 *                                      32510 | 32580 Proveedores (*)
 *                                      32500 Acreedores comerciales
 *   40100 Importe neto de la cifra de negocios
 *   40400 Aprovisionamientos (negative)
 *   40800 Amortización del inmovilizado (negative)
 *   41500 Gastos financieros (negative)
 *   49100 Resultado de explotación (EBIT)
 *   49500 Resultado del ejercicio
 *   ratios: 93622 EBIT, 93623 EBITDA, 93605 Periodo medio de pago (días)
 *
 * (*) Clientes / Proveedores are 12310 / 32510 in the Normal and Mixto
 * templates but 12380 / 32580 in Abreviado and PYMES; the totals above are
 * the same code in all four. Informa omits zero lines, so an absent balance
 * mass (11000/12000/31000/32000) in a balance that exists is 0.
 *
 * Derived values (same meaning as the PDF path):
 *   ebitda       = 49100 - 40800 (EBIT + amortisation); ratio 93623 if lines are absent
 *   grossMargin  = 40100 + 40400 (revenue less procurement)
 *   procurement, financialExpenses: stored positive, as the engine expects
 *
 * Every coded field is { valor, tablaDecodificacion, literal }; the literal
 * sent by Informa is used as-is (no local decoding tables).
 */
import { type AppMessage, msg } from "@/i18n/message";
import { EMPTY_FINANCIALS, type Financials } from "../domain/financials";
import { cnaeToSector } from "./cnae";
import { missingFinancials } from "./parse-informa-text";

export type CompanyStatusSeverity = "ok" | "warning" | "alert" | "unknown";

/** Informa "estado / código de vida" of the company. */
export interface InformaCompanyStatus {
  /** campoCodificadoVida: "00" = activa; anything else is a special situation (e.g. "90"). */
  code: string | null;
  literal: string | null;
  /** campoCodificadoSubcodigoVida: the event behind it (concurso, disolución, cierre de hoja registral...). */
  subcode: string | null;
  subcodeLiteral: string | null;
  /** campoCodificadoVidaEmpresaCompleto literal ("vida de la empresa ampliada"). */
  detail: string | null;
  /** fechaSituacionEspecialStatus, else fechaCodigoVidaActual (ISO). */
  since: string | null;
  /**
   * ok: vida 00 with no subcódigo. warning: vida 00 with a subcódigo.
   * alert: vida other than 00. unknown: Informa sent no vida code.
   */
  severity: CompanyStatusSeverity;
}

/** Informa's own risk indicators (informational: our score is always our model's). */
export interface InformaRisk {
  ratingInforma: number | null;
  opinionCredito: number | null;
  scoreEntregable: number | null;
  probabilidadFallo: number | null;
  scoreLiquidez: number | null;
  fechaCalculo: string | null;
}

export interface InformaBalanceInfo {
  year: number | null;
  closingDate: string | null;
  months: number | null;
  template: string | null;
  unit: string | null;
}

export interface InformaReportMapping {
  financials: Financials;
  missing: (keyof Financials)[];
  status: InformaCompanyStatus;
  risk: InformaRisk;
  /** productoSolicitado: INFORME_MAYOR falls back to comercial / abreviado when there is no financial report. */
  reportType: string | null;
  balance: InformaBalanceInfo | null;
  /** Things the analyst should double-check (no balances, old balance, odd unit...). */
  /** Things the analyst should check, as messages of the catalogue (scoring.informa.warnings.*). */
  warnings: AppMessage[];
}

// --- tolerant readers: the report is external input, any node may be missing ---
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const at = (v: unknown, ...path: string[]): unknown => path.reduce<unknown>((o, k) => obj(o)?.[k], v);
const str = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const coded = (v: unknown) => ({ valor: str(at(v, "valor")), literal: str(at(v, "literal")) });

/** "B-12.345.678" / " b12345678 " -> "B12345678"; null when it cannot be a Spanish NIF/CIF/NIE. */
export function normalizeCif(input: string): string | null {
  const cif = input.replace(/[\s.\-/]/g, "").toUpperCase();
  return /^[A-Z0-9]{9}$/.test(cif) ? cif : null;
}

/** "1980-02-01" -> "01/02/1980" (the PDF path's format). */
const isoToDmy = (iso: string | null) => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
};

const NO_SUBCODE = new Set(["", "0", "00"]);

export function decodeCompanyStatus(datosGenerales: unknown): InformaCompanyStatus {
  const vida = coded(at(datosGenerales, "campoCodificadoVida"));
  const sub = coded(at(datosGenerales, "campoCodificadoSubcodigoVida"));
  const subcode = sub.valor && !NO_SUBCODE.has(sub.valor) ? sub.valor : null;
  const severity: CompanyStatusSeverity = !vida.valor ? "unknown" : vida.valor !== "00" ? "alert" : subcode ? "warning" : "ok";
  return {
    code: vida.valor,
    literal: vida.literal,
    subcode,
    subcodeLiteral: subcode ? sub.literal : null,
    detail: str(at(datosGenerales, "campoCodificadoVidaEmpresaCompleto", "literal")),
    since: str(at(datosGenerales, "fechaSituacionEspecialStatus")) ?? str(at(datosGenerales, "fechaCodigoVidaActual")),
    severity,
  };
}

/** The balance with the latest fechaCierre (annoBalance when the date is absent). */
export function latestBalance(listaBalances: unknown): Obj | null {
  const key = (b: unknown) => str(at(b, "cabeceraBalance", "fechaCierre")) ?? `${num(at(b, "cabeceraBalance", "annoBalance")) ?? 0}-12-31`;
  const balances = arr(listaBalances).map(obj).filter((b): b is Obj => b !== null);
  return balances.reduce<Obj | null>((best, b) => (!best || key(b) > key(best) ? b : best), null);
}

/** codigoPartida -> valor over the asset, liability and P&L lists (the codes are disjoint). */
function partidas(balance: Obj): Map<string, number> {
  const out = new Map<string, number>();
  for (const list of ["listaPartidasBalanceActivo", "listaPartidasBalancePasivo", "listaPartidasCuentaPerdidasGanancias"]) {
    for (const line of arr(balance[list])) {
      const code = str(at(line, "codigoPartida"));
      const value = num(at(line, "valor"));
      if (code && value !== null) out.set(code, value);
    }
  }
  return out;
}

function ratios(balance: Obj): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of arr(balance.listaRatios)) {
    const code = str(at(r, "campoCodificadoRatio", "valor"));
    const value = num(at(r, "valor"));
    if (code && value !== null) out.set(code, value);
  }
  return out;
}

/** Euros per unit of the balance: "Euros" 1, "Miles de euros" 1,000, "Millones..." 1,000,000. */
function unitFactor(unitLiteral: string | null): number {
  if (!unitLiteral) return 1;
  if (/millon/i.test(unitLiteral)) return 1_000_000;
  if (/miles/i.test(unitLiteral)) return 1000;
  return 1;
}

const ADMIN_PRIORITY = [/administrador\s+[uú]nico/i, /consejero\s+delegado/i, /administrador\s+solidario/i, /administrador\s+mancomunado/i, /^presidente/i];

/** First administrator by role priority, "NAME SURNAME1 SURNAME2" like the PDF path. */
export function pickAdministrator(listaAdministradores: unknown): string | null {
  const admins = arr(listaAdministradores);
  const role = (a: unknown) => str(at(a, "campoCodificadoCargo", "literal")) ?? "";
  const chosen =
    ADMIN_PRIORITY.map((re) => admins.find((a) => re.test(role(a)))).find(Boolean) ??
    admins.find((a) => /administraci/i.test(str(at(a, "campoCodificadoTipoCargo", "literal")) ?? "")) ??
    null;
  if (!chosen) return null;
  const d = at(chosen, "denominacion");
  const person = [str(at(d, "nombre")), str(at(d, "apellido1")), str(at(d, "apellido2"))].filter(Boolean).join(" ");
  if (person && str(at(d, "nombre"))) return person;
  const full = str(at(d, "denominacionCompleta"));
  if (!full) return null;
  const [surnames, names] = full.split(/\s*,\s*/);
  return names ? `${names} ${surnames}` : full;
}

function latestPaymentPeriod(periodoMedioPago: unknown): number | null {
  const rows = arr(at(periodoMedioPago, "listaPeriodoMedioPago"))
    .map((r) => ({ year: num(at(r, "annoDatos")) ?? 0, days: num(at(r, "periodoMedioPagoProveedores")) }))
    .filter((r) => r.days !== null)
    .sort((a, b) => b.year - a.year);
  return rows[0]?.days ?? null;
}

export function mapInformaReport(report: unknown, today = new Date()): InformaReportMapping {
  const dp = at(report, "datosProducto");
  const ic = at(dp, "informacionComercial");
  const id = at(ic, "identificacion");
  const dg = at(ic, "datosGenerales");
  const dir = at(ic, "direcciones", "direccionActual");
  const actividad = at(ic, "actividad");
  const warnings: AppMessage[] = [];

  const reportType = str(at(report, "productoSolicitado"));
  const cnae2009 = str(at(actividad, "campoCodificadoCnae2009", "valor"));
  const cnae = cnae2009 ?? str(at(actividad, "campoCodificadoCnae2025", "valor"));

  const constitutionIso = str(at(dp, "estructuraLegal", "datosConstitucion", "fechaConstitucion"));
  let maturityYears: number | null = null;
  const c = constitutionIso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (c) maturityYears = Math.floor((today.getTime() - Date.UTC(+c[1], +c[2] - 1, +c[3])) / (365.25 * 24 * 3600 * 1000));

  const street = [str(at(dir, "campoCodificadoTipoVia", "literal")), str(at(dir, "nombreVia"))].filter(Boolean).join(" ");
  const numero = str(at(dir, "numeroVia"));

  const rating = at(dp, "riesgoComercial", "rating");
  const risk: InformaRisk = {
    ratingInforma: num(at(rating, "ratingInforma")),
    opinionCredito: num(at(rating, "opinionCredito")),
    scoreEntregable: num(at(rating, "scoreEntregable")),
    probabilidadFallo: num(at(rating, "probabilidadFallo")),
    scoreLiquidez: num(at(dp, "riesgoComercial", "ratingLiquidez", "scoreLiquidez")),
    fechaCalculo: str(at(rating, "fechaCalculoRating")),
  };

  const capital = num(at(dg, "capitalSocial", "importeCapitalSocial")) ?? num(at(dp, "estructuraLegal", "datosConstitucion", "importeCapitalSocial"));

  const base: Financials = {
    ...EMPTY_FINANCIALS,
    cif: normalizeCif(str(at(id, "cif")) ?? "") ?? str(at(id, "cif")) ?? "",
    name: str(at(id, "denominacionActual")) ?? "",
    sector: cnaeToSector(cnae),
    cnae,
    address: street ? (numero ? `${street}, ${numero}` : street) : null,
    fiscalPostalCode: str(at(dir, "codigoPostal")),
    fiscalCity: str(at(dir, "municipio")),
    fiscalProvince: str(at(dir, "campoCodificadoProvincia", "literal")),
    phone: str(arr(at(id, "listaTelefonos"))[0]),
    email: str(at(id, "email")),
    web: str(arr(at(id, "listaUrls"))[0]),
    constitutionDate: isoToDmy(constitutionIso),
    maturityYears,
    employees: num(at(ic, "empleados", "numeroTotalEmpleados")),
    adminName: pickAdministrator(at(dp, "estructuraCorporativa", "administradores", "listaAdministradores")),
    informaRating: risk.ratingInforma !== null ? String(risk.ratingInforma) : null,
    creditOpinionInforma: risk.opinionCredito,
    scoreLiquidez: risk.scoreLiquidez !== null ? String(risk.scoreLiquidez) : null,
    shareCapital: capital,
    paymentPeriodDays: latestPaymentPeriod(at(ic, "periodoMedioPago")),
  };

  const balance = latestBalance(at(dp, "informacionFinanciera", "listaBalances"));
  let financials = base;
  let balanceInfo: InformaBalanceInfo | null = null;

  if (!balance) {
    warnings.push(
      reportType ? msg("scoring.informa.warnings.noBalance", { report: reportType.replace(/_/g, " ") }) : msg("scoring.informa.warnings.noBalancePlain"),
    );
  } else {
    const head = obj(balance.cabeceraBalance) ?? {};
    const unit = str(at(head, "campoCodificadoUnidadDivisa", "literal"));
    const factor = unitFactor(unit);
    const p = partidas(balance);
    const r = ratios(balance);
    const line = (code: string) => (p.has(code) ? p.get(code)! * factor : null);
    const mass = (code: string) => line(code) ?? 0;
    const firstLine = (...codes: string[]) => codes.map(line).find((v) => v !== null) ?? null;
    const abs = (v: number | null) => (v === null ? null : Math.abs(v));

    const closingDate = str(head.fechaCierre);
    const year = num(head.annoBalance) ?? (closingDate ? Number(closingDate.slice(0, 4)) : null);
    const months = num(head.duracionMeses);
    balanceInfo = { year, closingDate, months, template: str(at(head, "campoCodificadoTipoPlantilla", "literal")), unit };

    if (unit && !/euro/i.test(unit)) warnings.push(msg("scoring.informa.warnings.unit", { unit }));
    if (months !== null && months !== 12) warnings.push(msg("scoring.informa.warnings.months", { months }));
    if (year !== null && year < today.getUTCFullYear() - 2) warnings.push(msg("scoring.informa.warnings.oldBalance", { year }));

    const revenue = line("40100");
    const procurement = line("40400");
    const ebit = line("49100") ?? (r.has("93622") ? r.get("93622")! * factor : null);
    const ebitda = line("49100") !== null ? line("49100")! - (line("40800") ?? 0) : r.has("93623") ? r.get("93623")! * factor : null;

    financials = {
      ...base,
      referenceYear: year,
      employees: base.employees ?? num(head.numeroTotalEmpleados),
      totalRevenue: revenue,
      procurement: abs(procurement),
      grossMargin: revenue !== null ? revenue + (procurement ?? 0) : null,
      ebitda,
      adjustedEbitda: ebitda,
      ebit,
      netResult: firstLine("49500", "21700"),
      financialExpenses: abs(line("41500")),
      totalAssets: line("10000"),
      nonCurrentAssets: mass("11000"),
      currentAssets: mass("12000"),
      equity: line("20000"),
      nonCurrentLiabilities: mass("31000"),
      currentLiabilities: mass("32000"),
      shareCapital: base.shareCapital ?? line("21100"),
      receivables: firstLine("12310", "12380", "12300"),
      payables: firstLine("32510", "32580", "32500"),
      paymentPeriodDays: base.paymentPeriodDays ?? r.get("93605") ?? null,
    };
  }

  return {
    financials,
    missing: missingFinancials(financials),
    status: decodeCompanyStatus(dg),
    risk,
    reportType,
    balance: balanceInfo,
    warnings,
  };
}
