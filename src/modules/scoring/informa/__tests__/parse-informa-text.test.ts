import { describe, expect, it } from "vitest";
import { parseAdministrator, parseFiscalAddress, parseInformaText } from "../parse-informa-text";

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
