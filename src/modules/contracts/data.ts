import "server-only";
import { db } from "@/lib/supabase/server";
import { monthKeyOfDate } from "./domain/month-key";
import { buildSchedule, type ContractInput, type ContractSchedule, principalOutstandingAt } from "./domain/schedule";

const CONTRACT_SELECT = `
  id, contract_number, loan_book_ref, contract_type, tranche_lender, product_type, rating, sector,
  signing_date, duration_months, installment, residual_value, purchase_value, expo_adjustment,
  has_guarantor, guarantor_name, guarantor_nif, cancel_date, additional_status, residual_waived,
  amortize_over_real_life, workflow_status, notes, created_at, scoring_id,
  company:companies ( id, cif, name ),
  distributor:distributors ( id, name ),
  asset_type:asset_types ( id, name ),
  type:contract_types ( billing_lag_months )
`;

async function fetchContracts(filter?: { companyId?: string }) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = db().from("contracts").select(CONTRACT_SELECT).order("signing_date", { ascending: false }).order("contract_number").range(from, from + 999);
    if (filter?.companyId) q = q.eq("company_id", filter.companyId);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

type ContractRow = Awaited<ReturnType<typeof fetchContracts>>[number];

export function toContractInput(row: ContractRow): ContractInput {
  return {
    signingDate: row.signing_date,
    billingLagMonths: row.type?.billing_lag_months ?? 0,
    durationMonths: row.duration_months,
    installment: Number(row.installment),
    residualValue: row.residual_value === null ? null : Number(row.residual_value),
    purchaseValue: Number(row.purchase_value),
    expoAdjustment: Number(row.expo_adjustment),
    cancelDate: row.cancel_date,
    residualWaived: row.residual_waived,
    amortizeOverRealLife: row.amortize_over_real_life,
  };
}

export interface ContractWithSchedule {
  row: ContractRow;
  schedule: ContractSchedule;
  outstanding: number;
}

/**
 * Every contract of the loan book with its schedule, computed as of `asOf`.
 * Drafts (not yet signed) are excluded from the portfolio by default.
 */
export async function loadLoanBook({ asOf = new Date(), includeDrafts = false, companyId }: { asOf?: Date; includeDrafts?: boolean; companyId?: string } = {}) {
  const rows = await fetchContracts({ companyId });
  const key = monthKeyOfDate(asOf);
  return rows
    .filter((r) => includeDrafts || r.workflow_status === "signed")
    .map((row): ContractWithSchedule => {
      const schedule = buildSchedule(toContractInput(row), asOf);
      return { row, schedule, outstanding: principalOutstandingAt(schedule, key) ?? 0 };
    });
}

export async function getContract(id: string) {
  const { data, error } = await db().from("contracts").select(CONTRACT_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listPipeline() {
  const { data, error } = await db()
    .from("contracts")
    .select("id, contract_number, workflow_status, purchase_value, created_at, company:companies ( name )")
    .in("workflow_status", ["draft", "pending_signature"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data;
}
