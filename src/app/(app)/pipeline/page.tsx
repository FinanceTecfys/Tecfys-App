import Link from "next/link";
import { Card } from "@/components/ui/card";
import { FilterBar, FilterCell, filterSubmitClass } from "@/components/ui/filter-bar";
import { inputClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate, fmtNum, fmtPct } from "@/lib/format";
import { requireRole } from "@/lib/supabase/auth";
import { DonutChart, MonthlyBarChart, RankedBarChart, STATUS_COLORS } from "@/modules/dashboard/components/charts";
import { LifecycleStepper } from "@/modules/pipeline/components/lifecycle-stepper";
import { loadPipeline } from "@/modules/pipeline/data";
import {
  activePartners,
  activityByPartner,
  buildPipelineRows,
  filterPipeline,
  hasPipelineFilters,
  parsePipelineQuery,
  pipelineFilterOptions,
  pipelineSearch,
  pipelineTotals,
  SCORING_STATUS_LABELS,
  SCORING_STATUSES,
  type ScoringStatus,
  scoringsByPartner,
  scoringsByStatus,
  weeklyActivity,
} from "@/modules/pipeline/domain/pipeline";
import { RatingBadge, ScoringStatusBadge } from "@/modules/scoring/components/badges";
import { RATINGS, type Rating } from "@/modules/scoring/domain/criteria";

export const metadata = { title: "Pipeline" };

const PAGE_SIZE = 50;
const ACTIVE_DAYS = 30;
const WEEKS = 12;

const STATUS_COLOR: Record<ScoringStatus, string> = {
  approved: STATUS_COLORS.positive,
  pending_review: STATUS_COLORS.waiting,
  rejected: STATUS_COLORS.negative,
};

const isRating = (v: string): v is Rating => (RATINGS as readonly string[]).includes(v);
const int = (n: number) => n.toLocaleString("es-ES");

/**
 * Partner activity for the commercial team: every scoring, the operation
 * created from it and where it is in its lifecycle. Read-only. One load
 * (loadPipeline); rows, filters, figures and charts are computed in memory by
 * the pure domain module, and the figures follow the active filters.
 */
