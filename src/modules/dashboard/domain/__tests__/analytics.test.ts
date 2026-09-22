import { describe, expect, it } from "vitest";
import type { LoanBookRowView } from "@/modules/contracts/domain/loan-book-view";
import { monthKey } from "@/modules/contracts/domain/month-key";
import { buildPortfolio } from "@/modules/contracts/domain/portfolio";
import { buildSchedule, type ContractInput } from "@/modules/contracts/domain/schedule";
import {
  defaultSeries,
  groupOutstanding,
  irrSeries,
  LOAN_SIZE_BUCKETS,
  monthKeyToInput,
  monthsInPeriod,
  outstandingByLoanSize,
  parseMonthInput,
  resolvePeriod,
  topClientsByOutstanding,
} from "../analytics";

const today = new Date(Date.UTC(2026, 8, 22)); // 22-Sep-2026
const SEP26 = monthKey(2026, 9);

const row = (over: Partial<LoanBookRowView> = {}): LoanBookRowView => ({
  id: "id", contractNumber: "LB-1", loanBookRef: "1", client: "Alfa SL", cif: "B1", country: "ES",
  distributor: "Nicton", assetType: "Laptops", assetCluster: "Laptops", contractType: "Renting",
  signingDate: "2025-01-10", durationMonths: 36, extensionMonths: null, installment: 100, cost: 3000,
  expectedAnnualIrr: 0.2, workflowStatus: "signed", lifecycleStatus: "Active", cancelDate: null,
  additionalStatus: null, settlementAmount: null, outstanding: 1000, defaultAmount: null, ...over,
});

describe("resolvePeriod", () => {
  it("presets end in the current month and span whole months", () => {
    const p12 = resolvePeriod({ preset: "last12" }, today);
    expect([p12.fromKey, p12.toKey]).toEqual([monthKey(2025, 10), SEP26]);
    expect(p12.toKey - p12.fromKey + 1).toBe(12);
    expect([p12.fromInput, p12.toInput]).toEqual(["2025-10", "2026-09"]);

    const p24 = resolvePeriod({ preset: "last24" }, today);
    expect(p24.toKey - p24.fromKey + 1).toBe(24);
    expect(p24.fromKey).toBe(monthKey(2024, 10));
  });

  it("falls back to the 12-month preset for an unknown preset", () => {
    expect(resolvePeriod({ preset: "nope" }, today).preset).toBe("last12");
    expect(resolvePeriod({}, today).preset).toBe("last12");
  });

  it("reads a custom range and repairs inverted or missing bounds", () => {
    const custom = resolvePeriod({ preset: "custom", from: "2024-03", to: "2024-08" }, today);
    expect([custom.fromKey, custom.toKey]).toEqual([monthKey(2024, 3), monthKey(2024, 8)]);

    const inverted = resolvePeriod({ preset: "custom", from: "2024-08", to: "2024-03" }, today);
    expect([inverted.fromKey, inverted.toKey]).toEqual([monthKey(2024, 3), monthKey(2024, 8)]);

    const partial = resolvePeriod({ preset: "custom", from: "2026-01" }, today);
    expect([partial.fromKey, partial.toKey]).toEqual([monthKey(2026, 1), SEP26]);

    const empty = resolvePeriod({ preset: "custom" }, today);
    expect(empty.toKey - empty.fromKey + 1).toBe(12);
  });

  it("round-trips month inputs and rejects malformed ones", () => {
    expect(parseMonthInput("2026-09")).toBe(SEP26);
    expect(monthKeyToInput(SEP26)).toBe("2026-09");
    for (const bad of ["2026-13", "2026-00", "26-09", "", undefined, null]) expect(parseMonthInput(bad)).toBeNull();
  });
});

