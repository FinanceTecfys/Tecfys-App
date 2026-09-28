/**
 * Upsert planning and incremental-window logic for the Holded sync. Pure.
 */
import { HOLDED_COLUMNS, type HoldedInvoiceRecord } from "./invoice";

/** The fields that define a record's content (holded_id and doc_type included). */
const COMPARED_KEYS = [...HOLDED_COLUMNS.map((c) => c.key), "holded_id", "doc_type"] as const satisfies readonly (keyof HoldedInvoiceRecord)[];
const DATE_KEYS = new Set<string>(HOLDED_COLUMNS.filter((c) => c.kind === "date").map((c) => c.key));
const MONEY_KEYS = new Set<string>(HOLDED_COLUMNS.filter((c) => c.kind === "money").map((c) => c.key));

/** A stored row as read back from the database (numeric may arrive as string, timestamptz as "+00:00"). */
export type StoredInvoice = { [K in keyof HoldedInvoiceRecord]: unknown };

const sameValue = (key: string, a: unknown, b: unknown) => {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (DATE_KEYS.has(key)) return Date.parse(String(a)) === Date.parse(String(b));
  if (MONEY_KEYS.has(key)) return Math.abs(Number(a) - Number(b)) < 0.005;
  return a === b;
};

/**
 * Whether an incoming record would change the stored row. A stored holded_id
 * is kept when the incoming record has none (an Excel re-import after an API
 * sync must not count as a change just because the Excel lacks the id).
 */
export function recordsEqual(incoming: HoldedInvoiceRecord, stored: StoredInvoice): boolean {
  return COMPARED_KEYS.every((key) => {
    if (key === "holded_id" && incoming.holded_id === null) return true;
    return sameValue(key, incoming[key], stored[key]);
  });
}

/** Last occurrence of each Num wins (a document edited between two pages). */
export function dedupeByNum(records: readonly HoldedInvoiceRecord[]): HoldedInvoiceRecord[] {
  const byNum = new Map<string, HoldedInvoiceRecord>();
  for (const r of records) byNum.set(r.num, r);
  return [...byNum.values()];
}

export interface UpsertPlan {
  toCreate: HoldedInvoiceRecord[];
  toUpdate: HoldedInvoiceRecord[];
  /** Identical to what is stored: not written. */
  unchanged: HoldedInvoiceRecord[];
}

/** Split incoming records by what the upsert on Num will do to them. */
export function planUpsert(incoming: readonly HoldedInvoiceRecord[], existing: ReadonlyMap<string, StoredInvoice>): UpsertPlan {
  const plan: UpsertPlan = { toCreate: [], toUpdate: [], unchanged: [] };
  for (const r of dedupeByNum(incoming)) {
    const stored = existing.get(r.num);
    if (!stored) plan.toCreate.push(r);
    else if (recordsEqual(r, stored)) plan.unchanged.push(r);
    else {
      // Keep the id we already know when this source does not carry one.
      plan.toUpdate.push(r.holded_id === null && typeof stored.holded_id === "string" ? { ...r, holded_id: stored.holded_id } : r);
    }
  }
  return plan;
}

export interface SyncWindow {
  /** Inclusive issue-date bounds, "YYYY-MM-DD"; null = unbounded. */
  start: string | null;
  end: string | null;
  mode: "full" | "incremental" | "range";
}

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Which issue dates the next API sync reads. The API filters only by issue
 * date (there is no "modified since"), so an incremental run re-reads:
 *   - everything issued since the last successful run, minus `lookbackDays`
 *     (late-issued or edited recent documents), and
 *   - every document still open (pending <> 0), whose payments/status move.
 * No successful run yet, or `full`, reads everything. An explicit range wins.
 */
export function planSyncWindow(opts: {
  lastSuccessAt: string | null;
  earliestOpenDate: string | null;
  lookbackDays: number;
  full?: boolean;
  range?: { start: string | null; end: string | null };
}): SyncWindow {
  if (opts.range && (opts.range.start || opts.range.end)) return { start: opts.range.start, end: opts.range.end, mode: "range" };
  if (opts.full || !opts.lastSuccessAt) return { start: null, end: null, mode: "full" };
  let start = Date.parse(opts.lastSuccessAt) - Math.max(0, opts.lookbackDays) * DAY_MS;
  if (opts.earliestOpenDate) start = Math.min(start, Date.parse(opts.earliestOpenDate));
  return { start: isoDay(start), end: null, mode: "incremental" };
}

export interface SyncCounts {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
}

export const emptyCounts = (): SyncCounts => ({ fetched: 0, created: 0, updated: 0, skipped: 0, invalid: 0 });
