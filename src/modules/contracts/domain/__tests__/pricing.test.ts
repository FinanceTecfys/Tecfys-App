import { describe, expect, it } from "vitest";
import { installmentForRate, monthlyFromAnnual } from "../pricing";
import { buildSchedule } from "../schedule";

const schedule = (cost: number, n: number, m: number, residual: number) =>
  buildSchedule(
    {
      signingDate: "2026-10-01", billingLagMonths: 0, durationMonths: n, installment: m, residualValue: residual,
      purchaseValue: cost, expoAdjustment: 0, cancelDate: null, residualWaived: false, amortizeOverRealLife: false,
    },
    new Date(Date.UTC(2026, 9, 1)),
  );

describe("installmentForRate", () => {
  it.each([
    [10000, 36, 1000, 0.25],
    [5000, 24, 0, 0.18],
    [20000, 48, 8000, 0.12], // rents alone do not cover the asset: residual enters the solve
  ])("round-trips through the engine (cost %d, %d months, residual %d, %d p.a.)", (cost, n, residual, annual) => {
    const target = monthlyFromAnnual(annual);
    const m = installmentForRate(cost, n, residual, target)!;
    expect(m).toBeGreaterThan(0);
    expect(schedule(cost, n, m, residual).expectedMonthlyIrr).toBeCloseTo(target, 7);
  });

  it("rejects impossible inputs", () => {
    expect(installmentForRate(0, 12, 0, 0.01)).toBeNull();
    expect(installmentForRate(1000, 0, 0, 0.01)).toBeNull();
  });
});
