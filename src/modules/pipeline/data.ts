import "server-only";
import { db } from "@/lib/supabase/server";
import { listUsers } from "@/modules/users/data";
import type { LifecycleInput } from "./domain/lifecycle";
import type { PipelineContract, PipelineScoring, PipelineUser } from "./domain/pipeline";

const PAGE = 1000;

async function fetchScorings(): Promise<PipelineScoring[]> {
  const rows: PipelineScoring[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("scorings")
      .select("id, status, rating, total_score, created_at, created_by, company:companies ( name, cif, sector )")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(
      ...data.map((s) => ({
        id: s.id,
        status: s.status,
        rating: s.rating,
        totalScore: Number(s.total_score),
        createdAt: s.created_at,
        createdBy: s.created_by,
        company: s.company,
      })),
    );
    if (data.length < PAGE) break;
  }
  return rows;
}

/** Only the contracts born from a scoring: the imported loan book has none and is not pipeline. */
async function fetchOperations(): Promise<PipelineContract[]> {
  const rows: PipelineContract[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("contracts")
      .select("id, contract_number, scoring_id, workflow_status, created_at, distributor:distributors ( name ), signature_requests ( id )")
      .not("scoring_id", "is", null)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const c of data) {
      if (!c.scoring_id) continue;
      rows.push({
        id: c.id,
        contractNumber: c.contract_number,
        scoringId: c.scoring_id,
        workflowStatus: c.workflow_status,
        createdAt: c.created_at,
        distributorName: c.distributor?.name ?? null,
        hasSignatureRequest: c.signature_requests.length > 0,
      });
    }
    if (data.length < PAGE) break;
  }
  return rows;
}

/**
 * Everything the Pipeline shows, in ONE load: every scoring, the operations
 * created from them and the user directory. Unscoped (all partners): only for
 * callers behind requireRole("pipeline.view"). Aggregation happens in memory
 * (domain/pipeline.ts), not in further queries.
 */
export async function loadPipeline(): Promise<{ scorings: PipelineScoring[]; contracts: PipelineContract[]; users: PipelineUser[] }> {
  const [scorings, contracts, users] = await Promise.all([fetchScorings(), fetchOperations(), listUsers()]);
  return {
    scorings,
    contracts,
    // Only what resolves "who created it": no activity or status fields of the account.
    users: users.map((u) => ({ id: u.id, email: u.email, role: u.role, distributor: u.distributor })),
  };
}

/**
 * The lifecycle facts of one contract that its own row does not carry: the
 * status of the scoring it came from and whether it was sent to e-signature.
 * Call it for a contract the caller already reached through getContract (scope
 * checked there); it returns statuses only.
 */
export async function contractLifecycleInput(contract: { id: string; scoring_id: string | null; workflow_status: string }): Promise<LifecycleInput> {
  const [scoring, signature] = await Promise.all([
    contract.scoring_id ? db().from("scorings").select("status").eq("id", contract.scoring_id).maybeSingle() : null,
    db().from("signature_requests").select("id", { count: "exact", head: true }).eq("contract_id", contract.id),
  ]);
  if (scoring?.error) throw scoring.error;
  if (signature.error) throw signature.error;
  return {
    scoringStatus: scoring?.data?.status ?? null,
    contract: { workflowStatus: contract.workflow_status, hasSignatureRequest: (signature.count ?? 0) > 0 },
  };
}
