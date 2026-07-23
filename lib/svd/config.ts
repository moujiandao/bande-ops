import 'server-only';

export interface SvdConfig {
  baseUrl: string;
  username: string;
  password: string;
}

const DEFAULT_BASE_URL = 'https://svdirect.us';

/**
 * Reduce whatever is configured to a bare origin.
 *
 * The natural thing to paste into SVD_BASE_URL is the login URL copied out of
 * the browser, which carries a path, a stale PmSess1 and a query string. The
 * client builds every path itself, so anything beyond the origin would produce
 * a doubled URL and a 404. Normalizing here is friendlier than failing.
 */
function normalizeBaseUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_BASE_URL;
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, '');
  }
}

export function getSvdConfig(): SvdConfig {
  const baseUrl = normalizeBaseUrl(process.env.SVD_BASE_URL);
  const username = process.env.SVD_USERNAME?.trim();
  const password = process.env.SVD_PASSWORD?.trim();
  const missing = [
    username ? null : 'SVD_USERNAME',
    password ? null : 'SVD_PASSWORD',
  ].filter((value): value is string => value !== null);

  if (missing.length > 0) {
    throw new Error(`SVD config missing required env var(s): ${missing.join(', ')}`);
  }

  return { baseUrl, username: username!, password: password! };
}
