import { readFileSync } from "node:fs";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { CONTRACT_TEMPLATE_PATH, renderContractDocx } from "../../document/render-contract-docx";
import {
  buildContractTemplateData,
  CONTRACT_TEMPLATE_TAGS,
  type ContractDraftSource,
  stripLeadingCalle,
} from "../contract-template";

const source: ContractDraftSource = {
  contractNumber: "TCF-000042",
  clientName: "NICTON PLUS SL",
  clientCif: "B65944837",
  fiscalAddress: "C/ Ronda General Mitre, 172 - BJ DR",
  fiscalPostalCode: "08006",
  fiscalCity: "Barcelona",
  fiscalProvince: "Barcelona",
  signatoryName: "David Gil Marsà",
  signatoryNif: "12345678Z",
  signatoryAddress: null,
  contactName: "David Gil",
  contactPhone: "934181568",
  contactEmail: "comercial@nictonplus.com",
  deliverySameAsFiscal: true,
  deliveryAddress: null,
  productDescription: "12 portátiles ASUS ExpertBook B1",
  durationMonths: 36,
  installment: 1234.5,
  hasGuarantor: false,
  guarantorName: null,
  guarantorNif: null,
  guarantorAddress: null,
  guarantorRepresentative: null,
  guarantorRepresentativeNif: null,
  sepa: {
    debtorName: "NICTON PLUS SL",
    debtorAddress: "C/ Ronda General Mitre, 172 - BJ DR",
    debtorPostalCode: "08006",
    debtorCity: "Barcelona",
    debtorProvince: "Barcelona",
    iban: "ES9121000418450200051332",
    signedPlace: "Barcelona",
    signedAt: "2026-10-01",
  },
};

describe("buildContractTemplateData", () => {
  it("maps every template tag", () => {
    const data = buildContractTemplateData(source);
    expect(Object.keys(data).sort()).toEqual([...CONTRACT_TEMPLATE_TAGS].sort());
  });

  it("formats amounts, IBAN, dates and addresses for the contract", () => {
    const d = buildContractTemplateData(source);
    expect(d.installment).toBe("1.234,50");
    expect(d.sepa_iban).toBe("ES91 2100 0418 4502 0005 1332");
    expect(d.sepa_date).toBe("01/10/2026");
    // The template already prints "Calle" before the fiscal address.
    expect(d.client_fiscal_address).toBe("Ronda General Mitre, 172 - BJ DR, 08006 Barcelona");
    // Delivery defaults to the fiscal address, written in full.
    expect(d.delivery_address).toBe("C/ Ronda General Mitre, 172 - BJ DR, 08006 Barcelona");
    expect(d.sepa_debtor_city).toBe("Barcelona");
  });

  it("uses a separate delivery address and a province that differs from the city", () => {
    const d = buildContractTemplateData({
      ...source,
      fiscalCity: "Sant Cugat del Vallès",
      fiscalProvince: "Barcelona",
      deliverySameAsFiscal: false,
      deliveryAddress: "Nave 4, Polígono Can Magí, 08173 Sant Cugat",
    });
    expect(d.delivery_address).toBe("Nave 4, Polígono Can Magí, 08173 Sant Cugat");
    expect(d.client_fiscal_address).toBe("Ronda General Mitre, 172 - BJ DR, 08006 Sant Cugat del Vallès (Barcelona)");
  });

  it("strips only a leading street type 'Calle'", () => {
    expect(stripLeadingCalle("Calle Mayor 3")).toBe("Mayor 3");
    expect(stripLeadingCalle("C/Mayor 3")).toBe("Mayor 3");
    expect(stripLeadingCalle("Avda. Diagonal 1")).toBe("Avda. Diagonal 1");
  });
});

describe("renderContractDocx (real template)", () => {
  const template = readFileSync(CONTRACT_TEMPLATE_PATH);
  const documentText = (buf: Buffer) => {
    const xml = new PizZip(buf).file("word/document.xml")!.asText();
    return xml.replace(/<[^>]+>/g, "");
  };

  it("fills every field and leaves no marker or tag behind", () => {
    const text = documentText(renderContractDocx(template, buildContractTemplateData(source)));
    expect(text).not.toMatch(/\bx{2,}\b/i);
    expect(text).not.toMatch(/[{}]/);
    for (const expected of ["TCF-000042", "NICTON PLUS SL", "B65944837", "12345678Z", "12 portátiles ASUS", "1.234,50", "ES91 2100 0418 4502 0005 1332", "comercial@nictonplus.com", "Sin avalista"]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain(" y domicilio  ");
    // Header + Annex I title (body) + remission to Annex I (text box, stored twice).
    expect(text.split("TCF-000042").length - 1).toBe(4);
    expect(text).toContain("Condiciones Generales del Contrato nº TCF-000042");
  });

  it("prints the guarantor clause, with the corrected 'El Avalista', only when there is one", () => {
    const text = documentText(
      renderContractDocx(template, buildContractTemplateData({ ...source, hasGuarantor: true, guarantorName: "David Gil Marsà", guarantorNif: "12345678Z", guarantorAddress: "C/ Aribau 10, Barcelona" })),
    );
    expect(text).toContain("David Gil Marsà (en adelante El Avalista) con CIF 12345678Z");
    expect(text).not.toContain("Sin avalista");
    expect(text).not.toContain("representada por  con DNI");
  });
});
