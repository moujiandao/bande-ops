export interface SvdMappingCandidate {
  svdItemId: string;
  sku: string | null;
  fnSku: string | null;
}

export interface ManualMapping {
  amazonSku: string;
  svdItemId: string;
}

export type SourceMappingResult =
  | {
      status: 'mapped';
      svdItemId: string;
      mappingSource: 'fn_sku' | 'sku' | 'manual';
    }
  | { status: 'needs-review'; reason: 'missing-svd-mapping' };

export function resolveSourceMapping(input: {
  amazonSku: string;
  fnSku: string | null;
  svdRows: SvdMappingCandidate[];
  manualMappings: ManualMapping[];
}): SourceMappingResult {
  if (input.fnSku) {
    const byFnSku = input.svdRows.find((row) => row.fnSku === input.fnSku);
    if (byFnSku) {
      return {
        status: 'mapped',
        svdItemId: byFnSku.svdItemId,
        mappingSource: 'fn_sku',
      };
    }
  }

  const bySku = input.svdRows.find((row) => row.sku === input.amazonSku);
  if (bySku) {
    return { status: 'mapped', svdItemId: bySku.svdItemId, mappingSource: 'sku' };
  }

  const manual = input.manualMappings.find(
    (row) => row.amazonSku === input.amazonSku,
  );
  if (manual) {
    return {
      status: 'mapped',
      svdItemId: manual.svdItemId,
      mappingSource: 'manual',
    };
  }

  return { status: 'needs-review', reason: 'missing-svd-mapping' };
}
