/**
 * The arguments of public.record_scoring (migration 20261028000000): one call
 * stores the scoring, writes the company as the update policy decided and
 * records the changes - in one transaction. Pure, so the exact payload is tested.
 */
import type { Json } from "@/lib/supabase/database.types";
import type { ChangeSource, CompanyUpdateDecision } from "./update-policy";

export const RECORD_SCORING_RPC = "record_scoring";

export interface RecordScoringArgs {
  p_scoring: Json;
  /** create: the new company's columns; update: ONLY the applied columns ({} = untouched). */
  p_company: Json;
  p_changes: Json;
  /** Omitted to create the company (the SQL default is null). */
  p_company_id?: string;
  /** Omitted when nothing is recorded. */
  p_source?: string;
  p_report_id?: string;
}

export function recordScoringArgs(input: {
  decision: CompanyUpdateDecision;
  source: ChangeSource | null;
  /** scorings columns (the function allow-lists them; company_id is its own). */
  scoring: Record<string, unknown>;
  reportId: string | null;
}): RecordScoringArgs {
  const { decision, source, scoring, reportId } = input;
  const args: RecordScoringArgs = {
    p_scoring: scoring as Json,
    p_company: (decision.kind === "create" ? decision.values : decision.apply) as Json,
    p_changes: decision.kind === "create" ? [] : decision.changes.map((c) => ({ field: c.field, old_value: c.oldValue, new_value: c.newValue, status: c.status })),
  };
  if (decision.kind === "update") args.p_company_id = decision.companyId;
  if (decision.kind === "update" && decision.changes.length > 0 && source) args.p_source = source;
  if (reportId) args.p_report_id = reportId;
  return args;
}

/** { scoring_id, company_id } returned by the function, or null when it did not answer that. */
export function recordedScoringOf(data: unknown): { scoringId: string; companyId: string } | null {
  if (!data || typeof data !== "object") return null;
  const { scoring_id, company_id } = data as Record<string, unknown>;
  return typeof scoring_id === "string" && typeof company_id === "string" ? { scoringId: scoring_id, companyId: company_id } : null;
}
