import { describe, it, expect } from 'vitest';
import { isAuthorizedCronRequest, type HeaderReader } from './auth';

// The cron route is a public endpoint guarding a privileged sync, so this auth
// check is the security boundary. Tests pin the two accepted paths (Vercel's
// header, the bearer secret) and the rejection of everything else.

/** Build a HeaderReader from a plain map (case-insensitive, like `Headers`). */
function headers(map: Record<string, string>): HeaderReader {
  const lower = new Map(
    Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { get: (name) => lower.get(name.toLowerCase()) ?? null };
}

const SECRET = 's3cr3t-cron-token';

describe('isAuthorizedCronRequest', () => {
  it('authorizes a correct Authorization: Bearer <CRON_SECRET>', () => {
    expect(
      isAuthorizedCronRequest(
        headers({ authorization: `Bearer ${SECRET}` }),
        { CRON_SECRET: SECRET },
      ),
    ).toBe(true);
  });

  it("authorizes Vercel's x-vercel-cron header (no bearer needed)", () => {
    expect(
      isAuthorizedCronRequest(
        headers({ 'x-vercel-cron': '1' }),
        { CRON_SECRET: SECRET },
      ),
    ).toBe(true);
  });

  it('authorizes the vercel-cron header even when no secret is configured', () => {
    expect(
      isAuthorizedCronRequest(headers({ 'x-vercel-cron': '1' }), {}),
    ).toBe(true);
  });

  it('rejects a request with no credentials at all', () => {
    expect(isAuthorizedCronRequest(headers({}), { CRON_SECRET: SECRET })).toBe(
      false,
    );
  });

  it('rejects a wrong bearer token', () => {
    expect(
      isAuthorizedCronRequest(
        headers({ authorization: 'Bearer not-the-secret' }),
        { CRON_SECRET: SECRET },
      ),
    ).toBe(false);
  });

  it('rejects a bearer token when CRON_SECRET is unset (no "Bearer undefined")', () => {
    expect(
      isAuthorizedCronRequest(headers({ authorization: 'Bearer undefined' }), {}),
    ).toBe(false);
  });

  it('rejects a malformed Authorization header (missing Bearer scheme)', () => {
    expect(
      isAuthorizedCronRequest(headers({ authorization: SECRET }), {
        CRON_SECRET: SECRET,
      }),
    ).toBe(false);
  });
});
