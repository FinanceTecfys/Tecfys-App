import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { fmtDate, fmtEur, fmtNum } from "@/lib/format";
import { DecisionBadge, RatingBadge, ScoringStatusBadge } from "@/modules/scoring/components/badges";
import { ReviewForm } from "@/modules/scoring/components/review-form";
import { ScoreBreakdown } from "@/modules/scoring/components/score-breakdown";
import { getScoring } from "@/modules/scoring/data";

export default async function ScoringDetailPage({ params }: PageProps<"/scoring/[id]">) {
  const { id } = await params;
  const scoring = await getScoring(id);
  if (!scoring) notFound();
  const f = scoring.financials;

  return (
    <>
      <PageHeader
        title={scoring.company?.name ?? "Scoring"}
        description={
          <>
            <span className="num">{scoring.company?.cif}</span> · {f.sector ?? "sector sin informar"} · scoring del{" "}
            {fmtDate(scoring.created_at)}
            {scoring.report?.file_name && <> · {scoring.report.file_name}</>}
          </>
        }
        actions={
          scoring.status === "approved" && (
            <ButtonLink href={`/contracts/new?scoringId=${scoring.id}`}>
              Crear operación <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          )
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Stat label="Puntuación" value={`${fmtNum(Number(scoring.total_score), 2)} / 10`} />
        <div className="rounded-xl border border-ink-700 bg-ink-900 px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Rating</div>
          <div className="mt-2 flex items-center gap-3">
            <RatingBadge rating={scoring.rating} large />
            <DecisionBadge decision={scoring.decision} />
          </div>
        </div>
        <Stat label="Opinión de crédito" value={fmtEur(Number(scoring.credit_opinion))} hint={`EBITDA ajustado × ${fmtNum(Number(scoring.prudence) * 100, 0)} %`} accent />
        <div className="rounded-xl border border-ink-700 bg-ink-900 px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Estado</div>
          <div className="mt-3"><ScoringStatusBadge status={scoring.status} /></div>
          {scoring.review_note && <p className="mt-2 text-xs text-slate-400">“{scoring.review_note}”</p>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card title="Desglose del scoring">
          <ScoreBreakdown breakdown={scoring.breakdown} />
        </Card>
        <div className="space-y-6">
          {scoring.status === "pending_review" && (
            <Card title="Revisión manual" subtitle="El rating exige decisión del comité">
              <ReviewForm scoringId={scoring.id} />
            </Card>
          )}
          {scoring.status === "rejected" && (
            <Alert tone="error" title="Scoring rechazado">No se puede originar una operación para este cliente con este scoring.</Alert>
          )}
          <Card title="Indicadores Informa">
            <dl className="space-y-2 text-sm">
              {[
                ["Nota Informa", f.informaRating],
                ["Opinión de crédito Informa", f.creditOpinionInforma !== null ? fmtEur(f.creditOpinionInforma) : null],
                ["Score liquidez", f.scoreLiquidez],
                ["Resiliencia", f.resilience],
                ["Ejercicio de referencia", f.referenceYear],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-4">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="num text-right">{value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title="Principales magnitudes">
            <dl className="space-y-2 text-sm">
              {[
                ["Ventas", f.totalRevenue],
                ["EBITDA", f.ebitda],
                ["Resultado neto", f.netResult],
                ["Patrimonio neto", f.equity],
                ["Pasivo total", (f.currentLiabilities ?? 0) + (f.nonCurrentLiabilities ?? 0)],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-4">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="num">{fmtEur(value as number | null)}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <p className="text-xs text-slate-500">
            <Link href="/scoring" className="hover:text-mint-400">← Volver al listado</Link>
          </p>
        </div>
      </div>
    </>
  );
}
