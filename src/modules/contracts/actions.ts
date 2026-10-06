"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { dataScopeFor, inScope, operationDistributorId } from "@/lib/auth/scope";
import { requireRole } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import {
  ATTACHMENT_BUCKET,
  attachmentStoragePath,
  type AttachmentUploadResult,
  readAttachments,
  storeAttachment,
  toAttachmentRow,
} from "./domain/attachments";
import { type CancellationInput, cancellationSchema, resolveCancellation } from "./domain/cancellation";
import {
  isEditableDraft,
  operationAssetFields,
  operationCompanyFields,
  operationContractFields,
  type OperationInput,
  operationMandateFields,
  operationSchema,
} from "./domain/operation";

export type CreateContractResult = { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Create a DRAFT contract from an approved scoring the user can reach (a
 * partner only its own, and always for its own distributor): the contract with its
 * frozen identification snapshot, the equipment line and the SEPA mandate.
 * The company record is refreshed with the corrected identification (not the
 * CIF, which identifies it). Everything is re-validated here, including the
 * optional attachments in `files` (fields "id_document" / "bank_certificate"),
 * whose type is sniffed from their bytes before anything is written.
 */
export async function createContract(input: OperationInput, files?: FormData): Promise<CreateContractResult> {
  const user = await requireRole("operation.create");
  const parsed = operationSchema.safeParse(input);
  const attached = await readAttachments(files);
  if (!parsed.success || !attached.ok) {
    const fieldErrors = {
      ...(parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]))),
      ...(attached.ok ? {} : attached.fieldErrors),
    };
    return { ok: false, error: "Revisa los datos marcados", fieldErrors };
  }
  const v = parsed.data;

  const { data: scoring, error: scoringError } = await db()
    .from("scorings")
    .select("id, status, rating, created_by, company:companies ( id, sector )")
    .eq("id", v.scoringId)
    .maybeSingle();
  if (scoringError) return { ok: false, error: scoringError.message };
  // A scoring outside the user's scope (another partner's) does not exist for them.
  if (!scoring || !scoring.company || !inScope(dataScopeFor(user), scoring.created_by)) return { ok: false, error: "Scoring no encontrado" };
  if (scoring.status !== "approved") return { ok: false, error: "El scoring no está aprobado" };

  const { data: contract, error } = await db()
    .from("contracts")
    .insert({
      company_id: scoring.company.id,
      scoring_id: scoring.id,
      distributor_id: operationDistributorId(user, v.distributorId),
      rating: scoring.rating,
      sector: scoring.company.sector,
      ...operationContractFields(v),
      product_type: "New",
      workflow_status: "draft",
      created_by: user.id,
    })
    .select("id, contract_number")
    .single();
  if (error) return { ok: false, error: error.message };

  // No multi-statement transaction through PostgREST: undo the contract (its
  // child rows cascade) and any file already uploaded if a later step fails.
  const uploaded: string[] = [];
  const rollback = async (message: string): Promise<CreateContractResult> => {
    if (uploaded.length) await db().storage.from(ATTACHMENT_BUCKET).remove(uploaded);
    await db().from("contracts").delete().eq("id", contract.id);
    return { ok: false, error: message };
  };

  const { error: assetError } = await db().from("contract_assets").insert({ contract_id: contract.id, ...operationAssetFields(v) });
  if (assetError) return rollback(assetError.message);

  const { error: mandateError } = await db().from("sepa_mandates").insert({
    contract_id: contract.id,
    mandate_reference: contract.contract_number,
    ...operationMandateFields(v),
    signed_at: new Date().toISOString().slice(0, 10),
  });
  if (mandateError) return rollback(mandateError.message);

  for (const attachment of attached.attachments) {
    const path = attachmentStoragePath(contract.id, attachment.kind, attachment.mimeType, crypto.randomUUID());
    const { error: uploadError } = await db()
      .storage.from(ATTACHMENT_BUCKET)
      .upload(path, attachment.bytes, { contentType: attachment.mimeType, upsert: false });
    if (uploadError) return rollback(`No se pudo guardar el adjunto: ${uploadError.message}`);
    uploaded.push(path);
    const { error: rowError } = await db().from("contract_attachments").insert(toAttachmentRow(contract.id, attachment, path));
    if (rowError) return rollback(rowError.message);
  }

  await db().from("companies").update(operationCompanyFields(v)).eq("id", scoring.company.id);

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
 */
