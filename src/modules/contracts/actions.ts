"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrorsOf, getTranslate } from "@/i18n/server";
import { dataScopeFor, inScope, operationDistributorId } from "@/lib/auth/scope";
import { requireRole } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import {
  ATTACHMENT_BUCKET,
  type AttachmentRowInsert,
  attachmentStoragePath,
  type AttachmentUploadResult,
  readAttachments,
  storeAttachment,
  toAttachmentRow,
} from "./domain/attachments";
import { type CancellationInput, cancellationSchema, resolveCancellation } from "./domain/cancellation";
import { CREATE_DRAFT_RPC, createDraftArgs, createdDraftOf, UPDATE_DRAFT_RPC, updateDraftArgs } from "./domain/contract-write";
import { isEditableDraft, type OperationInput, operationSchema } from "./domain/operation";

export type CreateContractResult = { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Create a DRAFT contract from an approved scoring the user can reach (a
 * partner only its own, and always for its own distributor): the contract with its
 * frozen identification snapshot, the equipment line and the SEPA mandate.
 * The company record is refreshed with the corrected identification (not the
 * CIF, which identifies it). Everything is re-validated here, including the
 * optional attachments in `files` (fields "id_document" / "bank_certificate"),
 * whose type is sniffed from their bytes before anything is written.
 *
 * Atomic: every row is written by ONE database function (create_draft_contract),
 * in one transaction, so a failure leaves no partial contract. The attachment
 * files cannot be part of that transaction: they are uploaded first, under the
 * id the contract will have, and removed again if the write fails.
 */
export async function createContract(input: OperationInput, files?: FormData): Promise<CreateContractResult> {
  const user = await requireRole("operation.create");
  const translate = await getTranslate();
  const parsed = operationSchema.safeParse(input);
  const attached = await readAttachments(files);
  if (!parsed.success || !attached.ok) {
    const fieldErrors = {
      ...(parsed.success ? {} : fieldErrorsOf(parsed.error, translate)),
      // An attachment error is keyed by its kind, which is also the value its message needs.
      ...(attached.ok ? {} : Object.fromEntries(Object.entries(attached.fieldErrors).map(([kind, key]) => [kind, translate(key, { kind })]))),
    };
    return { ok: false, error: translate("common.errors.reviewFields"), fieldErrors };
  }
  const v = parsed.data;

  const { data: scoring, error: scoringError } = await db()
    .from("scorings")
    .select("id, status, rating, created_by, company:companies ( id, sector )")
    .eq("id", v.scoringId)
    .maybeSingle();
  if (scoringError) return { ok: false, error: scoringError.message };
  // A scoring outside the user's scope (another partner's) does not exist for them.
  if (!scoring || !scoring.company || !inScope(dataScopeFor(user), scoring.created_by)) return { ok: false, error: translate("errors.contract.scoringNotFound") };
  if (scoring.status !== "approved") return { ok: false, error: translate("errors.contract.scoringNotApproved") };

  // The id is chosen here so the files can be stored under it before the contract exists.
  const contractId = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const uploaded: string[] = [];
  const rows: AttachmentRowInsert[] = [];
  const fail = async (message: string): Promise<CreateContractResult> => {
    if (uploaded.length) await db().storage.from(ATTACHMENT_BUCKET).remove(uploaded);
    return { ok: false, error: message };
  };

  for (const attachment of attached.attachments) {
    const path = attachmentStoragePath(contractId, attachment.kind, attachment.mimeType, crypto.randomUUID());
    const { error: uploadError } = await db()
      .storage.from(ATTACHMENT_BUCKET)
      .upload(path, attachment.bytes, { contentType: attachment.mimeType, upsert: false });
    if (uploadError) return fail(translate("errors.contract.attachmentNotStored", { detail: uploadError.message }));
    uploaded.push(path);
    rows.push(toAttachmentRow(contractId, attachment, path));
  }

  // Contract, equipment line, SEPA mandate, attachment rows and company: one transaction.
  const { data, error } = await db().rpc(
    CREATE_DRAFT_RPC,
    createDraftArgs(v, {
      id: contractId,
      companyId: scoring.company.id,
      scoringId: scoring.id,
      distributorId: operationDistributorId(user, v.distributorId),
      rating: scoring.rating,
      sector: scoring.company.sector,
      createdBy: user.id,
      attachments: rows,
      today,
    }),
  );
  if (error) return fail(error.message);
  const contract = createdDraftOf(data);
  // The write succeeded: the files belong to a stored contract now, so they are not removed.
  if (!contract) return { ok: false, error: translate("errors.contract.notCreated") };

  revalidatePath("/contracts");
  redirect(`/contracts/${contract.id}`);
}

/**
 * Edit a DRAFT contract: any field of the operation, economic terms included.
 * Same role, same validation and same field mapping as createContract; only the
 * stored inputs change, and the schedule and the expected IRR are recomputed
 * from them by the same engine on the next read. Never a contract that is
 * pending signature or signed, and never one outside the user's scope (a
 * partner only its own draft, which stays with its own distributor). The
 * company, the scoring, the creator and the contract number do not change.
 *
 * Atomic: the contract, its equipment line, its SEPA mandate and the company
 * are written by ONE database function (update_draft_contract), in one
 * transaction: a failure anywhere leaves the draft exactly as it was.
 */
export async function updateDraftContract(contractId: string, input: OperationInput): Promise<CreateContractResult> {
  const user = await requireRole("operation.create");
  const translate = await getTranslate();
  const id = z.uuid().safeParse(contractId);
  const parsed = operationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: translate("common.errors.reviewFields"), fieldErrors: fieldErrorsOf(parsed.error, translate) };
  const v = parsed.data;
  if (!id.success) return { ok: false, error: translate("errors.contract.notFound") };

  const { data: contract, error: readError } = await db()
    .from("contracts")
    .select("id, workflow_status, created_by, scoring_id")
    .eq("id", id.data)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  // A draft outside the user's scope (another partner's) does not exist for them.
  if (!contract || !inScope(dataScopeFor(user), contract.created_by)) return { ok: false, error: translate("errors.contract.notFound") };
  if (!isEditableDraft(contract.workflow_status)) return { ok: false, error: translate("errors.contract.onlyDraftEditable") };
  if (contract.scoring_id !== v.scoringId) return { ok: false, error: translate("errors.contract.scoringMismatch") };

  // The function checks the status again inside the write: a draft signed in the meantime is not touched.
  const { data: updated, error } = await db().rpc(
    UPDATE_DRAFT_RPC,
    updateDraftArgs(v, {
      contractId: contract.id,
      distributorId: operationDistributorId(user, v.distributorId),
      today: new Date().toISOString().slice(0, 10),
    }),
  );
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: translate("errors.contract.noLongerDraft") };

  revalidatePath(`/contracts/${contract.id}`);
  revalidatePath("/contracts");
  revalidatePath("/pipeline");
  redirect(`/contracts/${contract.id}`);
}

