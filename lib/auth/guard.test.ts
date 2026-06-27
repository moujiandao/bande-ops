import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionUser } from '@/lib/auth/types';

// requireOwner is the authorization gate for the app's privileged, state-
// changing actions (the first write-back to Amazon). It must:
//   - return the user when role === 'owner'
//   - THROW (fail loud) for an authenticated non-owner (staff)
//
// We mock the two collaborators requireUser leans on — the Supabase server
// client factory and loadSessionUser — so there is no network/cookies. Because
// a user is always present in these cases, the redirect('/login') path is never
// hit, so next/navigation does not need mocking here.

const loadSessionUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({}),
}));
vi.mock('@/lib/auth/session', () => ({
  loadSessionUser: (...args: unknown[]) => loadSessionUser(...args),
}));

import { requireOwner } from './guard';

const owner: SessionUser = {
  id: 'owner-1',
  email: 'owner@example.com',
  role: 'owner',
};
const staff: SessionUser = {
  id: 'staff-1',
  email: 'staff@example.com',
  role: 'staff',
};

beforeEach(() => {
  loadSessionUser.mockReset();
});

describe('requireOwner', () => {
  it('returns the user when role is owner', async () => {
    loadSessionUser.mockResolvedValue(owner);
    await expect(requireOwner()).resolves.toEqual(owner);
  });

  it('throws for an authenticated staff user (fail loud, no silent pass)', async () => {
    loadSessionUser.mockResolvedValue(staff);
    await expect(requireOwner()).rejects.toThrow(/owner role/i);
  });
});
