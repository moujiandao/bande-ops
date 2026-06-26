import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Pure authorization check for the scheduled-sync cron endpoint.
 *
 * The cron route (`app/api/cron/sync/route.ts`) is a public HTTP endpoint that
 * triggers a privileged full sync (service-role writes via the admin client),
 * so it MUST reject anything that isn't the scheduler. Two callers are trusted:
 *
 *   1. Vercel Cron — its invocations carry the `x-vercel-cron` header, which
 *      Vercel sets internally and which cannot be spoofed by external traffic
 *      reaching a Vercel-hosted function.
 *   2. A manual / external trigger presenting `Authorization: Bearer <secret>`
 *      matching the `CRON_SECRET` env var (e.g. curl, an uptime checker, or a
 *      second scheduler). This is the shared-secret fallback.
 *
 * Kept as a pure function (headers + env in, boolean out) so it's unit-testable
 * with no request/Response plumbing. The route stays a thin adapter.
 */

/** Minimal header reader — `Headers` satisfies this, so do plain test stubs. */
export interface HeaderReader {
  get(name: string): string | null;
}

/** The slice of the environment this check reads. */
export interface CronAuthEnv {
  CRON_SECRET?: string;
}

/**
 * Constant-time string equality. Hashes both sides to a fixed-length digest so
 * the comparison leaks neither the secret's bytes (no early-exit byte compare)
 * nor its length. Used for the bearer-token check below.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * True iff the request is an authorized cron invocation.
 *
 * Accepts EITHER Vercel's `x-vercel-cron` header OR a correct
 * `Authorization: Bearer <CRON_SECRET>`. When `CRON_SECRET` is unset, the
 * bearer path is disabled entirely so a request can never authorize against an
 * empty/undefined secret (no "Bearer undefined" footgun).
 */
export function isAuthorizedCronRequest(
  headers: HeaderReader,
  env: CronAuthEnv,
): boolean {
  // Vercel-internal header: present only on platform-triggered cron runs. Vercel
  // strips inbound `x-vercel-*` headers from external traffic, so this is
  // unspoofable ON VERCEL. If ever self-hosted behind a non-Vercel proxy, drop
  // this branch and rely solely on CRON_SECRET.
  if (headers.get('x-vercel-cron')) {
    return true;
  }

  // Shared-secret fallback. Disabled unless a secret is actually configured.
  const secret = env.CRON_SECRET;
  if (secret) {
    const authorization = headers.get('authorization');
    if (authorization && safeEqual(authorization, `Bearer ${secret}`)) {
      return true;
    }
  }

  return false;
}
