import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getTranslate } from "@/i18n/server";
import { FileDown, Pencil } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { can } from "@/lib/auth/permissions";
import { dataScopeFor } from "@/lib/auth/scope";
import { fmtDate, fmtEur, fmtPct } from "@/lib/format";
import { requireRole } from "@/lib/supabase/auth";
import { markContractSigned } from "@/modules/contracts/actions";
import { LifecycleBadge, WorkflowBadge } from "@/modules/contracts/components/badges";
import { CancellationForm } from "@/modules/contracts/components/cancellation-form";
import { ContractDocuments } from "@/modules/contracts/components/contract-documents";
import { ScheduleTable } from "@/modules/contracts/components/schedule-table";
import { draftSourceFromContract, getContract, listAttachments, toContractInput } from "@/modules/contracts/data";
import { attachmentSlots } from "@/modules/contracts/domain/attachments";
import { findStatus } from "@/modules/contracts/domain/cancellation";
import { cityLine } from "@/modules/contracts/domain/contract-template";
import { monthKeyOfDate } from "@/modules/contracts/domain/month-key";
import { isEditableDraft } from "@/modules/contracts/domain/operation";
import { buildSchedule, principalOutstandingAt } from "@/modules/contracts/domain/schedule";
import { formatIban } from "@/modules/contracts/domain/sepa";
import { LifecycleStepper } from "@/modules/pipeline/components/lifecycle-stepper";
import { contractLifecycleInput } from "@/modules/pipeline/data";
import { lifecycleOf } from "@/modules/pipeline/domain/lifecycle";
import { signatureProvider } from "@/modules/signature/provider";

