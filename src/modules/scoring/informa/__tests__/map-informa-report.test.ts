import { describe, expect, it } from "vitest";
import { EMPTY_FINANCIALS, financialsSchema } from "../../domain/financials";
import { cnaeToSector } from "../cnae";
import { decodeCompanyStatus, latestBalance, mapInformaReport, normalizeCif, pickAdministrator } from "../map-informa-report";
import sample from "./fixtures/informe-mayor-A00000000.json";

// Informa's public demo report (A00000000, INFORME_MAYOR, June 2026), as returned by get-product.
const TODAY = new Date(Date.UTC(2026, 8, 29));
const clone = (): typeof sample => structuredClone(sample);
type Line = { codigoPartida: string; valor: number; campoCodificadoPartidaConPlantilla?: unknown };

describe("mapInformaReport - demo company A00000000", () => {
  const m = mapInformaReport(sample, TODAY);

  it("produces the same Financials shape as the PDF path", () => {
    expect(Object.keys(m.financials).sort()).toEqual(Object.keys(EMPTY_FINANCIALS).sort());
    expect(financialsSchema.safeParse(m.financials).success).toBe(true);
    expect(m.missing).toEqual([]);
  });

  it("reads the latest balance (2025) by codigoPartida", () => {
    expect(m.balance).toEqual({ year: 2025, closingDate: "2025-12-31", months: 12, template: "Normal PGC2007", unit: "Euros" });
    expect(m.financials).toMatchObject({
      referenceYear: 2025,
      totalRevenue: 2_300_000, // 40100
      procurement: 810_000, // |40400|
      grossMargin: 1_490_000, // 40100 + 40400
      ebit: 1_070_000, // 49100
      ebitda: 1_145_000, // 49100 - 40800
      adjustedEbitda: 1_145_000,
      netResult: 950_000, // 49500
      financialExpenses: 180_000, // |41500|
      totalAssets: 15_910_000, // 10000
      nonCurrentAssets: 12_110_000, // 11000
      currentAssets: 3_800_000, // 12000
      equity: 13_293_000, // 20000
      nonCurrentLiabilities: 90_000, // 31000
      currentLiabilities: 2_527_000, // 32000
      receivables: 2_400_000, // 12310
      payables: 250_000, // 32510
      shareCapital: 500_000,
      paymentPeriodDays: 87, // latest periodoMedioPago (2023)
      employees: 18,
    });
  });

  it("derives an EBITDA that matches Informa's own ratio 93623 and a balance that squares", () => {
    const ratio = sample.datosProducto.informacionFinanciera.listaBalances[0].listaRatios.find((r) => r.campoCodificadoRatio.valor === "93623");
    expect(m.financials.ebitda).toBe(ratio?.valor);
    const f = m.financials;
    expect(f.equity! + f.nonCurrentLiabilities! + f.currentLiabilities!).toBe(f.totalAssets);
    expect(f.nonCurrentAssets! + f.currentAssets!).toBe(f.totalAssets);
  });

  it("maps identity, address and administrator", () => {
    expect(m.financials).toMatchObject({
      cif: "A00000000",
      name: "SOCIEDAD NUEVA DE DEMOSTRACION SAU",
      address: "CALLE GOYA, 32",
      fiscalPostalCode: "28001",
      fiscalCity: "MADRID",
      fiscalProvince: "Madrid",
      phone: "900176076",
      email: "laficticianueva@empresa.com",
      web: "www.laprimerasd.es",
      constitutionDate: "01/02/1980",
      maturityYears: 46,
      adminName: "JOSE LUIS RODRIGO DEMOSTRACION", // Presidente: no administrador único / consejero delegado
      adminNif: null,
    });
  });

  it("maps CNAE 2009 through the existing sector table", () => {
    expect(m.financials.cnae).toBe("0124");
    expect(m.financials.sector).toBe(cnaeToSector("0124"));
    const r = clone();
    r.datosProducto.informacionComercial.actividad.campoCodificadoCnae2009.valor = "6201";
    expect(mapInformaReport(r, TODAY).financials.sector).toBe("Information technology");
  });

  it("keeps Informa's rating and credit opinion as informational fields", () => {
    expect(m.risk).toEqual({ ratingInforma: 3, opinionCredito: 0, scoreEntregable: 2, probabilidadFallo: 7.38, scoreLiquidez: 1, fechaCalculo: "2026-05-20" });
    expect(m.financials).toMatchObject({ informaRating: "3", creditOpinionInforma: 0, scoreLiquidez: "1", resilience: null });
    expect(m.reportType).toBe("informe_mayor");
  });

  it("flags the demo's provisional closure of the registry sheet (vida 00 + subcódigo 10)", () => {
    expect(m.status).toEqual({
      code: "00",
      literal: "Actual",
      subcode: "10",
      subcodeLiteral: "CIERRE PROV. HOJA REGISTRAL Art. 3781 RRMM",
      detail: "Reapertura de la hoja registral",
      since: "2026-05-19",
      severity: "warning",
    });
  });
});

