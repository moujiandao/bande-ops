import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_CLASSIFICATION_OPTIONS,
  ClassificationLegend,
} from './classification-legend';

describe('ClassificationLegend', () => {
  it('renders every filter option with an accessible heading and explanation', () => {
    const markup = renderToStaticMarkup(<ClassificationLegend />);

    expect(markup).toContain('aria-labelledby="classification-legend-heading"');
    expect(markup).toContain('Classification legend');
    expect(ANALYTICS_CLASSIFICATION_OPTIONS.map((item) => item.value)).toEqual([
      'all',
      'trending',
      'early',
      'constrained',
      'insufficient',
      'historical',
    ]);
    for (const item of ANALYTICS_CLASSIFICATION_OPTIONS) {
      expect(markup).toContain(item.label);
      expect(markup).toContain(item.description);
    }
  });
});
