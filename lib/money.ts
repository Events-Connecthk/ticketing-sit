/**
 * Money helpers — always 2 decimal places for display and totals.
 */

/** Round to 2 decimal places (half-up via epsilon). */
export function roundMoney(n: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Format amount with exactly 2 decimal places (e.g. 12.50). */
export function formatMoney(n: number): string {
  return roundMoney(n).toFixed(2);
}
