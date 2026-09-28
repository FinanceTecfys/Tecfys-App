import { describe, expect, it } from "vitest";
import type { HoldedInvoiceRecord } from "../domain/invoice";
import type { StoredInvoice } from "../domain/sync-plan";
import { HoldedApiError, type HoldedClient } from "../holded/client";
import { type ErpSettings, type HoldedRepository, runApiSync, runExcelImport, STALE_RUN_MS, UPSERT_BATCH } from "../sync";

const NOW = new Date("2026-09-28T10:00:00Z");

/** In-memory stand-in for holded_sales_invoices + holded_sync_runs, with a unique index on num. */
function memoryRepo(settings: Partial<ErpSettings> = {}) {
  const rows = new Map<string, StoredInvoice & { source: string }>();
  const runs: { id: string; source: string; status: string; started_at: string; window: unknown; result?: unknown }[] = [];
  let upserts = 0;
  const repo: HoldedRepository = {
    getSettings: async () => ({ holded_base_url: "https://api.holded.com", include_credit_notes: true, sync_lookback_days: 31, ...settings }),
    lastSuccessfulApiRun: async () => runs.filter((r) => r.source === "api" && r.status === "success").at(-1)?.started_at ?? null,
    runningRunStartedAt: async () => runs.filter((r) => r.status === "running").at(-1)?.started_at ?? null,
    earliestOpenDate: async () =>
      [...rows.values()].filter((r) => r.pending !== 0 && r.pending !== null).map((r) => r.date as string).sort()[0] ?? null,
    startRun: async ({ source, window }) => {
      const id = `run${runs.length + 1}`;
      runs.push({ id, source, status: "running", started_at: NOW.toISOString(), window });
      return id;
    },
    finishRun: async (id, result) => {
      const run = runs.find((r) => r.id === id)!;
      run.status = result.status;
      run.result = result;
    },
    loadExisting: async (nums) => new Map(nums.filter((n) => rows.has(n)).map((n) => [n, rows.get(n)!])),
    upsert: async (records: HoldedInvoiceRecord[], source) => {
      upserts++;
      for (const r of records) rows.set(r.num, { ...r, source });
    },
  };
  return { repo, rows, runs, upsertCalls: () => upserts };
}

const apiDoc = (n: number, over: Record<string, unknown> = {}) => ({
  id: `id${n}`,
  document_number: `TP-S-26-${String(n).padStart(5, "0")}`,
  contact_name: `Client ${n}`,
  date: "2026-08-31",
  due_date: "2026-09-30",
  subtotal: "100.00",
  discount: "0",
  tax: "21.00",
  total: "121.00",
  status: "pending",
  tags: [],
  lines: [],
  payment_method_id: null,
  payments_total: "0",
  payments_pending: "121.00",
  ...over,
});

/** Fake Holded: fixed pages per document type, records every list call. */
function fakeClient(pages: { invoice?: unknown[][]; creditnote?: unknown[][] }, opts: { failLookups?: boolean; failOn?: "invoice" | "creditnote" } = {}) {
  const listCalls: { docType: string; startDate: string | null | undefined; endDate: string | null | undefined }[] = [];
  const client: HoldedClient = {
    async *listDocuments(docType, o = {}) {
      listCalls.push({ docType, startDate: o.startDate, endDate: o.endDate });
      if (opts.failOn === docType) throw new HoldedApiError("Holded rate limit reached (minute window). Retry in 60s", 429, 60);
      for (const p of pages[docType] ?? [[]]) yield p;
    },
    async listAll(path) {
      if (opts.failLookups) throw new HoldedApiError("The Holded API key lacks permission", 403);
      if (path.endsWith("payment-methods")) return [{ id: "pm1", name: "Remesa Bancaria" }];
      return [];
    },
    async ping() {},
  };
  return { client, listCalls };
}

