/**
 * What a scoring shows the analyst, without the model behind it.
 *
 * The engine's result carries, per ratio, the weight and the score the model
 * assigns to the rating reached: pieces of the confidential configuration. The
 * preview keeps only the outcome - the value, the rating and what the ratio
 * contributes - plus the totals, and is the ONLY shape of a scoring that is
 * sent to the browser while the analyst fills the form. Pure, so the server
 * action that returns it and the authoritative createScoring provably agree.
 */
import type { ScoringCriteria } from "./criteria";
import { type RatioResult, scoreCompany, type ScoringResult } from "./engine";
import type { Financials } from "./financials";
import type { Decision, Rating, RatioKey } from "./ratings";

export interface BreakdownRow {
  key: RatioKey;
  label: string;
  formula: string;
  value: number | string | null;
  rating: Rating;
  contribution: number;
  /** Model internals: only present for the roles allowed to see the model. */
  ratingScore?: number;
  weight?: number;
}

/** A breakdown row with the model internals guaranteed absent. */
export type PreviewRow = Omit<BreakdownRow, "ratingScore" | "weight">;

export interface ScoringPreview {
  rows: PreviewRow[];
  totalScore: number;
  rating: Rating;
  decision: Decision;
  prudence: number;
  adjustedEbitda: number;
  creditOpinion: number;
}

/**
 * The breakdown as table rows, heaviest ratio first. `withModel` adds the
 * weight and the per-rating score; without it each row is built field by
 * field, so nothing else of the engine's result can slip through.
 */
export function breakdownRows(breakdown: Record<RatioKey, RatioResult>, { withModel }: { withModel: boolean }): BreakdownRow[] {
  return (Object.entries(breakdown) as [RatioKey, RatioResult][])
    .sort((a, b) => b[1].weight - a[1].weight)
    .map(([key, r]) => {
      const row: BreakdownRow = { key, label: r.label, formula: r.formula, value: r.value, rating: r.rating, contribution: r.contribution };
      return withModel ? { ...row, ratingScore: r.ratingScore, weight: r.weight } : row;
    });
}

export function toScoringPreview(result: ScoringResult): ScoringPreview {
  return {
    rows: breakdownRows(result.breakdown, { withModel: false }),
    totalScore: result.totalScore,
    rating: result.rating,
    decision: result.decision,
    prudence: result.prudence,
    adjustedEbitda: result.adjustedEbitda,
    creditOpinion: result.creditOpinion,
  };
}

/** Score with the same engine as createScoring and keep only what the analyst sees. */
export const previewScore = (financials: Financials, criteria: ScoringCriteria): ScoringPreview =>
  toScoringPreview(scoreCompany(financials, criteria));

/** The sectors the form offers: names only, never the rating the model gives each. */
export const sectorNames = (criteria: ScoringCriteria): string[] => Object.keys(criteria.sectorRating).sort();
