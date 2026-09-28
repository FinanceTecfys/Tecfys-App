/**
 * Holded sync orchestration, shared by the server action, `npm run sync:holded`
 * and `npm run import:holded`. Storage is behind HoldedRepository and the API
 * behind HoldedClient, so the whole flow runs in tests with in-memory fakes.
 */
import type { HoldedClient } from "./holded/client";
import type { HoldedDocType, HoldedInvoiceRecord, HoldedSource, MapResult } from "./domain/invoice";
import { buildLookups, EMPTY_LOOKUPS, type HoldedLookups, mapApiDocument } from "./domain/map-api";
import { emptyCounts, planSyncWindow, planUpsert, type StoredInvoice, type SyncCounts, type SyncWindow } from "./domain/sync-plan";

export interface ErpSettings {
  holded_base_url: string;
  include_credit_notes: boolean;
  sync_lookback_days: number;
}

export interface HoldedRepository {
  getSettings(): Promise<ErpSettings>;
  /** started_at of the newest successful API run. */
  lastSuccessfulApiRun(): Promise<string | null>;
  /** started_at of a run still marked running, if any. */
  runningRunStartedAt(): Promise<string | null>;
  /** Issue date of the oldest stored document with pending <> 0. */
  earliestOpenDate(): Promise<string | null>;
  startRun(run: { source: HoldedSource; triggeredBy: string | null; window: SyncWindow | null }): Promise<string>;
  finishRun(id: string, result: { status: "success" | "error"; counts: SyncCounts; error: string | null; messages: string[] }): Promise<void>;
  loadExisting(nums: string[]): Promise<Map<string, StoredInvoice>>;
  upsert(records: HoldedInvoiceRecord[], source: HoldedSource): Promise<void>;
}

export type SyncResult =
  | { ok: true; runId: string; window: SyncWindow | null; counts: SyncCounts; messages: string[] }
  | { ok: false; runId: string | null; error: string; counts: SyncCounts; messages: string[] };

export const UPSERT_BATCH = 500;
const MAX_MESSAGES = 50;
/** A run marked running for longer than this is considered dead (crashed process). */
export const STALE_RUN_MS = 30 * 60_000;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));

/** Upsert records by Num in batches; adds to `counts`. Idempotent: identical rows are not written. */
export async function applyRecords(repo: HoldedRepository, records: readonly HoldedInvoiceRecord[], source: HoldedSource, counts: SyncCounts) {
  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    const batch = records.slice(i, i + UPSERT_BATCH);
    const existing = await repo.loadExisting([...new Set(batch.map((r) => r.num))]);
    const plan = planUpsert(batch, existing);
    const writes = [...plan.toCreate, ...plan.toUpdate];
    if (writes.length) await repo.upsert(writes, source);
    counts.created += plan.toCreate.length;
    counts.updated += plan.toUpdate.length;
    counts.skipped += plan.unchanged.length;
  }
}

class Messages {
  readonly list: string[] = [];
  private dropped = 0;
  push(m: string) {
    if (this.list.length < MAX_MESSAGES) this.list.push(m);
    else this.dropped++;
  }
  done() {
    return this.dropped ? [...this.list, `… and ${this.dropped} more`] : this.list;
  }
}

async function loadLookups(client: HoldedClient, messages: Messages): Promise<HoldedLookups> {
  const safe = async (label: string, load: () => Promise<unknown[]>) => {
    try {
      return await load();
    } catch (e) {
      messages.push(`Warning: could not load ${label} (${errorMessage(e)}); raw ids shown instead`);
      return [];
    }
  };
  const [paymentMethods, projects, accounts] = await Promise.all([
    safe("payment methods", () => client.listAll("/api/v2/payment-methods")),
    safe("projects", () => client.listAll("/api/v2/projects")),
    safe("accounting accounts", () => client.listAll("/api/v2/accounting-accounts", { paginated: false })),
  ]);
  return paymentMethods.length || projects.length || accounts.length ? buildLookups({ paymentMethods, projects, accounts }) : EMPTY_LOOKUPS;
}

/** Pull sales invoices (and credit notes) from Holded and upsert them by Num. */
export async function runApiSync(opts: {
  repo: HoldedRepository;
  client: HoldedClient;
  now?: Date;
  triggeredBy?: string | null;
  full?: boolean;
  range?: { start: string | null; end: string | null };
}): Promise<SyncResult> {
  const { repo, client } = opts;
  const now = opts.now ?? new Date();
  const counts = emptyCounts();
  const messages = new Messages();

  const running = await repo.runningRunStartedAt();
  if (running && now.getTime() - Date.parse(running) < STALE_RUN_MS) {
    return { ok: false, runId: null, error: "A Holded sync is already running", counts, messages: [] };
  }

  const settings = await repo.getSettings();
  const [lastSuccessAt, earliestOpenDate] = await Promise.all([repo.lastSuccessfulApiRun(), repo.earliestOpenDate()]);
  const window = planSyncWindow({ lastSuccessAt, earliestOpenDate, lookbackDays: settings.sync_lookback_days, full: opts.full, range: opts.range });
  const runId = await repo.startRun({ source: "api", triggeredBy: opts.triggeredBy ?? null, window });

  try {
    const lookups = await loadLookups(client, messages);
    const docTypes: HoldedDocType[] = settings.include_credit_notes ? ["invoice", "creditnote"] : ["invoice"];
    for (const docType of docTypes) {
      for await (const items of client.listDocuments(docType, { startDate: window.start, endDate: window.end })) {
        counts.fetched += items.length;
        const records: HoldedInvoiceRecord[] = [];
        for (const item of items) {
          const mapped = mapApiDocument(item, { docType, asOf: now, lookups });
          if (mapped.ok) records.push(mapped.record);
          else { counts.invalid++; messages.push(mapped.error); }
        }
        await applyRecords(repo, records, "api", counts);
      }
    }
    const list = messages.done();
    await repo.finishRun(runId, { status: "success", counts, error: null, messages: list });
    return { ok: true, runId, window, counts, messages: list };
  } catch (e) {
    const error = errorMessage(e);
    const list = messages.done();
    await repo.finishRun(runId, { status: "error", counts, error, messages: list }).catch(() => undefined);
    return { ok: false, runId, error, counts, messages: list };
  }
}

/** Store rows already mapped from the Holded Excel export (same target shape as the API). */
export async function runExcelImport(opts: {
  repo: HoldedRepository;
  results: readonly MapResult[];
  triggeredBy?: string | null;
}): Promise<SyncResult> {
  const { repo } = opts;
  const counts = emptyCounts();
  const messages = new Messages();
  const records: HoldedInvoiceRecord[] = [];
  for (const r of opts.results) {
    counts.fetched++;
    if (r.ok) records.push(r.record);
    else { counts.invalid++; messages.push(r.error); }
  }
  const runId = await repo.startRun({ source: "excel", triggeredBy: opts.triggeredBy ?? null, window: null });
  try {
    await applyRecords(repo, records, "excel", counts);
    const list = messages.done();
    await repo.finishRun(runId, { status: "success", counts, error: null, messages: list });
    return { ok: true, runId, window: null, counts, messages: list };
  } catch (e) {
    const error = errorMessage(e);
    const list = messages.done();
    await repo.finishRun(runId, { status: "error", counts, error, messages: list }).catch(() => undefined);
    return { ok: false, runId, error, counts, messages: list };
  }
}
