import Link from "next/link";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate, fmtEur, fmtPct } from "@/lib/format";
import { LifecycleBadge, WorkflowBadge } from "@/modules/contracts/components/badges";
import { loadLoanBook } from "@/modules/contracts/data";
import type { ContractStatus } from "@/modules/contracts/domain/schedule";

export const metadata = { title: "Loan book" };

const PAGE_SIZE = 50;
const STATUSES: { value: ContractStatus | "draft"; label: string }[] = [
  { value: "Active", label: "Activos" },
  { value: "On Track", label: "En plazo" },
  { value: "Extended", label: "Extendidos" },
  { value: "Finished", label: "Finalizados" },
  { value: "draft", label: "Borradores" },
];

export default async function ContractsPage({ searchParams }: PageProps<"/contracts">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const book = await loadLoanBook({ includeDrafts: true });
  const filtered = book.filter(({ row, schedule }) => {
    if (status === "draft" ? row.workflow_status === "signed" : status && (row.workflow_status !== "signed" || schedule.status !== status)) return false;
    if (!q) return true;
    return [row.contract_number, row.loan_book_ref, row.company?.name, row.company?.cif, row.distributor?.name]
      .some((v) => v?.toLowerCase().includes(q));
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const signed = book.filter((c) => c.row.workflow_status === "signed");
  const live = signed.filter((c) => c.schedule.status !== "Finished");
  const outstanding = signed.reduce((s, c) => s + c.outstanding, 0);
  const href = (p: number) => `/contracts?${new URLSearchParams({ ...(q && { q }), ...(status && { status }), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Loan book" description="Todos los contratos de renting. Estado, IRR y principal pendiente calculados a día de hoy." />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Stat label="Contratos firmados" value={signed.length.toLocaleString("es-ES")} hint={`${live.length.toLocaleString("es-ES")} vivos`} />
        <Stat label="Principal pendiente" value={fmtEur(outstanding)} accent />
        <Stat label="Borradores / pendientes de firma" value={(book.length - signed.length).toLocaleString("es-ES")} />
      </div>

      <Card bodyClassName="p-0">
        <form className="flex flex-wrap gap-3 border-b border-ink-700 p-4" role="search">
          <input name="q" defaultValue={q} placeholder="Buscar por cliente, CIF, nº contrato, distribuidor…" className={`${inputClass} max-w-md`} aria-label="Buscar" />
          <select name="status" defaultValue={status} className={`${inputClass} w-48`} aria-label="Estado">
            <option value="">Todos los estados</option>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button className="rounded-md border border-ink-600 px-4 text-sm text-slate-200 hover:border-mint-500/60">Filtrar</button>
          <span className="ml-auto self-center text-xs text-slate-500">{filtered.length.toLocaleString("es-ES")} contratos</span>
        </form>
        <Table>
          <thead>
            <tr>
              <Th>Contrato</Th>
              <Th>Cliente</Th>
              <Th>Distribuidor</Th>
              <Th>Firma</Th>
              <Th>Tipo</Th>
              <Th right>Meses</Th>
              <Th right>Cuota</Th>
              <Th right>Coste</Th>
              <Th right>Expected IRR</Th>
              <Th>Estado</Th>
              <Th right>Principal pendiente</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ row, schedule, outstanding: po }) => (
              <tr key={row.id} className="hover:bg-ink-800/50">
                <Td>
                  <Link href={`/contracts/${row.id}`} className="num font-medium text-slate-100 hover:text-mint-400">{row.contract_number}</Link>
                </Td>
                <Td className="max-w-64 truncate">{row.company?.name}</Td>
                <Td className="text-slate-400">{row.distributor?.name ?? "—"}</Td>
                <Td>{fmtDate(row.signing_date)}</Td>
                <Td className="text-slate-400">{row.contract_type}</Td>
                <Td right mono>{row.duration_months}</Td>
                <Td right mono>{fmtEur(Number(row.installment), 2)}</Td>
                <Td right mono>{fmtEur(schedule.assetBase)}</Td>
                <Td right mono>{schedule.expectedAnnualIrr === null ? "n/a" : fmtPct(schedule.expectedAnnualIrr, 1)}</Td>
                <Td>{row.workflow_status === "signed" ? <LifecycleBadge status={schedule.status} /> : <WorkflowBadge status={row.workflow_status} />}</Td>
                <Td right mono>{row.workflow_status === "signed" ? fmtEur(Math.abs(po) < 0.005 ? 0 : po) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <nav className="flex items-center justify-between p-4 text-sm text-slate-400" aria-label="Paginación">
          <span>Página {page} de {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={href(page - 1)} className="rounded-md border border-ink-600 px-3 py-1 hover:border-mint-500/60">Anterior</Link>}
            {page < pages && <Link href={href(page + 1)} className="rounded-md border border-ink-600 px-3 py-1 hover:border-mint-500/60">Siguiente</Link>}
          </div>
        </nav>
      </Card>
    </>
  );
}
