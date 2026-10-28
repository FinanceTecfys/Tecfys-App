import "server-only";
import { db } from "@/lib/supabase/server";
import type { CompanyField, CompanyValue, CurrentCompany } from "./domain/update-policy";

// Literal selects (the generated types parse them); the columns are COMPANY_FIELDS (guarded by a test).
const POLICY_COLUMNS =
  "id, cif, name, address, fiscal_postal_code, fiscal_city, fiscal_province, admin_name, admin_nif, cnae, sector, constitution_date, phone, email, web, employees";

/** The stored company with this (normalised) CIF, with the columns the update policy reads; null when new. */
export async function getCompanyByCif(cif: string): Promise<CurrentCompany | null> {
  const { data, error } = await db().from("companies").select(POLICY_COLUMNS).eq("cif", cif).maybeSingle();
  if (error) throw error;
  return data;
}

export interface PendingCompanyChange {
  id: string;
  field: CompanyField;
  oldValue: string | null;
  newValue: string;
  /** The company's value today (it may differ from oldValue if it changed since). */
  currentValue: string | null;
  source: string;
  createdAt: string;
  createdBy: string | null;
  scoringId: string | null;
  company: { id: string; cif: string; name: string } | null;
}

/** Pending changes, oldest first (at most 500). Callers must hold companyChanges.review. */
export async function listPendingCompanyChanges(): Promise<PendingCompanyChange[]> {
  const { data, error } = await db()
    .from("company_changes")
    .select(
      "id, field, old_value, new_value, source, created_at, created_by, scoring_id, company:companies ( id, cif, name, address, fiscal_postal_code, fiscal_city, fiscal_province, admin_name, admin_nif, cnae, sector, constitution_date, phone, email, web, employees )",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return data.map((row) => {
    const field = row.field as CompanyField;
    const current: CompanyValue | undefined = row.company ? (row.company as Record<CompanyField, CompanyValue>)[field] : null;
    return {
      id: row.id,
      field,
      oldValue: row.old_value,
      newValue: row.new_value,
      currentValue: current === null || current === undefined ? null : String(current),
      source: row.source,
      createdAt: row.created_at,
      createdBy: row.created_by,
      scoringId: row.scoring_id,
      company: row.company ? { id: row.company.id, cif: row.company.cif, name: row.company.name } : null,
    };
  });
}

/** Pending changes count, for the tab badge. */
export async function countPendingCompanyChanges(): Promise<number> {
  const { count, error } = await db().from("company_changes").select("id", { count: "exact", head: true }).eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}
