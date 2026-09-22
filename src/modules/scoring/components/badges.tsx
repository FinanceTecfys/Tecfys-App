import { Badge, type Tone } from "@/components/ui/badge";
import { DECISION_LABELS, type Decision, type Rating } from "../domain/criteria";

const RATING_TONE: Record<Rating, Tone> = {
  AAA: "mint", AA: "mint", A: "emerald", BBB: "yellow", BB: "orange", CCC: "red", CC: "red", C: "red",
};

export function RatingBadge({ rating, large }: { rating: Rating; large?: boolean }) {
  return (
    <Badge tone={RATING_TONE[rating]} className={large ? "num px-4 py-2 text-2xl" : "num"}>
      {rating}
    </Badge>
  );
}

const DECISION_TONE: Record<Decision, Tone> = { auto: "mint", limited: "yellow", manual: "orange", reject: "red" };

export function DecisionBadge({ decision }: { decision: Decision }) {
  return <Badge tone={DECISION_TONE[decision]} className="uppercase">{DECISION_LABELS[decision]}</Badge>;
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  approved: { label: "Aprobado", tone: "mint" },
  pending_review: { label: "Pendiente de revisión", tone: "orange" },
  rejected: { label: "Rechazado", tone: "red" },
};

export function ScoringStatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "slate" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
