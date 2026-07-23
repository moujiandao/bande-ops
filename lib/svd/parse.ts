import type { SvdInventoryItem } from './types';

function clean(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function quantityFromAvailability(raw: string): number | null {
  const value = clean(raw);
  if (/^temporarily out of stock$/i.test(value)) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  // Anything else is UNKNOWN and must stay null — never folded to 0.
  return null;
}

/**
 * Offer-list cells carry stable ids: IDData<n>, DESCData<n>, AvailData<n>
 * (alongside class="clsOffData clsIDData" etc). We key off those rather than
 * cell position because a row also contains image, order-qty and add-to-cart
 * cells, and because the offer table is nested inside other tables and
 * interleaved with inline <script> — splitting on <tr> mangles the first row
 * and captures JavaScript as if it were cell text.
 */
const CELL_PATTERN =
  /<td[^>]*\bid=['"](ID|DESC|Avail)Data(\d+)['"][^>]*>([\s\S]*?)<\/td>/gi;

type PartialRow = {
  svdItemId?: string;
  description?: string;
  rawAvailability?: string;
};

export function parseSvdInventoryHtml(html: string): SvdInventoryItem[] {
  const rows = new Map<number, PartialRow>();

  for (const match of html.matchAll(CELL_PATTERN)) {
    const [, kind, index, contents] = match;
    const position = Number(index);
    const row = rows.get(position) ?? {};

    if (kind.toUpperCase() === 'ID') row.svdItemId = clean(contents);
    else if (kind.toUpperCase() === 'DESC') row.description = clean(contents);
    else row.rawAvailability = clean(contents);

    rows.set(position, row);
  }

  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row)
    .filter((row): row is PartialRow & { svdItemId: string } =>
      Boolean(row.svdItemId),
    )
    .map((row) => {
      const rawAvailability = row.rawAvailability ?? '';
      return {
        svdItemId: row.svdItemId,
        description: row.description ?? '',
        quantity: quantityFromAvailability(rawAvailability),
        rawAvailability,
      };
    });
}
