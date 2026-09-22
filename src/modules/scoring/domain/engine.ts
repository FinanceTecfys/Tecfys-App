import type { Decision, Rating, RatioKey, ScoringCriteria, RatioDefinition } from "./criteria";
import type { Financials } from "./financials";

export type Ratios = Record<Exclude<RatioKey, "sectorialRisk">, number | null>;

export interface RatioResult {
  value: number | string | null;
  rating: Rating;
  ratingScore: number;
  weight: number;
  contribution: number;
  label: string;
  formula: string;
}

export interface ScoringResult {
  ratios: Ratios;
  breakdown: Record<RatioKey, RatioResult>;
  totalScore: number;
  rating: Rating;
  decision: Decision;
  prudence: number;
  adjustedEbitda: number;
  creditOpinion: number;
}

export function computeRatios(f: Financials): Ratios {
  const totalLiabilities = (f.nonCurrentLiabilities ?? 0) + (f.currentLiabilities ?? 0);
  const totalAssets = (f.nonCurrentAssets ?? 0) + (f.currentAssets ?? 0);
  const procurement = f.procurement ?? (f.totalRevenue ? f.totalRevenue - (f.grossMargin ?? 0) : 0);
  const pos = (x: number | null | undefined): x is number => x != null && x > 0;
  return {
    guarantee: totalLiabilities > 0 ? totalAssets / totalLiabilities : null,
    solvency: pos(f.currentLiabilities) && f.currentAssets != null ? f.currentAssets / f.currentLiabilities : null,
    indebtedness: pos(f.equity) ? totalLiabilities / f.equity : null,
    netMargin: pos(f.totalRevenue) && f.netResult != null ? f.netResult / f.totalRevenue : null,
    maturity: f.maturityYears ?? null,
    economicProfit: totalAssets > 0 && f.netResult != null ? f.netResult / totalAssets : null,
    financialProfit: pos(f.equity) && f.netResult != null ? f.netResult / f.equity : null,
    paymentPeriod: procurement > 0 && f.payables != null ? (f.payables / procurement) * 365 : null,
    collectionPeriod: pos(f.totalRevenue) && f.receivables != null ? (f.receivables / f.totalRevenue) * 365 : null,
  };
}

/** A missing ratio rates C: the model penalises what cannot be evidenced. */
export function ratingForRatio(value: number | null, def: RatioDefinition): Rating {
  if (value === null || Number.isNaN(value)) return "C";
  if (def.direction === "higher") {
    for (const [r, t] of def.tiers) if (value >= t) return r;
  } else if (def.direction === "lower") {
    for (const [r, t] of def.tiers) if (value <= t) return r;
  }
  return "C";
}

export function ratingFromScore(score: number, buckets: ScoringCriteria["scoreBuckets"]): Rating {
  for (const [r, lower] of buckets) if (score >= lower) return r;
  return "C";
}

export function scoreCompany(financials: Financials, criteria: ScoringCriteria): ScoringResult {
  const ratios = computeRatios(financials);
  const breakdown = {} as Record<RatioKey, RatioResult>;
  let total = 0;

  for (const [key, def] of Object.entries(criteria.ratios) as [RatioKey, RatioDefinition][]) {
    const weight = criteria.weights[key] ?? 0;
    let rating: Rating;
    let value: number | string | null;
    if (key === "sectorialRisk") {
      rating = (financials.sector && criteria.sectorRating[financials.sector]) || "BBB";
      value = financials.sector ?? null;
    } else {
      value = ratios[key];
      rating = ratingForRatio(value, def);
    }
    const ratingScore = def.scoreTable[rating] ?? 1;
    const contribution = ratingScore * weight;
    total += contribution;
    breakdown[key] = { value, rating, ratingScore, weight, contribution, label: def.label, formula: def.formula };
  }

  const rating = ratingFromScore(total, criteria.scoreBuckets);
  const prudence = criteria.prudence[rating] ?? 0.1;
  const adjustedEbitda = financials.adjustedEbitda ?? financials.ebitda ?? 0;
  return {
    ratios,
    breakdown,
    totalScore: total,
    rating,
    decision: criteria.decisionRules[rating] ?? "reject",
    prudence,
    adjustedEbitda,
    creditOpinion: Math.max(0, adjustedEbitda * prudence),
  };
}

export const sumOfWeights = (criteria: ScoringCriteria) =>
  Object.values(criteria.weights).reduce((a, b) => a + b, 0);
