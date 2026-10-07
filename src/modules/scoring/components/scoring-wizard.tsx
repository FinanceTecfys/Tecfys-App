"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { FileUp, PencilLine, Search } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, SelectField } from "@/components/ui/field";
import { useTranslate } from "@/i18n/client";
import { type AppMessage, render } from "@/i18n/message";
import { fmtEur, fmtNum } from "@/lib/format";
import { createScoring, fetchInformaReport, parseInformaPdf, previewScoring } from "../actions";
import { EMPTY_FINANCIALS, FINANCIAL_FIELDS, type Financials } from "../domain/financials";
import type { InformaCompanyStatus, InformaRisk } from "../informa/map-informa-report";
import type { ScoringPreview } from "../domain/preview";
import { DecisionBadge, RatingBadge } from "./badges";
import { InformaCompanyStatusAlert } from "./informa-company-status";
import { ScoreBreakdown } from "./score-breakdown";

type Step = "source" | "review";
type Source = "pdf" | "api" | "manual";

const SOURCE_SUBTITLE = { pdf: "sourcePdf", api: "sourceApi", manual: "sourceManual" } as const satisfies Record<Source, string>;

/** Pause after the last edit before the preview is asked for: one call per burst of typing, not per keystroke. */
const PREVIEW_DELAY_MS = 400;

/**
 * The scoring model never reaches this component: it gets the sector names and
 * a result computed on the server, and asks the server again (previewScoring)
 * whenever the financials change.
 */
