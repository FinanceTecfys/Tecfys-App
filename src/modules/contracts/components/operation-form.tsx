"use client";

import { useMemo, useState, useTransition } from "react";
import { Calculator } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, inputClass, Label, SelectField } from "@/components/ui/field";
import { fmtEur, fmtPct } from "@/lib/format";
import { createAssetType, createDistributor } from "@/modules/catalog/actions";
import { CatalogSelect } from "@/modules/catalog/components/catalog-select";
import type { AssetType, ContractType, Distributor } from "@/modules/catalog/data";
import { createContract } from "../actions";
import type { IdentityPrefill } from "../domain/operation";
import { installmentForRate, monthlyFromAnnual } from "../domain/pricing";
import { buildSchedule } from "../domain/schedule";
import { IdentitySection, type IdentityState } from "./identity-section";
import { ScheduleTable } from "./schedule-table";
import { SepaSection, type SepaState } from "./sepa-section";

export interface OperationScoring {
  id: string;
  companyName: string;
  cif: string;
  rating: string;
  creditOpinion: number;
  /** Principal outstanding today on the client's signed contracts. */
  currentExposure: number;
}

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

export function OperationForm({
  scoring,
  identity: prefill,
  distributors,
  assetTypes,
  contractTypes,
  clusters,
  today,
}: {
  scoring: OperationScoring;
  identity: IdentityPrefill;
  distributors: Distributor[];
  assetTypes: AssetType[];
  contractTypes: ContractType[];
  clusters: string[];
  today: string;
}) {
  const [identity, setIdentity] = useState<IdentityState>({ ...prefill, deliverySameAsFiscal: true, deliveryAddress: "" });
  const [sepa, setSepa] = useState<SepaState>({ iban: "", debtorName: prefill.clientName, debtorNameEdited: false, bic: "", bicDerived: false });
  const [distributorId, setDistributorId] = useState<string | null>(null);
  const [assetTypeId, setAssetTypeId] = useState<string | null>(null);
  const [newCluster, setNewCluster] = useState(clusters[0] ?? "Other");
  const [contractType, setContractType] = useState("Renting");
  const [signingDate, setSigningDate] = useState(today);
  const [purchaseValue, setPurchaseValue] = useState("");
  const [durationMonths, setDurationMonths] = useState("36");
  const [residualValue, setResidualValue] = useState("");
  const [installment, setInstallment] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [productDescription, setProductDescription] = useState("");
  const [hasGuarantor, setHasGuarantor] = useState(false);
  const [guarantorName, setGuarantorName] = useState("");
  const [guarantorNif, setGuarantorNif] = useState("");
  const [guarantorAddress, setGuarantorAddress] = useState("");
  const [guarantorRepresentative, setGuarantorRepresentative] = useState("");
  const [guarantorRepresentativeNif, setGuarantorRepresentativeNif] = useState("");
  const [notes, setNotes] = useState("");
  const [targetIrr, setTargetIrr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, startSaving] = useTransition();

  const lag = contractTypes.find((t) => t.code === contractType)?.billing_lag_months ?? 0;
  const cost = num(purchaseValue);
  const n = num(durationMonths);
  const m = num(installment);
  const residual = num(residualValue);

  const schedule = useMemo(() => {
    if (!cost || !n || !m || cost <= 0 || n <= 0 || m <= 0) return null;
    return buildSchedule(
      {
        signingDate,
        billingLagMonths: lag,
        durationMonths: Math.round(n),
        installment: m,
        residualValue: residual,
        purchaseValue: cost,
        expoAdjustment: 0,
        cancelDate: null,
        residualWaived: false,
        amortizeOverRealLife: false,
      },
      new Date(`${signingDate}T00:00:00Z`),
    );
  }, [cost, n, m, residual, signingDate, lag]);

  const receivable = schedule?.totals.installments ?? 0;
  const exposureAfter = scoring.currentExposure + (cost ?? 0);
  const overLimit = cost !== null && exposureAfter > scoring.creditOpinion;
  const noRecovery = schedule !== null && receivable < (cost ?? 0);

  // The SEPA debtor follows the company name until the analyst changes it.
  function patchIdentity(patch: Partial<IdentityState>) {
    setIdentity((prev) => ({ ...prev, ...patch }));
    if (patch.clientName !== undefined && !sepa.debtorNameEdited) setSepa((prev) => ({ ...prev, debtorName: patch.clientName! }));
  }

  function applyTargetIrr() {
    const annual = num(targetIrr);
    if (annual === null || !cost || !n) return;
    const value = installmentForRate(cost, Math.round(n), residual ?? 0, monthlyFromAnnual(annual / 100));
    if (value !== null) setInstallment(value.toFixed(2));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    startSaving(async () => {
      const res = await createContract({
        scoringId: scoring.id,
        ...identity,
        sepaIban: sepa.iban,
        sepaDebtorName: sepa.debtorName,
        sepaBic: sepa.bic,
        distributorId,
        assetTypeId: assetTypeId ?? "",
        contractType,
        signingDate,
        durationMonths: n ?? 0,
        installment: m ?? 0,
        residualValue: residual,
        purchaseValue: cost ?? 0,
        quantity: num(quantity) ?? 1,
        productDescription,
        hasGuarantor,
        guarantorName,
        guarantorNif,
        guarantorAddress,
        guarantorRepresentative,
        guarantorRepresentativeNif,
        notes,
      });
      if (res && !res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 xl:grid-cols-[1fr_400px]">
      <div className="space-y-6">
        <IdentitySection value={identity} onChange={patchIdentity} errors={fieldErrors} />
        <SepaSection value={sepa} onChange={(patch) => setSepa((prev) => ({ ...prev, ...patch }))} errors={fieldErrors} />
        <Card title="C · Producto y origen">
          <div className="grid gap-4 md:grid-cols-2">
            <CatalogSelect
              label="Distribuidor"
              name="distributorId"
              options={distributors.filter((d) => d.active)}
              value={distributorId}
              onChange={setDistributorId}
              onCreate={(name) => createDistributor({ name })}
              placeholder="— Directo / sin distribuidor —"
            />
            <CatalogSelect
              label="Tipo de activo"
              name="assetTypeId"
              options={assetTypes.filter((a) => a.active)}
              value={assetTypeId}
              onChange={setAssetTypeId}
              onCreate={(name) => createAssetType({ name, cluster: newCluster })}
              error={fieldErrors.assetTypeId}
              createExtra={
                <select aria-label="Grupo del activo" value={newCluster} onChange={(e) => setNewCluster(e.target.value)} className={inputClass}>
                  {clusters.map((c) => (
                    <option key={c} value={c}>Grupo: {c}</option>
                  ))}
                </select>
              }
            />
            <div className="md:col-span-2">
              <Label htmlFor="productDescription">Descripción del producto</Label>
              <textarea
                id="productDescription"
                rows={2}
                maxLength={500}
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                placeholder="Ej. 12 portátiles ASUS ExpertBook B1, 16 GB RAM, con cargador y funda"
                className={inputClass}
              />
              <p className={`mt-1 text-[11px] ${fieldErrors.productDescription ? "text-red-300" : "text-slate-500"}`}>
                {fieldErrors.productDescription ?? "Aparece literalmente en las Condiciones Particulares del contrato"}
              </p>
            </div>
            <Field label="Unidades" name="quantity" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </Card>

        <Card title="C · Condiciones económicas">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Coste del equipo" name="purchaseValue" type="number" step="0.01" suffix="€" value={purchaseValue} onChange={(e) => setPurchaseValue(e.target.value)} error={fieldErrors.purchaseValue} hint="Valor de compra (sin IVA)" />
            <Field label="Duración" name="durationMonths" type="number" min={1} suffix="meses" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} error={fieldErrors.durationMonths} />
            <Field label="Valor residual" name="residualValue" type="number" step="0.01" suffix="€" value={residualValue} onChange={(e) => setResidualValue(e.target.value)} error={fieldErrors.residualValue} hint="Opcional; se factura el mes siguiente a la última cuota" />
            <Field label="Cuota mensual" name="installment" type="number" step="0.01" suffix="€" value={installment} onChange={(e) => setInstallment(e.target.value)} error={fieldErrors.installment} />
            <div className="md:col-span-2">
              <Label htmlFor="targetIrr">Calcular cuota para una IRR objetivo</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input id="targetIrr" type="number" step="0.1" value={targetIrr} onChange={(e) => setTargetIrr(e.target.value)} placeholder="Ej. 25" className={`${inputClass} num pr-16`} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">% anual</span>
                </div>
                <Button type="button" variant="secondary" onClick={applyTargetIrr} disabled={!cost || !n || !targetIrr}>
                  <Calculator className="h-4 w-4" aria-hidden /> Calcular
                </Button>
              </div>
            </div>
            <SelectField
              label="Tipo de contrato"
              name="contractType"
              value={contractType}
              onChange={(e) => setContractType(e.target.value)}
              options={contractTypes.map((t) => ({ value: t.code, label: t.label }))}
            />
            <Field label="Fecha de firma" name="signingDate" type="date" value={signingDate} onChange={(e) => setSigningDate(e.target.value)} error={fieldErrors.signingDate} />
          </div>
        </Card>

        <Card title="C · Garantías">
          <label className="flex items-center gap-3 text-sm text-slate-200">
            <input type="checkbox" checked={hasGuarantor} onChange={(e) => setHasGuarantor(e.target.checked)} className="h-4 w-4 accent-mint-500" />
            Operación con avalista
          </label>
          {hasGuarantor && (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Nombre del avalista" name="guarantorName" value={guarantorName} onChange={(e) => setGuarantorName(e.target.value)} error={fieldErrors.guarantorName} />
              <Field label="NIF / CIF del avalista" name="guarantorNif" value={guarantorNif} onChange={(e) => setGuarantorNif(e.target.value)} error={fieldErrors.guarantorNif} />
              <Field label="Domicilio del avalista" name="guarantorAddress" className="md:col-span-2" value={guarantorAddress} onChange={(e) => setGuarantorAddress(e.target.value)} error={fieldErrors.guarantorAddress} />
              <Field label="Representante (si el avalista es una empresa)" name="guarantorRepresentative" value={guarantorRepresentative} onChange={(e) => setGuarantorRepresentative(e.target.value)} />
              <Field label="DNI del representante" name="guarantorRepresentativeNif" value={guarantorRepresentativeNif} onChange={(e) => setGuarantorRepresentativeNif(e.target.value)} error={fieldErrors.guarantorRepresentativeNif} />
            </div>
          )}
          <div className="mt-4">
            <Label htmlFor="notes">Notas internas</Label>
            <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </div>
        </Card>

        {schedule && (
          <Card title="Calendario previsto" subtitle={lag ? "Renting F: la facturación empieza el mes siguiente a la firma" : undefined}>
            <ScheduleTable schedule={schedule} maxRows={13} />
          </Card>
        )}
      </div>

      <aside className="xl:sticky xl:top-8 xl:self-start">
        <Card title="Expected IRR">
          <div className="space-y-5">
            <div>
              <div className="num text-4xl font-semibold text-mint-400">{schedule ? fmtPct(schedule.expectedAnnualIrr) : "—"}</div>
              <div className="num mt-1 text-sm text-slate-400">
                {schedule ? `${fmtPct(schedule.expectedMonthlyIrr, 4)} mensual` : "Introduce coste, duración y cuota"}
              </div>
              {schedule && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Flujos: −{fmtEur(cost)} · {Math.round(n ?? 0)} × {fmtEur(m, 2)}
                  {residual ? ` · +${fmtEur(residual)} residual` : ""}
                  {schedule.residualInSolve > 0 ? " (el residual entra en la IRR: las cuotas no cubren el coste)" : ""}
                </p>
              )}
            </div>
            <dl className="space-y-2 border-t border-ink-700 pt-4 text-sm">
              <div className="flex justify-between"><dt className="text-slate-400">Total a cobrar</dt><dd className="num">{fmtEur(receivable)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">Interés total</dt><dd className="num">{fmtEur(schedule?.totals.interest)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">Principal</dt><dd className="num">{fmtEur(schedule?.totals.principal)}</dd></div>
            </dl>
            <dl className="space-y-2 border-t border-ink-700 pt-4 text-sm">
              <div className="flex justify-between"><dt className="text-slate-400">Cliente</dt><dd className="text-right">{scoring.companyName} · {scoring.rating}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">Opinión de crédito</dt><dd className="num">{fmtEur(scoring.creditOpinion)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">Riesgo vivo actual</dt><dd className="num">{fmtEur(scoring.currentExposure)}</dd></div>
              <div className="flex justify-between font-semibold"><dt className="text-slate-300">Riesgo tras la operación</dt><dd className={`num ${overLimit ? "text-orange-300" : "text-slate-100"}`}>{fmtEur(exposureAfter)}</dd></div>
            </dl>
            {overLimit && <Alert tone="warning" title="Supera la opinión de crédito">El riesgo total con el cliente excede el límite del scoring. Requiere aprobación del comité.</Alert>}
            {noRecovery && <Alert tone="error" title="La operación no recupera el coste">Cuotas + residual por debajo del coste del equipo.</Alert>}
            {error && (
              <Alert tone="error" title={error}>
                {Object.keys(fieldErrors).length > 0 && `${Object.keys(fieldErrors).length} campo(s) con error en las secciones de la izquierda.`}
              </Alert>
            )}
            <Button type="submit" disabled={saving || !schedule} className="w-full">
              {saving ? "Creando contrato…" : "Crear contrato borrador"}
            </Button>
          </div>
        </Card>
      </aside>
    </form>
  );
}
