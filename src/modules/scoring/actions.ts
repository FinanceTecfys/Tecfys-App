"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Translate } from "@/i18n/message";
import { fieldErrorsOf, getTranslate } from "@/i18n/server";
import { can } from "@/lib/auth/permissions";
import { dataScopeFor } from "@/lib/auth/scope";
import { requireRole } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import { getCompanyByCif } from "@/modules/companies/data";
import { RECORD_SCORING_RPC, recordedScoringOf, recordScoringArgs } from "@/modules/companies/domain/record-scoring";
import { type ChangeSource, type CompanyField, companyValuesFromFinancials, decideCompanyUpdate } from "@/modules/companies/domain/update-policy";
import type { Json } from "@/lib/supabase/database.types";
import { getActiveCriteria, getInformaReport } from "./data";
import { scoreCompany } from "./domain/engine";
import { type Financials, financialsSchema, previewFinancialsSchema } from "./domain/financials";
import { previewScore, type ScoringPreview } from "./domain/preview";
import { extractInformaText } from "./informa/extract-pdf-text";
import { parseInformaText } from "./informa/parse-informa-text";
import { type InformaReportMapping, mapInformaReport, normalizeCif } from "./informa/map-informa-report";
import { InformaApiError } from "./informa/api-client";
import { MAX_PDF_BYTES, MAX_PDF_MB } from "./informa/pdf-limits";
import { apiReportDate, pdfReportDate, receiptProvenance, sha256Hex } from "./informa/provenance";
import { appInformaClient, informaConfigStatus, isInformaConfigured } from "./informa/server";


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
 * map it to Financials for the wizard. Zero retention: the raw response lives
 * only in this request's memory - it is never stored, logged or sent to the
 * browser (it also echoes the request credentials). What is written is a
 * provenance receipt (informa_reports: source, report date, fetch time, owner)
 * with no report content; the mapped data is persisted only when a scoring is
 * saved from it.
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
  const fetchedAt = new Date().toISOString();
  // An allow-list of mapped fields is all that leaves this function; the raw report goes out of scope here.
  const { financials, missing, status, risk, balance, warnings } = mapInformaReport(report);
  const mapping = { financials, missing, status, risk, balance, warnings };
  const reportDate = apiReportDate(report);
  if (!mapping.financials.cif) mapping.financials.cif = cif;

  const { data, error } = await db()
    .from("informa_reports")
    .insert({
      source: "informa_api",
      reference_year: mapping.financials.referenceYear,
      report_date: reportDate,
      fetched_at: fetchedAt,
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

/**
 * Parse an Informa PDF for the wizard. Zero retention: the file is read and
 * parsed in memory and dropped with the request - never uploaded to Storage,
 * written to disk or logged. Only a provenance receipt is written (file name,
 * SHA-256 of the bytes, the report's date, owner); the mapped data is persisted
 * only when a scoring is saved from it.
 */
export async function parseInformaPdf(formData: FormData): Promise<ParsePdfResult> {
  const user = await requireRole("scoring.run");
  const translate = await getTranslate();
  const file = formData.get("pdf");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: translate("scoring.errors.pdfMissing") };
  if (file.type && file.type !== "application/pdf") return { ok: false, error: translate("scoring.errors.notPdf") };
  if (file.size > MAX_PDF_BYTES) return { ok: false, error: translate("scoring.errors.pdfTooLarge", { max: MAX_PDF_MB }) };

  const buffer = await file.arrayBuffer();
  const fileSha256 = await sha256Hex(buffer);
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

  const { data, error } = await db()
    .from("informa_reports")
    .insert({
      source: "informa_pdf",
      file_name: file.name.slice(0, 255),
      file_sha256: fileSha256,
      report_date: pdfReportDate(text),
      reference_year: financials.referenceYear,
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
 *
 * The scoring is a new, immutable snapshot. The company master record is NOT
 * overwritten: the update policy (companies/domain/update-policy.ts) decides
 * which fields change - applied with history for Tecfys staff, pending review
 * for a partner, fill-only for contact data - and record_scoring writes the
 * scoring, the company and its change rows in one transaction.
 */
export async function createScoring(input: { financials: Financials; informaReportId?: string | null }): Promise<CreateScoringResult> {
  const user = await requireRole("scoring.run");
  const translate = await getTranslate();
  const parsed = financialsSchema.safeParse(input.financials);
  if (!parsed.success) return { ok: false, error: translate("common.errors.reviewFields"), fieldErrors: fieldErrorsOf(parsed.error, translate) };
  const f = { ...parsed.data, cif: parsed.data.cif.replace(/[\s.-]/g, "").toUpperCase() };

  // The provenance is copied from the server-issued receipt, never taken from the browser.
  let report: Awaited<ReturnType<typeof getInformaReport>> = null;
  if (input.informaReportId) {
    const id = z.uuid().safeParse(input.informaReportId);
    report = id.success ? await getInformaReport(id.data, dataScopeFor(user)) : null;
    if (!report) return { ok: false, error: translate("scoring.errors.reportNotFound") };
  }
  const reportId = report?.id ?? null;
  const provenance = report ? receiptProvenance(report) : null;

  const criteria = await getActiveCriteria();
  const result = scoreCompany(f, criteria.config);

  const source = changeSourceOf(provenance?.source ?? null);
  const decision = decideCompanyUpdate({
    current: await getCompanyByCif(f.cif),
    incoming: companyValuesFromFinancials(f),
    actorRole: user.role,
    source,
  });

  const status = result.decision === "reject" ? "rejected" : result.decision === "manual" ? "pending_review" : "approved";
  const scoringRow = {
    informa_report_id: reportId,
    report_source: provenance?.source ?? null,
    report_date: provenance?.reportDate ?? null,
    report_file_name: provenance?.fileName ?? null,
    report_file_sha256: provenance?.fileSha256 ?? null,
    report_fetched_at: provenance?.fetchedAt ?? null,
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
  };
  const { data, error } = await db().rpc(RECORD_SCORING_RPC, recordScoringArgs({ decision, source, scoring: scoringRow, reportId }));
  if (error) return { ok: false, error: error.message };
  const recorded = recordedScoringOf(data);
  if (!recorded) return { ok: false, error: translate("scoring.errors.notSaved") };

  revalidatePath("/scoring");
  redirect(`/scoring/${recorded.scoringId}`);
}

const changeSourceOf = (source: "pdf" | "api" | null): ChangeSource | null =>
  source === "pdf" ? "informa_pdf" : source === "api" ? "informa_api" : null;

export interface CompanyChangePreview {
  field: CompanyField;
  kind: "change" | "fill";
  from: string | null;
  to: string;
}

export type PreviewCompanyChangesResult = { ok: true; newCompany: boolean; changes: CompanyChangePreview[] } | { ok: false };

/**
 * Wizard, before saving: what the scoring will change in the company master.
 * Tecfys staff only - a partner gets nothing back, never the existing master
 * data of a client it may not own (its differences become pending silently).
 * Informative: createScoring decides again, from the data actually saved.
 */
export async function previewCompanyChanges(input: { financials: Financials; informaReportId?: string | null }): Promise<PreviewCompanyChangesResult> {
  const user = await requireRole("scoring.run");
  if (!can(user.role, "companyMaster.update")) return { ok: true, newCompany: false, changes: [] };
  const parsed = financialsSchema.safeParse(input.financials);
  if (!parsed.success) return { ok: false };
  const f = { ...parsed.data, cif: parsed.data.cif.replace(/[\s.-]/g, "").toUpperCase() };
  const id = input.informaReportId ? z.uuid().safeParse(input.informaReportId) : null;
  const report = id?.success ? await getInformaReport(id.data, dataScopeFor(user)) : null;
  const provenance = report ? receiptProvenance(report) : null;
  const decision = decideCompanyUpdate({
    current: await getCompanyByCif(f.cif),
    incoming: companyValuesFromFinancials(f),
    actorRole: user.role,
    source: changeSourceOf(provenance?.source ?? null),
  });
  if (decision.kind === "create") return { ok: true, newCompany: true, changes: [] };
  return { ok: true, newCompany: false, changes: decision.changes.map((c) => ({ field: c.field, kind: c.kind, from: c.oldValue, to: c.newValue })) };
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