/**
 * Upload one document into an empty slot of a contract (ID document, bank
 * certificate, signed contract, annex) - any contract the user can open,
 * imported loan-book ones included; a partner only its own. The file goes to
 * the private bucket after its real type and size are checked (storeAttachment).
 * Form fields: "contractId", "kind", "file".
 */
export async function uploadContractAttachment(formData: FormData): Promise<AttachmentUploadResult> {
  const user = await requireRole("contract.view");
  const scope = dataScopeFor(user);
  const bucket = () => db().storage.from(ATTACHMENT_BUCKET);

  const result = await storeAttachment(
    { contractId: formData.get("contractId"), kind: formData.get("kind"), file: formData.get("file") },
    {
      findContract: async (contractId) => {
        const { data, error } = await db().from("contracts").select("id, created_by").eq("id", contractId).maybeSingle();
        if (error) throw new Error(error.message);
        return data && inScope(scope, data.created_by) ? { id: data.id } : null;
      },
      hasAttachment: async (contractId, kind) => {
        const { data, error } = await db().from("contract_attachments").select("id").eq("contract_id", contractId).eq("kind", kind).maybeSingle();
        if (error) throw new Error(error.message);
        return data !== null;
      },
      upload: async (path, attachment) => {
        const { error } = await bucket().upload(path, attachment.bytes, { contentType: attachment.mimeType, upsert: false });
        return error?.message ?? null;
      },
      insert: async (row) => {
        const { error } = await db().from("contract_attachments").insert(row);
        return error?.message ?? null;
      },
      remove: async (path) => {
        await bucket().remove([path]);
      },
      newId: () => crypto.randomUUID(),
    },
  );
  if (!result.ok) {
    const translate = await getTranslate();
    return { ok: false, error: translate(result.error, { kind: result.kind ?? "extra", detail: result.detail ?? "" }) };
  }
  revalidatePath(`/contracts/${result.contractId}`);
  return result;
}

const signSchema = z.object({ id: z.uuid(), signingDate: z.iso.date() });

/**
 * Mark a draft as signed so it enters the loan book. Temporary manual step
 * until the Signaturit webhook drives it.
 */
export async function markContractSigned(formData: FormData): Promise<void> {
  await requireRole("contract.manage");
  const { id, signingDate } = signSchema.parse(Object.fromEntries(formData));
  const { error } = await db()
    .from("contracts")
    .update({ workflow_status: "signed", signing_date: signingDate })
    .eq("id", id)
    .in("workflow_status", ["draft", "pending_signature"]);
  if (error) throw new Error(error.message);
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/contracts");
}

export type CancellationResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Set or clear a contract's cancellation (date, additional status, settlement).
 * Only the stored inputs change: the loan book, the outstanding balance and the
 * default are recomputed by the schedule engine on the next read.
 */
export async function updateContractCancellation(input: CancellationInput): Promise<CancellationResult> {
  await requireRole("contract.manage");
  const translate = await getTranslate();
  const parsed = cancellationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: translate("common.errors.reviewFields"), fieldErrors: fieldErrorsOf(parsed.error, translate) };
  const fields = resolveCancellation(parsed.data);

  const { data: contract, error: readError } = await db()
    .from("contracts")
    .select("id, signing_date, workflow_status")
    .eq("id", parsed.data.contractId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!contract) return { ok: false, error: translate("errors.contract.notFound") };
  if (contract.workflow_status !== "signed") {
    return { ok: false, error: translate("errors.contract.onlySignedCancellable") };
  }
  if (fields.cancel_date && fields.cancel_date < contract.signing_date) {
    return { ok: false, error: translate("common.errors.reviewFields"), fieldErrors: { cancelDate: translate("validation.cancellation.beforeSigning") } };
  }

  const { error } = await db().from("contracts").update(fields).eq("id", contract.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/contracts/${contract.id}`);
  revalidatePath("/contracts");
  revalidatePath("/portfolio");
  revalidatePath("/");
  return { ok: true };
}
