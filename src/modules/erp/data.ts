import "server-only";
import { db } from "@/lib/supabase/server";
import { readErpSettings } from "./repository";
import { type ErpQuery, searchPattern } from "./domain/erp-view";

export const ERP_PAGE_SIZE = 50;

export async function getErpSettings() {
  return readErpSettings(db());
}

export async function lastSyncRun() {
  const { data, error } = await db()
    .from("holded_sync_runs")
    .select("id, source, status, started_at, finished_at, window_start, window_end, fetched, created, updated, skipped, invalid, error, messages")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type SyncRun = NonNullable<Awaited<ReturnType<typeof lastSyncRun>>>;

/** PostgREST: the requested page starts past the last row. */
const RANGE_NOT_SATISFIABLE = "PGRST103";

/** One page of invoices matching the query, newest first, plus the total count. */
export async function listHoldedInvoices(query: ErpQuery) {
  const filtered = <T extends { or(f: string): T; eq(c: "status", v: string): T }>(q: T) => {
    const pattern = searchPattern(query.q);
    if (pattern) q = q.or(`num.ilike.${pattern},client.ilike.${pattern},description.ilike.${pattern},tags.ilike.${pattern}`);
    if (query.status) q = q.eq("status", query.status);
    return q;
  };
  const { data, error, count } = await filtered(
    db()
      .from("holded_sales_invoices")
      .select("*", { count: "exact" })
      .order("date", { ascending: false })
      .order("num", { ascending: false })
      .range((query.page - 1) * ERP_PAGE_SIZE, query.page * ERP_PAGE_SIZE - 1),
  );
  if (error?.code === RANGE_NOT_SATISFIABLE) {
    const head = await filtered(db().from("holded_sales_invoices").select("id", { count: "exact", head: true }));
    if (head.error) throw head.error;
    return { rows: [], count: head.count ?? 0 };
  }
  if (error) throw error;
  return { rows: data, count: count ?? 0 };
}

export type HoldedInvoiceRow = Awaited<ReturnType<typeof listHoldedInvoices>>["rows"][number];
