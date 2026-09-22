/**
 * Contract schedule: the per-contract logic of the Borrowing Base workbook
 * (Loan book / Principal / Interest / Principal Outstanding tabs).
 *
 * Column map, for anyone reconciling against the workbook:
 *   N  durationMonths         M  installment          AR residualValue
 *   BF -(purchase - expo)     R  cancelDate           U  "Gesico" -> residualWaived
 *   S  elapsedMonths          T  status               V  paymentHorizon (HW)
 *   HZ residualInSolve        HX expectedMonthlyIrr   HY amortizationMonths
 *   IA billing start key      BD principalResult      PO!HY writeOff
 *
 * Two horizons: the contract PAYS for V months (real life: extended or cut
 * short by a cancellation) but principal AMORTISES over HY = N contractual
 * months. Months N..V-1 of an extended contract are 100 % interest.
 */
import { annualize, irr, pv, rateWithLadder } from "./financial-math";
import { completeMonthsBetween, type MonthKey, monthKeyOfDate } from "./month-key";

export type ContractStatus = "Active" | "Finished" | "Extended" | "On Track";

export interface ContractInput {
  /**
   * ISO signing date. The month places the contract on the grid; the day
   * matters for the elapsed-months count (DATEDIF counts complete months).
   */
  signingDate: string;
  /** 1 for "Renting F", 0 otherwise (contract_types.billing_lag_months). */
  billingLagMonths: number;
  durationMonths: number;
  installment: number;
  residualValue: number | null;
  /** Purchase value of the equipment, positive (workbook col BE with sign flipped). */
  purchaseValue: number;
  /** Workbook col AS; the asset base is purchaseValue - expoAdjustment. */
  expoAdjustment: number;
  cancelDate: string | null;
  /** Gesico contracts: the residual is never billed. */
  residualWaived: boolean;
  /** Per-contract override: amortise over min(N, real life) instead of N. */
  amortizeOverRealLife: boolean;
}

export interface ScheduleRow {
  key: MonthKey;
  /** Months since the first billing month (0-based). */
  age: number;
  installment: number;
  principal: number;
  interest: number;
  isResidual: boolean;
}

export interface ContractSchedule {
  signingKey: MonthKey;
  billingStartKey: MonthKey;
  cancelKey: MonthKey | null;
  status: ContractStatus;
  elapsedMonths: number;
  paymentHorizon: number;
  rateHorizon: number;
  amortizationMonths: number;
  residualInSolve: number;
  expectedMonthlyIrr: number | null;
  expectedAnnualIrr: number | null;
  /** -BF: the principal the contract has to recover. */
  assetBase: number;
  rows: ScheduleRow[];
  totals: { installments: number; principal: number; interest: number };
  /** Workbook col BD: principal recovered less asset base (negative = shortfall). */
  principalResult: number;
  /** Unrecovered principal written off at the cancel date (PO col HY). */
  writeOff: number;
  realisedMonthlyIrr: number | null;
  realisedAnnualIrr: number | null;
}

export function contractStatus(input: ContractInput, asOf: Date): {
  status: ContractStatus;
  elapsedMonths: number;
  paymentHorizon: number;
} {
  // Workbook col S: DATEDIF(signing date, cancel date or today, "m") + 1.
  const elapsedMonths = completeMonthsBetween(input.signingDate, input.cancelDate ?? asOf) + 1;
  const n = input.durationMonths;
  const status: ContractStatus = input.cancelDate
    ? "Finished"
    : elapsedMonths < n
      ? "Active"
      : elapsedMonths > n
        ? "Extended"
        : "On Track";
  const paymentHorizon = status === "Finished" || status === "Extended" ? elapsedMonths : n;
  return { status, elapsedMonths, paymentHorizon };
}

