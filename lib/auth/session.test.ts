import { describe, it, expect } from "vitest";
import { loadSessionUser } from "./session";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// These tests pin the two auth decisions the shell depends on:
//   1. logged-out (no verified user) -> loadSessionUser returns null, which is
//      what the protected layout turns into redirect('/login').
//   2. role resolution -> owner stays owner, staff stays staff, and anything
//      missing/garbage degrades to staff (least privilege).
//
// We mock the Supabase client structurally and cast it to the real client
// type, so no network and no live creds. The mock reproduces only the two
// call shapes loadSessionUser uses: auth.getUser() and the
// from('profiles').select('role').eq('id', …).single() chain.

type MockOpts = {
  user?: { id: string; email?: string | null } | null;
  getUserError?: unknown;
  profile?: { role?: string } | null;
  profileError?: unknown;
};

function mockSupabase(opts: MockOpts): SupabaseServerClient {
  const { user = null, getUserError = null, profile = null, profileError = null } =
    opts;

  const client = {
    auth: {
      getUser: async () => ({ data: { user }, error: getUserError }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: profile, error: profileError }),
        }),
      }),
    }),
  };

  return client as unknown as SupabaseServerClient;
}

describe("loadSessionUser — redirect decision", () => {
  it("returns null when there is no signed-in user (drives redirect to /login)", async () => {
    const result = await loadSessionUser(mockSupabase({ user: null }));
    expect(result).toBeNull();
  });

  it("returns null when getUser reports an error", async () => {
    const result = await loadSessionUser(
      mockSupabase({ user: { id: "u1" }, getUserError: { message: "bad jwt" } }),
    );
    expect(result).toBeNull();
  });
});

describe("loadSessionUser — role read from profiles", () => {
  it("resolves an owner", async () => {
    const result = await loadSessionUser(
      mockSupabase({
        user: { id: "owner-id", email: "owner@example.com" },
        profile: { role: "owner" },
      }),
    );
    expect(result).toEqual({
      id: "owner-id",
      email: "owner@example.com",
      role: "owner",
    });
  });

  it("resolves a staff user", async () => {
    const result = await loadSessionUser(
      mockSupabase({
        user: { id: "staff-id", email: "staff@example.com" },
        profile: { role: "staff" },
      }),
    );
    expect(result?.role).toBe("staff");
    expect(result?.email).toBe("staff@example.com");
  });

  it("defaults to staff when the profile row is missing", async () => {
    const result = await loadSessionUser(
      mockSupabase({
        user: { id: "ghost-id", email: "ghost@example.com" },
        profile: null,
      }),
    );
    expect(result?.role).toBe("staff");
  });

  it("defaults to staff for an unrecognized role value", async () => {
    const result = await loadSessionUser(
      mockSupabase({
        user: { id: "weird-id", email: "weird@example.com" },
        profile: { role: "superadmin" },
      }),
    );
    expect(result?.role).toBe("staff");
  });

  it("tolerates a null email", async () => {
    const result = await loadSessionUser(
      mockSupabase({ user: { id: "no-email", email: null }, profile: { role: "owner" } }),
    );
    expect(result?.email).toBe("");
  });
});
