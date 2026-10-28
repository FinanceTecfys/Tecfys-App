/**
 * The contract of the two database functions that write an operation in one
 * transaction (supabase/migrations/20261028120000_operation_master_policy.sql,
 * first 20261001000000_atomic_contract_writes.sql): their names and the
 * arguments the server actions send. Pure, so what is sent is unit-tested and
 * checked against the SQL signature without a database.
 *
 * Every argument is a JSON object keyed by the column names of its table; the
 * contract's values come from the mappings creation and edit have always shared
 * (domain/operation.ts). The company is no longer written with what was typed:
 * p_company / p_changes carry the update policy's decision (only the applied
 * columns, and the change rows).
 */
import { changeRows } from "@/modules/companies/domain/record-scoring";
import type { CompanyChange, CompanyValues } from "@/modules/companies/domain/update-policy";
import type { AttachmentRowInsert } from "./attachments";
import { type Operation, operationAssetFields, operationContractFields, operationMandateFields } from "./operation";

/** The company side of an operation write, as the update policy decided it. */
export interface CompanyWrite {
  /** Only the columns to apply ({} = the master is not touched). */
  apply: CompanyValues;
  changes: readonly CompanyChange[];
}

export const CREATE_DRAFT_RPC = "create_draft_contract";
export const UPDATE_DRAFT_RPC = "update_draft_contract";

export interface CreateDraftContext {
  /** Chosen by the caller so the attachment objects can be stored under it first. */
  id: string;
  companyId: string;
  scoringId: string;
  distributorId: string | null;
  rating: string | null;
  sector: string | null;
  createdBy: string;
  /** Metadata of the files already uploaded to the private bucket. */
  attachments: AttachmentRowInsert[];
  /** ISO date the SEPA mandate is dated. */
  today: string;
  company: CompanyWrite;
}

export function createDraftArgs(v: Operation, ctx: CreateDraftContext) {
  return {
    p_contract: {
      id: ctx.id,
      company_id: ctx.companyId,
      scoring_id: ctx.scoringId,
      distributor_id: ctx.distributorId,
      rating: ctx.rating,
      sector: ctx.sector,
      created_by: ctx.createdBy,
      ...operationContractFields(v),
    },
    p_asset: operationAssetFields(v),
    p_mandate: { ...operationMandateFields(v), signed_at: ctx.today },
    p_company: ctx.company.apply,
    p_attachments: ctx.attachments.map(({ kind, file_name, mime_type, size_bytes, storage_path }) => ({ kind, file_name, mime_type, size_bytes, storage_path })),
    p_changes: changeRows(ctx.company.changes),
  };
}

export interface UpdateDraftContext {
  contractId: string;
  distributorId: string | null;
  /** Dates the SEPA mandate only when the draft has none yet; an existing mandate keeps its date. */
  today: string;
  company: CompanyWrite;
  /** Who edits: recorded on the change rows. */
  actorId: string;
}

export function updateDraftArgs(v: Operation, ctx: UpdateDraftContext) {
  return {
    p_contract_id: ctx.contractId,
    p_contract: { ...operationContractFields(v), distributor_id: ctx.distributorId },
    p_asset: operationAssetFields(v),
    p_mandate: { ...operationMandateFields(v), signed_at: ctx.today },
    p_company: ctx.company.apply,
    p_changes: changeRows(ctx.company.changes),
    p_actor: ctx.actorId,
  };
}

/** What create_draft_contract returns: { id, contract_number }; null for anything else. */
export function createdDraftOf(data: unknown): { id: string; contractNumber: string } | null {
  if (typeof data !== "object" || data === null) return null;
  const { id, contract_number } = data as Record<string, unknown>;
  return typeof id === "string" && typeof contract_number === "string" ? { id, contractNumber: contract_number } : null;
}
