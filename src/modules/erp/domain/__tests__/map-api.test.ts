import { describe, expect, it } from "vitest";
import { buildLookups, holdedStatusLabel, mapApiDocument } from "../map-api";

const AS_OF = new Date("2026-09-28T10:00:00Z");

/** A v2 list item shaped like the documented example. */
const doc = (over: Record<string, unknown> = {}) => ({
  id: "507f1f77bcf86cd799439011",
  document_number: "TP-S-26-00042",
  contact_id: "c1",
  contact_name: "Acme  Corp ",
  description: "Cuotas agosto",
  date: "2026-08-31",
  due_date: "2026-09-30",
  subtotal: "100.00",
  discount: "0",
  total: "121.00",
  tax: "21.00",
  currency: "EUR",
  status: "pending",
  tags: ["0partner", "#1retail"],
  lines: [
    { name: "Renting", price: "60.00", units: "1", discount: "0", tax: "21", retention: "0", account: "70500000", project_id: "p1" },
    { name: "Seguro", price: "40.00", units: "1", discount: "0", tax: "21", retention: "0", account: "70500000", project_id: "p2" },
  ],
  payment_method_id: "pm1",
  payments_total: "0",
  payments_pending: "121.00",
  ...over,
});

const lookups = buildLookups({
  paymentMethods: [{ id: "pm1", name: "Remesa Bancaria", type: "manual" }],
  projects: [{ id: "p1", name: "36 months" }, { id: "p2", name: "24 months" }],
  accounts: [{ id: "a1", number: 70500000, name: "Ingresos por arrendamientos" }],
});

describe("mapApiDocument", () => {
  it("maps a pending invoice to the Holded export columns", () => {
    const res = mapApiDocument(doc(), { docType: "invoice", asOf: AS_OF, lookups });
    expect(res).toEqual({
      ok: true,
      record: {
        num: "TP-S-26-00042",
        holded_id: "507f1f77bcf86cd799439011",
        doc_type: "invoice",
        date: "2026-08-31T00:00:00.000Z",
        operation_date: "2026-08-31T00:00:00.000Z",
        due_date: "2026-09-30T00:00:00.000Z",
        client: "Acme Corp",
        description: "Cuotas agosto",
        tags: "#0partner #1retail",
        account: "Ingresos por arrendamientos",
        payment_method: "Remesa Bancaria",
        project: "36 months, 24 months",
        subtotal: 100,
        vat: 21,
        withholding: 0,
        employees: null,
        equivalence_surcharge: null,
        total: 121,
        collected: 0,
        pending: 121,
        status: "Pending",
        collected_date: null,
        digital_signature: null,
        sii: null,
      },
    });
  });

  it("makes credit-note amounts negative whatever sign the API returns", () => {
    for (const sign of ["", "-"]) {
      const res = mapApiDocument(
        doc({ document_number: "CN260351", subtotal: `${sign}149.00`, tax: `${sign}31.29`, total: `${sign}180.29`, payments_total: `${sign}180.29`, payments_pending: "0", status: "completed", lines: [] }),
        { docType: "creditnote", asOf: AS_OF },
      );
      if (!res.ok) throw new Error(res.error);
      expect(res.record).toMatchObject({ doc_type: "creditnote", subtotal: -149, vat: -31.29, total: -180.29, collected: -180.29, pending: 0, status: "Paid" });
      expect(Object.is(res.record.pending, -0)).toBe(false);
      expect(Object.is(res.record.withholding, -0)).toBe(false);
    }
  });

  it("nets the discount into Subtotal and derives Retención from the lines", () => {
    const res = mapApiDocument(
      doc({
        subtotal: "1000.00",
        discount: "100.00",
        tax: "189.00",
        total: "954.00",
        lines: [{ price: "500", units: "2", discount: "10", retention: "15", account: null, project_id: null }],
      }),
      { docType: "invoice", asOf: AS_OF },
    );
    if (!res.ok) throw new Error(res.error);
    // 900 + 189 - 135 = 954: the export's Subtotal + IVA - Retención = Total holds.
    expect(res.record).toMatchObject({ subtotal: 900, vat: 189, withholding: 135, total: 954, account: null, project: null });
    expect(res.record.subtotal + res.record.vat! - res.record.withholding!).toBe(res.record.total);
  });

  it("tolerates missing optional fields and falls back to raw ids without lookups", () => {
    const res = mapApiDocument(
      { id: "x1", document_number: "TP-S-26-00043", date: "2026-08-01", total: 50, payment_method_id: "pm9", lines: [{ account: 70000000 }] },
      { docType: "invoice", asOf: AS_OF },
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.record).toMatchObject({
      client: null, description: null, tags: null, due_date: null, subtotal: 0, vat: null, collected: null, pending: null,
      status: null, payment_method: "pm9", account: "70000000", total: 50,
    });
  });

  it("parses legacy unix-second dates", () => {
    const res = mapApiDocument(doc({ date: 1_788_220_800, due_date: null }), { docType: "invoice", asOf: AS_OF });
    if (!res.ok) throw new Error(res.error);
    expect(res.record.date).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rejects drafts without number, bad dates, bad totals and malformed documents", () => {
    expect(mapApiDocument(doc({ document_number: null }), { docType: "invoice", asOf: AS_OF })).toEqual({
      ok: false,
      error: "Document 507f1f77bcf86cd799439011: no document number (draft?)",
    });
    expect(mapApiDocument(doc({ date: "not a date" }), { docType: "invoice", asOf: AS_OF })).toMatchObject({ ok: false, error: "TP-S-26-00042: invalid date" });
    expect(mapApiDocument(doc({ total: "abc" }), { docType: "invoice", asOf: AS_OF })).toMatchObject({ ok: false, error: "TP-S-26-00042: invalid total" });
    expect(mapApiDocument({ document_number: "X" }, { docType: "invoice", asOf: AS_OF })).toMatchObject({ ok: false });
    expect(mapApiDocument(doc({ tags: "not-an-array" }), { docType: "invoice", asOf: AS_OF })).toMatchObject({ ok: false });
  });
});