export function buildSchedule(input: ContractInput, asOf: Date): ContractSchedule {
  const signingKey = monthKeyOfDate(input.signingDate);
  const billingStartKey = signingKey + input.billingLagMonths;
  const cancelKey = input.cancelDate ? monthKeyOfDate(input.cancelDate) : null;
  const { status, elapsedMonths, paymentHorizon } = contractStatus(input, asOf);

  const m = input.installment;
  const residual = input.residualValue ?? 0;
  const assetBase = input.purchaseValue - input.expoAdjustment;
  const rateBase = Math.abs(assetBase);

  // Expected IRR (cols HZ / HX / HY). The residual enters the solve only when
  // the rents alone cannot amortise the asset; the +1 / (HZ - M)
  // parametrisation matches the grid timing (residual one month after the
  // last rent), so the principal recovered on schedule equals the asset base.
  const rateHorizon = input.amortizeOverRealLife
    ? Math.min(input.durationMonths, paymentHorizon)
    : input.durationMonths;
  const residualInSolve = m * rateHorizon >= rateBase ? 0 : residual;
  const solved = rateWithLadder(rateHorizon + 1, m, -rateBase, residualInSolve - m);
  const expectedMonthlyIrr = solved === null ? null : Math.max(0, solved);
  const amortizationMonths = expectedMonthlyIrr === null ? 0 : rateHorizon;

  const i = expectedMonthlyIrr ?? 0;
  const hy = amortizationMonths;
  const hz = residualInSolve;
  const rows: ScheduleRow[] = [];

  for (let age = 0; age < paymentHorizon; age++) {
    let principal: number;
    if (age < hy) {
      const k = hy - age;
      principal = m * Math.pow(1 + i, -k) - hz * i * Math.pow(1 + i, -(k + 1));
      if (!Number.isFinite(principal)) principal = m;
    } else {
      principal = 0;
    }
    rows.push({ key: billingStartKey + age, age, installment: m, principal, interest: m - principal, isResidual: false });
  }

  if (!input.residualWaived) {
    let principal = 0;
    if (hy > 0) {
      // Settlement: the residual recovers what is left of the amortisation
      // schedule at the payment horizon, capped at the residual billed.
      const remaining = pv(i, Math.max(0, hy - paymentHorizon), -m, -hz / (1 + i));
      principal = Number.isFinite(remaining) ? Math.max(0, Math.min(residual, remaining)) : hz;
    }
    rows.push({
      key: billingStartKey + paymentHorizon,
      age: paymentHorizon,
      installment: residual,
      principal,
      interest: residual - principal,
      isResidual: true,
    });
  }

  const totals = rows.reduce(
    (acc, r) => ({
      installments: acc.installments + r.installment,
      principal: acc.principal + r.principal,
      interest: acc.interest + r.interest,
    }),
    { installments: 0, principal: 0, interest: 0 },
  );
  const principalResult = totals.principal - assetBase;
  const writeOff = Math.max(0, -principalResult);

  const realised = irr([-assetBase, ...rows.map((r) => r.installment)]);

  return {
    signingKey,
    billingStartKey,
    cancelKey,
    status,
    elapsedMonths,
    paymentHorizon,
    rateHorizon,
    amortizationMonths,
    residualInSolve,
    expectedMonthlyIrr,
    expectedAnnualIrr: expectedMonthlyIrr === null ? null : annualize(expectedMonthlyIrr),
    assetBase,
    rows,
    totals,
    principalResult,
    writeOff,
    realisedMonthlyIrr: realised,
    realisedAnnualIrr: realised === null ? null : annualize(realised),
  };
}

/**
 * Closing principal outstanding at month `key` (Principal Outstanding tab):
 * asset base less principal collected to date, less the write-off from the
 * cancellation month on. Null before the contract is signed.
 */
export function principalOutstandingAt(schedule: ContractSchedule, key: MonthKey): number | null {
  if (key < schedule.signingKey) return null;
  if (schedule.rows.length === 0) return 0;
  let collected = 0;
  for (const r of schedule.rows) if (r.key <= key) collected += r.principal;
  const writtenOff = schedule.cancelKey !== null && key >= schedule.cancelKey ? schedule.writeOff : 0;
  return schedule.assetBase - collected - writtenOff;
}

/** Last month in which the contract books anything. */
export function lastScheduleKey(schedule: ContractSchedule): MonthKey {
  return schedule.rows.length ? schedule.rows[schedule.rows.length - 1].key : schedule.signingKey;
}

/** Schedule rows with the closing principal outstanding after each month. */
export function rowsWithOutstanding(schedule: ContractSchedule): (ScheduleRow & { outstanding: number })[] {
  let collected = 0;
  return schedule.rows.map((r) => {
    collected += r.principal;
    const writtenOff = schedule.cancelKey !== null && r.key >= schedule.cancelKey ? schedule.writeOff : 0;
    return { ...r, outstanding: schedule.assetBase - collected - writtenOff };
  });
}
