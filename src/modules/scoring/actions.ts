"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Translate } from "@/i18n/message";
import { fieldErrorsOf, getTranslate } from "@/i18n/server";
import { dataScopeFor } from "@/lib/auth/scope";
import { requireRole } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { getActiveCriteria, getInformaReport } from "./data";
import { scoreCompany } from "./domain/engine";
import { type Financials, financialsSchema, previewFinancialsSchema } from "./domain/financials";
import { previewScore, type ScoringPreview } from "./domain/preview";
import { extractInformaText } from "./informa/extract-pdf-text";
import { parseInformaText } from "./informa/parse-informa-text";
import { type InformaReportMapping, mapInformaReport, normalizeCif } from "./informa/map-informa-report";
import { InformaApiError } from "./informa/api-client";
import { appInformaClient, informaConfigStatus, isInformaConfigured } from "./informa/server";

const MAX_PDF_BYTES = 20 * 1024 * 1024;

const INFORMA_ERRORS = "scoring.informa.errors";

/**
 * What the user is told when Informa fails, in their language. The API client
 * keeps its own technical message for the logs; here the text comes from the
 * catalogue by Informa's response code, else by the HTTP status, else a generic
 * line - so nothing untranslated reaches the screen.
 */
function informaErrorMessage(e: unknown, translate: Translate): string {
  const known = (key: string) => {
    const text = translate(key);
    return text === key ? null : text;
  };
  if (!(e instanceof InformaApiError)) return translate(`${INFORMA_ERRORS}.generic`);
  const byCode = e.code !== null ? known(`${INFORMA_ERRORS}.code${e.code}`) : null;
  const byStatus = e.status !== null ? known(`${INFORMA_ERRORS}.status${e.status}`) : null;
  const message = byCode ?? byStatus ?? translate(`${INFORMA_ERRORS}.generic`);
  if (e.code !== null) return translate(`${INFORMA_ERRORS}.withCode`, { message, code: e.code });
  if (e.status !== null) return translate(`${INFORMA_ERRORS}.withStatus`, { message, status: e.status });
  return message;
}

/** Which server env entry is missing or wrong - names only, never values. */
function informaNotConfigured(translate: Translate): string {
  const s = informaConfigStatus();
  if (!s.baseUrlAllowed) return translate(`${INFORMA_ERRORS}.notConfiguredUrl`);
  const missing = [!s.hasUsername && "INFORMA_USERNAME", !s.hasPassword && "INFORMA_PASSWORD"].filter(Boolean).join(" + ");
  return translate(`${INFORMA_ERRORS}.notConfiguredEnv`, { missing });
}

export type FetchInformaResult =
  | ({ ok: true; reportId: string } & Omit<InformaReportMapping, "reportType">)
  | { ok: false; error: string };

/**
 * "Buscar en Informa por CIF": fetch the INFORME_MAYOR from the Informa API and
 * map it to Financials. Only the mapping is kept (informa_reports, source
 * informa_api): the raw report echoes the request credentials, so it is
 * neither stored nor sent to the browser. The report belongs to whoever fetched it.
 */
export async function fetchInformaReport(cifInput: string): Promise<FetchInformaResult> {
  const user = await requireRole("scoring.run");
  const translate = await getTranslate();
  const cif = normalizeCif(String(cifInput ?? ""));
  if (!cif) return { ok: false, error: translate("scoring.errors.cifInvalid") };
  if (!isInformaConfigured()) return { ok: false, error: informaNotConfigured(translate) };

  let report: unknown;
  try {
    report = await appInformaClient().getReport(cif);
  } catch (e) {
    return { ok: false, error: informaErrorMessage(e, translate) };
  }
  const { reportType, ...mapping } = mapInformaReport(report);
  if (!mapping.financials.cif) mapping.financials.cif = cif;

  const { data, error } = await db()
    .from("informa_reports")
    .insert({
      source: "informa_api",
      file_name: `Informa API ${reportType ?? "informe"} ${cif}`,
      reference_year: mapping.financials.referenceYear,
      parsed: { ...mapping, reportType, requestedCif: cif } as unknown as Json,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  return { ok: true, reportId: data.id, ...mapping };
}

/** "Probar conexión": a fresh POST /login, then the demo company's report (A00000000). Secrets never leave the server. */
export async function testInformaConnection(): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  await requireRole("settings.access");
  const translate = await getTranslate();
  if (!isInformaConfigured()) return { ok: false, error: informaNotConfigured(translate) };
  try {
    const started = Date.now();
    await appInformaClient().ping();
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: informaErrorMessage(e, translate) };
  }
}

