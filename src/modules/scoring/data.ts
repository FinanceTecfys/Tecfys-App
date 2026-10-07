import "server-only";
import { createdByFilter, type DataScope, inScope } from "@/lib/auth/scope";
import { db } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { DEFAULT_CRITERIA, type ScoringCriteria } from "./domain/criteria";
import type { RatioKey } from "./domain/criteria";
import type { RatioResult } from "./domain/engine";
import type { Financials } from "./domain/financials";

export async function getActiveCriteria(): Promise<{ id: string | null; version: number; config: ScoringCriteria }> {
  const { data, error } = await db().from("scoring_criteria").select("id, version, config").eq("is_active", true).maybeSingle();
  if (error) throw error;
  if (!data) return { id: null, version: 0, config: DEFAULT_CRITERIA };
  return { id: data.id, version: data.version, config: data.config as unknown as ScoringCriteria };
}

/**
 * Scorings inside the caller's scope, newest first: a partner only gets the
 * ones it created. The scope is mandatory so no caller can forget it.
 */
export async function listScorings(scope: DataScope, { limit = 100, status }: { limit?: number; status?: Database["public"]["Enums"]["scoring_status"] } = {}) {
  let q = db()
    .from("scorings")
    .select("id, rating, decision, status, total_score, credit_opinion, created_at, company:companies ( id, cif, name )")
    .order("created_at", { ascending: false })
    .limit(limit);
  const createdBy = createdByFilter(scope);
  if (createdBy) q = q.eq("created_by", createdBy);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

/** One scoring; null when it does not exist OR is outside the caller's scope (not found either way). */
export async function getScoring(id: string, scope: DataScope) {
  const { data, error } = await db()
    .from("scorings")
    .select("*, company:companies ( * ), report:informa_reports ( id, file_name, reference_year, source )")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || !inScope(scope, data.created_by)) return null;
  return {
    ...data,
    financials: data.financials as unknown as Financials,
    breakdown: data.breakdown as unknown as Record<RatioKey, RatioResult>,
  };
}

/**
 * An Informa report the caller may link to a scoring; null when it does not
 * exist OR is outside the caller's scope (not found either way). A partner only
 * reaches the reports it fetched or uploaded; a report with no owner (older
 * than informa_reports.created_by) is Tecfys's, like every record with no creator.
 */
export async function getInformaReport(id: string, scope: DataScope) {
  const { data, error } = await db().from("informa_reports").select("id, created_by").eq("id", id).maybeSingle();
  if (error) throw error;
  return data && inScope(scope, data.created_by) ? data : null;
}

export type ScoringDetail = NonNullable<Awaited<ReturnType<typeof getScoring>>>;
