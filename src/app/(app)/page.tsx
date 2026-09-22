import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate, fmtEur, fmtMonthKey, fmtPct } from "@/lib/format";
import { WorkflowBadge } from "@/modules/contracts/components/badges";
import { listPipeline, loadLoanBook } from "@/modules/contracts/data";
import { toLoanBookRow } from "@/modules/contracts/domain/loan-book-view";
import { yearMonthOf } from "@/modules/contracts/domain/month-key";
import { buildPortfolio } from "@/modules/contracts/domain/portfolio";
import {
  BucketBarChart,
  DonutChart,
  MonthlyBarChart,
  MonthlyLineChart,
  RankedBarChart,
} from "@/modules/dashboard/components/charts";
import { PeriodSelector } from "@/modules/dashboard/components/period-selector";
import {
  defaultSeries,
  groupOutstanding,
  irrSeries,
  outstandingByLoanSize,
  resolvePeriod,
  topClientsByOutstanding,
} from "@/modules/dashboard/domain/analytics";
import { RatingBadge, ScoringStatusBadge } from "@/modules/scoring/components/badges";
import { listScorings } from "@/modules/scoring/data";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const now = new Date();
  const period = resolvePeriod({ preset: str(sp.preset), from: str(sp.from), to: str(sp.to) }, now);

  // Point-in-time figures are read at the end of the selected period, never
  // beyond today: the same as-of convention the loan book and waterfall use.
  const { year, month } = yearMonthOf(period.toKey);
  const endOfPeriod = new Date(Date.UTC(year, month, 0));
  const asOf = endOfPeriod < now ? endOfPeriod : now;

  const [book, scorings, pipeline] = await Promise.all([loadLoanBook({ asOf }), listScorings(6), listPipeline()]);
  const rows = book.map(toLoanBookRow);
  const months = buildPortfolio(book.map((c) => c.schedule));
  const current = months.find((m) => m.key === period.toKey);

  const topClients = topClientsByOutstanding(rows, 20);
  const buckets = outstandingByLoanSize(rows);
  const byAsset = groupOutstanding(rows, "assetCluster");
  const byCountry = groupOutstanding(rows, "country");
  const byPartner = groupOutstanding(rows, "distributor");
  const irr = irrSeries(months, period);
  const defaults = defaultSeries(months, period);

  const outstanding = rows.reduce((s, r) => s + Math.max(0, r.outstanding ?? 0), 0);
  const live = rows.filter((r) => r.lifecycleStatus !== null && r.lifecycleStatus !== "Finished").length;
  const top5Share = topClients.slice(0, 5).reduce((s, c) => s + c.share, 0);
  const periodDefaults = defaults.reduce((s, d) => s + d.defaults, 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Cartera a ${fmtDate(asOf.toISOString())} · ${period.label.toLowerCase()} (${fmtMonthKey(period.fromKey)} – ${fmtMonthKey(period.toKey)})`}
        actions={
          <ButtonLink href="/scoring/new">
            <Plus className="h-4 w-4" aria-hidden /> Nuevo scoring
          </ButtonLink>
        }
      />

      <div className="mb-6"><PeriodSelector period={period} /></div>

      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="Principal pendiente" value={fmtEur(outstanding)} hint={`${live.toLocaleString("es-ES")} contratos vivos`} accent />
        <Stat label="IRR anualizada ponderada" value={fmtPct(current?.weightedAnnualIrr, 1)} hint="por valor del activo, contratos vivos" />
        <Stat label="Default del periodo" value={fmtEur(periodDefaults)} hint={current ? `acumulado ${fmtEur(current.cumulativeDefaults)}` : undefined} />
        <Stat label="Concentración top 5" value={fmtPct(top5Share, 1)} hint="del principal pendiente" />
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-mint-500/80">Concentración</h2>
      <div className="mb-8 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card title="Top 20 clientes por principal pendiente" subtitle={`${fmtMonthKey(period.toKey)} · ${fmtPct(top5Share, 1)} del total en los 5 primeros`}>
          <RankedBarChart data={topClients} />
        </Card>
        <div className="space-y-6">
          <Card title="Principal pendiente por tamaño de operación" subtitle="Tramos por saldo pendiente de cada contrato">
            <BucketBarChart data={buckets} />
          </Card>
          <Card title="Principal pendiente por tipo de activo">
            <DonutChart data={byAsset} total={outstanding} />
          </Card>
        </div>
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-mint-500/80">Distribución</h2>
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card title="Principal pendiente por país">
          <DonutChart data={byCountry} total={outstanding} />
        </Card>
        <Card title="Principal pendiente por partner">
          <DonutChart data={byPartner} total={outstanding} />
        </Card>
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-mint-500/80">Evolución mensual</h2>
      <div className="mb-8 grid gap-6 xl:grid-cols-2">
        <Card title="IRR anualizada ponderada" subtitle="IRR esperada de los contratos vivos, ponderada por valor del activo y anualizada">
          <MonthlyLineChart data={irr.map((p) => ({ label: p.label, value: p.annualIrr }))} format="percent" />
        </Card>
        <Card title="Loss rate acumulado" subtitle="Default acumulado sobre principal originado (Summary fila 45)">
          <MonthlyLineChart data={defaults.map((p) => ({ label: p.label, value: p.cumulativeLossRate }))} format="percent" tone="loss" />
        </Card>
        <Card title="Default mensual" subtitle="Principal no recuperado dado de baja en el mes (Summary fila 22)" className="xl:col-span-2">
          <MonthlyBarChart data={defaults.map((p) => ({ label: p.label, value: p.defaults }))} />
        </Card>
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-mint-500/80">Actividad</h2>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Últimos scorings" action={<Link href="/scoring" className="text-xs text-slate-400 hover:text-mint-400">Ver todos</Link>} bodyClassName="p-0">
          {scorings.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-400">Sin scorings todavía.</p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {scorings.map((s) => (
                <li key={s.id}>
                  <Link href={`/scoring/${s.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-ink-800/50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-100">{s.company?.name}</span>
                      <span className="text-xs text-slate-500">{fmtDate(s.created_at)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <RatingBadge rating={s.rating} />
                      <ScoringStatusBadge status={s.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Pipeline de firma" subtitle="Contratos en borrador o pendientes de firma" bodyClassName="p-0">
          {pipeline.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-400">No hay operaciones pendientes.</p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {pipeline.map((c) => (
                <li key={c.id}>
                  <Link href={`/contracts/${c.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-ink-800/50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-100">{c.company?.name}</span>
                      <span className="num text-xs text-slate-500">{c.contract_number} · {fmtEur(Number(c.purchase_value))}</span>
                    </span>
                    <WorkflowBadge status={c.workflow_status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Cobros previstos"
          subtitle="Próximos 6 meses, cartera firmada"
          action={<Link href="/portfolio" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-mint-400">Waterfall <ArrowRight className="h-3 w-3" aria-hidden /></Link>}
          bodyClassName="p-0"
        >
          <Table>
            <thead>
              <tr>
                <Th>Mes</Th>
                <Th right>Cuotas</Th>
                <Th right>Interés</Th>
                <Th right>Principal</Th>
              </tr>
            </thead>
            <tbody>
              {months
                .filter((m) => m.key > period.toKey && m.key <= period.toKey + 6)
                .map((m) => (
                  <tr key={m.key}>
                    <Td>{fmtMonthKey(m.key)}</Td>
                    <Td right mono>{fmtEur(m.installments)}</Td>
                    <Td right mono>{fmtEur(m.interest)}</Td>
                    <Td right mono>{fmtEur(m.principal)}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