export async function updateDraftContract(contractId: string, input: OperationInput): Promise<CreateContractResult> {
  const user = await requireRole("operation.create");
  const id = z.uuid().safeParse(contractId);
  const parsed = operationSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    return { ok: false, error: "Revisa los datos marcados", fieldErrors };
  }
  const v = parsed.data;
  if (!id.success) return { ok: false, error: "Contrato no encontrado" };

  const { data: contract, error: readError } = await db()
    .from("contracts")
    .select("id, contract_number, workflow_status, created_by, scoring_id, company_id")
    .eq("id", id.data)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  // A draft outside the user's scope (another partner's) does not exist for them.
  if (!contract || !inScope(dataScopeFor(user), contract.created_by)) return { ok: false, error: "Contrato no encontrado" };
  if (!isEditableDraft(contract.workflow_status)) return { ok: false, error: "Solo se puede editar un contrato en borrador" };
  if (contract.scoring_id !== v.scoringId) return { ok: false, error: "El scoring no corresponde a este contrato" };

  // The status is checked again in the write itself: a draft signed in the meantime is not touched.
  const { data: updated, error } = await db()
    .from("contracts")
    .update({ ...operationContractFields(v), distributor_id: operationDistributorId(user, v.distributorId) })
    .eq("id", contract.id)
    .eq("workflow_status", "draft")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (updated.length === 0) return { ok: false, error: "El contrato ya no está en borrador" };

  // The equipment line: a draft has exactly one; anything else is replaced by it.
  const { data: lines, error: linesError } = await db().from("contract_assets").select("id").eq("contract_id", contract.id);
  if (linesError) return { ok: false, error: linesError.message };
  if (lines.length === 1) {
    const { error: assetError } = await db().from("contract_assets").update(operationAssetFields(v)).eq("id", lines[0].id);
    if (assetError) return { ok: false, error: assetError.message };
  } else {
    if (lines.length > 1) await db().from("contract_assets").delete().eq("contract_id", contract.id);
    const { error: assetError } = await db().from("contract_assets").insert({ contract_id: contract.id, ...operationAssetFields(v) });
    if (assetError) return { ok: false, error: assetError.message };
  }

  // The mandate keeps its reference and its date; only what the form holds changes.
  const { data: mandate, error: mandateReadError } = await db().from("sepa_mandates").select("id").eq("contract_id", contract.id).maybeSingle();
  if (mandateReadError) return { ok: false, error: mandateReadError.message };
  const { error: mandateError } = mandate
    ? await db().from("sepa_mandates").update(operationMandateFields(v)).eq("id", mandate.id)
    : await db().from("sepa_mandates").insert({
        contract_id: contract.id,
        mandate_reference: contract.contract_number,
        ...operationMandateFields(v),
        signed_at: new Date().toISOString().slice(0, 10),
      });
  if (mandateError) return { ok: false, error: mandateError.message };

  await db().from("companies").update(operationCompanyFields(v)).eq("id", contract.company_id);

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
  if (result.ok) revalidatePath(`/contracts/${result.contractId}`);
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
  const parsed = cancellationSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    return { ok: false, error: "Revisa los datos marcados", fieldErrors };
  }
  const fields = resolveCancellation(parsed.data);

  const { data: contract, error: readError } = await db()
    .from("contracts")
    .select("id, signing_date, workflow_status")
    .eq("id", parsed.data.contractId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!contract) return { ok: false, error: "Contrato no encontrado" };
  if (contract.workflow_status !== "signed") {
    return { ok: false, error: "Solo se puede cancelar un contrato firmado" };
  }
  if (fields.cancel_date && fields.cancel_date < contract.signing_date) {
    return { ok: false, error: "Revisa los datos marcados", fieldErrors: { cancelDate: "Anterior a la fecha de firma" } };
  }

  const { error } = await db().from("contracts").update(fields).eq("id", contract.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/contracts/${contract.id}`);
  revalidatePath("/contracts");
  revalidatePath("/portfolio");
  revalidatePath("/");
  return { ok: true };
}
