# Changelog

## [2026-06-26]

### Added
- Add public `/login` route (`app/login/`) with email + password sign-in via a server action; redirects already-signed-in users to the dashboard.
- Add protected route group `app/(app)/` whose layout gates on `getUser()` and redirects to `/login` when unauthenticated, rendering `AppShell` with the signed-in email + role.
- Add `lib/auth/` spine module: `session.ts` (`loadSessionUser` — verified user + role from `profiles`), `actions.ts` (`signIn`/`signOut` server actions), `types.ts` (`Role`, `SessionUser`, `SignInState`).
- Add sign-out control to `AppShell` topbar.
- Add `lib/auth/session.test.ts` covering the logged-out redirect decision and owner/staff role resolution with a mocked Supabase client.

### Changed
- Move the Dashboard page from `app/page.tsx` into `app/(app)/page.tsx`.
- Strip `AppShell` out of the root `app/layout.tsx`; it now only provides the html/body + globals.css shell. `AppShell` is mounted by the protected layout.