export type ParsePdfResult =
  | { ok: true; reportId: string; financials: Financials; missing: (keyof Financials)[] }
  | { ok: false; error: string };

/** Parse an Informa PDF, keep the original in storage and the parse in informa_reports, owned by whoever uploaded it. */
export async function parseInformaPdf(formData: FormData): Promise<ParsePdfResult> {
  const user = await requireRole("scoring.run");
  const translate = await getTranslate();
  const file = formData.get("pdf");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: translate("scoring.errors.pdfMissing") };
  if (file.type && file.type !== "application/pdf") return { ok: false, error: translate("scoring.errors.notPdf") };
  if (file.size > MAX_PDF_BYTES) return { ok: false, error: translate("scoring.errors.pdfTooLarge") };

  const buffer = await file.arrayBuffer();
  let text: string;
  try {
    text = await extractInformaText(buffer.slice(0));
  } catch {
    return { ok: false, error: translate("scoring.errors.pdfUnreadable") };
  }
  const { financials, missing } = parseInformaText(text);
  if (!financials.cif && !financials.name && financials.totalRevenue === null) {
    return { ok: false, error: translate("scoring.errors.pdfNotInforma") };
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
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  return { ok: true, reportId: data.id, financials, missing };
}

export type PreviewScoringResult = { ok: true; preview: ScoringPreview } | { ok: false; error: string };

/**
 * Live preview of the scoring wizard: score the financials typed so far with
 * the active model and return ONLY the outcome (domain/preview.ts) - the value,
 * rating and contribution of each ratio and the totals. The model itself
 * (weights, tiers, score tables, rules, prudence table) never leaves the
 * server. Nothing is stored; createScoring recomputes when the analyst saves.
 */
export async function previewScoring(financials: Financials): Promise<PreviewScoringResult> {
  await requireRole("scoring.run");
  const parsed = previewFinancialsSchema.safeParse(financials);
  if (!parsed.success) return { ok: false, error: (await getTranslate())("scoring.errors.invalidFinancials") };
  const criteria = await getActiveCriteria();
  return { ok: true, preview: previewScore(parsed.data, criteria.config) };
}

export type CreateScoringResult = { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Score a company (always recomputed server-side) and store the result, owned
 * by whoever ran it. The Informa report it links must be inside the user's
 * scope: a partner only links a report it fetched or uploaded itself, and one
 * outside its scope reads as not found - checked before anything is written.
 */
export async function createScoring(input: { financials: Financials; informaReportId?: string | null }): Promise<CreateScoringResult> {
  const user = await requireRole("scoring.run");
  const translate = await getTranslate();
  const parsed = financialsSchema.safeParse(input.financials);
  if (!parsed.success) return { ok: false, error: translate("common.errors.reviewFields"), fieldErrors: fieldErrorsOf(parsed.error, translate) };
  const f = { ...parsed.data, cif: parsed.data.cif.replace(/[\s.-]/g, "").toUpperCase() };

  let reportId: string | null = null;
  if (input.informaReportId) {
    const id = z.uuid().safeParse(input.informaReportId);
    const report = id.success ? await getInformaReport(id.data, dataScopeFor(user)) : null;
    if (!report) return { ok: false, error: translate("scoring.errors.reportNotFound") };
    reportId = report.id;
  }

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
      created_by: user.id,
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
  note: z.string().trim().min(3, "validation.scoring.reviewNote"),
});

/** Manual committee decision on a scoring pending review (owner / admin). */
export async function reviewScoring(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string } | null> {
  await requireRole("scoring.review");
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: (await getTranslate())(parsed.error.issues[0].message) };
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
