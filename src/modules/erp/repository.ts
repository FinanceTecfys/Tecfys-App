/**
 * Supabase implementation of HoldedRepository. Takes the client as a
 * parameter (no `server-only`) so the CLI scripts reuse it with their own
 * service-role client; the app passes db().
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { StoredInvoice } from "./domain/sync-plan";
import type { ErpSettings, HoldedRepository } from "./sync";

const LOOKUP_CHUNK = 200;

export const DEFAULT_ERP_SETTINGS: ErpSettings = {
  holded_base_url: "https://api.holded.com",
  include_credit_notes: true,
  sync_lookback_days: 31,
};

export async function readErpSettings(sb: SupabaseClient<Database>): Promise<ErpSettings> {
  const { data, error } = await sb.from("erp_settings").select("holded_base_url, include_credit_notes, sync_lookback_days").eq("id", true).maybeSingle();
  if (error) throw error;
  return data ?? DEFAULT_ERP_SETTINGS;
}

export function supabaseHoldedRepository(sb: SupabaseClient<Database>): HoldedRepository {
  return {
    getSettings: () => readErpSettings(sb),

    async lastSuccessfulApiRun() {
      const { data, error } = await sb
        .from("holded_sync_runs")
        .select("started_at")
        .eq("source", "api")
        .eq("status", "success")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.started_at ?? null;
    },

    async runningRunStartedAt() {
      const { data, error } = await sb
        .from("holded_sync_runs")
        .select("started_at")
        .eq("status", "running")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.started_at ?? null;
    },

    async earliestOpenDate() {
      const { data, error } = await sb
        .from("holded_sales_invoices")
        .select("date")
        .neq("pending", 0)
        .order("date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.date ?? null;
    },

    async startRun({ source, triggeredBy, window }) {
      const { data, error } = await sb
        .from("holded_sync_runs")
        .insert({ source, triggered_by: triggeredBy, window_start: window?.start ?? null, window_end: window?.end ?? null })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },

    async finishRun(id, { status, counts, error: message, messages }) {
      const { error } = await sb
        .from("holded_sync_runs")
        .update({ status, finished_at: new Date().toISOString(), error: message, messages, ...counts })
        .eq("id", id);
      if (error) throw error;
    },

    async loadExisting(nums) {
      const out = new Map<string, StoredInvoice>();
      for (let i = 0; i < nums.length; i += LOOKUP_CHUNK) {
        const { data, error } = await sb.from("holded_sales_invoices").select("*").in("num", nums.slice(i, i + LOOKUP_CHUNK));
        if (error) throw error;
        for (const row of data) out.set(row.num, row);
      }
      return out;
    },

    async upsert(records, source) {
      const syncedAt = new Date().toISOString();
      const { error } = await sb
        .from("holded_sales_invoices")
        .upsert(records.map((r) => ({ ...r, source, synced_at: syncedAt })), { onConflict: "num" });
      if (error) throw error;
    },
  };
}
