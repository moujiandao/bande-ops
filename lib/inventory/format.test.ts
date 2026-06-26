import { describe, it, expect } from 'vitest';
import { formatInventoryLevel, UNKNOWN_LABEL } from './format';

// This helper is the one place the UNKNOWN-stock rule reaches the UI. These
// tests pin the three-way mapping and, above all, assert that null is surfaced
// as UNKNOWN and is NEVER rendered or treated as 0 (and vice versa: a true 0 is
// never UNKNOWN).

describe('formatInventoryLevel', () => {
  it('maps null to the UNKNOWN sentinel — never to "0"', () => {
    const d = formatInventoryLevel(null);
    expect(d.isUnknown).toBe(true);
    expect(d.label).toBe(UNKNOWN_LABEL);
    expect(d.label).not.toBe('0');
  });

  it('maps a missing row (undefined) to UNKNOWN, not 0', () => {
    const d = formatInventoryLevel(undefined);
    expect(d.isUnknown).toBe(true);
    expect(d.label).toBe(UNKNOWN_LABEL);
    expect(d.label).not.toBe('0');
  });

  it('maps a true 0 to "0" and marks it NOT unknown', () => {
    const d = formatInventoryLevel(0);
    expect(d.isUnknown).toBe(false);
    expect(d.label).toBe('0');
  });

  it('maps a positive number to its string', () => {
    const d = formatInventoryLevel(42);
    expect(d.isUnknown).toBe(false);
    expect(d.label).toBe('42');
  });

  it('keeps UNKNOWN and 0 distinguishable (the core invariant)', () => {
    const unknown = formatInventoryLevel(null);
    const zero = formatInventoryLevel(0);
    expect(unknown.isUnknown).not.toBe(zero.isUnknown);
    expect(unknown.label).not.toBe(zero.label);
  });
});