describe("top clients", () => {
  it("aggregates by client and ranks by outstanding", () => {
    const rows = [
      row({ id: "1", cif: "B1", client: "Alfa SL", outstanding: 1000 }),
      row({ id: "2", cif: "B1", client: "Alfa SL", outstanding: 500 }),
      row({ id: "3", cif: "B2", client: "Beta SA", outstanding: 2000 }),
      row({ id: "4", cif: "B3", client: "Gamma SL", outstanding: 0 }),
    ];
    const top = topClientsByOutstanding(rows);
    expect(top.map((t) => [t.label, t.amount, t.count])).toEqual([["Beta SA", 2000, 1], ["Alfa SL", 1500, 2]]);
    expect(top[0].share).toBeCloseTo(2000 / 3500, 10);
  });

  it("limits to the top N", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ id: `${i}`, cif: `C${i}`, client: `Cliente ${i}`, outstanding: i + 1 }));
    const top = topClientsByOutstanding(rows, 20);
    expect(top).toHaveLength(20);
    expect(top[0].amount).toBe(30);
    // Shares are of the whole book, not just the visible slice.
    expect(top.reduce((s, t) => s + t.share, 0)).toBeLessThan(1);
  });
});

describe("loan size buckets", () => {
  it("places each contract in exactly one bucket, upper bound excluded", () => {
    const rows = [
      row({ id: "a", outstanding: 999.99 }),
      row({ id: "b", outstanding: 1000 }),
      row({ id: "c", outstanding: 4999 }),
      row({ id: "d", outstanding: 5000 }),
      row({ id: "e", outstanding: 19999 }),
      row({ id: "f", outstanding: 20000 }),
      row({ id: "g", outstanding: 50000 }),
      row({ id: "h", outstanding: 250000 }),
      row({ id: "i", outstanding: 0 }),
      row({ id: "j", outstanding: null }),
    ];
    const buckets = outstandingByLoanSize(rows);
    expect(buckets.map((b) => b.label)).toEqual(LOAN_SIZE_BUCKETS.map((b) => b.label));
    expect(buckets.map((b) => b.count)).toEqual([1, 2, 1, 1, 1, 2]);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(8); // the two nil ones are out
    expect(buckets.find((b) => b.label === ">50k")!.amount).toBe(300000);
    expect(buckets.reduce((s, b) => s + b.share, 0)).toBeCloseTo(1, 10);
  });
});

describe("group-by aggregations", () => {
  const rows = [
    row({ id: "1", assetCluster: "Laptops", country: "ES", distributor: "Nicton", outstanding: 100 }),
    row({ id: "2", assetCluster: "laptops", country: "PT", distributor: "Acquanima", outstanding: 50 }),
    row({ id: "3", assetCluster: "TV", country: "ES", distributor: null, outstanding: 25 }),
    row({ id: "4", assetCluster: null, country: null, distributor: "Nicton", outstanding: 25 }),
  ];

  it("groups by asset cluster, country and partner, case-insensitively", () => {
    // Ties (25 vs 25) break alphabetically, so the order is deterministic.
    expect(groupOutstanding(rows, "assetCluster").map((s) => [s.label, s.amount])).toEqual([
      ["Laptops", 150], ["Sin informar", 25], ["TV", 25],
    ]);
    expect(groupOutstanding(rows, "country").map((s) => [s.label, s.amount])).toEqual([
      ["ES", 125], ["PT", 50], ["Sin informar", 25],
    ]);
    expect(groupOutstanding(rows, "distributor").map((s) => [s.label, s.amount])).toEqual([
      ["Nicton", 125], ["Acquanima", 50], ["Sin informar", 25],
    ]);
    expect(groupOutstanding(rows, "country")[0].share).toBeCloseTo(125 / 200, 10);
  });

  it("folds the tail into a single 'Otros' slice", () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ id: `${i}`, country: `C${i}`, outstanding: 10 - i }));
    const grouped = groupOutstanding(many, "country", { limit: 3 });
    expect(grouped).toHaveLength(4);
    expect(grouped.at(-1)).toMatchObject({ label: "Otros", count: 7 });
    expect(grouped.reduce((s, g) => s + g.amount, 0)).toBe(55);
    expect(grouped.reduce((s, g) => s + g.share, 0)).toBeCloseTo(1, 10);
  });

  it("does not fold when the groups fit", () => {
    expect(groupOutstanding(rows, "country", { limit: 6 })).toHaveLength(3);
  });
});

