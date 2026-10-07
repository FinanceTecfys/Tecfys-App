import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, Td, Th } from "@/components/ui/table";
import { dataScopeFor } from "@/lib/auth/scope";
import { fmtDate, fmtEur, fmtMonthKey, fmtPct } from "@/lib/format";
import { requireRole } from "@/lib/supabase/auth";
import { WorkflowBadge } from "@/modules/contracts/components/badges";
import { listPipeline, loadLoanBook } from "@/modules/contracts/data";
import { asOfForMonth, type LoanBookQuery, loanBookSearch, toLoanBookRow } from "@/modules/contracts/domain/loan-book-view";
import { monthKeyOfDate } from "@/modules/contracts/domain/month-key";
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
  type AggregateSlice,
  defaultDrillDownQuery,
  defaultSeries,
  type DrillDimension,
  drillDownQuery,
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
  const scope = dataScopeFor(await requireRole("dashboard.view"));
  const sp = await searchParams;
  const t = await getTranslations("dashboard");
  const tCommon = await getTranslations("common");
  const now = new Date();
  const period = resolvePeriod({ preset: str(sp.preset), from: str(sp.from), to: str(sp.to) }, now);

  // Point-in-time figures are read at the end of the selected period, never
  // beyond today: the same as-of convention the loan book and waterfall use.
  const asOf = asOfForMonth(period.toInput, now);
  // Drill-downs read the loan book as of the same date, so the rows reconcile with the segment.
  const asof = period.toKey < monthKeyOfDate(now) ? period.toInput : undefined;
  const loanBookHref = (query: LoanBookQuery) => `/contracts?${loanBookSearch({ ...query, asof })}`;
  const drill = (dimension: DrillDimension, slices: AggregateSlice[]) =>
    slices.map((s) => ({ ...s, href: loanBookHref(drillDownQuery(dimension, s)) }));

  const [book, scorings, pipeline] = await Promise.all([loadLoanBook({ asOf }), listScorings(scope, { limit: 6 }), listPipeline(scope)]);
  const rows = book.map(toLoanBookRow);
  const months = buildPortfolio(book.map((c) => c.schedule));
  const current = months.find((m) => m.key === period.toKey);

  const topClients = drill("client", topClientsByOutstanding(rows, 20));
  const buckets = drill("size", outstandingByLoanSize(rows));
  // The placeholder slices ("not reported", "others") are named in the user's language.
  const groupText = { emptyLabel: tCommon("noValue"), otherLabel: tCommon("others") };
  const byAsset = drill("assetCluster", groupOutstanding(rows, "assetCluster", groupText));
  const byCountry = drill("country", groupOutstanding(rows, "country", groupText));
  const byPartner = drill("distributor", groupOutstanding(rows, "distributor", groupText));
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
        description={t("description", { date: fmtDate(asOf.toISOString()), period: t(`period.${period.preset}`).toLowerCase(), from: fmtMonthKey(period.fromKey), to: fmtMonthKey(period.toKey) })}
        actions={
          <ButtonLink href="/scoring/new">
            <Plus className="h-4 w-4" aria-hidden /> {t("newScoring")}
          </ButtonLink>
        }
      />

      <div className="mb-6"><PeriodSelector period={period} /></div>

      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("kpi.outstanding")} value={fmtEur(outstanding)} hint={t("kpi.liveContracts", { count: live.toLocaleString("es-ES") })} accent />
        <Stat label={t("kpi.irr")} value={fmtPct(current?.weightedAnnualIrr, 1)} hint={t("kpi.irrHint")} />
        <Stat label={t("kpi.periodDefault")} value={fmtEur(periodDefaults)} hint={current ? t("kpi.cumulative", { amount: fmtEur(current.cumulativeDefaults) }) : undefined} />
        <Stat label={t("kpi.top5")} value={fmtPct(top5Share, 1)} hint={t("kpi.top5Hint")} />
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-mint-500/80">{t("sections.concentration")}</h2>
      <div className="mb-8 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card title={t("charts.topClients")} subtitle={t("charts.topClientsSubtitle", { month: fmtMonthKey(period.toKey), share: fmtPct(top5Share, 1) })}>
          <RankedBarChart data={topClients} />
        </Card>
        <div className="space-y-6">
          <Card title={t("charts.bySize")} subtitle={t("charts.bySizeSubtitle")}>
            <BucketBarChart data={buckets} />
          </Card>
          <Card title={t("charts.byAsset")}>
            <DonutChart data={byAsset} total={outstanding} />
          </Card>
        </div>
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-mint-500/80">{t("sections.distribution")}</h2>
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card title={t("charts.byCountry")}>
          <DonutChart data={byCountry} total={outstanding} />
        </Card>
        <Card title={t("charts.byPartner")}>
          <DonutChart data={byPartner} total={outstanding} />
        </Card>
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-mint-500/80">{t("sections.monthly")}</h2>
      <div className="mb-8 grid gap-6 xl:grid-cols-2">
        <Card title={t("charts.irr")} subtitle={t("charts.irrSubtitle")}>
          <MonthlyLineChart data={irr.map((p) => ({ label: p.label, value: p.annualIrr }))} format="percent" />
        </Card>
        <Card title={t("charts.lossRate")} subtitle={t("charts.lossRateSubtitle")}>
          <MonthlyLineChart data={defaults.map((p) => ({ label: p.label, value: p.cumulativeLossRate }))} format="percent" tone="loss" />
        </Card>
        <Card title={t("charts.monthlyDefault")} subtitle={t("charts.monthlyDefaultSubtitle")} className="xl:col-span-2">
          <MonthlyBarChart data={defaults.map((p) => ({ label: p.label, value: p.defaults, href: loanBookHref(defaultDrillDownQuery(p.key)) }))} />
        </Card>
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-mint-500/80">{t("sections.activity")}</h2>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title={t("activity.lastScorings")} action={<Link href="/scoring" className="text-xs text-slate-400 hover:text-mint-400">{t("activity.viewAll")}</Link>} bodyClassName="p-0">
          {scorings.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-400">{t("activity.noScorings")}</p>
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

        <Card title={t("activity.signingPipeline")} subtitle={t("activity.signingPipelineSubtitle")} bodyClassName="p-0">
          {pipeline.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-400">{t("activity.noPending")}</p>
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
          title={t("activity.expected")}
          subtitle={t("activity.expectedSubtitle")}
          action={<Link href="/portfolio" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-mint-400">Waterfall <ArrowRight className="h-3 w-3" aria-hidden /></Link>}
          bodyClassName="p-0"
        >
          <Table>
            <thead>
              <tr>
                <Th>{t("activity.month")}</Th>
                <Th right>{t("activity.installments")}</Th>
                <Th right>{t("activity.interest")}</Th>
                <Th right>{t("activity.principal")}</Th>
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
