import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { apiReportDate, dmyToIso, pdfReportDate, receiptProvenance, sha256Hex } from "../provenance";

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("sha256Hex", () => {
  it("matches the standard test vectors", async () => {
    expect(await sha256Hex(bytes("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(bytes(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("dmyToIso", () => {
  it("converts real dates and rejects impossible ones", () => {
    expect(dmyToIso("13/08/2026")).toBe("2026-08-13");
    expect(dmyToIso("29/02/2024")).toBe("2024-02-29");
    expect(dmyToIso("29/02/2026")).toBeNull();
    expect(dmyToIso("32/01/2026")).toBeNull();
    expect(dmyToIso("2026-08-13")).toBeNull();
  });
});

describe("pdfReportDate", () => {
  it("reads the page header date of an Informa Comercial PDF, not the other dates of the report", () => {
    const text =
      "=== PAGE 1 === Informa Comercial Resumen Ejecutivo FECHA DE CONSTITUCIÓN 26/05/2016 " +
      "=== PAGE 2 === CID BRAND SL Usuario: analista@tecfys.com Fecha: 13/08/2026 INFORMA D&B S.A.U.";
    expect(pdfReportDate(text)).toBe("2026-08-13");
  });

  it("is null when the header is absent", () => {
    expect(pdfReportDate("Informe de Riesgo : ORIGENES 360 SL Fecha Constitución: 17/07/2025")).toBeNull();
  });
});

describe("apiReportDate", () => {
  it("reads fechaUltimoDatoIncluidoInforme of the real sample report", () => {
    const sample = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "informe-mayor-A00000000.json"), "utf8"));
    expect(apiReportDate(sample)).toBe("2026-06-05");
  });

  it("is null for anything else", () => {
    for (const report of [null, "x", [], {}, { datosProducto: { informacionComercial: { datosGenerales: { fechaUltimoDatoIncluidoInforme: 20260605 } } } }]) {
      expect(apiReportDate(report)).toBeNull();
    }
  });
});

describe("receiptProvenance", () => {
  const receipt = { file_name: "a.pdf", file_sha256: "f".repeat(64), report_date: "2026-08-13", fetched_at: "2026-10-26T09:00:00Z" };

  it("keeps the file fields for a pdf and the fetch time for the api only", () => {
    expect(receiptProvenance({ ...receipt, source: "informa_pdf" })).toEqual({
      source: "pdf", reportDate: "2026-08-13", fileName: "a.pdf", fileSha256: "f".repeat(64), fetchedAt: null,
    });
    expect(receiptProvenance({ ...receipt, source: "informa_api" })).toEqual({
      source: "api", reportDate: "2026-08-13", fileName: null, fileSha256: null, fetchedAt: "2026-10-26T09:00:00Z",
    });
    expect(receiptProvenance({ ...receipt, source: "manual" })).toBeNull();
  });
});
