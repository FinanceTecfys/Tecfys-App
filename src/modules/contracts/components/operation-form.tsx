"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Calculator } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, inputClass, Label, SelectField } from "@/components/ui/field";
import { fmtEur, fmtPct } from "@/lib/format";
import { createAssetType, createDistributor } from "@/modules/catalog/actions";
import { CatalogSelect } from "@/modules/catalog/components/catalog-select";
import type { AssetType, ContractType, Distributor } from "@/modules/catalog/data";
import { createContract, updateDraftContract } from "../actions";
import { AttachmentInput } from "./attachment-input";
import type { IdentityPrefill, OperationInput } from "../domain/operation";
import { installmentForRate, monthlyFromAnnual } from "../domain/pricing";
import { buildSchedule } from "../domain/schedule";
import { deriveBic } from "../domain/sepa";
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

/** Editing a saved draft: the contract and its stored values, which pre-fill every field. */
export interface OperationEdit {
  contractId: string;
  contractNumber: string;
  initial: OperationInput;
}

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function OperationForm({
  scoring,
  identity: prefill,
  distributors,
  assetTypes,
  contractTypes,
  clusters,
  today,
  canEditCatalog,
  lockedDistributorId,
  edit,
}: {
  scoring: OperationScoring;
  identity: IdentityPrefill;
  distributors: Distributor[];
  assetTypes: AssetType[];
  contractTypes: ContractType[];
  clusters: string[];
  today: string;
  /** Inline creation of distributors / asset types (the server action checks the role again). */
  canEditCatalog: boolean;
  /** A partner originates for its own distributor: the select is fixed (and the server overrides it anyway). */
  lockedDistributorId?: string | null;
  /** Set to edit a draft instead of creating one: same form, same validation, same engine. */
  edit?: OperationEdit;
}) {
  const init = edit?.initial;
  const t = useTranslations("operation");
  const tDocs = useTranslations("contract.documents.kinds");
  const tCommon = useTranslations("common");
  const [identity, setIdentity] = useState<IdentityState>({ ...prefill, deliverySameAsFiscal: init?.deliverySameAsFiscal ?? true, deliveryAddress: init?.deliveryAddress ?? "" });
  const [sepa, setSepa] = useState<SepaState>({
    iban: init?.sepaIban ?? "",
    debtorName: init?.sepaDebtorName ?? prefill.clientName,
    // A saved debtor that differs from the company was typed by the analyst: it no longer follows the name.
    debtorNameEdited: init !== undefined && init.sepaDebtorName !== prefill.clientName,
    bic: init?.sepaBic ?? "",
    bicDerived: Boolean(init?.sepaBic) && init?.sepaBic === deriveBic(init?.sepaIban ?? ""),
  });
  const [distributorId, setDistributorId] = useState<string | null>(lockedDistributorId ?? init?.distributorId ?? null);
  const [assetTypeId, setAssetTypeId] = useState<string | null>(init?.assetTypeId || null);
  const [newCluster, setNewCluster] = useState(clusters[0] ?? "Other");
  const [contractType, setContractType] = useState(init?.contractType ?? "Renting");
  const [signingDate, setSigningDate] = useState(init?.signingDate ?? today);
  const [purchaseValue, setPurchaseValue] = useState(str(init?.purchaseValue));
  const [durationMonths, setDurationMonths] = useState(init ? str(init.durationMonths) : "36");
  const [residualValue, setResidualValue] = useState(str(init?.residualValue));
  const [installment, setInstallment] = useState(str(init?.installment));
  const [quantity, setQuantity] = useState(init ? str(init.quantity ?? 1) : "1");
  const [productDescription, setProductDescription] = useState(init?.productDescription ?? "");
  const [hasGuarantor, setHasGuarantor] = useState(init?.hasGuarantor ?? false);
  const [guarantorName, setGuarantorName] = useState(init?.guarantorName ?? "");
  const [guarantorNif, setGuarantorNif] = useState(init?.guarantorNif ?? "");
  const [guarantorAddress, setGuarantorAddress] = useState(init?.guarantorAddress ?? "");
  const [guarantorRepresentative, setGuarantorRepresentative] = useState(init?.guarantorRepresentative ?? "");
  const [guarantorRepresentativeNif, setGuarantorRepresentativeNif] = useState(init?.guarantorRepresentativeNif ?? "");
  const [notes, setNotes] = useState(init?.notes ?? "");
  const [targetIrr, setTargetIrr] = useState("");
  const [idDocument, setIdDocument] = useState<File | null>(null);
  const [bankCertificate, setBankCertificate] = useState<File | null>(null);
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
    const files = new FormData();
    if (idDocument) files.set("id_document", idDocument);
    if (bankCertificate) files.set("bank_certificate", bankCertificate);
    startSaving(async () => {
      const input: OperationInput = {
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
      };
      // Both go through the same schema and the same field mapping on the server.
      const res = edit ? await updateDraftContract(edit.contractId, input) : await createContract(input, files);
      if (res && !res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 xl:grid-cols-[1fr_400px]">
      <div className="space-y-6">
        <IdentitySection
          value={identity}
          onChange={patchIdentity}
          errors={fieldErrors}
          signatoryIdAttachment={
            // The documents of a saved draft are managed on the contract page, slot by slot.
            edit ? undefined : (
              <AttachmentInput id="id_document" label={tDocs("id_document")} value={idDocument} onChange={setIdDocument} error={fieldErrors.id_document} />
            )
          }
        />
        <SepaSection
          value={sepa}
          onChange={(patch) => setSepa((prev) => ({ ...prev, ...patch }))}
          errors={fieldErrors}
          bankCertificateAttachment={
            edit ? undefined : (
              <AttachmentInput id="bank_certificate" label={tDocs("bank_certificate")} value={bankCertificate} onChange={setBankCertificate} error={fieldErrors.bank_certificate} />
            )
          }
        />
        <Card title={t("product.title")}>
          <div className="grid gap-4 md:grid-cols-2">
            <CatalogSelect
              label={t("product.distributor")}
              name="distributorId"
              options={distributors.filter((d) => d.active || d.id === init?.distributorId)}
              value={distributorId}
              onChange={setDistributorId}
              onCreate={canEditCatalog ? (name) => createDistributor({ name }) : undefined}
              disabled={lockedDistributorId !== undefined}
              placeholder={t("product.distributorPlaceholder")}
            />
            <CatalogSelect
              label={t("product.assetType")}
              name="assetTypeId"
              options={assetTypes.filter((a) => a.active || a.id === init?.assetTypeId)}
              value={assetTypeId}
              onChange={setAssetTypeId}
              onCreate={canEditCatalog ? (name) => createAssetType({ name, cluster: newCluster }) : undefined}
              error={fieldErrors.assetTypeId}
              createExtra={
                <select aria-label={t("product.clusterAria")} value={newCluster} onChange={(e) => setNewCluster(e.target.value)} className={inputClass}>
                  {clusters.map((c) => (
                    <option key={c} value={c}>{t("product.clusterOption", { cluster: c })}</option>
                  ))}
                </select>
              }
            />
            <div className="md:col-span-2">
              <Label htmlFor="productDescription">{t("product.description")}</Label>
              <textarea
                id="productDescription"
                rows={2}
                maxLength={500}
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                placeholder={t("product.descriptionPlaceholder")}
                className={inputClass}
              />
              <p className={`mt-1 text-[11px] ${fieldErrors.productDescription ? "text-red-300" : "text-slate-500"}`}>
                {fieldErrors.productDescription ?? t("product.descriptionHint")}
              </p>
            </div>
            <Field label={t("product.quantity")} name="quantity" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </Card>

        <Card title={t("terms.title")}>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t("terms.purchaseValue")} name="purchaseValue" type="number" step="0.01" suffix="€" value={purchaseValue} onChange={(e) => setPurchaseValue(e.target.value)} error={fieldErrors.purchaseValue} hint={t("terms.purchaseValueHint")} />
            <Field label={t("terms.duration")} name="durationMonths" type="number" min={1} suffix={t("terms.months")} value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} error={fieldErrors.durationMonths} />
            <Field label={t("terms.residual")} name="residualValue" type="number" step="0.01" suffix="€" value={residualValue} onChange={(e) => setResidualValue(e.target.value)} error={fieldErrors.residualValue} hint={t("terms.residualHint")} />
            <Field label={t("terms.installment")} name="installment" type="number" step="0.01" suffix="€" value={installment} onChange={(e) => setInstallment(e.target.value)} error={fieldErrors.installment} />
            <div className="md:col-span-2">
              <Label htmlFor="targetIrr">{t("terms.targetIrr")}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input id="targetIrr" type="number" step="0.1" value={targetIrr} onChange={(e) => setTargetIrr(e.target.value)} placeholder={t("terms.targetIrrPlaceholder")} className={`${inputClass} num pr-16`} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{t("terms.perYear")}</span>
                </div>
                <Button type="button" variant="secondary" onClick={applyTargetIrr} disabled={!cost || !n || !targetIrr}>
                  <Calculator className="h-4 w-4" aria-hidden /> {t("terms.calculate")}
                </Button>
              </div>
            </div>
            <SelectField
              label={t("terms.contractType")}
              name="contractType"
              value={contractType}
              onChange={(e) => setContractType(e.target.value)}
              options={contractTypes.map((t) => ({ value: t.code, label: t.label }))}
            />
            <Field label={t("terms.signingDate")} name="signingDate" type="date" value={signingDate} onChange={(e) => setSigningDate(e.target.value)} error={fieldErrors.signingDate} />
          </div>
        </Card>

        <Card title={t("guarantees.title")}>
          <label className="flex items-center gap-3 text-sm text-slate-200">
            <input type="checkbox" checked={hasGuarantor} onChange={(e) => setHasGuarantor(e.target.checked)} className="h-4 w-4 accent-mint-500" />
            {t("guarantees.hasGuarantor")}
          </label>
          {hasGuarantor && (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label={t("guarantees.name")} name="guarantorName" value={guarantorName} onChange={(e) => setGuarantorName(e.target.value)} error={fieldErrors.guarantorName} />
              <Field label={t("guarantees.nif")} name="guarantorNif" value={guarantorNif} onChange={(e) => setGuarantorNif(e.target.value)} error={fieldErrors.guarantorNif} />
              <Field label={t("guarantees.address")} name="guarantorAddress" className="md:col-span-2" value={guarantorAddress} onChange={(e) => setGuarantorAddress(e.target.value)} error={fieldErrors.guarantorAddress} />
              <Field label={t("guarantees.representative")} name="guarantorRepresentative" value={guarantorRepresentative} onChange={(e) => setGuarantorRepresentative(e.target.value)} />
              <Field label={t("guarantees.representativeNif")} name="guarantorRepresentativeNif" value={guarantorRepresentativeNif} onChange={(e) => setGuarantorRepresentativeNif(e.target.value)} error={fieldErrors.guarantorRepresentativeNif} />
            </div>
          )}
          <div className="mt-4">
            <Label htmlFor="notes">{t("guarantees.notes")}</Label>
            <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </div>
        </Card>

        {schedule && (
          <Card title={t("schedule.title")} subtitle={lag ? t("schedule.lagSubtitle") : undefined}>
            <ScheduleTable schedule={schedule} collapsedRows={13} />
          </Card>
        )}
      </div>

      <aside className="xl:sticky xl:top-8 xl:self-start">
        <Card title={t("panel.title")}>
          <div className="space-y-5">
            <div>
              <div className="num text-4xl font-semibold text-mint-400">{schedule ? fmtPct(schedule.expectedAnnualIrr) : "—"}</div>
              <div className="num mt-1 text-sm text-slate-400">
                {schedule ? t("panel.monthly", { rate: fmtPct(schedule.expectedMonthlyIrr, 4) }) : t("panel.enterTerms")}
              </div>
              {schedule && (
                <p className="mt-2 text-[11px] text-slate-500">
                  {t("panel.flows", { cost: fmtEur(cost), months: Math.round(n ?? 0), installment: fmtEur(m, 2) })}
                  {residual ? t("panel.flowsResidual", { residual: fmtEur(residual) }) : ""}
                  {schedule.residualInSolve > 0 ? t("panel.residualInIrr") : ""}
                </p>
              )}
            </div>
            <dl className="space-y-2 border-t border-ink-700 pt-4 text-sm">
              <div className="flex justify-between"><dt className="text-slate-400">{t("panel.receivable")}</dt><dd className="num">{fmtEur(receivable)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">{t("panel.interest")}</dt><dd className="num">{fmtEur(schedule?.totals.interest)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">{t("panel.principal")}</dt><dd className="num">{fmtEur(schedule?.totals.principal)}</dd></div>
            </dl>
            <dl className="space-y-2 border-t border-ink-700 pt-4 text-sm">
              <div className="flex justify-between"><dt className="text-slate-400">{t("panel.client")}</dt><dd className="text-right">{scoring.companyName} · {scoring.rating}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">{t("panel.creditOpinion")}</dt><dd className="num">{fmtEur(scoring.creditOpinion)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">{t("panel.currentExposure")}</dt><dd className="num">{fmtEur(scoring.currentExposure)}</dd></div>
              <div className="flex justify-between font-semibold"><dt className="text-slate-300">{t("panel.exposureAfter")}</dt><dd className={`num ${overLimit ? "text-orange-300" : "text-slate-100"}`}>{fmtEur(exposureAfter)}</dd></div>
            </dl>
            {overLimit && <Alert tone="warning" title={t("panel.overLimitTitle")}>{t("panel.overLimitBody")}</Alert>}
            {noRecovery && <Alert tone="error" title={t("panel.noRecoveryTitle")}>{t("panel.noRecoveryBody")}</Alert>}
            {error && (
              <Alert tone="error" title={error}>
                {Object.keys(fieldErrors).length > 0 && tCommon("errors.fieldsWithError", { count: Object.keys(fieldErrors).length })}
              </Alert>
            )}
            <Button type="submit" disabled={saving || !schedule} className="w-full">
              {edit ? (saving ? t("panel.savingChanges") : t("panel.saveChanges")) : saving ? t("panel.creating") : t("panel.create")}
            </Button>
            {edit && (
              <p className="text-[11px] text-slate-500">
                {t("panel.editNote", { number: edit.contractNumber })}
              </p>
            )}
          </div>
        </Card>
      </aside>
    </form>
  );
}
