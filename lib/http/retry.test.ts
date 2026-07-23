import { describe, expect, it } from 'vitest';

import { isRetryable, retryDelayMs } from './retry';

describe('retryDelayMs', () => {
  it('honors a Retry-After header expressed in seconds', () => {
    const headers = new Headers({ 'retry-after': '3' });
    expect(retryDelayMs(0, headers)).toBe(3000);
  });

  it('caps an oversized Retry-After at the max backoff delay', () => {
    const headers = new Headers({ 'retry-after': '600' });
    expect(retryDelayMs(0, headers)).toBe(8_000);
  });

  it('falls back to jittered backoff when Retry-After is absent', () => {
    const delay = retryDelayMs(0, new Headers());
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(8_000);
  });

  it('ignores a non-numeric Retry-After and falls back to backoff', () => {
    const headers = new Headers({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' });
    const delay = retryDelayMs(0, headers);
    expect(delay).toBeLessThanOrEqual(8_000);
    expect(Number.isFinite(delay)).toBe(true);
  });
});

describe('isRetryable', () => {
  it('retries throttling and server errors', () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(500)).toBe(true);
    expect(isRetryable(503)).toBe(true);
  });

  it('does not retry client errors that will not fix themselves', () => {
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(403)).toBe(false);
    expect(isRetryable(404)).toBe(false);
  });
});
