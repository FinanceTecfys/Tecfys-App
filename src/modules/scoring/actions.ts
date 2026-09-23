"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { getActiveCriteria } from "./data";
import { scoreCompany } from "./domain/engine";
import { type Financials, financialsSchema } from "./domain/financials";
import { extractInformaText } from "./informa/extract-pdf-text";
import { parseInformaText } from "./informa/parse-informa-text";

const MAX_PDF_BYTES = 20 * 1024 * 1024;

export type ParsePdfResult =
  | { ok: true; reportId: string; financials: Financials; missing: (keyof Financials)[] }
  | { ok: false; error: string };

/** Parse an Informa PDF, keep the original in storage and the parse in informa_reports. */
export async function parseInformaPdf(formData: FormData): Promise<ParsePdfResult> {
  await requireUser();
  const file = formData.get("pdf");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Selecciona un PDF de Informa" };
  if (file.type && file.type !== "application/pdf") return { ok: false, error: "El fichero no es un PDF" };
  if (file.size > MAX_PDF_BYTES) return { ok: false, error: "El PDF supera 20 MB" };

  const buffer = await file.arrayBuffer();
  let text: string;
  try {
    text = await extractInformaText(buffer.slice(0));
  } catch {
    return { ok: false, error: "No se pudo leer el PDF (¿está protegido o escaneado?)" };
  }
  const { financials, missing } = parseInformaText(text);
  if (!financials.cif && !financials.name && financials.totalRevenue === null) {
    return { ok: false, error: "El PDF no parece un informe de Informa: no se encontró CIF, razón social ni ventas" };
  }

  const storagePath = `${crypto.randomUUID()}.pdf`;
  const upload = await db().storage.from("informa-reports").upload(storagePath, buffer, { contentType: "application/pdf" });

  const { data, error } = await db()
    .from("informa_reports")
    .insert({
      source: "informa_pdf",
      file_name: file.name,
      storage_path: upload.error ? null : storagePath,
      reference_year: financials.referenceYear,
      parsed: { financials, missing } as unknown as Json,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  return { ok: true, reportId: data.id, financials, missing };
}

export type CreateScoringResult = { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Score a company (always recomputed server-side) and store the result. */
export async function createScoring(input: { financials: Financials; informaReportId?: string | null }): Promise<CreateScoringResult> {
  await requireUser();
  const parsed = financialsSchema.safeParse(input.financials);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    return { ok: false, error: "Revisa los datos marcados", fieldErrors };
  }
  const f = { ...parsed.data, cif: parsed.data.cif.replace(/[\s.-]/g, "").toUpperCase() };
  const criteria = await getActiveCriteria();
  const result = scoreCompany(f, criteria.config);

  const { data: company, error: companyError } = await db()
    .from("companies")
    .upsert(
      {
        cif: f.cif,
        name: f.name,
        country: f.country,
        sector: f.sector,
        cnae: f.cnae,
        address: f.address,
        fiscal_postal_code: f.fiscalPostalCode,
        fiscal_city: f.fiscalCity,
        fiscal_province: f.fiscalProvince,
        phone: f.phone,
        email: f.email,
        web: f.web,
        constitution_date: toIsoDate(f.constitutionDate),
        employees: f.employees,
        admin_name: f.adminName,
        admin_nif: f.adminNif?.toUpperCase() ?? null,
      },
      { onConflict: "cif" },
    )
    .select("id")
    .single();
  if (companyError) return { ok: false, error: companyError.message };

  const reportId = input.informaReportId ? z.uuid().parse(input.informaReportId) : null;
  if (reportId) await db().from("informa_reports").update({ company_id: company.id }).eq("id", reportId);

  const status = result.decision === "reject" ? "rejected" : result.decision === "manual" ? "pending_review" : "approved";
  const { data: scoring, error } = await db()
    .from("scorings")
    .insert({
      company_id: company.id,
      informa_report_id: reportId,
      criteria_id: criteria.id,
      criteria_snapshot: criteria.config as unknown as Json,
      financials: f as unknown as Json,
      ratios: result.ratios as unknown as Json,
      breakdown: result.breakdown as unknown as Json,
      total_score: round(result.totalScore, 3),
      rating: result.rating,
      decision: result.decision,
      prudence: result.prudence,
      adjusted_ebitda: result.adjustedEbitda,
      credit_opinion: round(result.creditOpinion, 2),
      status,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/scoring");
  redirect(`/scoring/${scoring.id}`);
}

const reviewSchema = z.object({
  id: z.uuid(),
  status: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(3, "Explica el motivo de la decisión"),
});

export async function reviewScoring(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string } | null> {
  await requireUser();
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, status, note } = parsed.data;
  const { error } = await db()
    .from("scorings")
    .update({ status, review_note: note, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/scoring/${id}`);
  return null;
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** "dd/mm/yyyy" (Informa) or ISO -> ISO date. */
function toIsoDate(value: string | null): string | null {
  if (!value) return null;
  const dmy = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}
