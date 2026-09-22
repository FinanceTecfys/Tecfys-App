/**
 * Tecfys credit scoring model (ported from the scoring mockup, v5).
 *
 * Each ratio is rated AAA..C against its own tiers, the rating is mapped to a
 * per-ratio 1-10 score, and the weighted sum is the final score on a 10-point
 * scale. The final score buckets into a rating, which sets the decision rule
 * and the prudence factor applied to adjusted EBITDA (the credit opinion).
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

export interface RatioDefinition {
  /** higher / lower is better; "rating" = looked up (sector). */
  direction: "higher" | "lower" | "rating";
  label: string;
  formula: string;
  /** [rating, threshold] from best to worst. */
  tiers: [Rating, number][];
  scoreTable: Record<Rating, number>;
}

export interface ScoringCriteria {
  weights: Record<RatioKey, number>;
  ratios: Record<RatioKey, RatioDefinition>;
  /** [rating, lower bound inclusive], best to worst. */
  scoreBuckets: [Rating, number][];
  prudence: Record<Rating, number>;
  decisionRules: Record<Rating, Decision>;
  sectorRating: Record<string, Rating>;
}

const scores = (aaa: number, aa: number, a: number, bbb: number, bb: number, ccc: number, cc: number, c: number): Record<Rating, number> =>
  ({ AAA: aaa, AA: aa, A: a, BBB: bbb, BB: bb, CCC: ccc, CC: cc, C: c });

export const DEFAULT_CRITERIA: ScoringCriteria = {
  weights: {
    guarantee: 0.32, solvency: 0.27, indebtedness: 0.2, netMargin: 0.05,
    sectorialRisk: 0.05, maturity: 0.05, economicProfit: 0.02, financialProfit: 0.02,
    paymentPeriod: 0.01, collectionPeriod: 0.01,
  },
  ratios: {
    guarantee: {
      direction: "higher", label: "Garantía (colateral)", formula: "Activo total / Pasivo total",
      tiers: [["AAA", 60], ["AA", 2.5], ["A", 2.2], ["BBB", 2.0], ["BB", 1.1], ["CCC", 0.9], ["CC", 0.7], ["C", 0.5]],
      scoreTable: scores(10, 9.9, 7, 6, 5, 4, 3, 1),
    },
    solvency: {
      direction: "higher", label: "Solvencia", formula: "Activo corriente / Pasivo corriente",
      tiers: [["AAA", 90], ["AA", 5.0], ["A", 3.5], ["BBB", 2.5], ["BB", 1.5], ["CCC", 1.0], ["CC", 0.7], ["C", 0.5]],
      scoreTable: scores(10, 9.8, 8, 7, 5, 4, 3, 1),
    },
    indebtedness: {
      direction: "lower", label: "Endeudamiento", formula: "Pasivo total / Patrimonio neto",
      tiers: [["AAA", 0.01], ["AA", 0.1], ["A", 0.75], ["BBB", 1.15], ["BB", 2.0], ["CCC", 5.0], ["CC", 10.0], ["C", 60.0]],
      scoreTable: scores(10, 9, 8, 7, 6, 5, 4, 3),
    },
    netMargin: {
      direction: "higher", label: "Margen neto", formula: "Resultado neto / Ventas",
      tiers: [["AAA", 150], ["AA", 0.6], ["A", 0.3], ["BBB", 0.2], ["BB", 0.1], ["CCC", 0.05], ["CC", 0.01], ["C", -0.01]],
      scoreTable: scores(10, 10, 7, 6, 5, 4, 3, 1),
    },
    sectorialRisk: {
      direction: "rating", label: "Riesgo sectorial", formula: "Sector → rating",
      tiers: [],
      scoreTable: scores(10, 8, 7, 6, 5, 4, 3, 1),
    },
    maturity: {
      direction: "higher", label: "Antigüedad (años)", formula: "Años desde la constitución",
      tiers: [["AAA", 102], ["AA", 15], ["A", 10], ["BBB", 8], ["BB", 6], ["CCC", 3], ["CC", 2], ["C", 1]],
      scoreTable: scores(10, 9.5, 8.5, 6, 5, 4, 3, 1),
    },
    economicProfit: {
      direction: "higher", label: "Rentabilidad económica (ROA)", formula: "Resultado neto / Activo total",
      tiers: [["AAA", 3.0], ["AA", 0.6], ["A", 0.3], ["BBB", 0.1], ["BB", 0.05], ["CCC", 0.01], ["CC", -0.05], ["C", -1.0]],
      scoreTable: scores(10, 8, 7, 6, 5, 4, 3, 1),
    },
    financialProfit: {
      direction: "higher", label: "Rentabilidad financiera (ROE)", formula: "Resultado neto / Patrimonio neto",
      tiers: [["AAA", 400], ["AA", 0.7], ["A", 0.6], ["BBB", 0.5], ["BB", 0.3], ["CCC", 0.2], ["CC", -0.05], ["C", -1.0]],
      scoreTable: scores(10, 8, 7, 6, 5, 4, 3, 1),
    },
    paymentPeriod: {
      direction: "lower", label: "Periodo medio de pago (días)", formula: "(Proveedores / Aprovisionamientos) × 365",
      tiers: [["AAA", 0], ["AA", 20], ["A", 60], ["BBB", 70], ["BB", 90], ["CCC", 180], ["CC", 280], ["C", 300]],
      scoreTable: scores(10, 8, 7, 6, 5, 4, 3, 1),
    },
    collectionPeriod: {
      direction: "lower", label: "Periodo medio de cobro (días)", formula: "(Clientes / Ventas) × 365",
      tiers: [["AAA", 0], ["AA", 20], ["A", 60], ["BBB", 70], ["BB", 90], ["CCC", 180], ["CC", 280], ["C", 300]],
      scoreTable: scores(10, 8, 7, 6, 5, 4, 3, 1),
    },
  },
  scoreBuckets: [["AAA", 9.5], ["AA", 8.5], ["A", 7.0], ["BBB", 6.0], ["BB", 5.0], ["CCC", 4.0], ["CC", 3.0], ["C", 0]],
  prudence: { AAA: 0.3, AA: 0.25, A: 0.25, BBB: 0.18, BB: 0.12, CCC: 0.1, CC: 0.08, C: 0.05 },
  decisionRules: { AAA: "auto", AA: "auto", A: "auto", BBB: "limited", BB: "manual", CCC: "reject", CC: "reject", C: "reject" },
  sectorRating: {
    "Pharmaceuticals and biotechnology": "AAA",
    "Information technology": "AAA",
    "Telecommunications": "AA",
    "Renewable energies": "AA",
    "Basic food": "A",
    "Automotive": "BBB",
    "Construction and materials": "BB",
    "Transportation and logistics": "BB",
    "Retail trade": "BB",
    "Professional services": "BBB",
    "Hotels and tourism": "CCC",
    "Textile and fashion": "CCC",
    "Leisure and entertainment": "CCC",
    "Catering": "CCC",
    "Speculative real estate activities": "CC",
    "Agriculture and fishing": "C",
    "Other": "BBB",
  },
};

export const DECISION_LABELS: Record<Decision, string> = {
  auto: "Aprobado automático",
  limited: "Aprobado con límites",
  manual: "Revisión manual",
  reject: "Rechazado",
};
