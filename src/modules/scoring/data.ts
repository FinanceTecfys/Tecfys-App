import "server-only";
import { db } from "@/lib/supabase/server";
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

export async function listScorings(limit = 100) {
  const { data, error } = await db()
    .from("scorings")
    .select("id, rating, decision, status, total_score, credit_opinion, created_at, company:companies ( id, cif, name )")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function getScoring(id: string) {
  const { data, error } = await db()
    .from("scorings")
    .select("*, company:companies ( * ), report:informa_reports ( id, file_name, reference_year, source )")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    financials: data.financials as unknown as Financials,
    breakdown: data.breakdown as unknown as Record<RatioKey, RatioResult>,
  };
}

export type ScoringDetail = NonNullable<Awaited<ReturnType<typeof getScoring>>>;
