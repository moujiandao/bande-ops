import type { SvdInventoryItem } from './types';

function clean(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function quantityFromAvailability(raw: string): number | null {
  const value = clean(raw);
  if (/^temporarily out of stock$/i.test(value)) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  return null;
}

export function parseSvdInventoryHtml(html: string): SvdInventoryItem[] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];

  return rows
    .map((row) => {
      const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
        (match) => clean(match[1]),
      );
      if (cells.length < 3) return null;
      if (/item id/i.test(cells[0])) return null;

      const [svdItemId, description, rawAvailability] = cells;
      if (!svdItemId || !description) return null;

      return {
        svdItemId,
        description,
        quantity: quantityFromAvailability(rawAvailability),
        rawAvailability,
      };
    })
    .filter((row): row is SvdInventoryItem => row !== null);
}