export function ScoringWizard({
  sectors,
  initialPreview,
  informaConfigured,
}: {
  sectors: string[];
  /** The score of the empty form, computed on the server. */
  initialPreview: ScoringPreview;
  informaConfigured: boolean;
}) {
  const t = useTranslations("scoring.wizard");
  const tFields = useTranslations("scoring.fields");
  const tGroups = useTranslations("scoring.fieldGroups");
  const tCommon = useTranslations("common");
  const translate = useTranslate();
  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<Source>("manual");
  const [informa, setInforma] = useState<{ status: InformaCompanyStatus; risk: InformaRisk; warnings: AppMessage[] } | null>(null);
  const [cifQuery, setCifQuery] = useState("");
  const [financials, setFinancials] = useState<Financials>(EMPTY_FINANCIALS);
  const [reportId, setReportId] = useState<string | null>(null);
  const [missing, setMissing] = useState<(keyof Financials)[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [parsing, startParsing] = useTransition();
  const [saving, startSaving] = useTransition();

  const [result, setResult] = useState<ScoringPreview>(initialPreview);
  /** True from an edit until the server has scored it: the figures shown belong to the previous values. */
  const [stale, setStale] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewSeq = useRef(0);

  useEffect(() => () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
  }, []);

  /** Every change of the financials goes through here: store it and ask the server for its score, debounced. */
  function applyFinancials(next: Financials, delay = PREVIEW_DELAY_MS) {
    setFinancials(next);
    setStale(true);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    const seq = ++previewSeq.current;
    previewTimer.current = setTimeout(async () => {
      let res: Awaited<ReturnType<typeof previewScoring>>;
      try {
        res = await previewScoring(next);
      } catch {
        res = { ok: false, error: translate("scoring.errors.previewFailed") };
      }
      // A newer edit is already on its way: its answer is the one that counts.
      if (seq !== previewSeq.current) return;
      setStale(false);
      if (res.ok) setResult(res.preview);
      setPreviewError(res.ok ? null : res.error);
    }, delay);
  }

  const set = <K extends keyof Financials>(key: K, value: Financials[K]) => applyFinancials({ ...financials, [key]: value });
  const setNumber = (key: keyof Financials, raw: string) =>
    set(key, (raw === "" ? null : Number(raw)) as Financials[typeof key]);

  /** The name of a financial field, for the "missing in the report" notice. */
  const fieldLabel = (key: keyof Financials) => (tFields.has(key as never) ? tFields(key as never) : key);

  function onUpload(formData: FormData) {
    setError(null);
    startParsing(async () => {
      const res = await parseInformaPdf(formData);
      if (!res.ok) return setError(res.error);
      applyFinancials(res.financials, 0);
      setReportId(res.reportId);
      setMissing(res.missing);
      setSource("pdf");
      setInforma(null);
      setStep("review");
    });
  }

  function onFetchInforma() {
    setError(null);
    startParsing(async () => {
      const res = await fetchInformaReport(cifQuery);
      if (!res.ok) return setError(res.error);
      applyFinancials(res.financials, 0);
      setReportId(res.reportId);
      setMissing(res.missing);
      setSource("api");
      setInforma({ status: res.status, risk: res.risk, warnings: res.warnings });
      setStep("review");
    });
  }

  function onSave() {
    setError(null);
    setFieldErrors({});
    startSaving(async () => {
      const res = await createScoring({ financials, informaReportId: reportId });
      // On success the action redirects; we only get here on failure.
      if (res && !res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }

  if (step === "source") {
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t("apiTitle")} subtitle={t("apiSubtitle")}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onFetchInforma();
            }}
            className="flex h-full flex-col justify-between gap-4"
          >
            <Field
              label={tFields("cif")}
              name="informaCif"
              value={cifQuery}
              onChange={(e) => setCifQuery(e.target.value)}
              placeholder="B12345678"
              autoComplete="off"
              required
              hint={informaConfigured ? t("apiHint") : t("apiNotConfigured")}
            />
            <Button type="submit" disabled={parsing || !informaConfigured || !cifQuery.trim()} className="w-full">
              <Search className="h-4 w-4" aria-hidden /> {parsing ? t("apiSearching") : t("apiSearch")}
            </Button>
          </form>
        </Card>
        <Card title={t("pdfTitle")} subtitle={t("pdfSubtitle")}>
          <form action={onUpload} className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ink-600 bg-ink-800/40 px-6 py-10 text-center transition hover:border-mint-500/60">
              <FileUp className="h-8 w-8 text-mint-500" aria-hidden />
              <span className="text-sm text-slate-300">{fileName ?? t("pdfPick")}</span>
              <span className="text-xs text-slate-500">{t("pdfMax")}</span>
              <input
                type="file"
                name="pdf"
                accept="application/pdf"
                required
                className="sr-only"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              />
            </label>
            <Button type="submit" disabled={parsing || !fileName} className="w-full">
              {parsing ? t("pdfProcessing") : t("pdfProcess")}
            </Button>
          </form>
        </Card>
        <Card title={t("manualTitle")} subtitle={t("manualSubtitle")}>
          <div className="flex h-full flex-col justify-between gap-6">
            <p className="text-sm text-slate-400">{t("manualBody")}</p>
            <Button variant="secondary" onClick={() => setStep("review")}>
              <PencilLine className="h-4 w-4" aria-hidden /> {t("manualStart")}
            </Button>
          </div>
        </Card>
        {error && (
          <div className="lg:col-span-3">
            <Alert tone="error" title={t("reportErrorTitle")}>{error}</Alert>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        {informa && <InformaCompanyStatusAlert status={informa.status} risk={informa.risk} />}
        {informa && informa.warnings.length > 0 && (
          <Alert tone="warning" title={t("reviewInforma")}>
            <ul className="list-disc space-y-0.5 pl-4">
              {informa.warnings.map((w) => <li key={`${w.key}:${JSON.stringify(w.values ?? {})}`}>{render(translate, w)}</li>)}
            </ul>
          </Alert>
        )}
        {missing.length > 0 && (
          <Alert tone="warning" title={t("missingTitle")}>
            {t("missingBody", { fields: missing.map(fieldLabel).join(", ") })}
          </Alert>
        )}
        <Card title={t("companyTitle")} subtitle={t(SOURCE_SUBTITLE[source])}>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={tFields("cif")} name="cif" value={financials.cif} onChange={(e) => set("cif", e.target.value)} error={fieldErrors.cif} />
            <Field label={tFields("name")} name="name" className="md:col-span-2" value={financials.name} onChange={(e) => set("name", e.target.value)} error={fieldErrors.name} />
            <SelectField
              label={tFields("sector")}
              name="sector"
              value={financials.sector ?? ""}
              onChange={(e) => set("sector", e.target.value || null)}
              options={sectors.map((s) => ({ value: s, label: s }))}
              placeholder={t("selectPlaceholder")}
            />
            <Field label={tFields("cnae")} name="cnae" value={financials.cnae ?? ""} onChange={(e) => set("cnae", e.target.value || null)} />
            <Field label={tFields("maturityYears")} name="maturityYears" type="number" suffix={t("years")} value={financials.maturityYears ?? ""} onChange={(e) => setNumber("maturityYears", e.target.value)} />
            <Field label={tFields("employees")} name="employees" type="number" value={financials.employees ?? ""} onChange={(e) => setNumber("employees", e.target.value)} />
            <Field label={tFields("adminName")} name="adminName" className="md:col-span-2" value={financials.adminName ?? ""} onChange={(e) => set("adminName", e.target.value || null)} />
            <Field label={tFields("adminNif")} name="adminNif" value={financials.adminNif ?? ""} onChange={(e) => set("adminNif", e.target.value || null)} hint={t("adminNifHint")} />
          </div>
        </Card>
        <Card title={t("addressTitle")} subtitle={t("addressSubtitle")}>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label={tFields("address")} name="address" className="md:col-span-4" value={financials.address ?? ""} onChange={(e) => set("address", e.target.value || null)} />
            <Field label={tFields("fiscalPostalCode")} name="fiscalPostalCode" value={financials.fiscalPostalCode ?? ""} onChange={(e) => set("fiscalPostalCode", e.target.value || null)} />
            <Field label={tFields("fiscalCity")} name="fiscalCity" value={financials.fiscalCity ?? ""} onChange={(e) => set("fiscalCity", e.target.value || null)} />
            <Field label={tFields("fiscalProvince")} name="fiscalProvince" value={financials.fiscalProvince ?? ""} onChange={(e) => set("fiscalProvince", e.target.value || null)} />
            <div />
            <Field label={tFields("phone")} name="phone" value={financials.phone ?? ""} onChange={(e) => set("phone", e.target.value || null)} />
            <Field label={tFields("email")} name="email" type="email" className="md:col-span-2" value={financials.email ?? ""} onChange={(e) => set("email", e.target.value || null)} />
          </div>
        </Card>
        {FINANCIAL_FIELDS.map(({ group, fields }) => (
          <Card key={group} title={tGroups(group)} subtitle={financials.referenceYear ? t("fiscalYear", { year: financials.referenceYear }) : undefined}>
            <div className="grid gap-4 md:grid-cols-4">
              {fields.map((key) => (
                <Field
                  key={key}
                  label={tFields(key)}
                  name={key}
                  type="number"
                  step="0.01"
                  suffix="€"
                  value={(financials[key] as number | null) ?? ""}
                  onChange={(e) => setNumber(key, e.target.value)}
                />
              ))}
            </div>
          </Card>
        ))}
        <Card title={t("breakdownTitle")} subtitle={stale ? t("updating") : undefined}>
          <div className={stale ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={stale}>
            <ScoreBreakdown rows={result.rows} />
          </div>
        </Card>
      </div>

      <aside className="xl:sticky xl:top-8 xl:self-start">
        <Card title={t("resultTitle")} subtitle={stale ? t("updating") : undefined}>
          <div className="space-y-5">
            <div className={`flex items-center justify-between transition-opacity ${stale ? "opacity-60" : ""}`} aria-live="polite" aria-busy={stale}>
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{t("score")}</div>
                <div className="num text-4xl font-semibold text-slate-50">{fmtNum(result.totalScore, 2)}</div>
                <div className="text-xs text-slate-500">{t("outOfTen")}</div>
              </div>
              <RatingBadge rating={result.rating} large />
            </div>
            <DecisionBadge decision={result.decision} />
            <dl className="space-y-2 border-t border-ink-700 pt-4 text-sm">
              <div className="flex justify-between"><dt className="text-slate-400">{t("adjustedEbitda")}</dt><dd className="num">{fmtEur(result.adjustedEbitda)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">{t("prudence")}</dt><dd className="num">{fmtNum(result.prudence * 100, 0)} %</dd></div>
              <div className="flex justify-between font-semibold"><dt className="text-slate-300">{t("creditOpinion")}</dt><dd className="num text-mint-400">{fmtEur(result.creditOpinion)}</dd></div>
            </dl>
            {previewError && <Alert tone="warning">{t("previewFailed", { error: previewError })}</Alert>}
            {error && <Alert tone="error">{error}</Alert>}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep("source")} disabled={saving}>{tCommon("actions.back")}</Button>
              <Button onClick={onSave} disabled={saving} className="flex-1">
                {saving ? t("saving") : t("save")}
              </Button>
            </div>
          </div>
        </Card>
      </aside>
    </div>
  );
}
