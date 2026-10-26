import { useTranslations } from "next-intl";
import { Badge, type Tone } from "@/components/ui/badge";
import type { Decision, Rating } from "../domain/ratings";

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
  const t = useTranslations("scoring.decisions");
  return <Badge tone={DECISION_TONE[decision]} className="uppercase">{t(decision)}</Badge>;
}

const STATUS_TONE = { approved: "mint", pending_review: "orange", rejected: "red" } as const satisfies Record<string, Tone>;
const isStatus = (status: string): status is keyof typeof STATUS_TONE => Object.hasOwn(STATUS_TONE, status);

export function ScoringStatusBadge({ status }: { status: string }) {
  const t = useTranslations("scoring.statuses");
  return isStatus(status) ? <Badge tone={STATUS_TONE[status]}>{t(status)}</Badge> : <Badge tone="slate">{status}</Badge>;
}
