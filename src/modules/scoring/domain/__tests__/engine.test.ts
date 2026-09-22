import { describe, expect, it } from "vitest";
import { DEFAULT_CRITERIA } from "../criteria";
import { computeRatios, ratingForRatio, scoreCompany, sumOfWeights } from "../engine";
import { EMPTY_FINANCIALS, type Financials } from "../financials";

// NICTON PLUS SL - the mockup's reference dataset.
const nicton: Financials = {
  ...EMPTY_FINANCIALS,
  cif: "B65944837", name: "NICTON PLUS SL.", sector: "Professional services", maturityYears: 13,
  totalRevenue: 2350082.75, grossMargin: 1643278.03, ebitda: 21114.47, netResult: 906.09,
  nonCurrentAssets: 32442.67, currentAssets: 832186.85, equity: 368376.18,
  nonCurrentLiabilities: 199040.1, currentLiabilities: 297213.24,
  receivables: 832186.85, payables: 297213.24, procurement: 706804.72, adjustedEbitda: 21114.47,
};

describe("scoring engine", () => {
  it("weights sum to 1", () => {
    expect(sumOfWeights(DEFAULT_CRITERIA)).toBeCloseTo(1, 12);
  });

  it("computes the balance-sheet ratios", () => {
    const r = computeRatios(nicton);
    expect(r.guarantee).toBeCloseTo(864629.52 / 496253.34, 10);
    expect(r.solvency).toBeCloseTo(832186.85 / 297213.24, 10);
    expect(r.indebtedness).toBeCloseTo(496253.34 / 368376.18, 10);
  });

  it("rates tiers with the right direction", () => {
    const { guarantee, indebtedness } = DEFAULT_CRITERIA.ratios;
    expect(ratingForRatio(2.3, guarantee)).toBe("A");
    expect(ratingForRatio(0.4, guarantee)).toBe("C");
    expect(ratingForRatio(0.5, indebtedness)).toBe("A");
    expect(ratingForRatio(null, indebtedness)).toBe("C");
  });

  it("scores NICTON consistently with its breakdown", () => {
    const res = scoreCompany(nicton, DEFAULT_CRITERIA);
    const sum = Object.values(res.breakdown).reduce((a, b) => a + b.contribution, 0);
    expect(res.totalScore).toBeCloseTo(sum, 12);
    expect(res.breakdown.sectorialRisk.rating).toBe("BBB");
    expect(res.creditOpinion).toBeCloseTo(21114.47 * res.prudence, 8);
    expect(["auto", "limited", "manual", "reject"]).toContain(res.decision);
  });

  it("an empty company rates C and is rejected", () => {
    const res = scoreCompany({ ...EMPTY_FINANCIALS, sector: "Agriculture and fishing" }, DEFAULT_CRITERIA);
    expect(res.rating).toBe("C");
    expect(res.decision).toBe("reject");
  });
});
