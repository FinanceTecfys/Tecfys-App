/**
 * The vocabulary of a scoring RESULT: ratings, decisions and ratio keys.
 *
 * Nothing of the model lives here - no weights, tiers, score tables, rules or
 * prudence factors (those are in criteria.ts, which is server-side only). This
 * is the module client components import, so the model never rides along in
 * the browser bundle.
 */

export const RATINGS = ["AAA", "AA", "A", "BBB", "BB", "CCC", "CC", "C"] as const;
export type Rating = (typeof RATINGS)[number];

export type Decision = "auto" | "limited" | "manual" | "reject";

export type RatioKey =
  | "guarantee"
  | "solvency"
  | "indebtedness"
  | "netMargin"
  | "sectorialRisk"
  | "maturity"
  | "economicProfit"
  | "financialProfit"
  | "paymentPeriod"
  | "collectionPeriod";

export const DECISION_LABELS: Record<Decision, string> = {
  auto: "Aprobado automático",
  limited: "Aprobado con límites",
  manual: "Revisión manual",
  reject: "Rechazado",
};