describe("decodeCompanyStatus", () => {
  it("is ok for an active company (00) with no subcódigo", () => {
    const s = decodeCompanyStatus({ campoCodificadoVida: { valor: "00", literal: "Actual" }, fechaCodigoVidaActual: "2020-01-01" });
    expect(s).toMatchObject({ code: "00", severity: "ok", subcode: null, subcodeLiteral: null, since: "2020-01-01" });
  });

  it("treats a 00 subcódigo as no subcódigo", () => {
    expect(decodeCompanyStatus({ campoCodificadoVida: { valor: "00" }, campoCodificadoSubcodigoVida: { valor: "00", literal: "-" } }).severity).toBe("ok");
  });

  it("raises an alert for a special situation (90, concurso)", () => {
    const r = clone();
    const dg = r.datosProducto.informacionComercial.datosGenerales;
    dg.campoCodificadoVida = { valor: "90", tablaDecodificacion: "tablaVida", literal: "Situación especial" };
    dg.campoCodificadoSubcodigoVida = { valor: "31", tablaDecodificacion: "tablaStatus", literal: "CONCURSO DE ACREEDORES" };
    dg.fechaSituacionEspecialStatus = "2026-03-02";
    expect(mapInformaReport(r, TODAY).status).toMatchObject({
      code: "90",
      literal: "Situación especial",
      subcodeLiteral: "CONCURSO DE ACREEDORES",
      since: "2026-03-02",
      severity: "alert",
    });
  });

  it("is unknown when Informa sends no vida code", () => {
    expect(decodeCompanyStatus(undefined)).toMatchObject({ code: null, severity: "unknown" });
  });
});

