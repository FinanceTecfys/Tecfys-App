/**
 * Pricing helpers for new operations, consistent with the expected-IRR
 * convention of the schedule engine: RATE(N+1, M, -cost, HZ - M), where the
 * residual HZ enters only when the rents alone cannot amortise the asset.
 */

/**
 * Monthly installment M such that the expected monthly IRR equals `monthlyRate`.
 * Solves -cost*g + M*((g-1)/i) + (HZ - M) = 0 with g = (1+i)^(N+1).
 */
export function installmentForRate(cost: number, durationMonths: number, residual: number, monthlyRate: number): number | null {
  if (!(cost > 0) || !(durationMonths > 0) || !(monthlyRate >= 0)) return null;
  const solve = (hz: number) => {
    const n = durationMonths + 1;
    if (monthlyRate === 0) return (cost - hz) / durationMonths;
    const g = Math.pow(1 + monthlyRate, n);
    return (cost * g - hz) / ((g - 1) / monthlyRate - 1);
  };
  // Try full payout first (residual outside the solve); if the rents then fail
  // to cover the asset, the residual is part of the solve.
  const fullPayout = solve(0);
  if (fullPayout * durationMonths >= cost) return fullPayout;
  const withResidual = solve(residual);
  return withResidual > 0 ? withResidual : null;
}

/** Effective annual rate to monthly. */
export const monthlyFromAnnual = (annual: number) => Math.pow(1 + annual, 1 / 12) - 1;
