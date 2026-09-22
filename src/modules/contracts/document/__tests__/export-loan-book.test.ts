import ExcelJS from "exceljs";
// exceljs bundles its own Buffer typing, older than @types/node.
type XlsxLoadArg = Parameters<ExcelJS.Xlsx["load"]>[0];
import { describe, expect, it } from "vitest";
import { EXPORT_COLUMNS, type LoanBookRowView } from "../../domain/loan-book-view";
import { formatExportCell, loanBookToPdf, loanBookToXlsx } from "../export-loan-book";

const row = (over: Partial<LoanBookRowView> = {}): LoanBookRowView => ({
  id: "id-1",
  contractNumber: "LB-16535",
  loanBookRef: "16535",
  client: "BLUEGROUND ESPANA",
  cif: "B12345678",
  country: "ES",
  distributor: "Nicton",
  assetType: "Water Dispenser",
  assetCluster: "Hospitality Machinery",
  contractType: "Renting F",
  signingDate: "2024-10-15",
  durationMonths: 24,
  extensionMonths: 3,
  installment: 5687.4,
  cost: 116058.68,
  expectedAnnualIrr: 0.1733,
  workflowStatus: "signed",
  lifecycleStatus: "Extended",
  cancelDate: null,
  additionalStatus: null,
  settlementAmount: null,
  outstanding: 37760.05,
  defaultAmount: null,
  ...over,
});

const ctx = { filters: "todos los estados", generatedAt: new Date(Date.UTC(2026, 8, 22, 10, 0)) };

/** 1-based Excel column of an export field, so the assertions survive new columns. */
const col = (key: string) => EXPORT_COLUMNS.findIndex((c) => c.key === key) + 1;

describe("formatExportCell", () => {
  const cell = (key: string, r: LoanBookRowView) => formatExportCell(EXPORT_COLUMNS.find((c) => c.key === key)!, r);

  it("formats each column type in Spanish", () => {
    const r = row();
    expect(cell("installment", r)).toBe("5.687,40");
    expect(cell("cost", r)).toBe("116.058,68");
    expect(cell("expectedAnnualIrr", r)).toBe("17,3 %");
    expect(cell("durationMonths", r)).toBe("24");
    expect(cell("signingDate", r)).toBe("15/10/2024");
    expect(cell("client", r)).toBe("BLUEGROUND ESPANA");
    expect(cell("assetCluster", r)).toBe("Hospitality Machinery");
    expect(cell("defaultAmount", row({ defaultAmount: -1234.56 }))).toBe("-1.234,56");
  });

  it("prints an em dash for empty values", () => {
    const r = row({ cancelDate: null, additionalStatus: null, settlementAmount: null, outstanding: null, extensionMonths: null });
    for (const key of ["cancelDate", "additionalStatus", "settlementAmount", "outstanding", "extensionMonths", "defaultAmount"]) {
      expect(cell(key, r)).toBe("—");
    }
  });
});

describe("loanBookToXlsx", () => {
  it("writes a sheet with the header, one row per contract and a totals row", async () => {
    const rows = [row(), row({ id: "id-2", contractNumber: "LB-2", cancelDate: "2026-01-15", additionalStatus: "CAP", settlementAmount: 1800, lifecycleStatus: "Finished", outstanding: 0, defaultAmount: -1234.56 })];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await loanBookToXlsx(rows, ctx)) as unknown as XlsxLoadArg);
    const ws = wb.getWorksheet("Loan book")!;

    expect(ws.getRow(3).values).toEqual([undefined, ...EXPORT_COLUMNS.map((c) => c.header)]);
    expect(ws.getCell(2, 1).value).toContain("2 contratos");
    expect(ws.getRow(4).getCell(col("contractNumber")).value).toBe("LB-16535");
    expect(ws.getRow(4).getCell(col("country")).value).toBe("ES");
    expect(ws.getRow(4).getCell(col("assetType")).value).toBe("Water Dispenser");
    expect(ws.getRow(4).getCell(col("assetCluster")).value).toBe("Hospitality Machinery");
    // Dates are real dates and amounts real numbers, so Excel can filter and sum them.
    expect(ws.getRow(4).getCell(col("signingDate")).value).toBeInstanceOf(Date);
    expect(ws.getRow(4).getCell(col("cost")).value).toBeCloseTo(116058.68, 6);
    expect(ws.getRow(5).getCell(col("settlementAmount")).value).toBe(1800);
    expect(ws.getRow(5).getCell(col("defaultAmount")).value).toBeCloseTo(-1234.56, 6);

    const totals = ws.getRow(6);
    expect(totals.getCell(1).value).toBe("TOTAL");
    expect(totals.getCell(col("cost")).value).toBeCloseTo(116058.68 * 2, 6);
    expect(totals.getCell(col("settlementAmount")).value).toBe(1800);
    expect(totals.getCell(col("outstanding")).value).toBeCloseTo(37760.05, 6);
    expect(totals.getCell(col("defaultAmount")).value).toBeCloseTo(-1234.56, 6);
  });

  it("handles an empty book", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await loanBookToXlsx([], ctx)) as unknown as XlsxLoadArg);
    expect(wb.getWorksheet("Loan book")!.getCell(2, 1).value).toContain("0 contratos");
  });
});

describe("loanBookToPdf", () => {
  it("produces a PDF that carries the data", async () => {
    const buf = await loanBookToPdf([row(), row({ id: "id-2", contractNumber: "LB-2" })], ctx);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.subarray(-6).toString().trim()).toBe("%%EOF");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("paginates a long book without failing", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => row({ id: `id-${i}`, contractNumber: `LB-${i}` }));
    const buf = await loanBookToPdf(rows, ctx);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    // More than one page: pdfkit writes one /Type /Page object per page.
    expect((buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeGreaterThan(1);
  });
});