describe("runApiSync", () => {
  it("creates on the first run and is idempotent on the second (upsert by Num, nothing duplicated)", async () => {
    const mem = memoryRepo();
    const holded = fakeClient({
      invoice: [[apiDoc(1), apiDoc(2, { payment_method_id: "pm1" })], [apiDoc(3)]],
      creditnote: [[apiDoc(4, { document_number: "CN260001", total: "60.50", subtotal: "50", tax: "10.50", payments_pending: "60.50" })]],
    });

    const first = await runApiSync({ repo: mem.repo, client: holded.client, now: NOW, triggeredBy: "test@tecfys" });
    expect(first).toMatchObject({ ok: true, counts: { fetched: 4, created: 4, updated: 0, skipped: 0, invalid: 0 }, window: { mode: "full" } });
    expect(mem.rows.size).toBe(4);
    expect(mem.rows.get("TP-S-26-00002")!.payment_method).toBe("Remesa Bancaria");
    expect(mem.rows.get("CN260001")).toMatchObject({ doc_type: "creditnote", total: -60.5, pending: -60.5 });

    const writesAfterFirst = mem.upsertCalls();
    const second = await runApiSync({ repo: mem.repo, client: holded.client, now: NOW });
    expect(second).toMatchObject({ ok: true, counts: { fetched: 4, created: 0, updated: 0, skipped: 4, invalid: 0 }, window: { mode: "incremental" } });
    expect(mem.rows.size).toBe(4);
    expect(mem.upsertCalls()).toBe(writesAfterFirst);
    expect(mem.runs.map((r) => r.status)).toEqual(["success", "success"]);
  });

  it("updates a document whose payment changed, and re-reads from the oldest open invoice", async () => {
    const mem = memoryRepo();
    await runApiSync({ repo: mem.repo, client: fakeClient({ invoice: [[apiDoc(1, { date: "2026-03-10", due_date: "2026-04-10" })]] }).client, now: NOW });
    expect(mem.rows.get("TP-S-26-00001")!.status).toBe("Overdue");

    const paid = fakeClient({ invoice: [[apiDoc(1, { date: "2026-03-10", status: "completed", payments_total: "121.00", payments_pending: "0" })]] });
    const res = await runApiSync({ repo: mem.repo, client: paid.client, now: NOW });
    expect(res).toMatchObject({ ok: true, counts: { created: 0, updated: 1, skipped: 0 }, window: { start: "2026-03-10", mode: "incremental" } });
    expect(paid.listCalls[0]).toMatchObject({ docType: "invoice", startDate: "2026-03-10", endDate: null });
    expect(mem.rows.get("TP-S-26-00001")).toMatchObject({ status: "Paid", pending: 0, collected: 121 });
  });

  it("counts rejected documents and keeps going", async () => {
    const mem = memoryRepo({ include_credit_notes: false });
    const holded = fakeClient({ invoice: [[apiDoc(1), apiDoc(2, { document_number: null }), apiDoc(3, { total: "?" })]] });
    const res = await runApiSync({ repo: mem.repo, client: holded.client, now: NOW });
    expect(res).toMatchObject({ ok: true, counts: { fetched: 3, created: 1, invalid: 2 } });
    expect(res.messages).toEqual(["Document id2: no document number (draft?)", "TP-S-26-00003: invalid total"]);
    expect(holded.listCalls.map((c) => c.docType)).toEqual(["invoice"]);
  });

  it("dedupes a Num seen twice in one page", async () => {
    const mem = memoryRepo({ include_credit_notes: false });
    const res = await runApiSync({ repo: mem.repo, client: fakeClient({ invoice: [[apiDoc(1), apiDoc(1, { payments_pending: "0" })]] }).client, now: NOW });
    expect(res.counts).toMatchObject({ fetched: 2, created: 1 });
    expect(mem.rows.get("TP-S-26-00001")!.pending).toBe(0);
  });

  it("writes in batches of UPSERT_BATCH", async () => {
    const mem = memoryRepo({ include_credit_notes: false });
    const page = Array.from({ length: UPSERT_BATCH + 1 }, (_, i) => apiDoc(i + 1));
    const res = await runApiSync({ repo: mem.repo, client: fakeClient({ invoice: [page] }).client, now: NOW });
    expect(res.counts.created).toBe(UPSERT_BATCH + 1);
    expect(mem.upsertCalls()).toBe(2);
  });

  it("turns lookup failures into warnings and shows raw ids", async () => {
    const mem = memoryRepo({ include_credit_notes: false });
    const res = await runApiSync({ repo: mem.repo, client: fakeClient({ invoice: [[apiDoc(1, { payment_method_id: "pm1" })]] }, { failLookups: true }).client, now: NOW });
    expect(res.ok).toBe(true);
    expect(res.messages).toHaveLength(3);
    expect(res.messages[0]).toMatch(/^Warning: could not load payment methods/);
    expect(mem.rows.get("TP-S-26-00001")!.payment_method).toBe("pm1");
  });

  it("surfaces an API error, keeps what was stored and marks the run failed", async () => {
    const mem = memoryRepo();
    const res = await runApiSync({ repo: mem.repo, client: fakeClient({ invoice: [[apiDoc(1)]] }, { failOn: "creditnote" }).client, now: NOW });
    expect(res).toMatchObject({ ok: false, error: "Holded rate limit reached (minute window). Retry in 60s", counts: { created: 1 } });
    expect(mem.rows.size).toBe(1);
    expect(mem.runs[0].status).toBe("error");
    // A failed run does not advance the incremental window.
    const next = await runApiSync({ repo: mem.repo, client: fakeClient({}).client, now: NOW });
    expect(next).toMatchObject({ ok: true, window: { mode: "full" } });
  });

  it("refuses to start while another run is in progress, unless that run is stale", async () => {
    const mem = memoryRepo();
    await mem.repo.startRun({ source: "api", triggeredBy: null, window: null });
    const blocked = await runApiSync({ repo: mem.repo, client: fakeClient({}).client, now: NOW });
    expect(blocked).toEqual({ ok: false, runId: null, error: "A Holded sync is already running", counts: expect.any(Object), messages: [] });

    const later = new Date(NOW.getTime() + STALE_RUN_MS + 1);
    const res = await runApiSync({ repo: mem.repo, client: fakeClient({}).client, now: later });
    expect(res.ok).toBe(true);
  });

  it("passes an explicit date range through to Holded", async () => {
    const mem = memoryRepo({ include_credit_notes: false });
    const holded = fakeClient({});
    await runApiSync({ repo: mem.repo, client: holded.client, now: NOW, range: { start: "2026-08-01", end: "2026-08-31" } });
    expect(holded.listCalls[0]).toMatchObject({ startDate: "2026-08-01", endDate: "2026-08-31" });
  });
});