export default async function ContractPage({ params }: PageProps<"/contracts/[id]">) {
  const user = await requireRole("contract.view");
  const canManage = can(user.role, "contract.manage");
  const { id } = await params;
  const contract = await getContract(id, dataScopeFor(user));
  if (!contract) notFound();
  const [stored, lifecycleInput] = await Promise.all([listAttachments(contract.id), contractLifecycleInput(contract)]);
  const lifecycle = lifecycleOf(lifecycleInput);
  const lifecycleLabel = (await getTranslate())(lifecycle.label);
  // Always the four slots, in a fixed order: a download when stored, an upload when missing.
  const documents = attachmentSlots(stored).map(({ kind, attachment }) => ({ kind, fileName: attachment?.file_name ?? null }));

  const t = await getTranslations("contract.detail");
  const tCommon = await getTranslations("common");
  const tStatuses = await getTranslations("contract.additionalStatuses");
  const today = new Date();
  const schedule = buildSchedule(toContractInput(contract), today);
  const todayKey = monthKeyOfDate(today);
  const outstanding = principalOutstandingAt(schedule, todayKey) ?? 0;
  const collected = schedule.rows.filter((r) => r.key <= todayKey).reduce((a, r) => a + r.installment, 0);
  const signed = contract.workflow_status === "signed";
  const canDownload = draftSourceFromContract(contract) !== null;
  // The action checks the same again: a draft, with a scoring, inside the user's scope.
  const canEdit = isEditableDraft(contract.workflow_status) && contract.scoring_id !== null && can(user.role, "operation.create");
  const mandate = contract.mandate;
  const fiscalLine = contract.fiscal_address
    ? `${contract.fiscal_address}, ${cityLine(contract.fiscal_postal_code ?? "", contract.fiscal_city ?? "", contract.fiscal_province)}`
    : null;
  const identification: [string, React.ReactNode][] = [
    [t("companyName"), contract.client_name ?? "—"],
    [t("taxId"), contract.client_cif ?? "—"],
    [t("fiscalAddress"), fiscalLine ?? "—"],
    [t("signatory"), contract.signatory_name ? `${contract.signatory_name}${contract.signatory_nif ? ` (${contract.signatory_nif})` : ""}` : "—"],
    [t("contact"), [contract.contact_name, contract.contact_phone, contract.contact_email].filter(Boolean).join(" · ") || "—"],
    [t("deliveryAddress"), contract.delivery_same_as_fiscal ? t("sameAsFiscal") : (contract.delivery_address ?? "—")],
    [t("product"), contract.product_description ?? "—"],
  ];

  const knownStatus = findStatus(contract.additional_status);
  const terms: [string, React.ReactNode][] = [
    [t("client"), contract.company ? <span key="c">{contract.company.name} <span className="num text-slate-500">{contract.company.cif}</span></span> : "—"],
    [t("distributor"), contract.distributor?.name ?? tCommon("direct")],
    [t("assetType"), contract.asset_type?.name ?? "—"],
    [t("contractType"), contract.contract_type],
    [t("signingDate"), fmtDate(contract.signing_date)],
    [t("duration"), tCommon("months", { count: contract.duration_months })],
    [t("installment"), fmtEur(Number(contract.installment), 2)],
    [t("residual"), contract.residual_value === null ? "—" : fmtEur(Number(contract.residual_value), 2)],
    [t("cost"), fmtEur(schedule.assetBase, 2)],
    [t("guarantor"), contract.has_guarantor ? `${contract.guarantor_name ?? tCommon("yes")}${contract.guarantor_nif ? ` (${contract.guarantor_nif})` : ""}` : tCommon("no")],
    [t("cancelDate"), fmtDate(contract.cancel_date)],
    // A status the app knows reads in the user's language; an imported one it does not know is shown as stored.
    [t("additionalStatus"), knownStatus ? tStatuses(`${knownStatus.key}.label`) : (contract.additional_status ?? "—")],
    [t("settlement"), contract.settlement_amount === null ? "—" : fmtEur(Number(contract.settlement_amount), 2)],
    [t("country"), contract.country ?? "—"],
    [t("loanBookRef"), contract.loan_book_ref ?? "—"],
    [t("tranche"), contract.tranche_lender ?? "—"],
  ];

  return (
    <>
      <PageHeader
        title={t("title", { number: contract.contract_number })}
        description={
          <span className="inline-flex items-center gap-2">
            {contract.company?.name} · <WorkflowBadge status={contract.workflow_status} />
            {signed && <LifecycleBadge status={schedule.status} />}
          </span>
        }
        actions={
          canEdit && (
            <ButtonLink href={`/contracts/${contract.id}/edit`} variant="secondary">
              <Pencil className="h-4 w-4" aria-hidden /> {t("edit")}
            </ButtonLink>
          )
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Stat label={t("expectedIrr")} value={fmtPct(schedule.expectedAnnualIrr)} hint={t("monthly", { rate: fmtPct(schedule.expectedMonthlyIrr, 4) })} accent />
        <Stat label={t("outstanding")} value={signed ? fmtEur(Math.abs(outstanding) < 0.005 ? 0 : outstanding) : "—"} hint={t("outstandingHint")} />
        <Stat label={t("billed")} value={signed ? fmtEur(collected) : "—"} hint={t("billedHint", { total: fmtEur(schedule.totals.installments) })} />
        <Stat
          label={t("principalResult")}
          value={fmtEur(schedule.principalResult)}
          hint={schedule.writeOff > 0.005 ? t("defaultHint", { amount: fmtEur(schedule.writeOff) }) : t("recoversHint")}
        />
      </div>

      <Card title={t("lifecycleTitle")} subtitle={lifecycleLabel} className="mb-6">
        <LifecycleStepper lifecycle={lifecycle} className="mx-auto max-w-3xl" />
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card title={t("scheduleTitle")} subtitle={`${t("scheduleSubtitle", { installments: schedule.paymentHorizon, months: schedule.amortizationMonths })}${schedule.billingStartKey > schedule.signingKey ? t("scheduleLag") : ""}`}>
          <ScheduleTable schedule={schedule} currentKey={todayKey} collapsedRows={signed ? undefined : 13} />
        </Card>
        <div className="space-y-6">
          <Card title={t("termsTitle")}>
            <dl className="space-y-2 text-sm">
              {terms.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {contract.client_name && (
            <Card title={t("identityTitle")}>
              <dl className="space-y-2 text-sm">
                {identification.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="shrink-0 text-slate-400">{label}</dt>
                    <dd className="text-right">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
          {mandate && (
            <Card title={t("sepaTitle")}>
              <dl className="space-y-2 text-sm">
                {[
                  [t("sepaReference"), mandate.mandate_reference],
                  [t("sepaDebtor"), mandate.debtor_name],
                  ["IBAN", formatIban(mandate.iban)],
                  ["BIC", mandate.bic ?? "—"],
                  [t("sepaPaymentType"), mandate.recurrent ? t("sepaRecurrent") : t("sepaOneOff")],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-slate-400">{label}</dt>
                    <dd className="num text-right">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
          {canDownload && (
            <a
              href={`/contracts/${contract.id}/draft`}
              className="flex items-center justify-center gap-2 rounded-md border border-mint-500/50 px-3.5 py-2 text-sm font-semibold text-mint-400 transition hover:bg-mint-500/10"
            >
              <FileDown className="h-4 w-4" aria-hidden />
              {signed ? t("downloadContract") : t("downloadDraft")}
            </a>
          )}
          <Card title={t("documentsTitle")} subtitle={t("documentsSubtitle")}>
            <ContractDocuments contractId={contract.id} slots={documents} />
          </Card>
          {signed && canManage && (
            <Card title={t("manageTitle")} subtitle={t("manageSubtitle")}>
              <CancellationForm
                contractId={contract.id}
                cancelDate={contract.cancel_date}
                additionalStatus={contract.additional_status}
                settlementAmount={contract.settlement_amount === null ? null : Number(contract.settlement_amount)}
                outstanding={outstanding}
              />
            </Card>
          )}
          {!signed && (
            <Card title={t("signatureTitle")} subtitle="Signaturit">
              <div className="space-y-4">
                <Alert tone="info" title={t("signaturePendingTitle")}>
                  {signatureProvider.isConfigured() ? t("signatureConfigured") : t("signatureManual")}
                </Alert>
                {canManage ? (
                  <form action={markContractSigned} className="space-y-3">
                    <input type="hidden" name="id" value={contract.id} />
                    <Field label={t("signingDate")} name="signingDate" type="date" defaultValue={contract.signing_date} required />
                    <Button type="submit" className="w-full">{t("markSigned")}</Button>
                  </form>
                ) : (
                  <p className="text-xs text-slate-400">{t("signedByTecfys")}</p>
                )}
              </div>
            </Card>
          )}
          {contract.scoring_id && (
            <p className="text-xs text-slate-500">
              <Link href={`/scoring/${contract.scoring_id}`} className="hover:text-mint-400">{t("sourceScoring")}</Link>
            </p>
          )}
          {contract.notes && <p className="text-xs text-slate-500">{contract.notes}</p>}
        </div>
      </div>
    </>
  );
}
