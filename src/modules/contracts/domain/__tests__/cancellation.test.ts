import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_STATUSES,
  cancellationSchema,
  findStatus,
  resolveCancellation,
  statusAllowsSettlement,
} from "../cancellation";
import { monthKey } from "../month-key";
import { buildSchedule, type ContractInput, principalOutstandingAt } from "../schedule";

const parse = (input: Parameters<typeof cancellationSchema.parse>[0]) => cancellationSchema.parse(input);
const contractId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const base: ContractInput = {
  signingDate: "2024-01-10",
  billingLagMonths: 0,
  durationMonths: 36,
  installment: 340,
  residualValue: 340,
  purchaseValue: 10000,
  expoAdjustment: 0,
  cancelDate: null,
  residualWaived: false,
  amortizeOverRealLife: false,
};
const asOf = new Date(Date.UTC(2026, 8, 15));

describe("additional statuses", () => {
  it("only early-cancellation statuses take a settlement, and only Gesico waives the residual", () => {
    expect(statusAllowsSettlement("CAP")).toBe(true);
    expect(statusAllowsSettlement("CAC")).toBe(true);
    expect(statusAllowsSettlement("FC")).toBe(false);
    expect(statusAllowsSettlement("Gesico")).toBe(false);
    expect(ADDITIONAL_STATUSES.filter((s) => s.waivesResidual).map((s) => s.code)).toEqual(["Gesico"]);
  });

  it("matches the workbook's spelling case-insensitively", () => {
    expect(findStatus("GESICO")?.code).toBe("Gesico");
    expect(findStatus(" cap ")?.code).toBe("CAP");
    expect(findStatus("desconocido")).toBeNull();
  });
});

