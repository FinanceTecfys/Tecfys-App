import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { fmtDate, fmtEur, fmtPct } from "@/lib/format";
import { markContractSigned } from "@/modules/contracts/actions";
import { LifecycleBadge, WorkflowBadge } from "@/modules/contracts/components/badges";
import { CancellationForm } from "@/modules/contracts/components/cancellation-form";
import { ScheduleTable } from "@/modules/contracts/components/schedule-table";
import { draftSourceFromContract, getContract, toContractInput } from "@/modules/contracts/data";
import { cityLine } from "@/modules/contracts/domain/contract-template";
import { monthKeyOfDate } from "@/modules/contracts/domain/month-key";
import { buildSchedule, principalOutstandingAt } from "@/modules/contracts/domain/schedule";
import { formatIban } from "@/modules/contracts/domain/sepa";
import { signatureProvider } from "@/modules/signature/provider";

export default async function ContractPage({ params }: PageProps<"/contracts/[id]">) {
  const { id } = await params;
  const contract = await getContract(id);
  if (!contract) notFound();

  const today = new Date();
  const schedule = buildSchedule(toContractInput(contract), today);
  const todayKey = monthKeyOfDate(today);
  const outstanding = principalOutstandingAt(schedule, todayKey) ?? 0;
  const collected = schedule.rows.filter((r) => r.key <= todayKey).reduce((a, r) => a + r.installment, 0);
  const signed = contract.workflow_status === "signed";
  const canDownload = draftSourceFromContract(contract) !== null;
  const mandate = contract.mandate;
  const fiscalLine = contract.fiscal_address
    ? `${contract.fiscal_address}, ${cityLine(contract.fiscal_postal_code ?? "", contract.fiscal_city ?? "", contract.fiscal_province)}`
    : null;
  const identification: [string, React.ReactNode][] = [
    ["Razón social", contract.client_name ?? "—"],
    ["CIF / NIF", contract.client_cif ?? "—"],
    ["Domicilio fiscal", fiscalLine ?? "—"],
    ["Firmante", contract.signatory_name ? `${contract.signatory_name}${contract.signatory_nif ? ` (${contract.signatory_nif})` : ""}` : "—"],
    ["Contacto", [contract.contact_name, contract.contact_phone, contract.contact_email].filter(Boolean).join(" · ") || "—"],
    ["Domicilio de entrega", contract.delivery_same_as_fiscal ? "Mismo que dirección fiscal" : (contract.delivery_address ?? "—")],
    ["Producto", contract.product_description ?? "—"],
  ];

  const terms: [string, React.ReactNode][] = [
    ["Cliente", contract.company ? <span key="c">{contract.company.name} <span className="num text-slate-500">{contract.company.cif}</span></span> : "—"],
    ["Distribuidor", contract.distributor?.name ?? "Directo"],
    ["Tipo de activo", contract.asset_type?.name ?? "—"],
    ["Tipo de contrato", contract.contract_type],
    ["Fecha de firma", fmtDate(contract.signing_date)],
    ["Duración", `${contract.duration_months} meses`],
    ["Cuota mensual", fmtEur(Number(contract.installment), 2)],
    ["Valor residual", contract.residual_value === null ? "—" : fmtEur(Number(contract.residual_value), 2)],
    ["Coste del equipo", fmtEur(schedule.assetBase, 2)],
    ["Avalista", contract.has_guarantor ? `${contract.guarantor_name ?? "Sí"}${contract.guarantor_nif ? ` (${contract.guarantor_nif})` : ""}` : "No"],
    ["Fecha de cancelación", fmtDate(contract.cancel_date)],
    ["Estado adicional", contract.additional_status ?? "—"],
    ["Importe de liquidación", contract.settlement_amount === null ? "—" : fmtEur(Number(contract.settlement_amount), 2)],
    ["País", contract.country ?? "—"],
    ["Ref. Loan book", contract.loan_book_ref ?? "—"],
    ["Tramo / lender", contract.tranche_lender ?? "—"],
  ];

  return (
    <>
      <PageHeader
        title={`Contrato ${contract.contract_number}`}
        description={
          <span className="inline-flex items-center gap-2">
            {contract.company?.name} · <WorkflowBadge status={contract.workflow_status} />
            {signed && <LifecycleBadge status={schedule.status} />}
          </span>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Stat label="Expected IRR" value={fmtPct(schedule.expectedAnnualIrr)} hint={`${fmtPct(schedule.expectedMonthlyIrr, 4)} mensual`} accent />
        <Stat label="Principal pendiente" value={signed ? fmtEur(Math.abs(outstanding) < 0.005 ? 0 : outstanding) : "—"} hint="a cierre del mes en curso" />
        <Stat label="Facturado hasta hoy" value={signed ? fmtEur(collected) : "—"} hint={`de ${fmtEur(schedule.totals.installments)} contratados`} />
        <Stat
          label="Resultado principal"
          value={fmtEur(schedule.principalResult)}
          hint={schedule.writeOff > 0.005 ? `Default: ${fmtEur(schedule.writeOff)} dado de baja` : "Recupera el coste del activo"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card title="Calendario de amortización" subtitle={`${schedule.paymentHorizon} cuotas · amortiza en ${schedule.amortizationMonths} meses${schedule.billingStartKey > schedule.signingKey ? " · factura desde el mes siguiente a la firma" : ""}`}>
          <ScheduleTable schedule={schedule} currentKey={todayKey} />
        </Card>
        <div className="space-y-6">
          <Card title="Condiciones">
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
            <Card title="Datos identificativos">
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
            <Card title="Orden de domiciliación SEPA">
              <dl className="space-y-2 text-sm">
                {[
                  ["Referencia", mandate.mandate_reference],
                  ["Deudor", mandate.debtor_name],
                  ["IBAN", formatIban(mandate.iban)],
                  ["BIC", mandate.bic ?? "—"],
                  ["Tipo de pago", mandate.recurrent ? "Recurrente" : "Único"],
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
              {signed ? "Descargar contrato (.docx)" : "Descargar contrato borrador (.docx)"}
            </a>
          )}
          {signed && (
            <Card title="Gestión del contrato" subtitle="Cancelación, estado y liquidación">
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
            <Card title="Firma" subtitle="Signaturit">
              <div className="space-y-4">
                <Alert tone="info" title="Firma electrónica en preparación">
                  {signatureProvider.isConfigured()
                    ? "Credenciales de Signaturit configuradas; falta la plantilla del contrato."
                    : "El envío automático a Signaturit llegará en una próxima rama. Mientras tanto, revisa el borrador descargado, fírmalo fuera de la plataforma y márcalo como firmado para que entre en el loan book."}
                </Alert>
                <form action={markContractSigned} className="space-y-3">
                  <input type="hidden" name="id" value={contract.id} />
                  <Field label="Fecha de firma" name="signingDate" type="date" defaultValue={contract.signing_date} required />
                  <Button type="submit" className="w-full">Marcar como firmado</Button>
                </form>
              </div>
            </Card>
          )}
          {contract.scoring_id && (
            <p className="text-xs text-slate-500">
              <Link href={`/scoring/${contract.scoring_id}`} className="hover:text-mint-400">Ver scoring de origen →</Link>
            </p>
          )}
          {contract.notes && <p className="text-xs text-slate-500">{contract.notes}</p>}
        </div>
      </div>
    </>
  );
}
