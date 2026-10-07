import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getTranslate } from "@/i18n/server";
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
  const t = await getTranslations("pipeline");
  const tCommon = await getTranslations("common");
  const translate = await getTranslate();
  const now = new Date();

  const { scorings, contracts, users } = await loadPipeline();
  const all = buildPipelineRows(scorings, contracts, users, { noPartner: t("text.noPartner"), deletedUser: t("text.deletedUser"), userWithoutEmail: t("text.userWithoutEmail") });
  const options = pipelineFilterOptions(all);
  const rows = filterPipeline(all, query);
  const filtering = hasPipelineFilters(query);

  const totals = pipelineTotals(rows);
  const partners = activityByPartner(rows);
  const byPartner = scoringsByPartner(rows).map((s) => ({ ...s, href: `/pipeline?${pipelineSearch(query, { partner: s.key, page: 1 })}` }));
  const byStatus = scoringsByStatus(rows).map((s) => ({
    ...s,
    label: t(`statusLabels.${s.key as ScoringStatus}`),
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
        description={t("description")}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat interactive label={t("kpi.scorings")} value={int(totals.scorings)} hint={t("kpi.pendingReview", { count: int(totals.pendingReview) })} accent />
        <Stat interactive label={t("kpi.approvalRate")} value={fmtPct(totals.approvalRate, 1)} hint={t("kpi.approvalHint", { approved: int(totals.approved), rate: fmtPct(totals.rejectionRate, 1), rejected: int(totals.rejected) })} />
        <Stat interactive label={t("kpi.operations")} value={int(totals.operations)} hint={t("kpi.operationsHint", { signed: int(totals.signed), rate: fmtPct(totals.conversionRate, 0) })} />
        <Stat interactive label={t("kpi.activePartners")} value={int(activePartners(rows, now, ACTIVE_DAYS))} hint={t("kpi.activeHint", { days: ACTIVE_DAYS })} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card title={t("charts.byPartner")} subtitle={t("charts.byPartnerSubtitle")}>
          <RankedBarChart data={byPartner} unit="count" measure={t("charts.measure")} height={Math.max(160, byPartner.length * 30 + 40)} />
        </Card>
        <Card title={t("charts.byStatus")} subtitle={t("charts.byStatusSubtitle")}>
          <DonutChart data={byStatus} total={totals.scorings} unit="count" centerLabel={t("charts.center")} />
        </Card>
        <Card title={t("charts.recent")} subtitle={t("charts.recentSubtitle", { weeks: WEEKS })}>
          <MonthlyBarChart data={weekly.map((w) => ({ label: w.label, value: w.scorings }))} unit="count" measure={t("charts.weekMeasure")} tone="neutral" height={210} />
        </Card>
      </div>

      <Card title={t("summary.title")} className="mb-6" bodyClassName="p-0">
        {partners.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">{t("summary.empty")}</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <thead>
                <tr>
                  <Th>{t("summary.partner")}</Th>
                  <Th right>{t("summary.scorings")}</Th>
                  <Th right>{t("summary.approved")}</Th>
                  <Th right>{t("summary.review")}</Th>
                  <Th right>{t("summary.rejected")}</Th>
                  <Th right>{t("summary.approvalRate")}</Th>
                  <Th right>{t("summary.operations")}</Th>
                  <Th right>{t("summary.signed")}</Th>
                  <Th>{t("summary.lastActivity")}</Th>
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
          summary={<span>{t("filters.records", { count: rows.length })}</span>}
          actions={
            <>
              {filtering && <Link href="/pipeline" className="text-xs text-slate-400 hover:text-mint-400">{tCommon("actions.clearFilters")}</Link>}
              <button className={filterSubmitClass}>{tCommon("actions.apply")}</button>
            </>
          }
        >
          <FilterCell wide>
            <input name="q" defaultValue={query.q} placeholder={t("filters.searchPlaceholder")} className={inputClass} aria-label={t("filters.search")} />
          </FilterCell>
          <FilterCell wide>
            <select name="partner" defaultValue={query.partner ?? ""} className={inputClass} aria-label={t("filters.partner")}>
              <option value="">{t("filters.allPartners")}</option>
              {options.partner.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FilterCell>
          <FilterCell>
            <select name="distributor" defaultValue={query.distributor ?? ""} className={inputClass} aria-label={t("filters.distributor")}>
              <option value="">{t("filters.allDistributors")}</option>
              {options.distributor.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FilterCell>
          <FilterCell>
            <select name="status" defaultValue={query.status ?? ""} className={inputClass} aria-label={t("filters.status")}>
              <option value="">{t("filters.allStatuses")}</option>
              {SCORING_STATUSES.map((s) => <option key={s} value={s}>{t(`statusLabels.${s}`)}</option>)}
            </select>
          </FilterCell>
        </FilterBar>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">{filtering ? t("table.noMatch") : t("table.empty")}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("table.date")}</Th>
                <Th>{t("table.partner")}</Th>
                <Th>{t("table.company")}</Th>
                <Th>{t("table.sector")}</Th>
                <Th right>{t("table.score")}</Th>
                <Th>{t("table.rating")}</Th>
                <Th>{t("table.status")}</Th>
                <Th>{t("table.operation")}</Th>
                <Th>{t("table.lifecycle")}</Th>
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
                    <span className={`mt-1 block text-xs ${r.lifecycle.outcome === "rejected" || r.lifecycle.outcome === "cancelled" ? "text-red-300" : "text-slate-400"}`}>{translate(r.lifecycle.label)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <nav className="flex items-center justify-between p-4 text-sm text-slate-400" aria-label={tCommon("pagination.ariaLabel")}>
          <span>{tCommon("pagination.pageOf", { page, pages })}</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={pageHref(page - 1)} className="rounded-md border border-ink-600 px-3 py-1 hover:border-mint-500/60">{tCommon("pagination.previousShort")}</Link>}
            {page < pages && <Link href={pageHref(page + 1)} className="rounded-md border border-ink-600 px-3 py-1 hover:border-mint-500/60">{tCommon("pagination.nextShort")}</Link>}
          </div>
        </nav>
      </Card>
    </>
  );
}