describe("monthly series", () => {
  const contract = (over: Partial<ContractInput>) =>
    buildSchedule(
      {
        signingDate: "2025-01-10", billingLagMonths: 0, durationMonths: 24, installment: 100,
        residualValue: 100, purchaseValue: 2000, expoAdjustment: 0, cancelDate: null,
        residualWaived: false, amortizeOverRealLife: false, ...over,
      },
      today,
    );

  it("weights the expected IRR by asset value and annualises it", () => {
    const cheap = contract({ purchaseValue: 1000, installment: 60 });
    const dear = contract({ purchaseValue: 9000, installment: 500 });
    const months = buildPortfolio([cheap, dear]);
    const m = months.find((x) => x.key === monthKey(2025, 6))!;

    const expectedMonthly =
      (cheap.assetBase * cheap.expectedMonthlyIrr! + dear.assetBase * dear.expectedMonthlyIrr!) /
      (cheap.assetBase + dear.assetBase);
    expect(m.weightedAnnualIrr).toBeCloseTo(Math.pow(1 + expectedMonthly, 12) - 1, 12);
    // The heavier contract dominates, so the blend sits near its own rate.
    expect(Math.abs(m.weightedAnnualIrr! - (Math.pow(1 + dear.expectedMonthlyIrr!, 12) - 1)))
      .toBeLessThan(Math.abs(m.weightedAnnualIrr! - (Math.pow(1 + cheap.expectedMonthlyIrr!, 12) - 1)));
  });

  it("is null before the first contract is live and after the book runs off", () => {
    const months = buildPortfolio([contract({})]);
    const beforeAndAfter = months.filter((m) => m.liveContracts === 0);
    expect(beforeAndAfter.every((m) => m.weightedAnnualIrr === null)).toBe(true);
    expect(months.some((m) => m.weightedAnnualIrr !== null)).toBe(true);
  });

  it("a cancelled contract stops weighting from its cancellation month", () => {
    const cancelled = contract({ cancelDate: "2025-06-20" });
    const months = buildPortfolio([cancelled], { from: monthKey(2025, 1), to: monthKey(2025, 9) });
    expect(months.find((m) => m.key === monthKey(2025, 6))!.weightedAnnualIrr).not.toBeNull();
    for (const m of [7, 8, 9]) {
      expect(months.find((x) => x.key === monthKey(2025, m))!.weightedAnnualIrr).toBeNull();
    }
  });

  it("irrSeries and defaultSeries cover exactly the period, one point per month", () => {
    const months = buildPortfolio([contract({}), contract({ cancelDate: "2025-06-20" })]);
    const period = resolvePeriod({ preset: "custom", from: "2025-03", to: "2025-08" }, today);

    const irr = irrSeries(months, period);
    expect(irr).toHaveLength(6);
    expect(irr.map((p) => p.key)).toEqual([3, 4, 5, 6, 7, 8].map((m) => monthKey(2025, m)));
    expect(irr[0].label).toBe("mar-25");

    const defaults = defaultSeries(months, period);
    expect(defaults).toHaveLength(6);
    expect(defaults.find((d) => d.key === monthKey(2025, 6))!.defaults).toBeGreaterThan(0);
    // Cumulative loss rate is the workbook's row 45: default over principal originated.
    const june = months.find((m) => m.key === monthKey(2025, 6))!;
    expect(defaults.find((d) => d.key === monthKey(2025, 6))!.cumulativeLossRate).toBe(june.cumulativeLossRate);
  });

  it("monthsInPeriod keeps order and drops everything outside", () => {
    const months = buildPortfolio([contract({})]);
    const period = resolvePeriod({ preset: "custom", from: "2025-02", to: "2025-04" }, today);
    const inside = monthsInPeriod(months, period);
    expect(inside.map((m) => m.key)).toEqual([monthKey(2025, 2), monthKey(2025, 3), monthKey(2025, 4)]);
  });
});
