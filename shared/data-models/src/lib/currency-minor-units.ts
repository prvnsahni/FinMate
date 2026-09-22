/**
 * Central currency precision map for FinMate ledger writes.
 *
 * IMPORTANT:
 * - Current balance math is hard-wired to 2 decimals (cent-style rounding and
 *   tolerances) across expense, settlement, and simplifier paths.
 * - Only 2-decimal currencies are allowed here until that math is generalized.
 * - Adding a non-2 currency requires first reworking those money paths.
 */
export const CURRENCY_MINOR_UNITS = Object.freeze({
  INR: 2,
  USD: 2,
} as const);

export function normalizeCurrencyCode(currency: string): string {
  return currency.trim().toUpperCase();
}

export function isSupportedCurrencyCode(currency: string): boolean {
  const code = normalizeCurrencyCode(currency);
  return Object.prototype.hasOwnProperty.call(CURRENCY_MINOR_UNITS, code);
}
