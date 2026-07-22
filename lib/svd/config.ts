import 'server-only';

export interface SvdConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export function getSvdConfig(): SvdConfig {
  const baseUrl = process.env.SVD_BASE_URL?.trim() || 'https://svdirect.us';
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
