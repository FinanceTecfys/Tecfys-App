/**
 * Excel-compatible financial functions.
 *
 * The Borrowing Base workbook solves the expected IRR with Excel's RATE and a
 * ladder of guesses; a contract whose RATE does not converge is treated as
 * "no rate" (100 % interest). To reproduce the workbook contract by contract,
 * RATE here follows Excel's algorithm - Newton's method, at most 20
 * iterations, converged when successive estimates differ by < 1e-7 - rather
 * than a more robust root finder that would find rates Excel gives up on.
 *
 * Two acceptance rules were fitted against the 2,156 expected IRRs of the
 * 15-Sep-2026 workbook (0 mismatches; without them 37 contracts differ):
 *  - the residual |f(r)| must be <= 1e-5, which is how Excel rejects a
 *    "converged" step at huge rates where f cannot be evaluated precisely;
 *  - r -> -1 is rejected. When the residual is not in the solve, r = -1 is an
 *    exact root of the RATE equation and Newton from 0.1 slides into it; Excel
 *    returns #NUM! and the workbook moves on to the next guess.
 */

const RATE_MAX_ITERATIONS = 20;
const RATE_STEP_TOLERANCE = 1e-7;
const RATE_RESIDUAL_TOLERANCE = 1e-5;
const RATE_FLOOR = -0.999999;

/** Excel PV(rate, nper, pmt, fv, type=0). */
export function pv(rate: number, nper: number, pmt: number, fv = 0): number {
  if (rate === 0) return -(pmt * nper + fv);
  const v = Math.pow(1 + rate, -nper);
  return -(pmt * (1 - v) / rate + fv * v);
}

/** Excel PMT(rate, nper, pv, fv, type=0). */
export function pmt(rate: number, nper: number, presentValue: number, fv = 0): number {
  if (nper <= 0) return NaN;
  if (rate === 0) return -(presentValue + fv) / nper;
  const g = Math.pow(1 + rate, nper);
  return -(presentValue * g + fv) * rate / (g - 1);
}

/**
 * Excel RATE(nper, pmt, pv, fv, type=0, guess). Returns null where Excel
 * returns #NUM! (no convergence within 20 Newton steps).
 */
export function rate(nper: number, payment: number, presentValue: number, fv = 0, guess = 0.1): number | null {
  if (!(nper > 0)) return null;
  let r = guess;
  for (let i = 0; i < RATE_MAX_ITERATIONS; i++) {
    const { f, df } = rateEquation(r, nper, payment, presentValue, fv);
    if (!Number.isFinite(f) || !Number.isFinite(df) || df === 0) return null;
    const next = r - f / df;
    if (!Number.isFinite(next) || next <= -1) return null;
    if (Math.abs(next - r) < RATE_STEP_TOLERANCE) {
      if (next < RATE_FLOOR) return null;
      const residual = rateEquation(next, nper, payment, presentValue, fv).f;
      return Math.abs(residual) <= RATE_RESIDUAL_TOLERANCE ? next : null;
    }
    r = next;
  }
  return null;
}

/** f(r) = pv*(1+r)^n + pmt*((1+r)^n - 1)/r + fv, and its derivative. */
function rateEquation(r: number, n: number, p: number, presentValue: number, fv: number) {
  if (Math.abs(r) < 1e-12) {
    return {
      f: presentValue + p * n + fv,
      df: presentValue * n + p * n * (n - 1) / 2,
    };
  }
  const g = Math.pow(1 + r, n);
  const dg = n * Math.pow(1 + r, n - 1);
  const f = presentValue * g + p * (g - 1) / r + fv;
  const df = presentValue * dg + p * (dg * r - (g - 1)) / (r * r);
  return { f, df };
}

/**
 * The guess ladder used by the workbook (col HX): Excel's default guess, then
 * 0.5, 3, 20, 150. Returns the first rate that converges, or null.
 */
export function rateWithLadder(nper: number, payment: number, presentValue: number, fv = 0): number | null {
  for (const guess of [0.1, 0.5, 3, 20, 150]) {
    const r = rate(nper, payment, presentValue, fv, guess);
    if (r !== null) return r;
  }
  return null;
}

/**
 * Periodic IRR of a cash-flow vector (t = 0, 1, 2, ...). Uses bisection on a
 * bracketed root, falling back to null when the flows have no sign change.
 * Informational only (the workbook's "realised IRR", col BB), so robustness
 * matters more than bit-for-bit Excel parity here.
 */
export function irr(cashFlows: readonly number[]): number | null {
  if (cashFlows.length < 2) return null;
  const hasNeg = cashFlows.some((c) => c < 0);
  const hasPos = cashFlows.some((c) => c > 0);
  if (!hasNeg || !hasPos) return null;

  const npv = (r: number) => {
    let total = 0;
    let discount = 1;
    for (const c of cashFlows) {
      total += c / discount;
      discount *= 1 + r;
    }
    return total;
  };

  let lo = -0.9999;
  let hi = 1;
  let fLo = npv(lo);
  let fHi = npv(hi);
  while (fLo * fHi > 0 && hi < 1e6) {
    hi *= 2;
    fHi = npv(hi);
  }
  if (fLo * fHi > 0) return null;

  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-10 || hi - lo < 1e-14) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/** Monthly rate to effective annual rate. */
export const annualize = (monthly: number) => Math.pow(1 + monthly, 12) - 1;
