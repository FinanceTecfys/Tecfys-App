"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/supabase/server";

const operationSchema = z
  .object({
    scoringId: z.uuid(),
    distributorId: z.uuid().nullable(),
    assetTypeId: z.uuid({ error: "Selecciona el tipo de activo" }),
    contractType: z.string().min(1),
    signingDate: z.iso.date({ error: "Fecha no válida" }),
    durationMonths: z.number().int().min(1, "Mínimo 1 mes").max(120, "Máximo 120 meses"),
    installment: z.number().positive("La cuota debe ser positiva"),
    residualValue: z.number().min(0, "No puede ser negativo").nullable(),
    purchaseValue: z.number().positive("Indica el coste del equipo"),
    quantity: z.number().int().min(1).default(1),
    description: z.string().trim().max(200).optional(),
    hasGuarantor: z.boolean(),
    guarantorName: z.string().trim().optional(),
    guarantorNif: z.string().trim().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.hasGuarantor && !v.guarantorName) ctx.addIssue({ code: "custom", path: ["guarantorName"], message: "Indica el avalista" });
    if (v.hasGuarantor && !v.guarantorNif) ctx.addIssue({ code: "custom", path: ["guarantorNif"], message: "Indica el NIF del avalista" });
  });

export type OperationInput = z.input<typeof operationSchema>;
export type CreateContractResult = { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Create a draft contract from an approved scoring. */
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
      guarantor_nif: v.hasGuarantor ? v.guarantorNif?.toUpperCase() : null,
      product_type: "New",
      workflow_status: "draft",
      notes: v.notes || null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await db().from("contract_assets").insert({
    contract_id: contract.id,
    asset_type_id: v.assetTypeId,
    quantity: v.quantity,
    description: v.description || null,
    unit_cost: Math.round((v.purchaseValue / v.quantity) * 100) / 100,
  });

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
