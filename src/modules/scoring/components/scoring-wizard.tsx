"use client";

import { useMemo, useState, useTransition } from "react";
import { FileUp, PencilLine } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, SelectField } from "@/components/ui/field";
import { fmtEur, fmtNum } from "@/lib/format";
import { createScoring, parseInformaPdf } from "../actions";
import type { ScoringCriteria } from "../domain/criteria";
import { scoreCompany } from "../domain/engine";
import { EMPTY_FINANCIALS, FINANCIAL_FIELDS, type Financials } from "../domain/financials";
import { DecisionBadge, RatingBadge } from "./badges";
import { ScoreBreakdown } from "./score-breakdown";

type Step = "source" | "review";

const FIELD_LABELS: Partial<Record<keyof Financials, string>> = {
  cif: "CIF", name: "Razón social", maturityYears: "Antigüedad", totalRevenue: "Ventas", netResult: "Resultado neto",
  ebitda: "EBITDA", nonCurrentAssets: "Activo no corriente", currentAssets: "Activo corriente", equity: "Patrimonio neto",
  nonCurrentLiabilities: "Pasivo no corriente", currentLiabilities: "Pasivo corriente",
  address: "Domicilio fiscal", fiscalPostalCode: "Código postal", fiscalCity: "Ciudad", adminName: "Administrador",
};