describe("runExcelImport", () => {
  const excelRecord = (num: string, over: Partial<HoldedInvoiceRecord> = {}): HoldedInvoiceRecord => ({
    num, holded_id: null, doc_type: "invoice", date: "2026-08-31T00:00:00.000Z", operation_date: "2026-08-31T00:00:00.000Z",
    due_date: "2026-09-30T00:00:00.000Z", client: "Client", description: null, tags: null, account: null, payment_method: null,
    project: null, subtotal: 100, vat: 21, withholding: 0, employees: 0, equivalence_surcharge: 0, total: 121, collected: 0,
    pending: 121, status: "Pending", collected_date: null, digital_signature: null, sii: null, ...over,
  });

  it("stores mapped rows, reports rejects, and re-imports without changes", async () => {
    const mem = memoryRepo();
    const results = [{ ok: true as const, record: excelRecord("A") }, { ok: true as const, record: excelRecord("B") }, { ok: false as const, error: "Missing Num (row 9)" }];
    const first = await runExcelImport({ repo: mem.repo, results });
    expect(first).toMatchObject({ ok: true, counts: { fetched: 3, created: 2, invalid: 1 }, messages: ["Missing Num (row 9)"] });
    const again = await runExcelImport({ repo: mem.repo, results });
    expect(again.counts).toMatchObject({ created: 0, updated: 0, skipped: 2 });
    expect(mem.rows.get("A")!.source).toBe("excel");
    expect(mem.runs.every((r) => r.source === "excel")).toBe(true);
  });

  it("an API sync after an Excel import updates the same Num instead of duplicating it", async () => {
    const mem = memoryRepo({ include_credit_notes: false });
    await runExcelImport({ repo: mem.repo, results: [{ ok: true, record: excelRecord("TP-S-26-00001") }] });
    const res = await runApiSync({ repo: mem.repo, client: fakeClient({ invoice: [[apiDoc(1)]] }).client, now: NOW });
    expect(res.counts).toMatchObject({ created: 0, updated: 1 });
    expect(mem.rows.size).toBe(1);
    expect(mem.rows.get("TP-S-26-00001")).toMatchObject({ holded_id: "id1", source: "api", client: "Client 1" });
  });
});