describe("cancellationSchema", () => {
  it("requires a cancel date before a status", () => {
    const r = cancellationSchema.safeParse({ contractId, cancelDate: "", additionalStatus: "FC" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ["cancelDate"] });
  });

  it("rejects a settlement on a status that does not take one, and a negative one", () => {
    expect(cancellationSchema.safeParse({ contractId, cancelDate: "2026-03-01", additionalStatus: "FC", settlementAmount: 100 }).success).toBe(false);
    expect(cancellationSchema.safeParse({ contractId, cancelDate: "2026-03-01", additionalStatus: "CAP", settlementAmount: -1 }).success).toBe(false);
    expect(cancellationSchema.safeParse({ contractId, cancelDate: "2026-03-01", additionalStatus: "CAP", settlementAmount: 2500 }).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(cancellationSchema.safeParse({ contractId, cancelDate: "2026-03-01", additionalStatus: "XYZ" }).success).toBe(false);
  });
});

describe("resolveCancellation", () => {
  it("Gesico waives the residual and drops any settlement", () => {
    expect(resolveCancellation(parse({ contractId, cancelDate: "2026-03-04", additionalStatus: "GESICO" }))).toEqual({
      cancel_date: "2026-03-04",
      additional_status: "Gesico",
      settlement_amount: null,
      residual_waived: true,
    });
  });

  it("keeps the settlement for CAP and nothing else for FC", () => {
    expect(resolveCancellation(parse({ contractId, cancelDate: "2026-03-04", additionalStatus: "CAP", settlementAmount: 2500 }))).toEqual({
      cancel_date: "2026-03-04",
      additional_status: "CAP",
      settlement_amount: 2500,
      residual_waived: false,
    });
    expect(resolveCancellation(parse({ contractId, cancelDate: "2026-03-04", additionalStatus: "FC" })).settlement_amount).toBeNull();
  });

  it("clearing the cancel date restores the contract to its term", () => {
    expect(resolveCancellation(parse({ contractId, cancelDate: "", additionalStatus: "" }))).toEqual({
      cancel_date: null,
      additional_status: null,
      settlement_amount: null,
      residual_waived: false,
    });
  });
});

describe("recalculation through the engine", () => {
  const withCancellation = (fields: ReturnType<typeof resolveCancellation>) =>
    buildSchedule(
      {
        ...base,
        cancelDate: fields.cancel_date,
        residualWaived: fields.residual_waived,
        settlementAmount: fields.settlement_amount,
      },
      asOf,
    );

  it("a live contract recovers its cost and defaults nothing", () => {
    const s = buildSchedule(base, asOf);
    expect(s.status).toBe("Active");
    expect(s.writeOff).toBeCloseTo(0, 6);
  });

  it("Gesico writes off the whole outstanding principal at the cancel date", () => {
    const fields = resolveCancellation(parse({ contractId, cancelDate: "2026-03-04", additionalStatus: "Gesico" }));
    const s = withCancellation(fields);
    const live = buildSchedule({ ...base, cancelDate: "2026-03-04" }, asOf);
    expect(s.rows.some((r) => r.isResidual)).toBe(false);
    expect(s.writeOff).toBeGreaterThan(0);
    // The residual it does not collect is exactly the extra default vs. an FC cancellation.
    expect(s.writeOff - live.writeOff).toBeCloseTo(live.rows.at(-1)!.principal, 8);
    expect(principalOutstandingAt(s, monthKey(2026, 3))).toBeCloseTo(0, 6);
  });

  it("a CAP settlement that covers the balance closes the contract with no default", () => {
    const outstanding = withCancellation(resolveCancellation(parse({ contractId, cancelDate: "2026-03-04", additionalStatus: "CAP" })));
    // Settle with the full balance still to amortise (plus the token residual).
    const payoff = outstanding.assetBase - outstanding.rows.filter((r) => !r.isResidual).reduce((a, r) => a + r.principal, 0);
    const s = withCancellation(resolveCancellation(parse({ contractId, cancelDate: "2026-03-04", additionalStatus: "CAP", settlementAmount: payoff })));
    expect(s.rows.at(-1)!.installment).toBeCloseTo(payoff, 8);
    expect(s.totals.principal).toBeCloseTo(s.assetBase, 6);
    expect(s.writeOff).toBeCloseTo(0, 6);
  });

  it("a settlement above the balance books the excess as interest, never as extra principal", () => {
    const fields = resolveCancellation(parse({ contractId, cancelDate: "2026-03-04", additionalStatus: "CAC", settlementAmount: 50000 }));
    const s = withCancellation(fields);
    const settlement = s.rows.at(-1)!;
    expect(settlement.installment).toBe(50000);
    expect(s.totals.principal).toBeCloseTo(s.assetBase, 6);
    expect(settlement.interest).toBeCloseTo(50000 - settlement.principal, 8);
    expect(s.writeOff).toBeCloseTo(0, 6);
  });

  it("a settlement below the balance leaves the shortfall as default", () => {
    const fields = resolveCancellation(parse({ contractId, cancelDate: "2026-03-04", additionalStatus: "CAP", settlementAmount: 1000 }));
    const s = withCancellation(fields);
    const noSettlement = withCancellation(resolveCancellation(parse({ contractId, cancelDate: "2026-03-04", additionalStatus: "CAP" })));
    expect(s.writeOff).toBeGreaterThan(0);
    expect(s.writeOff).toBeLessThan(noSettlement.writeOff);
    expect(s.principalResult).toBeCloseTo(-s.writeOff, 8);
  });

  it("the settlement leaves the expected IRR untouched (it is the contractual rate)", () => {
    const a = withCancellation(resolveCancellation(parse({ contractId, cancelDate: "2026-03-04", additionalStatus: "CAP" })));
    const b = withCancellation(resolveCancellation(parse({ contractId, cancelDate: "2026-03-04", additionalStatus: "CAP", settlementAmount: 9999 })));
    expect(b.expectedMonthlyIrr).toBe(a.expectedMonthlyIrr);
  });
});

/**
 * Principal outstanding around a cancellation, as the workbook books it:
 * the write-off lands in the cancellation month, but instalments already
 * scheduled after it (a Renting F bills one month after signing) are still
 * outstanding until they are collected. In the 15-Sep-2026 Borrowing Base 45
 * of the 49 Gesico contracts show exactly that residue in the cancel month and
 * nil in the next one - which is why the balance is not forced to zero.
 */
describe("outstanding around the cancellation", () => {
  const cancelDate = "2025-06-20";
  const cancelKey = monthKey(2025, 6);
  const statuses = ["FC", "Gesico", "CAP", "CAC", "CS"] as const;

  const scheduleFor = (status: string, settlementAmount?: number, over: Partial<ContractInput> = {}) => {
    const fields = resolveCancellation(parse({ contractId, cancelDate, additionalStatus: status, settlementAmount: settlementAmount ?? "" }));
    return buildSchedule(
      { ...base, ...over, cancelDate: fields.cancel_date, residualWaived: fields.residual_waived, settlementAmount: fields.settlement_amount },
      asOf,
    );
  };

  it.each(statuses)("%s: nil from the last booked month, and the write-off is already deducted at the cancel month", (status) => {
    const s = scheduleFor(status, status === "CAP" || status === "CAC" || status === "CS" ? 500 : undefined);
    const lastKey = s.rows.at(-1)!.key;
    expect(principalOutstandingAt(s, lastKey)).toBeCloseTo(0, 6);
    expect(principalOutstandingAt(s, lastKey + 6)).toBeCloseTo(0, 6);

    // At the cancellation month only what is still to be collected remains.
    const stillToCome = s.rows.filter((r) => r.key > cancelKey).reduce((a, r) => a + r.principal, 0);
    expect(principalOutstandingAt(s, cancelKey)).toBeCloseTo(stillToCome, 6);
  });

  it("a Renting F cancelled mid-month keeps its last instalment outstanding for one month (LB-19426 shape)", () => {
    // Signed 17-Aug, billed from Sep, cancelled 22-Sep: two instalments, Sep and Oct.
    const s = buildSchedule(
      { ...base, signingDate: "2026-08-17", billingLagMonths: 1, durationMonths: 48, installment: 284, residualValue: 284, purchaseValue: 9200, cancelDate: "2026-09-22", residualWaived: true },
      new Date(Date.UTC(2026, 8, 22)),
    );
    expect(s.paymentHorizon).toBe(2);
    expect(s.rows.map((r) => r.key)).toEqual([monthKey(2026, 9), monthKey(2026, 10)]);
    const atCancel = principalOutstandingAt(s, monthKey(2026, 9))!;
    expect(atCancel).toBeCloseTo(s.rows[1].principal, 8);
    expect(atCancel).toBeGreaterThan(0);
    expect(principalOutstandingAt(s, monthKey(2026, 10))).toBeCloseTo(0, 6);
    // The default is booked in full at the cancellation month.
    expect(s.principalResult).toBeLessThan(0);
    expect(principalOutstandingAt(s, monthKey(2026, 8))! - atCancel).toBeCloseTo(s.writeOff + s.rows[0].principal, 6);
  });

  it("the default reported per contract is BD, and it is nil when the contract recovers its cost", () => {
    const gesico = scheduleFor("Gesico");
    expect(gesico.principalResult).toBeCloseTo(-gesico.writeOff, 10);
    expect(gesico.principalResult).toBeLessThan(0);

    // A settlement that leaves a shortfall: BD is the part never repaid.
    const shortfall = scheduleFor("CAP", 500);
    expect(shortfall.principalResult).toBeLessThan(0);
    expect(shortfall.principalResult).toBeGreaterThan(gesico.principalResult);

    // Runs to term: nothing lost.
    expect(buildSchedule(base, new Date(Date.UTC(2030, 0, 1))).principalResult).toBeCloseTo(0, 6);
  });
});
