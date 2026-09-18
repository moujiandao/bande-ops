/** Buyable FBA stock: immediately fulfillable units plus transfers between FCs.
 * Missing transfer evidence is UNKNOWN, including mirrors from before 0024.
 * Never substitute Amazon's total/reserved inventory for this quantity.
 */
export function fbaOnHand(
  available: number | null | undefined,
  fcTransfer: number | null | undefined,
): number | null {
  if (!isQuantity(available) || !isQuantity(fcTransfer)) return null;
  return available + fcTransfer;
}

function isQuantity(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** SP-API's reserved total already contains FC transfers. Remove them from
 * the displayed reserved bucket so they do not appear in two categories.
 */
export function reservedExcludingFcTransfers(
  reserved: number | null | undefined,
  fcTransfer: number | null | undefined,
): number | null {
  if (!isQuantity(reserved) || !isQuantity(fcTransfer) || reserved < fcTransfer) {
    return null;
  }
  return reserved - fcTransfer;
}
