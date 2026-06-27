# Changelog

## [2026-06-27]

### Added
- Add Ads Module 2 slice A2 (campaign performance metrics) to `lib/ads/`: `metrics.ts` (PURE `acos(cost, sales)` / `roas(sales, cost)` -> `number | null`; zero/null denominator and non-finite inputs yield `null` (UNKNOWN), NEVER 0 or Infinity), `metrics-mapping.ts` (pure `CampaignMetrics -> ads_campaign_metrics row`, nulls preserved), and `syncCampaignMetrics` in `sync.ts` (dependency-injected upsert, idempotent on conflict `(marketplace_id, campaign_id)`). Extend `types.ts` with `CampaignMetrics` and `AdsCampaignMetricsRow`.
- Extend the `AdsClient` interface with `getCampaignMetrics(opts?)`: `AdsApiClient` implements it as a documented, BATCHED (one report, all campaigns) v3 async reporting skeleton (POST `/reporting/reports` with `application/vnd.createasyncreportrequest.v3+json`, `reportTypeId` `spCampaigns`, poll until COMPLETED, download+gunzip+parse) — the live network/gunzip leg throws NotImplemented (gated on sandbox-verified creds, never fabricates 0s); `FakeAdsClient` returns canned metrics (full / spend-no-sales / all-UNKNOWN).
- Add `supabase/migrations/0007_ads_campaign_metrics.sql`: `public.ads_campaign_metrics` synced mirror keyed on `(marketplace_id, campaign_id)` with nullable `impressions`/`clicks`/`cost`/`sales` numeric (NULL = UNKNOWN, column-commented; ACOS/ROAS deliberately not stored), `synced_at`, RLS enabled, authenticated SELECT only (writes via service role).
- Add vitest coverage: `metrics.test.ts` (exhaustive null/zero-denominator invariant — UNKNOWN is null, never 0/Infinity), `metrics-mapping.test.ts` (nulls preserved, true 0 distinct), and `syncCampaignMetrics` tests in `sync.test.ts` (idempotent upsert, UNKNOWN preserved).

### Changed
- Extend `/ads` (`app/(app)/ads/page.tsx`) with Spend, Sales, ACOS, ROAS columns joined from `ads_campaign_metrics` on `(marketplace_id, campaign_id)`; ACOS/ROAS are computed at render via `lib/ads/metrics.ts`. A null metric, absent metrics row, or computed-UNKNOWN ratio renders a distinct muted "Unknown" badge, never as 0/$0/0%. ACOS formatted as a percentage.
- Wire `syncAdsAction` (`app/(app)/ads/actions.ts`) to run `syncCampaigns` then `syncCampaignMetrics` after `requireUser()`.

## [2026-06-26]

### Added
- Add `lib/ads/` Module 2 (slice A1) Ads client seam — a SEPARATE API from SP-API (own host, own LWA client, profile-scoped auth): `types.ts` (`Campaign`, `CampaignState`, `AdsCampaignRow`; re-exports shared `MarketplaceId`/`DEFAULT_MARKETPLACE` from `@/lib/amazon/types`), `config.ts` (server-only lazy `getAdsConfig` reading `ADS_CLIENT_ID`/`ADS_CLIENT_SECRET`/`ADS_REFRESH_TOKEN`/`ADS_PROFILE_ID`/`AMAZON_USE_SANDBOX`), `client.ts` (`import 'server-only'`; `AdsClient` interface + `AdsApiClient` with self-contained LWA token refresh and 429/5xx retry+backoff `request()`, mapping the Sponsored Products v2 campaigns endpoint, live calls TODO-gated on sandbox), `fake-client.ts` (`FakeAdsClient`, node-safe, canned enabled/paused/null-budget campaigns), `index.ts` (barrel + `getAdsClient()` factory — Fake when `AMAZON_USE_FAKE=true`), `mapping.ts` (pure `Campaign -> ads_campaigns row`, null budget preserved, never 0), and `sync.ts` (`syncCampaigns`, dependency-injected upsert orchestration, idempotent on conflict `(marketplace_id, campaign_id)`).
- Add `supabase/migrations/0006_ads_campaigns.sql`: `public.ads_campaigns` synced mirror keyed on `(marketplace_id, campaign_id)` with `name`/`state`/nullable `daily_budget` numeric (NULL = UNKNOWN, column-commented)/`synced_at`, RLS enabled, authenticated SELECT only (writes via service role).
- Add `/ads` route (`app/(app)/ads/page.tsx`) listing campaigns from the mirror via the authenticated server client — name, state badge, daily budget (null renders a distinct "Unknown" badge, never $0), last-synced stamp, empty state, and a "Sync now" server action (`actions.ts`, `syncAdsAction` — `requireUser()` then `syncCampaigns(getAdsClient(), createAdminClient())`, revalidates `/ads`).
- Add vitest coverage for the ads module: `mapping.test.ts`, `sync.test.ts`, `fake-client.test.ts` (FakeAdsClient + mocked admin client; no network/DB), explicitly asserting UNKNOWN (null) budget is never coerced to 0 and sync is idempotent.
- Make "Ads" a live link to `/ads` under Modules in `components/nav.tsx` (removed its "Soon" disabled state).
- Add `lib/reorder/` reorder recommender (Module 1, decision-support only): `recommend.ts` (PURE `recommend()` — `reorderPoint = dailyDemand*leadTimeDays + safetyStock`, discriminated-union `ok | needs-review`; UNKNOWN/null on-hand or demand and invalid inputs surface as `needs-review`, never a number), `demand.ts` (DemandProvider seam barrel + `getDemandProvider()` factory), `fake-demand.ts` (`FakeDemandProvider`, node-safe), `spapi-demand.ts` (`SpApiDemandProvider` server-only skeleton — FBA Inventory Ledger via SP-API Reports, live fetch TODO gated on creds), and `service.ts` (`assembleRecommendations`, dependency-injected supabase + provider).
- Add `/reorder` route (`app/(app)/reorder/page.tsx`) listing SKUs to reorder with quantity + reasoning (on-hand, demand, lead time, safety stock, reorder point), plus distinct "Needs review" and "Well stocked" sections; recompute is per-request server read.
- Add vitest coverage for the reorder module: table-driven `recommend.test.ts` (clear reorder / well-stocked / at-reorder-point / zero demand / zero safety stock / UNKNOWN on-hand + demand, asserting null is never treated as 0 and never a number) and `service.test.ts` (assembly over a mocked supabase + FakeDemandProvider).
- Add "Reorder" link under Modules in `components/nav.tsx`.
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
