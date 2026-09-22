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
import { monthKeyOfDate } from "@/modules/contracts/domain/month-key";
import { buildPortfolio } from "@/modules/contracts/domain/portfolio";
import { RatingBadge, ScoringStatusBadge } from "@/modules/scoring/components/badges";
import { listScorings } from "@/modules/scoring/data";

export default async function DashboardPage() {
  const today = new Date();
  const [book, scorings, pipeline] = await Promise.all([loadLoanBook({ asOf: today }), listScorings(6), listPipeline()]);
  const months = buildPortfolio(book.map((c) => c.schedule));
  const currentKey = monthKeyOfDate(today);
  const current = months.find((m) => m.key === currentKey);
  const next6 = months.filter((m) => m.key > currentKey && m.key <= currentKey + 6);

  const live = book.filter((c) => c.schedule.status !== "Finished");
  const weighted = live.reduce(
    (acc, c) => (c.schedule.expectedMonthlyIrr === null || c.outstanding <= 0 ? acc : { w: acc.w + c.outstanding, x: acc.x + c.outstanding * c.schedule.expectedMonthlyIrr }),
    { w: 0, x: 0 },
  );
  const weightedIrr = weighted.w > 0 ? Math.pow(1 + weighted.x / weighted.w, 12) - 1 : null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Situación de la cartera a ${fmtDate(today.toISOString())}`}
        actions={
          <ButtonLink href="/scoring/new">
            <Plus className="h-4 w-4" aria-hidden /> Nuevo scoring
          </ButtonLink>
        }
      />
      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="Principal pendiente" value={fmtEur(current?.closingPrincipal)} hint={`${live.length.toLocaleString("es-ES")} contratos vivos`} accent />
        <Stat label={`Facturación ${fmtMonthKey(currentKey)}`} value={fmtEur(current?.installments)} hint={current ? `${fmtEur(current.interest)} interés · ${fmtEur(current.principal)} principal` : undefined} />
        <Stat label="Expected IRR ponderada" value={fmtPct(weightedIrr, 1)} hint="por principal pendiente, contratos vivos" />
        <Stat label="Loss rate acumulado" value={fmtPct(current?.cumulativeLossRate)} hint={current ? `default acumulado ${fmtEur(current.cumulativeDefaults)}` : undefined} />
      </div>

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

        <Card title="Cobros previstos" subtitle="Próximos 6 meses, cartera firmada" action={<Link href="/portfolio" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-mint-400">Waterfall <ArrowRight className="h-3 w-3" aria-hidden /></Link>} bodyClassName="p-0">
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
              {next6.map((m) => (
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
