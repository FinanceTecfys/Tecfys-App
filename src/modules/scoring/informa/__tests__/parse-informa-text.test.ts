import { describe, expect, it } from "vitest";
import { cleanCompanyName, parseAdministrator, parseCompanyName, parseFiscalAddress, parseInformaText } from "../parse-informa-text";

// Synthetic text laid out like pdf.js output of an Informa report (items joined by spaces).
// TODO: replace with a fixture from a real report once one is available.
const SAMPLE = `=== PAGE 1 ===
Informa Comercial NICTON PLUS SL. NIF B65944837 DOMICILIO SOCIAL RONDA GENERAL MITRE, 172 - BJ DR 08006 BARCELONA (BARCELONA) TELÉFONOS 934181568 PÁGINA WEB www.nictonplus.com EMAIL CORPORATIVO comercial@nictonplus.com
FECHA DE CONSTITUCIÓN 07/01/2013 EMPLEADOS 15 ADMINISTRADOR ÚNICO GIL MARSA, DAVID Estructura`;

describe("parseFiscalAddress", () => {
  it("splits street, postal code, city and province", () => {
    expect(parseFiscalAddress(SAMPLE)).toEqual({
      street: "RONDA GENERAL MITRE, 172 - BJ DR",
      postalCode: "08006",
      city: "BARCELONA",
      province: "BARCELONA",
    });
  });

  it("stops the city at the next section label when there is no province", () => {
    const r = parseFiscalAddress("DOMICILIO SOCIAL CALLE MAYOR 3 28013 MADRID TELÉFONOS 910000000");
    expect(r).toEqual({ street: "CALLE MAYOR 3", postalCode: "28013", city: "MADRID", province: null });
  });

  it("returns nulls when the report has no address", () => {
    expect(parseFiscalAddress("NIF B65944837")).toEqual({ street: null, postalCode: null, city: null, province: null });
  });
});

describe("parseAdministrator", () => {
  it("reorders 'SURNAMES, NAME'", () => {
    expect(parseAdministrator(SAMPLE)).toBe("DAVID GIL MARSA");
  });

  it("recognises other administrator roles", () => {
    expect(parseAdministrator("CONSEJERO DELEGADO PEREZ LOPEZ, ANA Cargo")).toBe("ANA PEREZ LOPEZ");
    expect(parseAdministrator("ADMINISTRADOR SOLIDARIO JUAN RUIZ Fecha")).toBe("JUAN RUIZ");
  });
});

it("parseInformaText exposes the identification fields and flags what is missing", () => {
  const { financials, missing } = parseInformaText(SAMPLE, new Date(Date.UTC(2026, 8, 22)));
  expect(financials).toMatchObject({
    cif: "B65944837",
    address: "RONDA GENERAL MITRE, 172 - BJ DR",
    fiscalPostalCode: "08006",
    fiscalCity: "BARCELONA",
    adminName: "DAVID GIL MARSA",
    phone: "934181568",
    email: "comercial@nictonplus.com",
    adminNif: null,
  });
  expect(missing).not.toContain("address");
  expect(missing).toContain("totalRevenue");
});

// Layouts of real Informa PDFs (pdf.js text), with fictitious companies.
const CURRENT_LAYOUT = `=== PAGE 1 === Informa Comercial Resumen Ejecutivo DOMICILIO SOCIAL CALLE MAYOR , 3 08006 BARCELONA Identificación INDICADOR DE RIESGO
Empresa Sector ALFA DEMO SL. Activa REFS. NIF B00000001 Número D-U-N-S ® 400000001 Informa Comercial - ALFA DEMO SL. Usuario: analista@tecfys.com Fecha: 13/08/2026 INFORMA D&B S.A.U.
=== PAGE 17 === DENOMINACIÓN PRINCIPAL ALFA DEMO SL. DENOMINACIÓN ANTIGUA BETA ANTIGUA SL. Denominaciones y Marcas`;

describe("company name", () => {
  it("reads the page header and never keeps the 'Informa Comercial - ' / leading '- ' artefact", () => {
    expect(parseCompanyName(CURRENT_LAYOUT)).toBe("ALFA DEMO SL.");
    expect(parseInformaText(CURRENT_LAYOUT).financials.name).toBe("ALFA DEMO SL.");
  });

  it("reads the short product's header (Informa Abreviado)", () => {
    expect(parseCompanyName("=== PAGE 1 === Informa Abreviado - GAMMA D'INVERSIONS S.L. Usuario: x@y.es Fecha: 21/06/2024 INFORMA D&B")).toBe("GAMMA D'INVERSIONS S.L.");
  });

  it("falls back to DENOMINACIÓN PRINCIPAL, stopping at the next label", () => {
    expect(parseCompanyName("DENOMINACIÓN PRINCIPAL DELTA SERVICIOS S.L. DENOMINACIÓN ANTIGUA EPSILON S.L.")).toBe("DELTA SERVICIOS S.L.");
    expect(parseCompanyName("DENOMINACIÓN PRINCIPAL DELTA SERVICIOS SL. MARCA DELTA Existen 2 marcas")).toBe("DELTA SERVICIOS SL.");
    expect(parseCompanyName("DENOMINACIÓN PRINCIPAL DELTA SERVICIOS SL. NOMBRE COMERCIAL DELTA")).toBe("DELTA SERVICIOS SL.");
  });

  it("keeps reading the older layout", () => {
    expect(parseCompanyName(SAMPLE)).toBe("NICTON PLUS SL.");
  });

  it("does not mistake the executive-summary title for a name", () => {
    expect(parseCompanyName("Informa Comercial Resumen Ejecutivo DOMICILIO SOCIAL CALLE MAYOR 3 NIF B00000001")).toBeNull();
  });

  it("cleans every artefact, and keeps Informa's own punctuation", () => {
    for (const raw of ["- CID DEMO SL", "Informa Comercial - CID DEMO SL", "  –  CID   DEMO SL ", "DENOMINACIÓN PRINCIPAL CID DEMO SL", "Informa Comercial - - CID DEMO SL"]) {
      expect(cleanCompanyName(raw), raw).toBe("CID DEMO SL");
    }
    expect(cleanCompanyName("ALFA, S.L.")).toBe("ALFA, S.L.");
    expect(cleanCompanyName("CRE-ZE BUILDING S.L.")).toBe("CRE-ZE BUILDING S.L.");
    for (const empty of [null, undefined, "", " - ", "Informa Comercial -"]) expect(cleanCompanyName(empty)).toBeNull();
  });
});

describe("CNAE", () => {
  const cnaeOf = (text: string) => parseInformaText(text).financials.cnae;

  it("reads the code, never the classification's version year (CNAE 2009 / CNAE 2025)", () => {
    expect(cnaeOf("ACTIVIDAD (CNAE 2025) 7112 Servicios técnicos de ingeniería")).toBe("7112");
    expect(cnaeOf("Actividad Principal ACTIVIDAD CNAE 2025 7112 - Servicios técnicos")).toBe("7112");
    expect(cnaeOf("ACTIVIDAD (CNAE 2009) 6201 Programación")).toBe("6201");
    expect(cnaeOf("CNAE 2009: 5610 Restaurantes")).toBe("5610");
    expect(cnaeOf("ACTIVIDAD CNAE CNAE 2009: 4711 Comercio")).toBe("4711");
    expect(cnaeOf("ACTIVIDAD CNAE 4711 Comercio")).toBe("4711");
  });
});