describe("holdedStatusLabel", () => {
  it("maps the v2 enum to Holded's export labels", () => {
    expect(holdedStatusLabel("completed", null, AS_OF)).toBe("Paid");
    expect(holdedStatusLabel("cancelled", null, AS_OF)).toBe("Cancelled");
    expect(holdedStatusLabel("pending", "2026-09-28T00:00:00.000Z", AS_OF)).toBe("Pending");
    expect(holdedStatusLabel("partial", "2026-10-01T00:00:00.000Z", AS_OF)).toBe("Partially paid");
    expect(holdedStatusLabel("failed", null, AS_OF)).toBe("Failed");
    expect(holdedStatusLabel("", null, AS_OF)).toBeNull();
    expect(holdedStatusLabel("weird", null, AS_OF)).toBe("weird");
  });

  it("reports unpaid documents past their due day as Overdue", () => {
    expect(holdedStatusLabel("pending", "2026-09-27T00:00:00.000Z", AS_OF)).toBe("Overdue");
    expect(holdedStatusLabel("partial", "2026-01-01T00:00:00.000Z", AS_OF)).toBe("Overdue");
    expect(holdedStatusLabel("overdue", null, AS_OF)).toBe("Overdue");
  });
});

describe("buildLookups", () => {
  it("keys accounts by id and numeric code and skips unusable items", () => {
    const l = buildLookups({ accounts: [{ id: "a1", number: 4300, name: "Clientes" }, { id: "a2", name: "" }, { nope: true }] });
    expect(l.accounts.get("a1")).toBe("Clientes");
    expect(l.accounts.get("4300")).toBe("Clientes");
    expect(l.accounts.has("a2")).toBe(false);
    expect(l.paymentMethods.size).toBe(0);
  });
});
