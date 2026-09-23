import Link from "next/link";
import { FileDown, FileSpreadsheet, X } from "lucide-react";
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
  asOfForMonth,
  DEFAULT_SORT,
  filterLoanBook,
  type GroupFilter,
  hasLoanBookFilters,
  LOAN_BOOK_SORTS,
  LOAN_SIZE_BUCKETS,
  type LoanBookQuery,
  loanBookFilterOptions,
  loanBookSearch,
  parseLoanBookQuery,
  sortLoanBook,
  toLoanBookRow,
  toSearchParams,
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

const GROUP_SELECTS: { name: GroupFilter; label: string; all: string }[] = [
  { name: "country", label: "País", all: "Todos los países" },
  { name: "distributor", label: "Distribuidor", all: "Todos los distribuidores" },
  { name: "cluster", label: "Grupo de activo", all: "Todos los grupos de activo" },
];

export default async function ContractsPage({ searchParams }: PageProps<"/contracts">) {
  const sp = await searchParams;
  const query = parseLoanBookQuery(toSearchParams(sp));
  const sort = query.sort ?? DEFAULT_SORT;
  const current: LoanBookQuery = { ...query, sort };
  const { q = "", status = "" } = query;
  const page = Math.max(1, Number(sp.page) || 1);
  // Dashboard drill-downs of a past period read the book as of that month.
  const asOf = asOfForMonth(query.asof, new Date());

  const book = await loadLoanBook({ includeDrafts: true, asOf });
  const rows = book.map(toLoanBookRow);
  const options = loanBookFilterOptions(rows);
  const filtered = sortLoanBook(filterLoanBook(rows, query), sort);
  const filtering = hasLoanBookFilters(query);
  const filteredOutstanding = filtered.reduce((s, r) => s + (r.outstanding ?? 0), 0);
  const filteredDefault = filtered.reduce((s, r) => s + (r.defaultAmount ?? 0), 0);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const signed = rows.filter((r) => r.lifecycleStatus !== null);
  const live = signed.filter((r) => r.lifecycleStatus !== "Finished");
  const outstanding = signed.reduce((s, r) => s + (r.outstanding ?? 0), 0);

  const params = (extra: Record<string, string>) => loanBookSearch(current, extra);
  const hrefWith = (patch: Partial<LoanBookQuery>) => `/contracts?${loanBookSearch({ ...current, ...patch })}`;

  return (
    <>
      <PageHeader
        title="Loan book"
        description={`Todos los contratos de renting. Estado, IRR, extensión y principal pendiente calculados ${query.asof ? `a ${fmtDate(asOf.toISOString())}` : "a día de hoy"}.`}
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
          <select name="client" defaultValue={query.client ?? ""} className={`${inputClass} w-64`} aria-label="Cliente">
            <option value="">Todos los clientes</option>
            {options.client.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {GROUP_SELECTS.map(({ name, label, all }) => {
            const values = query[name] ?? [];
            // Several values only arrive from a drill-down into "Otros": kept as a chip.
            if (values.length > 1) {
              return (
                <span key={name} className="inline-flex items-center gap-2 rounded-md border border-mint-500/50 px-3 text-sm text-mint-400">
                  {values.map((v) => <input key={v} type="hidden" name={name} value={v} />)}
                  {label}: Otros ({values.length})
                  <Link href={hrefWith({ [name]: [] })} aria-label={`Quitar filtro ${label.toLowerCase()}`} className="text-slate-400 hover:text-white">
                    <X className="h-3.5 w-3.5" />
                  </Link>
                </span>
              );
            }
            return (
              <select key={name} name={name} defaultValue={values[0] ?? ""} className={`${inputClass} w-52`} aria-label={label}>
                <option value="">{all}</option>
                {options[name].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            );
          })}
          <select name="size" defaultValue={query.size ?? ""} className={`${inputClass} w-52`} aria-label="Tamaño por principal pendiente">
            <option value="">Todos los tamaños</option>
            {LOAN_SIZE_BUCKETS.map((b) => <option key={b.key} value={b.key}>Pendiente {b.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Default en
            <input type="month" name="defaulted" defaultValue={query.defaulted ?? ""} className={`${inputClass} w-40`} aria-label="Default en el mes" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" name="pending" value="1" defaultChecked={query.pending} className="h-4 w-4 accent-mint-500" />
            Solo con principal pendiente
          </label>
          {query.asof && (
            <span className="inline-flex items-center gap-2 rounded-md border border-mint-500/50 px-3 text-sm text-mint-400">
              <input type="hidden" name="asof" value={query.asof} />
              Cartera a {fmtDate(asOf.toISOString())}
              <Link href={hrefWith({ asof: undefined })} aria-label="Ver a día de hoy" className="text-slate-400 hover:text-white">
                <X className="h-3.5 w-3.5" />
              </Link>
            </span>
          )}
          <select name="sort" defaultValue={sort} className={`${inputClass} w-64`} aria-label="Ordenar por">
            {Object.entries(LOAN_BOOK_SORTS).map(([value, { label }]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button className="rounded-md border border-ink-600 px-4 text-sm text-slate-200 hover:border-mint-500/60">Aplicar</button>
          {filtering && <Link href="/contracts" className="self-center text-xs text-slate-400 hover:text-mint-400">Quitar filtros</Link>}
          <span className="ml-auto self-center text-right text-xs text-slate-500">
            {filtered.length.toLocaleString("es-ES")} contratos
            {filtering && (
              <>
                {" · "}<span className="num text-slate-300">{fmtEur(filteredOutstanding)}</span> pendiente
                {query.defaulted && <>{" · "}<span className="num text-red-300">{fmtEur(filteredDefault, 2)}</span> default</>}
              </>
            )}
          </span>
        </form>
        <Table>
          <thead>
            <tr>
              <Th>Contrato</Th>
              <Th>Cliente</Th>
              <Th>País</Th>
              <Th>Distribuidor</Th>
              <Th>Tipo de activo</Th>
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
              <Th right>Default</Th>
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
                <Td className="max-w-40 truncate text-slate-400" title={r.assetCluster ?? undefined}>{r.assetType ?? "—"}</Td>
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
                <Td right mono className={r.defaultAmount === null ? "text-slate-600" : "text-red-300"}>
                  {r.defaultAmount === null ? "—" : fmtEur(r.defaultAmount, 2)}
                </Td>
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