export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  await requireRole("pipeline.view");
  const query = parsePipelineQuery(await searchParams);
  const now = new Date();

  const { scorings, contracts, users } = await loadPipeline();
  const all = buildPipelineRows(scorings, contracts, users);
  const options = pipelineFilterOptions(all);
  const rows = filterPipeline(all, query);
  const filtering = hasPipelineFilters(query);

  const totals = pipelineTotals(rows);
  const partners = activityByPartner(rows);
  const byPartner = scoringsByPartner(rows).map((s) => ({ ...s, href: `/pipeline?${pipelineSearch(query, { partner: s.key, page: 1 })}` }));
  const byStatus = scoringsByStatus(rows).map((s) => ({
    ...s,
    color: STATUS_COLOR[s.key as ScoringStatus],
    href: `/pipeline?${pipelineSearch(query, { status: s.key as ScoringStatus, page: 1 })}`,
  }));
  const weekly = weeklyActivity(rows, now, WEEKS);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (n: number) => `/pipeline?${pipelineSearch(query, { page: n })}`;

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Actividad de originación de partners y equipo: cada scoring, la operación que generó y en qué punto de su ciclo de vida está."
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat interactive label="Scorings" value={int(totals.scorings)} hint={`${int(totals.pendingReview)} pendientes de revisión manual`} accent />
        <Stat interactive label="Tasa de aprobación" value={fmtPct(totals.approvalRate, 1)} hint={`${int(totals.approved)} aprobados · ${fmtPct(totals.rejectionRate, 1)} rechazados (${int(totals.rejected)})`} />
        <Stat interactive label="Operaciones creadas" value={int(totals.operations)} hint={`${int(totals.signed)} firmadas · ${fmtPct(totals.conversionRate, 0)} de los aprobados con operación`} />
        <Stat interactive label="Partners activos" value={int(activePartners(rows, now, ACTIVE_DAYS))} hint={`con actividad en los últimos ${ACTIVE_DAYS} días`} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card title="Scorings por partner" subtitle="Volumen por quien originó el scoring">
          <RankedBarChart data={byPartner} unit="count" measure="Scorings" height={Math.max(160, byPartner.length * 30 + 40)} />
        </Card>
        <Card title="Aprobación vs rechazo" subtitle="Resultado de los scorings">
          <DonutChart data={byStatus} total={totals.scorings} unit="count" centerLabel="scorings" />
        </Card>
        <Card title="Actividad reciente" subtitle={`Scorings por semana, últimas ${WEEKS} semanas`}>
          <MonthlyBarChart data={weekly.map((w) => ({ label: w.label, value: w.scorings }))} unit="count" measure="Scorings de la semana" tone="neutral" height={210} />
        </Card>
      </div>

      <Card title="Resumen por partner" className="mb-6" bodyClassName="p-0">
        {partners.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">Sin actividad con estos filtros.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Partner</Th>
                  <Th right>Scorings</Th>
                  <Th right>Aprobados</Th>
                  <Th right>Revisión</Th>
                  <Th right>Rechazados</Th>
                  <Th right>Tasa de aprobación</Th>
                  <Th right>Operaciones</Th>
                  <Th right>Firmadas</Th>
                  <Th>Última actividad</Th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.key} className="hover:bg-ink-800/50">
                    <Td>
                      <Link href={`/pipeline?${pipelineSearch(query, { partner: p.key, page: 1 })}`} className={p.kind === "none" || p.kind === "unknown" ? "text-slate-400 hover:text-mint-400" : "text-slate-100 hover:text-mint-400"}>
                        {p.label}
                      </Link>
                    </Td>
                    <Td right mono>{int(p.scorings)}</Td>
                    <Td right mono>{int(p.approved)}</Td>
                    <Td right mono>{int(p.pendingReview)}</Td>
                    <Td right mono>{int(p.rejected)}</Td>
                    <Td right mono>{fmtPct(p.approvalRate, 0)}</Td>
                    <Td right mono>{int(p.operations)}</Td>
                    <Td right mono>{int(p.signed)}</Td>
                    <Td>{fmtDate(p.lastActivity)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card bodyClassName="p-0">
        <FilterBar
          summary={<span>{int(rows.length)} {rows.length === 1 ? "registro" : "registros"}</span>}
          actions={
            <>
              {filtering && <Link href="/pipeline" className="text-xs text-slate-400 hover:text-mint-400">Quitar filtros</Link>}
              <button className={filterSubmitClass}>Aplicar</button>
            </>
          }
        >
          <FilterCell wide>
            <input name="q" defaultValue={query.q} placeholder="Buscar por empresa o CIF…" className={inputClass} aria-label="Buscar empresa" />
          </FilterCell>
          <FilterCell wide>
            <select name="partner" defaultValue={query.partner ?? ""} className={inputClass} aria-label="Partner">
              <option value="">Todos los partners</option>
              {options.partner.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FilterCell>
          <FilterCell>
            <select name="distributor" defaultValue={query.distributor ?? ""} className={inputClass} aria-label="Distribuidor">
              <option value="">Todos los distribuidores</option>
              {options.distributor.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FilterCell>
          <FilterCell>
            <select name="status" defaultValue={query.status ?? ""} className={inputClass} aria-label="Estado del scoring">
              <option value="">Todos los estados</option>
              {SCORING_STATUSES.map((s) => <option key={s} value={s}>{SCORING_STATUS_LABELS[s]}</option>)}
            </select>
          </FilterCell>
        </FilterBar>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">{filtering ? "Ningún registro coincide con los filtros." : "Todavía no hay scorings."}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Partner</Th>
                <Th>Empresa</Th>
                <Th>Sector</Th>
                <Th right>Puntuación</Th>
                <Th>Rating</Th>
                <Th>Estado</Th>
                <Th>Operación</Th>
                <Th>Ciclo de vida</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.key} className="hover:bg-ink-800/50">
                  <Td>{fmtDate(r.date)}</Td>
                  <Td>
                    <span className={r.originator.kind === "none" || r.originator.kind === "unknown" ? "text-slate-500" : "text-slate-100"}>
                      {r.originator.kind === "internal" ? `Tecfys · ${r.originator.name}` : r.originator.name}
                    </span>
                    <span className="block text-xs text-slate-500">{r.distributorName ?? "—"}</span>
                  </Td>
                  <Td className="max-w-56 truncate" title={r.company}>
                    <Link href={`/scoring/${r.scoringId}`} className="font-medium text-slate-100 hover:text-mint-400">{r.company}</Link>
                    <span className="num block text-xs text-slate-500">{r.cif ?? "—"}</span>
                  </Td>
                  <Td className="max-w-40 truncate text-slate-400" title={r.sector ?? undefined}>{r.sector ?? "—"}</Td>
                  <Td right mono>{fmtNum(r.score, 2)}</Td>
                  <Td>{isRating(r.rating) ? <RatingBadge rating={r.rating} /> : r.rating}</Td>
                  <Td><ScoringStatusBadge status={r.status} /></Td>
                  <Td>
                    {r.contract ? (
                      <Link href={`/contracts/${r.contract.id}`} className="num text-slate-100 hover:text-mint-400">{r.contract.contractNumber}</Link>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </Td>
                  <Td>
                    <LifecycleStepper lifecycle={r.lifecycle} variant="compact" />
                    <span className={`mt-1 block text-xs ${r.lifecycle.outcome === "rejected" || r.lifecycle.outcome === "cancelled" ? "text-red-300" : "text-slate-400"}`}>{r.lifecycle.label}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <nav className="flex items-center justify-between p-4 text-sm text-slate-400" aria-label="Paginación">
          <span>Página {page} de {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={pageHref(page - 1)} className="rounded-md border border-ink-600 px-3 py-1 hover:border-mint-500/60">Anterior</Link>}
            {page < pages && <Link href={pageHref(page + 1)} className="rounded-md border border-ink-600 px-3 py-1 hover:border-mint-500/60">Siguiente</Link>}
          </div>
        </nav>
      </Card>
    </>
  );
}
