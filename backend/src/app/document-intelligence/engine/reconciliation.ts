import { ReconciliationStatus, ReconciliationSummary } from './document-extraction-engine.types';

/** Deterministic 2-dp money rounding (app-consistent with the Goal Engine). */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Pure total-vs-items reconciliation (readiness §A6). Computes the allocated total
 * and the signed unallocated difference and classifies the state. It NEVER invents,
 * removes, or adjusts an item to force a balance — differences are surfaced for the
 * user to resolve later. This preserves FIN-002 (extraction is candidates-only).
 *
 *   allocatedTotal        = sum(lineItemTotals)
 *   unallocatedDifference = documentTotal - allocatedTotal   (signed)
 *
 * @param documentTotal The authoritative total, if one was extracted. When absent
 *   the result is UNRECONCILED (we cannot compare against nothing).
 * @param lineItemTotals The per-line totals (undefined/NaN entries are ignored).
 * @param opts.toleranceMinor Optional absolute tolerance (same currency unit as the
 *   totals) within which a difference counts as BALANCED. Defaults to 0 (exact).
 */
export function computeReconciliation(
  documentTotal: number | undefined,
  lineItemTotals: ReadonlyArray<number | undefined>,
  opts: { toleranceMinor?: number } = {},
): ReconciliationSummary {
  const allocatedTotal = round2(
    lineItemTotals.reduce<number>(
      (sum, n) => (typeof n === 'number' && Number.isFinite(n) ? sum + n : sum),
      0,
    ),
  );

  if (documentTotal === undefined || !Number.isFinite(documentTotal)) {
    return {
      allocatedTotal,
      unallocatedDifference: 0,
      reconciliationStatus: 'UNRECONCILED',
    };
  }

  const unallocatedDifference = round2(documentTotal - allocatedTotal);
  const tolerance = Math.abs(opts.toleranceMinor ?? 0);

  let reconciliationStatus: ReconciliationStatus;
  if (Math.abs(unallocatedDifference) <= tolerance) {
    reconciliationStatus = 'BALANCED';
  } else if (unallocatedDifference > 0) {
    reconciliationStatus = 'UNDER_ALLOCATED';
  } else {
    reconciliationStatus = 'OVER_ALLOCATED';
  }

  return {
    documentTotal,
    allocatedTotal,
    unallocatedDifference,
    reconciliationStatus,
  };
}
