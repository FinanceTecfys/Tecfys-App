import { describe, expect, it } from "vitest";
import type { HoldedInvoiceRecord } from "../invoice";
import { dedupeByNum, planSyncWindow, planUpsert, recordsEqual, type StoredInvoice } from "../sync-plan";

const record = (over: Partial<HoldedInvoiceRecord> = {}): HoldedInvoiceRecord => ({
  num: "TP-S-26-00001",
  holded_id: null,
  doc_type: "invoice",
  date: "2026-08-31T00:00:00.000Z",
  operation_date: "2026-08-31T00:00:00.000Z",
  due_date: null,
  client: "Acme",
  description: null,
  tags: null,
  account: null,
  payment_method: null,
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
  collected_date: null,
  digital_signature: null,
  sii: null,
  ...over,
});

/** How the row comes back from PostgREST: timestamptz with "+00:00", extra columns. */
const stored = (r: HoldedInvoiceRecord): StoredInvoice => ({
  ...r,
  date: r.date.replace(".000Z", "+00:00"),
  operation_date: r.operation_date?.replace(".000Z", "+00:00") ?? null,
  id: "uuid",
  source: "excel",
  synced_at: "2026-09-28T10:00:00+00:00",
} as StoredInvoice);

describe("recordsEqual", () => {
  it("ignores timestamp formatting and bookkeeping columns", () => {
    expect(recordsEqual(record(), stored(record()))).toBe(true);
  });

  it("detects a changed payment / status", () => {
    const before = stored(record({ collected: 0, pending: 768.35, status: "Overdue" }));
    expect(recordsEqual(record(), before)).toBe(false);
  });

  it("compares money to the cent and treats numeric strings as numbers", () => {
    expect(recordsEqual(record(), { ...stored(record()), total: "768.35" })).toBe(true);
    expect(recordsEqual(record(), { ...stored(record()), total: 768.36 })).toBe(false);
  });

  it("does not count a missing holded_id (Excel after API) as a change", () => {
    expect(recordsEqual(record({ holded_id: null }), stored(record({ holded_id: "abc" })))).toBe(true);
    expect(recordsEqual(record({ holded_id: "xyz" }), stored(record({ holded_id: "abc" })))).toBe(false);
  });
});

describe("planUpsert", () => {
  it("creates new Nums, updates changed ones and skips identical ones", () => {
    const existing = new Map<string, StoredInvoice>([
      ["A", stored(record({ num: "A" }))],
      ["B", stored(record({ num: "B", pending: 10, status: "Overdue" }))],
    ]);
    const plan = planUpsert([record({ num: "A" }), record({ num: "B" }), record({ num: "C" })], existing);
    expect(plan.unchanged.map((r) => r.num)).toEqual(["A"]);
    expect(plan.toUpdate.map((r) => r.num)).toEqual(["B"]);
    expect(plan.toCreate.map((r) => r.num)).toEqual(["C"]);
  });

  it("is idempotent: planning the same batch against its own result writes nothing", () => {
    const batch = [record({ num: "A" }), record({ num: "B", doc_type: "creditnote", total: -10 })];
    const first = planUpsert(batch, new Map());
    expect(first.toCreate).toHaveLength(2);
    const afterFirst = new Map(first.toCreate.map((r) => [r.num, stored(r)]));
    const second = planUpsert(batch, afterFirst);
    expect(second).toEqual({ toCreate: [], toUpdate: [], unchanged: batch });
  });

  it("keeps the stored holded_id when the incoming source has none", () => {
    const existing = new Map([["A", stored(record({ num: "A", holded_id: "h1", pending: 5 }))]]);
    const plan = planUpsert([record({ num: "A", holded_id: null })], existing);
    expect(plan.toUpdate[0].holded_id).toBe("h1");
  });

  it("collapses a Num repeated in one batch to its last version", () => {
    const plan = planUpsert([record({ num: "A", pending: 5 }), record({ num: "A", pending: 0 })], new Map());
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].pending).toBe(0);
    expect(dedupeByNum([record({ num: "A" }), record({ num: "B" }), record({ num: "A", total: 1 })]).map((r) => [r.num, r.total])).toEqual([
      ["A", 1],
      ["B", 768.35],
    ]);
  });
});

describe("planSyncWindow", () => {
  it("reads everything on the first run or when forced", () => {
    expect(planSyncWindow({ lastSuccessAt: null, earliestOpenDate: null, lookbackDays: 31 })).toEqual({ start: null, end: null, mode: "full" });
    expect(planSyncWindow({ lastSuccessAt: "2026-09-01T00:00:00Z", earliestOpenDate: null, lookbackDays: 31, full: true }).mode).toBe("full");
  });

  it("goes back lookbackDays from the last successful run", () => {
    expect(planSyncWindow({ lastSuccessAt: "2026-09-28T10:00:00Z", earliestOpenDate: null, lookbackDays: 31 })).toEqual({
      start: "2026-08-28",
      end: null,
      mode: "incremental",
    });
  });

  it("reaches back to the oldest open invoice so its payments refresh", () => {
    const w = planSyncWindow({ lastSuccessAt: "2026-09-28T10:00:00Z", earliestOpenDate: "2026-03-15T00:00:00+00:00", lookbackDays: 31 });
    expect(w.start).toBe("2026-03-15");
  });

  it("an explicit range wins", () => {
    expect(planSyncWindow({ lastSuccessAt: null, earliestOpenDate: null, lookbackDays: 31, range: { start: "2026-08-01", end: "2026-08-31" } })).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
      mode: "range",
    });
  });
});
