/**
 * Shared retry/backoff policy for the outbound Amazon HTTP clients.
 *
 * SP-API (`lib/amazon/client.ts`) and the Advertising API (`lib/ads/client.ts`)
 * are separate APIs with separate credentials and hosts, but they throttle the
 * same way (429 + `Retry-After`) and both need the same identification header.
 * That shared *transport* policy lives here so a fix lands once; nothing
 * credential-bearing or API-specific belongs in this module, which is why it is
 * pure and free of `server-only`.
 */

/** Retry tuning for transient failures (429 / 5xx). */
export const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
export const MAX_DELAY_MS = 8_000;

/**
 * Amazon asks clients to identify themselves; unidentified callers risk being
 * deprioritized or throttled harder. Bumped by hand — it is a client identity
 * string, not the package version, so it must not drift with every release.
 */
export const USER_AGENT = 'bande-ops/1.0.0 (Language=JavaScript; Platform=Node.js)';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter, capped. */
export function backoffDelay(attempt: number): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

export function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * How long to wait before retrying a transient failure.
 *
 * Amazon publishes its own throttle recovery time via `Retry-After` (seconds);
 * obeying it beats guessing, because blind jitter can keep re-hitting a
 * sustained 429 on the low-rate operations (FBA summaries is 2 rps). Falls back
 * to jittered exponential backoff when the header is missing or not an integer
 * count of seconds (the HTTP-date form is legal but Amazon does not send it),
 * and never waits longer than the normal backoff cap.
 */
export function retryDelayMs(attempt: number, headers?: Headers): number {
  const retryAfter = headers?.get('retry-after')?.trim();
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return Math.min(MAX_DELAY_MS, Number(retryAfter) * 1000);
  }
  return backoffDelay(attempt);
}

/** Observability seam: report each retry wait without stubbing timers. */
export type RetryDelayReporter = (ms: number) => void;

/** Wait before a retry, reporting the chosen delay through the seam. */
export async function waitBeforeRetry(
  attempt: number,
  headers?: Headers,
  onRetryDelay?: RetryDelayReporter,
): Promise<void> {
  const delay = retryDelayMs(attempt, headers);
  onRetryDelay?.(delay);
  await sleep(delay);
}
