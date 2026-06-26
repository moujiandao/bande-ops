# Changelog

## [2026-06-26]

### Added
- Add `supabase/migrations/0003_inventory_levels.sql`: `public.inventory_levels` synced mirror keyed on `(marketplace_id, sku)` with nullable `total_quantity` (NULL = UNKNOWN, column-commented), nullable `fn_sku`, `synced_at`, RLS enabled, authenticated SELECT only (writes via service role).
- Add `lib/inventory/` Module 1 inventory path: `mapping.ts` (pure `InventorySummary -> row`, preserves null), `sync.ts` (`syncInventory`, dependency-injected upsert orchestration, idempotent on conflict), and `format.ts` (`formatInventoryLevel` UI helper mapping null -> "Unknown", 0 -> "0", n -> n).
- Add vitest coverage for the inventory mapping, sync orchestration, and display formatting, explicitly asserting UNKNOWN (null) is never coerced to 0.
- Add `supabase/migrations/0002_catalog_items.sql`: `public.catalog_items` synced mirror keyed on `(marketplace_id, sku)` with `asin`/`title`/`image_url`/`synced_at`, RLS enabled, authenticated SELECT only (writes via service role).
- Add `lib/supabase/admin.ts`: server-only service-role Supabase client factory (`createAdminClient`) reading env lazily; used for mirror writes, never client-side.
- Add `lib/catalog/` Module 1 sync path: `mapping.ts` (pure `CatalogItem -> row`) and `sync.ts` (`syncCatalog`, dependency-injected upsert orchestration, idempotent on conflict).
- Add `/catalog` route (`app/(app)/catalog/page.tsx`) reading the mirror via the authenticated server client, with sku/asin/title/image table, last-synced stamp, empty state, and a "Sync now" server action (`actions.ts`).
- Add vitest coverage for the catalog mapping and sync orchestration (FakeAmazonClient + mocked admin client; no network/DB).
- Add public `/login` route (`app/login/`) with email + password sign-in via a server action; redirects already-signed-in users to the dashboard.
- Add protected route group `app/(app)/` whose layout gates on `getUser()` and redirects to `/login` when unauthenticated, rendering `AppShell` with the signed-in email + role.
- Add `lib/auth/` spine module: `session.ts` (`loadSessionUser` — verified user + role from `profiles`), `actions.ts` (`signIn`/`signOut` server actions), `types.ts` (`Role`, `SessionUser`, `SignInState`).
- Add sign-out control to `AppShell` topbar.
- Add `lib/auth/session.test.ts` covering the logged-out redirect decision and owner/staff role resolution with a mocked Supabase client.

### Changed
- Extend `/catalog` (`app/(app)/catalog/page.tsx`) with an Inventory column joined from `inventory_levels` on `(marketplace_id, sku)`; null or missing rows render a distinct muted "Unknown" badge, never as 0.
- Make `syncCatalogAction` (`app/(app)/catalog/actions.ts`) run both `syncCatalog` and `syncInventory` so one "Sync now" refreshes catalog + inventory mirrors.
- Add `@/*` path alias resolution to `vitest.config.ts` so tests can import via `@/...` like app code.
- Move the Dashboard page from `app/page.tsx` into `app/(app)/page.tsx`.
- Strip `AppShell` out of the root `app/layout.tsx`; it now only provides the html/body + globals.css shell. `AppShell` is mounted by the protected layout.