describe("mapInformaReport - missing and partial data", () => {
  it("keeps identity and reports the gaps when the report has no balances (comercial / abreviado)", () => {
    const r = clone() as Record<string, unknown> & typeof sample;
    r.productoSolicitado = "informe_comercial";
    (r.datosProducto as Record<string, unknown>).informacionFinanciera = undefined;
    const m = mapInformaReport(r, TODAY);
    expect(m.balance).toBeNull();
    expect(m.financials).toMatchObject({ cif: "A00000000", totalRevenue: null, ebitda: null, equity: null, referenceYear: null, shareCapital: 500_000 });
    expect(m.missing).toEqual(["totalRevenue", "netResult", "ebitda", "nonCurrentAssets", "currentAssets", "equity", "nonCurrentLiabilities", "currentLiabilities"]);
    expect(m.warnings).toEqual(["Informa no tiene balances de esta empresa (ha devuelto informe comercial): introduce las cifras a mano o usa el PDF"]);
  });

  it("maps a balance-only report (no P&L) and treats absent balance masses as zero", () => {
    const r = clone();
    const b = r.datosProducto.informacionFinanciera.listaBalances[0];
    b.listaPartidasCuentaPerdidasGanancias = [];
    b.listaRatios = [];
    b.listaPartidasBalancePasivo = b.listaPartidasBalancePasivo.filter((l) => !l.codigoPartida.startsWith("31"));
    const m = mapInformaReport(r, TODAY);
    expect(m.financials).toMatchObject({ totalRevenue: null, ebitda: null, netResult: 950_000, nonCurrentLiabilities: 0, currentLiabilities: 2_527_000 });
    expect(m.missing).toEqual(["totalRevenue", "ebitda"]);
  });

  it("falls back to Informa's EBITDA / EBIT ratios when the operating result line is absent", () => {
    const r = clone();
    const b = r.datosProducto.informacionFinanciera.listaBalances[0];
    b.listaPartidasCuentaPerdidasGanancias = b.listaPartidasCuentaPerdidasGanancias.filter((l) => l.codigoPartida !== "49100");
    expect(mapInformaReport(r, TODAY).financials).toMatchObject({ ebitda: 1_145_000, ebit: 1_070_000 });
  });

  it("reads clientes / proveedores from the Abreviado / PYMES codes 12380 / 32580", () => {
    const r = clone();
    const b = r.datosProducto.informacionFinanciera.listaBalances[0] as { listaPartidasBalanceActivo: Line[]; listaPartidasBalancePasivo: Line[] };
    b.listaPartidasBalanceActivo = b.listaPartidasBalanceActivo.filter((l) => !l.codigoPartida.startsWith("1231")).concat({ codigoPartida: "12380", valor: 111 });
    b.listaPartidasBalancePasivo = b.listaPartidasBalancePasivo.filter((l) => !l.codigoPartida.startsWith("3251")).concat({ codigoPartida: "32580", valor: 222 });
    expect(mapInformaReport(r, TODAY).financials).toMatchObject({ receivables: 111, payables: 222 });
  });

  it("scales a balance reported in thousands of euros", () => {
    const r = clone();
    const head = r.datosProducto.informacionFinanciera.listaBalances[0].cabeceraBalance;
    head.campoCodificadoUnidadDivisa = { valor: "002", tablaDecodificacion: "tablaUnidadDivisa", literal: "Miles de euros" };
    expect(mapInformaReport(r, TODAY).financials.totalAssets).toBe(15_910_000_000);
  });

  it("warns about a short fiscal year and a stale balance", () => {
    const r = clone();
    r.datosProducto.informacionFinanciera.listaBalances = r.datosProducto.informacionFinanciera.listaBalances.slice(2); // 2023 only
    r.datosProducto.informacionFinanciera.listaBalances[0].cabeceraBalance.duracionMeses = 6;
    const m = mapInformaReport(r, new Date(Date.UTC(2027, 0, 15)));
    expect(m.financials.referenceYear).toBe(2023);
    expect(m.warnings).toEqual([
      "El último ejercicio dura 6 meses: las cifras de resultados no son anuales",
      "El último balance disponible en Informa es de 2023",
    ]);
  });

  it("survives an empty or non-object report", () => {
    for (const input of [null, {}, "x", { datosProducto: {} }]) {
      const m = mapInformaReport(input, TODAY);
      expect(m.financials.cif).toBe("");
      expect(m.status.severity).toBe("unknown");
      expect(m.missing).toContain("cif");
    }
  });
});

describe("helpers", () => {
  it("latestBalance picks the latest closing date whatever the order", () => {
    const list = [...sample.datosProducto.informacionFinanciera.listaBalances].reverse();
    expect((latestBalance(list)?.cabeceraBalance as { annoBalance: number }).annoBalance).toBe(2025);
    expect(latestBalance(undefined)).toBeNull();
  });

  it("pickAdministrator prefers the administrador único over the presidente", () => {
    const admins = [
      { denominacion: { denominacionCompleta: "PEREZ LOPEZ, ANA" }, campoCodificadoCargo: { literal: "Presidente" } },
      { denominacion: { nombre: "LUIS", apellido1: "GIL", apellido2: "MARSA" }, campoCodificadoCargo: { literal: "Administrador único" } },
    ];
    expect(pickAdministrator(admins)).toBe("LUIS GIL MARSA");
    expect(pickAdministrator(admins.slice(0, 1))).toBe("ANA PEREZ LOPEZ");
    expect(pickAdministrator([])).toBeNull();
  });

  it("normalizeCif strips separators and rejects what cannot be a NIF", () => {
    expect(normalizeCif(" b-12.345.678 ")).toBe("B12345678");
    expect(normalizeCif("A00000000")).toBe("A00000000");
    expect(normalizeCif("B1234")).toBeNull();
    expect(normalizeCif("B12345678; DROP")).toBeNull();
  });
});
