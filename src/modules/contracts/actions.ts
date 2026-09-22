"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/supabase/server";
import { type OperationInput, operationSchema } from "./domain/operation";

export type CreateContractResult = { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Create a DRAFT contract from an approved scoring: the contract with its
 * frozen identification snapshot, the equipment line and the SEPA mandate.
 * The company record is refreshed with the corrected identification (not the
 * CIF, which identifies it). Everything is re-validated here.
 */
export async function createContract(input: OperationInput): Promise<CreateContractResult> {
  const parsed = operationSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    return { ok: false, error: "Revisa los datos marcados", fieldErrors };
  }
  const v = parsed.data;

  const { data: scoring, error: scoringError } = await db()
    .from("scorings")
    .select("id, status, rating, company:companies ( id, sector )")
    .eq("id", v.scoringId)
    .maybeSingle();
  if (scoringError) return { ok: false, error: scoringError.message };
  if (!scoring || !scoring.company) return { ok: false, error: "Scoring no encontrado" };
  if (scoring.status !== "approved") return { ok: false, error: "El scoring no está aprobado" };

  const { data: contract, error } = await db()
    .from("contracts")
    .insert({
      company_id: scoring.company.id,
      scoring_id: scoring.id,
      distributor_id: v.distributorId,
      asset_type_id: v.assetTypeId,
      contract_type: v.contractType,
      rating: scoring.rating,
      sector: scoring.company.sector,
      signing_date: v.signingDate,
      duration_months: v.durationMonths,
      installment: v.installment,
      residual_value: v.residualValue,
      purchase_value: v.purchaseValue,
      has_guarantor: v.hasGuarantor,
      guarantor_name: v.hasGuarantor ? v.guarantorName : null,
      guarantor_nif: v.hasGuarantor ? v.guarantorNif : null,
      guarantor_address: v.hasGuarantor ? v.guarantorAddress : null,
      guarantor_representative: v.hasGuarantor ? v.guarantorRepresentative : null,
      guarantor_representative_nif: v.hasGuarantor && v.guarantorRepresentative ? v.guarantorRepresentativeNif : null,
      client_name: v.clientName,
      client_cif: v.clientCif,
      fiscal_address: v.fiscalAddress,
      fiscal_postal_code: v.fiscalPostalCode,
      fiscal_city: v.fiscalCity,
      fiscal_province: v.fiscalProvince,
      signatory_name: v.signatoryName,
      signatory_nif: v.signatoryNif,
      signatory_address: v.signatoryAddress,
      contact_name: v.contactName,
      contact_phone: v.contactPhone,
      contact_email: v.contactEmail,
      delivery_same_as_fiscal: v.deliverySameAsFiscal,
      delivery_address: v.deliveryAddress,
      product_description: v.productDescription,
      product_type: "New",
      workflow_status: "draft",
      notes: v.notes || null,
    })
    .select("id, contract_number")
    .single();
  if (error) return { ok: false, error: error.message };

  // No multi-statement transaction through PostgREST: undo the contract if a child insert fails.
  const rollback = async (message: string): Promise<CreateContractResult> => {
    await db().from("contracts").delete().eq("id", contract.id);
    return { ok: false, error: message };
  };

  const { error: assetError } = await db().from("contract_assets").insert({
    contract_id: contract.id,
    asset_type_id: v.assetTypeId,
    quantity: v.quantity,
    description: v.productDescription,
    unit_cost: Math.round((v.purchaseValue / v.quantity) * 100) / 100,
  });
  if (assetError) return rollback(assetError.message);

  const { error: mandateError } = await db().from("sepa_mandates").insert({
    contract_id: contract.id,
    mandate_reference: contract.contract_number,
    debtor_name: v.sepaDebtorName,
    debtor_address: v.fiscalAddress,
    debtor_postal_code: v.fiscalPostalCode,
    debtor_city: v.fiscalCity,
    debtor_province: v.fiscalProvince,
    iban: v.sepaIban,
    bic: v.sepaBic,
    signed_place: v.fiscalCity,
    signed_at: new Date().toISOString().slice(0, 10),
  });
  if (mandateError) return rollback(mandateError.message);

  await db()
    .from("companies")
    .update({
      address: v.fiscalAddress,
      fiscal_postal_code: v.fiscalPostalCode,
      fiscal_city: v.fiscalCity,
      fiscal_province: v.fiscalProvince,
      admin_name: v.signatoryName,
      admin_nif: v.signatoryNif,
      phone: v.contactPhone,
      email: v.contactEmail,
    })
    .eq("id", scoring.company.id);

  revalidatePath("/contracts");
  redirect(`/contracts/${contract.id}`);
}

const signSchema = z.object({ id: z.uuid(), signingDate: z.iso.date() });

/**
 * Mark a draft as signed so it enters the loan book. Temporary manual step
 * until the Signaturit webhook drives it.
 */
export async function markContractSigned(formData: FormData): Promise<void> {
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
