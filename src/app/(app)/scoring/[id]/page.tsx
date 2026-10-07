import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { can } from "@/lib/auth/permissions";
import { dataScopeFor } from "@/lib/auth/scope";
import { fmtDate, fmtEur, fmtNum } from "@/lib/format";
import { requireRole } from "@/lib/supabase/auth";
import { DecisionBadge, RatingBadge, ScoringStatusBadge } from "@/modules/scoring/components/badges";
import { ReviewForm } from "@/modules/scoring/components/review-form";
import { ScoreBreakdown } from "@/modules/scoring/components/score-breakdown";
import { getScoring } from "@/modules/scoring/data";
import { breakdownRows } from "@/modules/scoring/domain/preview";

export default async function ScoringDetailPage({ params }: PageProps<"/scoring/[id]">) {
  const user = await requireRole("scoring.view");
  const { id } = await params;
  const scoring = await getScoring(id, dataScopeFor(user));
  if (!scoring) notFound();
  const f = scoring.financials;
  const t = await getTranslations("scoring.detail");
  // The weight and the per-rating score are the model: Tecfys staff see them, a partner never does.
  const rows = breakdownRows(scoring.breakdown, { withModel: can(user.role, "scoringModel.viewBreakdown") });

  return (
    <>
      <PageHeader
        title={scoring.company?.name ?? t("fallbackTitle")}
        description={
          <>
            <span className="num">{scoring.company?.cif}</span> · {f.sector ?? t("noSector")} · {t("scoringOf", { date: fmtDate(scoring.created_at) })}
            {scoring.report?.file_name && <> · {scoring.report.file_name}</>}
          </>
        }
        actions={
          scoring.status === "approved" && (
            <ButtonLink href={`/contracts/new?scoringId=${scoring.id}`}>
              {t("createOperation")} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          )
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Stat label={t("score")} value={`${fmtNum(Number(scoring.total_score), 2)} / 10`} />
        <div className="rounded-xl border border-ink-700 bg-ink-900 px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{t("rating")}</div>
          <div className="mt-2 flex items-center gap-3">
            <RatingBadge rating={scoring.rating} large />
            <DecisionBadge decision={scoring.decision} />
          </div>
        </div>
        <Stat label={t("creditOpinion")} value={fmtEur(Number(scoring.credit_opinion))} hint={t("creditOpinionHint", { prudence: fmtNum(Number(scoring.prudence) * 100, 0) })} accent />
        <div className="rounded-xl border border-ink-700 bg-ink-900 px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{t("status")}</div>
          <div className="mt-3"><ScoringStatusBadge status={scoring.status} /></div>
          {scoring.review_note && <p className="mt-2 text-xs text-slate-400">“{scoring.review_note}”</p>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card title={t("breakdown")}>
          <ScoreBreakdown rows={rows} />
        </Card>
        <div className="space-y-6">
          {scoring.status === "pending_review" &&
            (can(user.role, "scoring.review") ? (
              <Card title={t("reviewTitle")} subtitle={t("reviewSubtitle")}>
                <ReviewForm scoringId={scoring.id} />
              </Card>
            ) : (
              <Alert tone="warning" title={t("pendingTitle")}>{t("pendingBody")}</Alert>
            ))}
          {scoring.status === "rejected" && (
            <Alert tone="error" title={t("rejectedTitle")}>{t("rejectedBody")}</Alert>
          )}
          <Card title={t("informaTitle")}>
            <dl className="space-y-2 text-sm">
              {[
                [t("informaRating"), f.informaRating],
                [t("informaCreditOpinion"), f.creditOpinionInforma !== null ? fmtEur(f.creditOpinionInforma) : null],
                [t("liquidityScore"), f.scoreLiquidez],
                [t("resilience"), f.resilience],
                [t("referenceYear"), f.referenceYear],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-4">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="num text-right">{value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title={t("figuresTitle")}>
            <dl className="space-y-2 text-sm">
              {[
                [t("revenue"), f.totalRevenue],
                [t("ebitda"), f.ebitda],
                [t("netResult"), f.netResult],
                [t("equity"), f.equity],
                [t("totalLiabilities"), (f.currentLiabilities ?? 0) + (f.nonCurrentLiabilities ?? 0)],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-4">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="num">{fmtEur(value as number | null)}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <p className="text-xs text-slate-500">
            <Link href="/scoring" className="hover:text-mint-400">{t("backToList")}</Link>
          </p>
        </div>
      </div>
    </>
  );
}
