export interface SvdInventoryItem {
  svdItemId: string;
  sku?: string;
  fnSku?: string;
  description: string;
  quantity: number | null;
  rawAvailability: string;
}
