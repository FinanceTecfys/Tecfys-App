import Link from "next/link";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate, fmtEur, fmtPct } from "@/lib/format";
import { LifecycleBadge, WorkflowBadge } from "@/modules/contracts/components/badges";
import { loadLoanBook } from "@/modules/contracts/data";
import {
  DEFAULT_SORT,
  filterLoanBook,
  isLoanBookSort,
  LOAN_BOOK_SORTS,
  sortLoanBook,
  toLoanBookRow,
} from "@/modules/contracts/domain/loan-book-view";
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
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const sortParam = typeof sp.sort === "string" ? sp.sort : undefined;
  const sort = isLoanBookSort(sortParam) ? sortParam : DEFAULT_SORT;
  const page = Math.max(1, Number(sp.page) || 1);

  const book = await loadLoanBook({ includeDrafts: true });
  const rows = book.map(toLoanBookRow);
  const filtered = sortLoanBook(filterLoanBook(rows, { q, status }), sort);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const signed = rows.filter((r) => r.lifecycleStatus !== null);
  const live = signed.filter((r) => r.lifecycleStatus !== "Finished");
  const outstanding = signed.reduce((s, r) => s + (r.outstanding ?? 0), 0);

  const params = (extra: Record<string, string>) =>
    new URLSearchParams({ ...(q && { q }), ...(status && { status }), sort, ...extra }).toString();

  return (
    <>
      <PageHeader
        title="Loan book"
        description="Todos los contratos de renting. Estado, IRR, extensión y principal pendiente calculados a día de hoy."
        actions={
          <>
            <a href={`/contracts/export?${params({ format: "xlsx" })}`} className="inline-flex items-center gap-2 rounded-md border border-ink-600 px-3.5 py-2 text-sm text-slate-200 transition hover:border-mint-500/60">
              <FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel
            </a>
            <a href={`/contracts/export?${params({ format: "pdf" })}`} className="inline-flex items-center gap-2 rounded-md border border-ink-600 px-3.5 py-2 text-sm text-slate-200 transition hover:border-mint-500/60">
              <FileDown className="h-4 w-4" aria-hidden /> PDF
            </a>
          </>
        }
      />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Stat label="Contratos firmados" value={signed.length.toLocaleString("es-ES")} hint={`${live.length.toLocaleString("es-ES")} vivos`} />
        <Stat label="Principal pendiente" value={fmtEur(outstanding)} accent />
        <Stat label="Borradores / pendientes de firma" value={(rows.length - signed.length).toLocaleString("es-ES")} />
      </div>

      <Card bodyClassName="p-0">
        <form className="flex flex-wrap gap-3 border-b border-ink-700 p-4" role="search">
          <input name="q" defaultValue={q} placeholder="Buscar por cliente, CIF, nº contrato, distribuidor, país…" className={`${inputClass} max-w-sm`} aria-label="Buscar" />
          <select name="status" defaultValue={status} className={`${inputClass} w-44`} aria-label="Estado">
            <option value="">Todos los estados</option>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select name="sort" defaultValue={sort} className={`${inputClass} w-64`} aria-label="Ordenar por">
            {Object.entries(LOAN_BOOK_SORTS).map(([value, { label }]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button className="rounded-md border border-ink-600 px-4 text-sm text-slate-200 hover:border-mint-500/60">Aplicar</button>
          <span className="ml-auto self-center text-xs text-slate-500">{filtered.length.toLocaleString("es-ES")} contratos</span>
        </form>
        <Table>
          <thead>
            <tr>
              <Th>Contrato</Th>
              <Th>Cliente</Th>
              <Th>País</Th>
              <Th>Distribuidor</Th>
              <Th>Firma</Th>
              <Th right>Meses</Th>
              <Th right>Ext.</Th>
              <Th right>Cuota</Th>
              <Th right>Coste</Th>
              <Th right>Expected IRR</Th>
              <Th>Estado</Th>
              <Th>Cancelación</Th>
              <Th>Estado adicional</Th>
              <Th right>Principal pendiente</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="hover:bg-ink-800/50">
                <Td>
                  <Link href={`/contracts/${r.id}`} className="num font-medium text-slate-100 hover:text-mint-400">{r.contractNumber}</Link>
                </Td>
                <Td className="max-w-56 truncate">{r.client}</Td>
                <Td mono className="text-slate-400">{r.country ?? "—"}</Td>
                <Td className="text-slate-400">{r.distributor ?? "—"}</Td>
                <Td>{fmtDate(r.signingDate)}</Td>
                <Td right mono>{r.durationMonths}</Td>
                <Td right mono className={r.extensionMonths ? "text-yellow-300" : "text-slate-600"}>
                  {r.extensionMonths ? `+${r.extensionMonths}` : "—"}
                </Td>
                <Td right mono>{fmtEur(r.installment, 2)}</Td>
                <Td right mono>{fmtEur(r.cost)}</Td>
                <Td right mono>{r.expectedAnnualIrr === null ? "n/a" : fmtPct(r.expectedAnnualIrr, 1)}</Td>
                <Td>{r.lifecycleStatus ? <LifecycleBadge status={r.lifecycleStatus} /> : <WorkflowBadge status={r.workflowStatus} />}</Td>
                <Td>{fmtDate(r.cancelDate)}</Td>
                <Td>
                  {r.additionalStatus ? (
                    <Badge tone={r.additionalStatus.toLowerCase() === "gesico" ? "red" : "slate"}>{r.additionalStatus}</Badge>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </Td>
                <Td right mono>{r.outstanding === null ? "—" : fmtEur(r.outstanding)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <nav className="flex items-center justify-between p-4 text-sm text-slate-400" aria-label="Paginación">
          <span>Página {page} de {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={`/contracts?${params({ page: String(page - 1) })}`} className="rounded-md border border-ink-600 px-3 py-1 hover:border-mint-500/60">Anterior</Link>}
            {page < pages && <Link href={`/contracts?${params({ page: String(page + 1) })}`} className="rounded-md border border-ink-600 px-3 py-1 hover:border-mint-500/60">Siguiente</Link>}
          </div>
        </nav>
      </Card>
    </>
  );
}
