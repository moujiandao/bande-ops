/**
 * Pure inventory-level display formatting.
 *
 * The single place that turns a stored `total_quantity` (number | null) into
 * what the UI shows, so the UNKNOWN-stock rule lives in one tested spot:
 *   - null  -> UNKNOWN  ({ isUnknown: true,  label: 'Unknown' })
 *   - 0     -> '0'      ({ isUnknown: false, label: '0' })  (in-stock-zero)
 *   - n     -> String(n)
 *
 * UNKNOWN is intentionally distinct from 0: a null quantity means Amazon never
 * gave us a number (flag for review), and is NEVER rendered or treated as 0.
 * Callers branch on `isUnknown` to style the two states differently (e.g. a
 * muted "Unknown" badge vs. a plain numeric cell).
 */

/** Sentinel label rendered for an UNKNOWN (null) inventory level. */
export const UNKNOWN_LABEL = 'Unknown';

export interface InventoryDisplay {
  /** true only when the level is UNKNOWN (null). A true 0 is NOT unknown. */
  isUnknown: boolean;
  /** Human-readable cell text. */
  label: string;
}

/**
 * Map a stored inventory quantity to its display. `quantity === null` (UNKNOWN)
 * yields the sentinel; every finite number (including 0) yields its string.
 */
export function formatInventoryLevel(
  quantity: number | null | undefined,
): InventoryDisplay {
  // Treat a missing row (undefined, e.g. no inventory_levels match) the same as
  // an explicit UNKNOWN: we have no number, so it must not read as 0.
  if (quantity === null || quantity === undefined) {
    return { isUnknown: true, label: UNKNOWN_LABEL };
  }
  return { isUnknown: false, label: String(quantity) };
}
