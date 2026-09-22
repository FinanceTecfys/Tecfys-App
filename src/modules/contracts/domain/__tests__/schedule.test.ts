import { describe, expect, it } from "vitest";
import { pmt, pv, rate } from "../financial-math";
import { monthKey } from "../month-key";
import { buildPortfolio } from "../portfolio";
import { buildSchedule, type ContractInput, principalOutstandingAt } from "../schedule";

const base: ContractInput = {
  signingDate: "2025-01-15",
  billingLagMonths: 0,
  durationMonths: 36,
  installment: 340,
  residualValue: 1000,
  purchaseValue: 10000,
  expoAdjustment: 0,
  cancelDate: null,
  residualWaived: false,
  amortizeOverRealLife: false,
};
const asOf = new Date(Date.UTC(2025, 5, 1));

describe("financial math", () => {
  it("RATE inverts PMT", () => {
    const r = rate(36, -340, 10000);
    expect(r).not.toBeNull();
    expect(pmt(r!, 36, 10000)).toBeCloseTo(-340, 9);
  });

  it("PV at a zero rate is the undiscounted sum", () => {
    expect(pv(0, 10, -100, -50)).toBeCloseTo(1050, 12);
  });
});

describe("contract schedule", () => {
  it("full-payout contract recovers exactly the asset base; the residual is pure interest", () => {
    const s = buildSchedule(base, asOf);
    expect(s.status).toBe("Active");
    expect(s.paymentHorizon).toBe(36);
    expect(s.residualInSolve).toBe(0); // 340 x 36 covers the 10,000 asset
    expect(s.rows).toHaveLength(37);
    expect(s.totals.principal).toBeCloseTo(10000, 8);
    expect(s.totals.installments).toBeCloseTo(340 * 36 + 1000, 8);
    const residual = s.rows.at(-1)!;
    expect(residual.isResidual).toBe(true);
    expect(residual.principal).toBe(0);
    for (const r of s.rows) expect(r.principal + r.interest).toBeCloseTo(r.installment, 10);
    expect(principalOutstandingAt(s, residual.key)).toBeCloseTo(0, 8);
    expect(s.writeOff).toBeCloseTo(0, 8);
  });

  it("the residual enters the solve only when the rents cannot amortise the asset", () => {
    const s = buildSchedule({ ...base, installment: 200, residualValue: 4000 }, asOf);
    expect(s.residualInSolve).toBe(4000);
    expect(s.totals.principal).toBeCloseTo(10000, 8);
    expect(s.rows.at(-1)!.principal).toBeGreaterThan(0);
  });

  it("Renting F bills one month later with identical totals", () => {
    const plain = buildSchedule(base, asOf);
    const lagged = buildSchedule({ ...base, billingLagMonths: 1 }, asOf);
    expect(lagged.rows[0].key).toBe(plain.rows[0].key + 1);
    expect(lagged.totals.principal).toBeCloseTo(plain.totals.principal, 10);
    expect(lagged.signingKey).toBe(plain.signingKey);
  });

  it("an extended contract pays interest only after the contractual term", () => {
    const s = buildSchedule({ ...base, durationMonths: 12, installment: 900 }, new Date(Date.UTC(2026, 2, 10)));
    expect(s.status).toBe("Extended");
    expect(s.paymentHorizon).toBe(14); // DATEDIF: 15-Jan-25 -> 10-Mar-26 = 13 complete months, +1
    expect(s.amortizationMonths).toBe(12);
    for (const r of s.rows.slice(12, 14)) expect(r.principal).toBe(0);
    expect(s.totals.principal).toBeCloseTo(10000, 8);
  });

  it("a contract cancelled early writes off its unrecovered principal at the cancel date", () => {
    const s = buildSchedule({ ...base, cancelDate: "2026-06-20" }, asOf);
    expect(s.status).toBe("Finished");
    expect(s.paymentHorizon).toBe(18);
    expect(s.writeOff).toBeGreaterThan(0);
    expect(s.principalResult).toBeCloseTo(-s.writeOff, 10);
    const cancelKey = monthKey(2026, 6);
    const before = principalOutstandingAt(s, cancelKey - 1)!;
    const at = principalOutstandingAt(s, cancelKey)!;
    expect(before).toBeGreaterThan(s.writeOff);
    expect(at).toBeGreaterThanOrEqual(-1e-9);
    // after the last booked month the balance is nil
    expect(principalOutstandingAt(s, s.rows.at(-1)!.key)).toBeCloseTo(0, 8);
  });

  it("Gesico contracts never bill the residual", () => {
    const s = buildSchedule({ ...base, residualWaived: true }, asOf);
    expect(s.rows.some((r) => r.isResidual)).toBe(false);
    expect(s.totals.installments).toBeCloseTo(340 * 36, 8);
  });
});

describe("portfolio", () => {
  it("roll-forward closing balance ties to the bottom-up sum of contract balances", () => {
    const schedules = [
      buildSchedule(base, asOf),
      buildSchedule({ ...base, signingDate: "2024-03-01", billingLagMonths: 1 }, asOf),
      buildSchedule({ ...base, signingDate: "2024-06-01", cancelDate: "2025-02-11" }, asOf),
      buildSchedule({ ...base, signingDate: "2023-09-01", durationMonths: 12, installment: 900, residualWaived: true }, asOf),
    ];
    const months = buildPortfolio(schedules);
    for (const m of months) {
      expect(Math.abs(m.reconciliationDiff)).toBeLessThan(1e-6);
      expect(m.interest + m.principal).toBeCloseTo(m.installments, 8);
    }
    const totalDefaults = months.at(-1)!.cumulativeDefaults;
    expect(totalDefaults).toBeCloseTo(schedules[2].writeOff, 8);
    expect(months.at(-1)!.closingPrincipal).toBeCloseTo(0, 6);
  });

  it("a sub-range carries the opening balance in", () => {
    const schedules = [buildSchedule(base, asOf), buildSchedule({ ...base, signingDate: "2024-01-01" }, asOf)];
    const full = buildPortfolio(schedules);
    const from = monthKey(2025, 6);
    const partial = buildPortfolio(schedules, { from, to: full.at(-1)!.key });
    const ref = full.find((m) => m.key === from)!;
    expect(partial[0].closingPrincipal).toBeCloseTo(ref.closingPrincipal, 8);
    expect(partial[0].closingInterest).toBeCloseTo(ref.closingInterest, 8);
  });
});
