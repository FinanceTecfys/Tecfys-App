import { describe, expect, it } from "vitest";
import { HOLDED_COLUMNS } from "../invoice";
import { buildHeaderIndex, isBlankRow, mapExcelRow } from "../map-excel";
import { mapApiDocument } from "../map-api";

// Header row 5 of the Holded sales export, as ExcelJS reads it (col A empty).
const HEADER = [null, ...HOLDED_COLUMNS.map((c) => c.label)];
const stamp = (day: string) => new Date(`${day}T11:13:27.000Z`); // export clock time on every date

// Synthetic rows shaped like the real export (no client data).
const INVOICE = [
  null, stamp("2026-08-31"), "TP-S-26-00001", stamp("2026-08-31"), stamp("2026-08-31"), "ACME RENTING SL.",
  "18382 - 18159", null, " Industry and Logistic sector", "Remesa Bancaria", null,
  635, 133.35, 0, 0, 0, 768.35, "768.35€", 0, "Paid", stamp("2026-09-04"), " Not required", "Pending",
];
const CREDIT_NOTE = [
  null, stamp("2026-08-31"), "CN000001", stamp("2026-08-31"), stamp("2026-08-31"), "BAR EJEMPLO SL",
  18096, "#0partner #1barrestaurant ", " Catering  Restaurants", "Remesa Sabadell", 36,
  -149, -31.29, 0, 0, 0, -180.29, "-180.29€", 0, "Paid", stamp("2026-08-31"), "-", "Pending",
];

describe("buildHeaderIndex", () => {
  it("finds every Holded column by label", () => {
    const index = buildHeaderIndex(HEADER);
    expect(index.date).toBe(1);
    expect(index.num).toBe(2);
    expect(index.sii).toBe(22);
  });

  it("maps a reordered header by label, not by position", () => {
    const reordered = [null, "Num", "Date", ...HOLDED_COLUMNS.slice(2).map((c) => c.label)];
    const index = buildHeaderIndex(reordered);
    expect(index.num).toBe(1);
    expect(index.date).toBe(2);
  });

  it("names the missing labels", () => {
    expect(() => buildHeaderIndex(HEADER.filter((h) => h !== "Collected" && h !== "SII"))).toThrow("Collected, SII");
  });
});

describe("mapExcelRow", () => {
  const index = buildHeaderIndex(HEADER);

  it("maps an invoice row, normalising the Collected string and the export clock time", () => {
    const res = mapExcelRow(INVOICE, index, 6);
    expect(res).toEqual({
      ok: true,
      record: {
        num: "TP-S-26-00001",
        holded_id: null,
        doc_type: "invoice",
        date: "2026-08-31T00:00:00.000Z",
        operation_date: "2026-08-31T00:00:00.000Z",
        due_date: "2026-08-31T00:00:00.000Z",
        client: "ACME RENTING SL.",
        description: "18382 - 18159",
        tags: null,
        account: "Industry and Logistic sector",
        payment_method: "Remesa Bancaria",
        project: null,
        subtotal: 635,
        vat: 133.35,
        withholding: 0,
        employees: 0,
        equivalence_surcharge: 0,
        total: 768.35,
        collected: 768.35,
        pending: 0,
        status: "Paid",
        collected_date: "2026-09-04T00:00:00.000Z",
        digital_signature: "Not required",
        sii: "Pending",
      },
    });
  });

  it("keeps credit notes negative and stringifies numeric description / project", () => {
    const res = mapExcelRow(CREDIT_NOTE, index);
    if (!res.ok) throw new Error(res.error);
    expect(res.record).toMatchObject({
      num: "CN000001",
      doc_type: "creditnote",
      description: "18096",
      project: "36",
      tags: "#0partner #1barrestaurant",
      account: "Catering Restaurants",
      subtotal: -149,
      vat: -31.29,
      total: -180.29,
      collected: -180.29,
      digital_signature: null,
    });
  });

  it("leaves missing optional fields null (unpaid: no collected date, no status)", () => {
    const row: unknown[] = [...INVOICE];
    row[17] = "0.00€"; row[18] = 768.35; row[19] = null; row[20] = null; row[7] = undefined; row[10] = "";
    const res = mapExcelRow(row, index);
    if (!res.ok) throw new Error(res.error);
    expect(res.record).toMatchObject({ collected: 0, pending: 768.35, status: null, collected_date: null, tags: null, project: null });
  });

  it("rejects rows without Num, Date or Total, naming the row", () => {
    const noNum = [...INVOICE]; noNum[2] = null;
    const badDate = [...INVOICE]; badDate[1] = "soon";
    const noTotal = [...INVOICE]; noTotal[16] = null;
    expect(mapExcelRow(noNum, index, 9)).toEqual({ ok: false, error: "Missing Num (row 9)" });
    expect(mapExcelRow(badDate, index, 9)).toEqual({ ok: false, error: "TP-S-26-00001: invalid Date (row 9)" });
    expect(mapExcelRow(noTotal, index)).toEqual({ ok: false, error: "TP-S-26-00001: invalid Total" });
  });

  it("the Excel row and the equivalent API document land in the same shape", () => {
    const excel = mapExcelRow(INVOICE, index);
    const api = mapApiDocument(
      {
        id: "65f000000000000000000001",
        document_number: "TP-S-26-00001",
        contact_name: "ACME RENTING SL.",
        description: "18382 - 18159",
        date: "2026-08-31",
        due_date: "2026-08-31",
        subtotal: "635.00",
        discount: "0",
        tax: "133.35",
        total: "768.35",
        status: "completed",
        tags: [],
        lines: [{ price: "635", units: "1", discount: "0", retention: "0", account: "acc1", project_id: null }],
        payment_method_id: "pm1",
        payments_total: "768.35",
        payments_pending: "0",
      },
      {
        docType: "invoice",
        asOf: new Date("2026-09-28T10:00:00Z"),
        lookups: { paymentMethods: new Map([["pm1", "Remesa Bancaria"]]), projects: new Map(), accounts: new Map([["acc1", "Industry and Logistic sector"]]) },
      },
    );
    if (!excel.ok || !api.ok) throw new Error("both should map");
    expect(Object.keys(api.record).sort()).toEqual(Object.keys(excel.record).sort());
    const shared = ["num", "doc_type", "date", "due_date", "client", "description", "account", "payment_method", "subtotal", "vat", "withholding", "total", "collected", "pending", "status"] as const;
    for (const k of shared) expect(api.record[k], k).toEqual(excel.record[k]);
  });
});

describe("isBlankRow", () => {
  it("detects the blank separator before the export footer", () => {
    expect(isBlankRow([null, undefined, "", "  "])).toBe(true);
    expect(isBlankRow([null, "Report powered automatically by Holded - 28/09/2026 13:13"])).toBe(false);
  });
});
