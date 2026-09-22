/**
 * Portfolio summary / waterfall: the Summary tab of the Borrowing Base.
 *
 * Roll-forward convention (Summary rows 9-11): the "opening" balance of month t
 * already includes the contracts signed in t; the closing balance deducts the
 * month's collections and defaults:
 *   opening(t) = closing(t-1) + new(t)
 *   closing(t) = opening(t) - collected(t) - default(t)
 * The closing principal is also computed bottom-up from every contract's
 * principal outstanding; the two must agree (Summary row 30, "should be nil").
 */
import { type ContractSchedule, principalOutstandingAt } from "./schedule";
import type { MonthKey } from "./month-key";

export interface PortfolioMonth {
  key: MonthKey;
  installments: number;          // row 4
  interest: number;              // row 5
  principal: number;             // row 6
  newContracts: number;          // count signed in month
  newPrincipal: number;          // row 15 - asset value originated
  newInterest: number;           // row 14 - interest the new contracts will earn
  defaults: number;              // row 22 - unrecovered principal written off at cancel date
  cumulativeDefaults: number;    // row 23
  openingPrincipal: number;      // row 11
  closingPrincipal: number;      // row 28
  openingInterest: number;       // row 10
  closingInterest: number;
  /** Row 30: roll-forward closing less the bottom-up sum of contract balances. */
  reconciliationDiff: number;
  /** Row 45: cumulative default over cumulative principal originated. */
  cumulativeLossRate: number | null;
  liveContracts: number;
}

export function buildPortfolio(schedules: readonly ContractSchedule[], range?: { from: MonthKey; to: MonthKey }): PortfolioMonth[] {
  if (schedules.length === 0) return [];

  const from = range?.from ?? Math.min(...schedules.map((s) => s.signingKey));
  const to = range?.to ?? Math.max(...schedules.map((s) => (s.rows.length ? s.rows[s.rows.length - 1].key : s.signingKey)));
  const size = to - from + 1;

  const zeros = () => new Float64Array(size);
  const inst = zeros(), int = zeros(), pri = zeros();
  const newP = zeros(), newI = zeros(), def = zeros(), bottomUp = zeros();
  const newCount = new Int32Array(size), live = new Int32Array(size);

  for (const s of schedules) {
    for (const r of s.rows) {
      const idx = r.key - from;
      if (idx < 0 || idx >= size) continue;
      inst[idx] += r.installment;
      int[idx] += r.interest;
      pri[idx] += r.principal;
    }
    const sIdx = s.signingKey - from;
    if (sIdx >= 0 && sIdx < size) {
      newP[sIdx] += s.assetBase;
      newI[sIdx] += s.totals.interest;
      newCount[sIdx] += 1;
    }
    if (s.cancelKey !== null) {
      const cIdx = s.cancelKey - from;
      if (cIdx >= 0 && cIdx < size) def[cIdx] += s.writeOff;
    }
    // Bottom-up balance: incremental walk instead of re-summing each month.
    let collected = 0;
    let rowIdx = 0;
    const lastKey = s.rows.length ? s.rows[s.rows.length - 1].key : s.signingKey;
    for (let k = Math.max(from, s.signingKey); k <= to; k++) {
      while (rowIdx < s.rows.length && s.rows[rowIdx].key <= k) collected += s.rows[rowIdx++].principal;
      const balance = s.rows.length === 0
        ? 0
        : s.assetBase - collected - (s.cancelKey !== null && k >= s.cancelKey ? s.writeOff : 0);
      bottomUp[k - from] += balance;
      if (k <= lastKey && (s.cancelKey === null || k <= s.cancelKey)) live[k - from] += 1;
    }
  }

  // Contracts signed before the range start carry their balance in.
  let closingP = 0;
  let closingI = 0;
  for (const s of schedules) {
    if (s.signingKey >= from) continue;
    closingP += principalOutstandingAt(s, from - 1) ?? 0;
    closingI += s.rows.filter((r) => r.key >= from).reduce((a, r) => a + r.interest, 0);
  }

  const months: PortfolioMonth[] = [];
  let cumDefault = 0;
  let cumOriginated = 0;
  for (let idx = 0; idx < size; idx++) {
    const openingPrincipal = closingP + newP[idx];
    const openingInterest = closingI + newI[idx];
    closingP = openingPrincipal - pri[idx] - def[idx];
    closingI = openingInterest - int[idx];
    cumDefault += def[idx];
    cumOriginated += newP[idx];
    months.push({
      key: from + idx,
      installments: inst[idx],
      interest: int[idx],
      principal: pri[idx],
      newContracts: newCount[idx],
      newPrincipal: newP[idx],
      newInterest: newI[idx],
      defaults: def[idx],
      cumulativeDefaults: cumDefault,
      openingPrincipal,
      closingPrincipal: closingP,
      openingInterest,
      closingInterest: closingI,
      reconciliationDiff: closingP - bottomUp[idx],
      cumulativeLossRate: cumOriginated > 0 ? cumDefault / cumOriginated : null,
      liveContracts: live[idx],
    });
  }
  return months;
}
