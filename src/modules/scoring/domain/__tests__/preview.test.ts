import { describe, expect, it } from "vitest";
import { DEFAULT_CRITERIA, type ScoringCriteria } from "../criteria";
import { scoreCompany } from "../engine";
import { EMPTY_FINANCIALS, type Financials, previewFinancialsSchema } from "../financials";
import { breakdownRows, previewScore, sectorNames, toScoringPreview } from "../preview";

const company = (over: Partial<Financials> = {}): Financials => ({
  ...EMPTY_FINANCIALS,
  cif: "B12345678", name: "Alfa SL", sector: "Information technology", maturityYears: 12,
  totalRevenue: 2_000_000, grossMargin: 900_000, procurement: 1_100_000, ebitda: 300_000, netResult: 150_000,
  nonCurrentAssets: 800_000, currentAssets: 700_000, equity: 900_000, nonCurrentLiabilities: 250_000, currentLiabilities: 350_000,
  receivables: 300_000, payables: 180_000,
  ...over,
});

const CASES: [string, Financials][] = [
  ["a healthy company", company()],
  ["the empty form", EMPTY_FINANCIALS],
  ["a weak company", company({ netResult: -200_000, equity: 50_000, currentLiabilities: 900_000, sector: "Catering", maturityYears: 1 })],
  ["no sector, adjusted EBITDA", company({ sector: null, adjustedEbitda: 420_000 })],
  ["negative EBITDA", company({ ebitda: -50_000 })],
];

/** Every key anywhere inside a value. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      keysOf(v, into);
    }
  }
  return into;
}

/** The names under which the model configuration travels. */
const MODEL_KEYS = ["weight", "weights", "ratingScore", "tiers", "scoreTable", "scoreBuckets", "decisionRules", "sectorRating", "ratios", "direction", "breakdown", "criteria", "config"];

describe("toScoringPreview carries the outcome, never the model", () => {
  it.each(CASES)("%s: only result fields, row by row", (_name, financials) => {
    const preview = previewScore(financials, DEFAULT_CRITERIA);
    expect(Object.keys(preview).sort()).toEqual(["adjustedEbitda", "creditOpinion", "decision", "prudence", "rating", "rows", "totalScore"]);
    expect(preview.rows).toHaveLength(Object.keys(DEFAULT_CRITERIA.ratios).length);
    for (const row of preview.rows) expect(Object.keys(row).sort()).toEqual(["contribution", "formula", "key", "label", "rating", "value"]);
    const keys = keysOf(preview);
    for (const forbidden of MODEL_KEYS) expect(keys.has(forbidden), forbidden).toBe(false);
  });

  it("holds no table of the model: the prudence and the decision are the single values of the rating reached", () => {
    const preview = previewScore(company(), DEFAULT_CRITERIA);
    expect(typeof preview.prudence).toBe("number");
    expect(typeof preview.decision).toBe("string");
    // No [rating, threshold] pairs, no per-rating records.
    const json = JSON.stringify(preview);
    expect(json).not.toMatch(/\[\s*"(AAA|AA|A|BBB|BB|CCC|CC|C)"\s*,/);
    expect(json).not.toMatch(/"AAA"\s*:/);
    for (const sector of Object.keys(DEFAULT_CRITERIA.sectorRating)) {
      if (sector !== company().sector) expect(json, sector).not.toContain(sector);
    }
  });

  it("does not let extra fields of the engine result through", () => {
    const result = scoreCompany(company(), DEFAULT_CRITERIA);
    const tainted = { ...result, criteria: DEFAULT_CRITERIA, breakdown: Object.fromEntries(Object.entries(result.breakdown).map(([k, r]) => [k, { ...r, tiers: [["AAA", 1]] }])) };
    const keys = keysOf(toScoringPreview(tainted as unknown as typeof result));
    for (const forbidden of MODEL_KEYS) expect(keys.has(forbidden), forbidden).toBe(false);
  });
});

describe("the preview is the authoritative computation", () => {
  it.each(CASES)("%s: same totals, ratings and contributions as scoreCompany", (_name, financials) => {
    const result = scoreCompany(financials, DEFAULT_CRITERIA);
    const preview = previewScore(financials, DEFAULT_CRITERIA);
    expect(preview).toMatchObject({
      totalScore: result.totalScore, rating: result.rating, decision: result.decision,
      prudence: result.prudence, adjustedEbitda: result.adjustedEbitda, creditOpinion: result.creditOpinion,
    });
    for (const row of preview.rows) {
      const r = result.breakdown[row.key];
      expect(row).toEqual({ key: row.key, label: r.label, formula: r.formula, value: r.value, rating: r.rating, contribution: r.contribution });
    }
    expect(preview.rows.reduce((sum, row) => sum + row.contribution, 0)).toBeCloseTo(result.totalScore, 10);
  });

  it("follows the model it is given, not a copy of the default one", () => {
    const strict: ScoringCriteria = { ...DEFAULT_CRITERIA, decisionRules: { ...DEFAULT_CRITERIA.decisionRules, AAA: "manual", AA: "manual", A: "manual" }, prudence: { ...DEFAULT_CRITERIA.prudence, A: 0.01, AA: 0.01, AAA: 0.01 } };
    const base = previewScore(company(), DEFAULT_CRITERIA);
    const changed = previewScore(company(), strict);
    expect(changed.totalScore).toBe(base.totalScore);
    expect(["AAA", "AA", "A"]).toContain(base.rating);
    expect(changed.decision).toBe("manual");
    expect(changed.prudence).toBe(0.01);
  });
});

describe("breakdownRows", () => {
  const result = scoreCompany(company(), DEFAULT_CRITERIA);

  it("orders the ratios heaviest first, as the table always did", () => {
    const rows = breakdownRows(result.breakdown, { withModel: true });
    const weights = rows.map((r) => r.weight!);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
    expect(rows[0].key).toBe("guarantee");
  });

  it("adds the weight and the rating score only when the model may be shown", () => {
    const withModel = breakdownRows(result.breakdown, { withModel: true });
    const without = breakdownRows(result.breakdown, { withModel: false });
    expect(withModel.every((r) => r.weight !== undefined && r.ratingScore !== undefined)).toBe(true);
    expect(without.every((r) => !("weight" in r) && !("ratingScore" in r))).toBe(true);
    expect(without.map((r) => [r.key, r.rating, r.contribution])).toEqual(withModel.map((r) => [r.key, r.rating, r.contribution]));
  });
});

describe("what the wizard is given besides results", () => {
  it("sector names only, sorted, without the rating of each", () => {
    const names = sectorNames(DEFAULT_CRITERIA);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("Information technology");
    expect(names.every((n) => typeof n === "string")).toBe(true);
    expect(names).toHaveLength(Object.keys(DEFAULT_CRITERIA.sectorRating).length);
  });

  it("the preview accepts the form before the CIF and the name are typed, the final scoring does not", () => {
    expect(previewFinancialsSchema.safeParse(EMPTY_FINANCIALS).success).toBe(true);
    expect(previewFinancialsSchema.safeParse({ ...EMPTY_FINANCIALS, totalRevenue: Number.NaN }).success).toBe(false);
    expect(previewFinancialsSchema.safeParse({ ...EMPTY_FINANCIALS, totalRevenue: "1000" }).success).toBe(false);
  });
});
