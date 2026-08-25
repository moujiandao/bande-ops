/**
 * SVD → FBA replenishment math.
 *
 * Lives here rather than in the reorder table component because it is reorder
 * math, not presentation: it needs unit tests, and while it sat in a client
 * component it silently acquired the box/unit defect that `supply.ts` was fixed
 * for.
 *
 * Every quantity below is in UNITS. `row.sources.svd` is already converted from
 * SVD's boxes by `service.ts`; nothing here multiplies anything.
 */

import type { RecommendationRow } from './service';

export type SvdShipmentBoxCounts = Record<string, number | ''>;

/**
 * Days of cover from stock at or heading to Amazon.
 *
 * The amazon-side figure (`sources.amazonSideCounted`) is assembled in
 * `service.ts`, where the policy lives: FBA fulfillable + policy-counted FBA
 * incoming + policy-counted AWD. It must NOT be reassembled here — doing so from
 * `sources.awd` (which shows ALL AWD, including in-transit units FBA inbound
 * already reports) would double-count.
 *
 * SVD is excluded deliberately: it cannot fulfil a customer order, so it reduces
 * future reorder need without extending current cover. Reserved and
 * unfulfillable FBA stock are likewise excluded, though the breakdown shows them.
 */
export function amazonSideCover(row: RecommendationRow): number | null {
  if (row.dailyDemand === null || row.dailyDemand <= 0) return null;
  if (row.sources.fba === null && row.sources.awd === null) return null;
  return Math.floor(row.sources.amazonSideCounted / row.dailyDemand);
}

/**
 * Units to send from SVD to reach the coverage target, capped by what SVD
 * actually has. Never suggests shipping stock that is not there.
 *
 * A null `sources.svd` means the unit count could not be derived — an unset
 * pack size, or an unreadable quantity — and yields null rather than a guess.
 */
export function suggestedShipQty(
  row: RecommendationRow,
  targetDays: number,
): number | null {
  if (row.dailyDemand === null || row.dailyDemand <= 0) return null;
  const svd = row.sources.svd;
  if (svd === null || svd <= 0) return null;
  const shortfall = Math.ceil(
    row.dailyDemand * targetDays - row.sources.amazonSideCounted,
  );
  if (shortfall <= 0) return null;
  return Math.min(shortfall, svd);
}

export function suggestedBoxesToSend(
  shipUnits: number | null,
  unitsPerBox: number | null,
): number | null {
  if (shipUnits === null || !Number.isFinite(shipUnits) || shipUnits < 0) return null;
  if (unitsPerBox === null || !Number.isFinite(unitsPerBox) || unitsPerBox <= 0) {
    return null;
  }
  return Math.ceil(shipUnits / unitsPerBox);
}

export function svdShipmentRowKey(row: RecommendationRow): string {
  return `${row.marketplaceId}:${row.sku}`;
}

export function initialSvdShipmentBoxCounts(
  rows: RecommendationRow[],
  targetDays: number,
): SvdShipmentBoxCounts {
  return Object.fromEntries(
    rows.map((row) => [
      svdShipmentRowKey(row),
      suggestedBoxesToSend(
        suggestedShipQty(row, targetDays),
        row.svdUnitsPerBox,
      ) ?? '',
    ]),
  );
}

function svdShipmentEmailRows(
  rows: RecommendationRow[],
  counts: SvdShipmentBoxCounts,
) {
  return rows.map((row) => ({
    box: row.boxName ?? '(not set)',
    numberOfBoxes: counts[svdShipmentRowKey(row)] ?? '',
  }));
}

export function applySvdShipmentBoxCount({
  monthYear,
  rows,
  currentCounts,
  rowKey,
  numberOfBoxes,
}: {
  monthYear: string;
  rows: RecommendationRow[];
  currentCounts: SvdShipmentBoxCounts;
  rowKey: string;
  numberOfBoxes: number | '';
}): { boxesToSend: SvdShipmentBoxCounts; emailDraft: string } {
  const boxesToSend = { ...currentCounts, [rowKey]: numberOfBoxes };
  return {
    boxesToSend,
    emailDraft: buildSvdShipmentEmail(
      monthYear,
      svdShipmentEmailRows(rows, boxesToSend),
    ),
  };
}

/**
 * React key for the session-only draft. A server refresh that changes shipment
 * inputs remounts the table so stale counts and removed rows cannot survive.
 */
export function svdShipmentDraftKey(
  rows: RecommendationRow[],
  targetDays: number,
  monthYear: string,
): string {
  return JSON.stringify([
    monthYear,
    targetDays,
    rows.map((row) => [
      svdShipmentRowKey(row),
      row.boxName,
      suggestedShipQty(row, targetDays),
      row.svdUnitsPerBox,
    ]),
  ]);
}

export function formatShipmentMonthYear(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(date);
}

export function buildSvdShipmentEmail(
  monthYear: string,
  rows: ReadonlyArray<{ box: string; numberOfBoxes: number | '' }>,
): string {
  const table = [
    'Box | Number of Boxes',
    ...rows.map((row) => `${row.box} | ${row.numberOfBoxes}`),
  ].join('\n');

  return `Subject: B&E Medical ${monthYear} Shipment


Hi Julio,

See attached for box labels and pallet labels. They will be coming within 2 days to pick up the boxes.

${table}

As always please email or call me if you have any questions.

Kind regards,
Brian
5107171898`;
}

export function shouldReplenishFromSvd(
  row: RecommendationRow,
  targetDays: number,
): boolean {
  const cover = amazonSideCover(row);
  return (
    cover !== null &&
    cover < targetDays &&
    suggestedShipQty(row, targetDays) !== null
  );
}