export function ScoringWizard({ criteria }: { criteria: ScoringCriteria }) {
  const [step, setStep] = useState<Step>("source");
  const [financials, setFinancials] = useState<Financials>(EMPTY_FINANCIALS);
  const [reportId, setReportId] = useState<string | null>(null);
  const [missing, setMissing] = useState<(keyof Financials)[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [parsing, startParsing] = useTransition();
  const [saving, startSaving] = useTransition();

  const result = useMemo(() => scoreCompany(financials, criteria), [financials, criteria]);
  const sectors = Object.keys(criteria.sectorRating).sort();

  const set = <K extends keyof Financials>(key: K, value: Financials[K]) => setFinancials((f) => ({ ...f, [key]: value }));
  const setNumber = (key: keyof Financials, raw: string) =>
    set(key, (raw === "" ? null : Number(raw)) as Financials[typeof key]);

  function onUpload(formData: FormData) {
    setError(null);
    startParsing(async () => {
      const res = await parseInformaPdf(formData);
      if (!res.ok) return setError(res.error);
      setFinancials(res.financials);
      setReportId(res.reportId);
      setMissing(res.missing);
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
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Informe de Informa (PDF)" subtitle="Se extraen los estados financieros del último ejercicio">
          <form action={onUpload} className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ink-600 bg-ink-800/40 px-6 py-10 text-center transition hover:border-mint-500/60">
              <FileUp className="h-8 w-8 text-mint-500" aria-hidden />
              <span className="text-sm text-slate-300">{fileName ?? "Selecciona o arrastra el PDF de Informa"}</span>
              <span className="text-xs text-slate-500">Máx. 20 MB</span>
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
              {parsing ? "Procesando informe…" : "Procesar informe"}
            </Button>
          </form>
        </Card>
        <Card title="Alta manual" subtitle="Sin informe: introduce los datos a mano">
          <div className="flex h-full flex-col justify-between gap-6">
            <p className="text-sm text-slate-400">
              Útil para empresas sin informe disponible o para ajustar un caso concreto. El scoring aplica el mismo
              modelo y queda registrado como alta manual.
            </p>
            <Button variant="secondary" onClick={() => setStep("review")}>
              <PencilLine className="h-4 w-4" aria-hidden /> Introducir datos
            </Button>
          </div>
        </Card>
        {error && (
          <div className="lg:col-span-2">
            <Alert tone="error" title="No se pudo procesar el informe">{error}</Alert>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        {missing.length > 0 && (
          <Alert tone="warning" title="Datos no encontrados en el informe">
            Revisa y completa: {missing.map((k) => FIELD_LABELS[k] ?? k).join(", ")}. Un ratio sin dato puntúa C.
          </Alert>
        )}
        <Card title="Empresa" subtitle={reportId ? "Datos extraídos del informe de Informa" : "Alta manual"}>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="CIF" name="cif" value={financials.cif} onChange={(e) => set("cif", e.target.value)} error={fieldErrors.cif} />
            <Field label="Razón social" name="name" className="md:col-span-2" value={financials.name} onChange={(e) => set("name", e.target.value)} error={fieldErrors.name} />
            <SelectField
              label="Sector"
              name="sector"
              value={financials.sector ?? ""}
              onChange={(e) => set("sector", e.target.value || null)}
              options={sectors.map((s) => ({ value: s, label: `${s} (${criteria.sectorRating[s]})` }))}
              placeholder="— Selecciona —"
            />
            <Field label="CNAE" name="cnae" value={financials.cnae ?? ""} onChange={(e) => set("cnae", e.target.value || null)} />
            <Field label="Antigüedad" name="maturityYears" type="number" suffix="años" value={financials.maturityYears ?? ""} onChange={(e) => setNumber("maturityYears", e.target.value)} />
            <Field label="Empleados" name="employees" type="number" value={financials.employees ?? ""} onChange={(e) => setNumber("employees", e.target.value)} />
            <Field label="Administrador" name="adminName" className="md:col-span-2" value={financials.adminName ?? ""} onChange={(e) => set("adminName", e.target.value || null)} />
            <Field label="DNI del administrador" name="adminNif" value={financials.adminNif ?? ""} onChange={(e) => set("adminNif", e.target.value || null)} hint="No viene en Informa" />
          </div>
        </Card>
        <Card title="Domicilio fiscal y contacto" subtitle="Se trasladan a la operación y al contrato; todos editables">
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Dirección" name="address" className="md:col-span-4" value={financials.address ?? ""} onChange={(e) => set("address", e.target.value || null)} />
            <Field label="Código postal" name="fiscalPostalCode" value={financials.fiscalPostalCode ?? ""} onChange={(e) => set("fiscalPostalCode", e.target.value || null)} />
            <Field label="Ciudad" name="fiscalCity" value={financials.fiscalCity ?? ""} onChange={(e) => set("fiscalCity", e.target.value || null)} />
            <Field label="Provincia" name="fiscalProvince" value={financials.fiscalProvince ?? ""} onChange={(e) => set("fiscalProvince", e.target.value || null)} />
            <div />
            <Field label="Teléfono" name="phone" value={financials.phone ?? ""} onChange={(e) => set("phone", e.target.value || null)} />
            <Field label="Email" name="email" type="email" className="md:col-span-2" value={financials.email ?? ""} onChange={(e) => set("email", e.target.value || null)} />
          </div>
        </Card>
        {Object.entries(FINANCIAL_FIELDS).map(([group, fields]) => (
          <Card key={group} title={group} subtitle={financials.referenceYear ? `Ejercicio ${financials.referenceYear}` : undefined}>
            <div className="grid gap-4 md:grid-cols-4">
              {fields.map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
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
        <Card title="Desglose del scoring">
          <ScoreBreakdown breakdown={result.breakdown} />
        </Card>
      </div>

      <aside className="xl:sticky xl:top-8 xl:self-start">
        <Card title="Resultado">
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Puntuación</div>
                <div className="num text-4xl font-semibold text-slate-50">{fmtNum(result.totalScore, 2)}</div>
                <div className="text-xs text-slate-500">sobre 10</div>
              </div>
              <RatingBadge rating={result.rating} large />
            </div>
            <DecisionBadge decision={result.decision} />
            <dl className="space-y-2 border-t border-ink-700 pt-4 text-sm">
              <div className="flex justify-between"><dt className="text-slate-400">EBITDA ajustado</dt><dd className="num">{fmtEur(result.adjustedEbitda)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">Prudencia</dt><dd className="num">{fmtNum(result.prudence * 100, 0)} %</dd></div>
              <div className="flex justify-between font-semibold"><dt className="text-slate-300">Opinión de crédito</dt><dd className="num text-mint-400">{fmtEur(result.creditOpinion)}</dd></div>
            </dl>
            {error && <Alert tone="error">{error}</Alert>}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep("source")} disabled={saving}>Volver</Button>
              <Button onClick={onSave} disabled={saving} className="flex-1">
                {saving ? "Guardando…" : "Guardar scoring"}
              </Button>
            </div>
          </div>
        </Card>
      </aside>
    </div>
  );
}
