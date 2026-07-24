# Changelog

## [2026-07-23] FBA incoming in the replenish math

### Fixed
- Count FBA **incoming** toward coverage in the SVD→FBA replenish math (`lib/reorder/replenish.ts`). It previously credited only FBA fulfillable + AWD, so units already inbound to FBA were invisible and it over-recommended pulling stock from SVD. "Incoming" uses the same policy inbound toggles as the reorder supply math, so the term means one thing app-wide. Verified live: 30 of 94 active SKUs carry counted incoming.

### Added
- Add `sources.fbaInbound` (policy-counted incoming, drives the math) and a null-preserving `fbaBreakdown` (available, reserved, the three inbound buckets, researching, unfulfillable) to each reorder row. Every field already existed in the `inventory_levels` mirror; no migration or sync change was needed.
- Add a collapsible FBA breakdown to the Replenish section: the FBA cell shows the full FBA total (Available + Reserved + Incoming + Other) and expands to itemize it, with each incoming bucket linking to the Seller Central inbound-shipments queue. Amazon exposes no reliable per-SKU inbound deep link, so the URL is a single constant (`SELLER_CENTRAL_INBOUND_URL`).

### Changed
- Reserved and unfulfillable FBA stock are now **displayed but never counted** as coverage — reserved is committed to orders and unfulfillable cannot ship. The breakdown states which parts feed the recommendation, so the shown total deliberately differs from the counted figure.

## [2026-07-23] SVD box-to-unit conversion

SVD reports inventory in boxes while FBA and AWD report units, so `/reorder` was
summing incompatible quantities and understating supply for every SKU with SVD
stock. An early magnitude check (a claimed 60 units/box made one SKU's 500 AWD
boxes imply 30,000 units) falsified the original "AWD is also boxes" report, so
the conversion is scoped to SVD alone.

### Fixed
- Convert SVD box counts to units before they enter reorder supply (`lib/reorder/supply.ts`, `service.ts`). `calculateUsableSupply` takes a per-SKU `svdUnitsPerBox` and owns a new `unknown-svd-units-per-box` block that fires **only** when a SKU has non-zero SVD boxes — zero boxes is zero units under any factor, so an un-stocked SKU never blocks. FBA and AWD are untouched.

### Added
- Add `svd_units_per_box` to `replenishment_settings` (migration `0015`): per-SKU pack size, deliberately with **no** global-default fallback. Lead time and safety stock are policy choices where one default applies broadly; a pack size is a physical per-product fact, so a default would fabricate rather than approximate. A missing value stays UNKNOWN and blocks rather than being guessed as 1.
- Make `lead_time_days` and `safety_stock` nullable on per-SKU rows (migration `0016`), with a check constraint keeping them required on the global default row. A per-SKU row can now carry only an override (a box size, a coverage target) and inherit the rest, instead of being forced to pin lead time and safety stock.
- Add `lib/reorder/replenish.ts` with `amazonSideCover` and `suggestedShipQty`, moved out of the reorder table component so the replenish math is unit-tested. `suggestedShipQty` had silently carried the box/unit defect there.
- Add a `saveSvdUnitsPerBoxAction` server action and a "SVD box configuration" section on `/settings`: lists the SKUs currently carried at SVD, unset-with-stock first, one units-per-box input each. Blank clears back to UNKNOWN.

### Changed
- `/reorder` SVD column shows converted units, with a per-cell tooltip giving the derivation (`N units — B boxes × F`) and naming the reason when blank.
- The per-SKU overrides list on `/settings` now shows a row only when it actually overrides lead time, safety stock, or coverage — box-only rows live in the box configuration section instead.
- Seeded 68 supplied pack sizes through the real server-action write path (not raw SQL), so the DB constraints were exercised before the UI depended on them. Verified live: 42 SVD-stocked SKUs, 3 still awaiting a size.

## [2026-07-23] Go-live on real Amazon + SVD data

Flipped to production (`AMAZON_USE_FAKE=false`, `AMAZON_USE_SANDBOX=false`) and fixed
every failure that surfaced. All five bugs below shared one root cause: test fixtures
were **invented rather than captured**, so the suite was green against code that could
not work against the real systems.

### Fixed
- Fix the SVD scraper against the real site (`lib/svd/client.ts`, `parse.ts`): the site allocates a `PmSess1` session id across two redirects and posts to `CustLoginSubmit.asp` with `username`/`password`, so the old direct post could never authenticate. Real offer rows are `[id, image, description, availability]`, so reading description from `cells[1]` dropped every row. Cells are now keyed by their `IDData`/`DESCData`/`AvailData` ids, surviving nested tables and inline script. A page that is not the offer list now throws instead of being returned as empty inventory. Verified live at 79/79 items.
- Fix catalog SKU sourcing (`lib/catalog/sync.ts`): Catalog Items 2022-04-01 is a search API and 400s without identifiers, so `syncCatalog` could never have run in production. FBA inventory summaries now supply the SKU universe and catalog only enriches it, batched to the 20-identifier limit. A row is kept for every stocked SKU so catalog misses do not silently drop SKUs from `/reorder`.
- Fix FBA ledger parsing (`lib/velocity/ledger-mapping.ts`): Amazon quotes every cell including headers, so no column ever matched and all 18k rows were skipped **without an error** — the sync reported success over an empty write. Also converts `MM/DD/YYYY` dates to ISO and takes the magnitude of the negative "Customer Shipments" column, and aggregates by `(marketplace, sku, date)` since one MSKU appears across several FNSKUs per day.
- Fix AWD quantity mapping (`lib/amazon/client.ts`): quantities are nested under `inventoryDetails` and on-hand is `totalOnhandQuantity`, so every AWD row read UNKNOWN and ~12,000 real units were invisible to reorder.
- Fix `mapping_source` omission when saving a manual SVD mapping (NOT NULL with a check constraint).
- Treat an absent AWD/SVD row as 0 rather than UNKNOWN (`lib/reorder/supply.ts`): absence means the SKU is not stored there, which is a fact. A row that exists with an unreadable quantity still blocks.

### Added
- Add `lib/http/retry.ts`: one shared outbound transport policy for both Amazon clients (retry tuning, `Retry-After`, `User-Agent`, an `onRetryDelay` seam). Both previously carried byte-identical copies.
- Add `lib/env/mode.ts` + `components/data-source-banner.tsx` (closes #28): report whether each API serves fake/sandbox/production data by calling each client's own `readUseSandbox()`, and warn on every page whenever data is not fully live.
- Add `lib/listings/`: sync `GET_MERCHANT_LISTINGS_ALL_DATA` for per-SKU `open-date`, which is the only signal separating a dead SKU from a new one. Also fills in SKUs that Catalog Items search returns nothing for (46 → 21). Migration `0012`.
- Add `lib/reorder/legacy.ts`: classify a SKU as legacy when it has not sold in ~550 days AND its listing is over a year old. An unknown open date is never legacy. Migration `0014` records `last_sold_date`.
- Add configurable AWD supply buckets to the replenishment policy (`count_awd_available`, `count_awd_replenishment`), alongside the existing FBA inbound toggles. Migration `0013`.
- Add a settings section to create and remove manual SVD → Amazon SKU mappings, the missing write path for `inventory_source_mappings`.
- Add `lib/ads/client.test.ts` and `lib/svd/client.test.ts` — both HTTP layers previously had no tests.

### Changed
- Match SVD items by `svd_item_id` against the Amazon SKU (`lib/reorder/mappings.ts`). The SVD page exposes neither an FNSKU nor an Amazon SKU, so those columns are null on every row; its item id is the Amazon SKU for 72 of 79 items. Checked last, so manual mappings always win.
- Rework `/reorder`: every list is a sortable table sharing one column set (SKU, FBA, AWD, SVD, Total, per-day, days of cover, order/status), with UNKNOWN rendered as an em dash and always sorted last. Legacy SKUs move to a collapsed section with a count rather than being hidden outright.
- `FakeAmazonClient.listCatalogItems` now throws without `sellerSkus` and filters by them, mirroring the real API. A fake must never be more permissive than the thing it stands in for.
- Widen the ledger fetch to the 550-day legacy window; `calculateSalesVelocity` self-limits to `velocityMaxLookbackDays`, so velocity is unchanged.


## [2026-07-22] Amazon rate-limit compliance

### Added
- Add `lib/http/retry.ts`: one shared outbound-transport policy (retry tuning, jittered backoff, `Retry-After` handling, `User-Agent`) for both Amazon clients, which previously carried byte-identical copies of it. Pure and free of `server-only` — no credentials or API specifics belong there.
- Add `lib/ads/client.test.ts`: first tests for the Advertising HTTP layer, which had none.

### Changed
- Honor Amazon's `Retry-After` header on 429/5xx in `lib/amazon/client.ts` and `lib/ads/client.ts` instead of always guessing with jittered backoff, capped at the existing 8s ceiling. Blind jitter can keep re-hitting a sustained 429 on the low-rate operations (FBA summaries is 2 rps). Closes the rate-limit item in `docs/go-live-readiness.md`.
- Send a descriptive `User-Agent` on every SP-API and Advertising API request; Amazon deprioritizes unidentified clients.
- Both clients take an optional `onRetryDelay` observability seam so throttling is visible to tests and sync logs without stubbing timers.
- Refresh `docs/go-live-readiness.md` with a 2026-07-22 status recheck; the 2026-06-26 audit body was substantially stale (most SP-API blockers and the whole Ads v2→v3 migration have since landed).

## [2026-07-22] Sandbox-flip safety

### Added
- Add `lib/env/mode.ts`: resolve which data each Amazon client is actually serving (`fake` / `sandbox` / `production` per API, independently) using the same flag precedence as the clients themselves, and flag a production deploy that is not fully live.
- Add `components/data-source-banner.tsx`, rendered in `AppShell`: a persistent banner whenever data is not fully live — amber normally, red on a production deploy — and nothing at all once both APIs are on production. Fake and sandbox modes otherwise fail silently, with every page rendering fiction. Closes #28.
- Document the fake → sandbox → production flip order in `docs/go-live-readiness.md`: one stage and one API at a time, sandbox proves auth/parsing but never data correctness, rollback is one env var.

## [2026-07-22] Coverage-based reorder

### Added
- Add `target_coverage_days` to `replenishment_settings` (`supabase/migrations/0011_replenishment_coverage.sql`), per-SKU with a global default; editable in `/settings` (entered in months, stored as days).
- Add `lib/velocity/reconcile-sku.ts`: reconcile truncated FBA-ledger MSKUs to canonical catalog SKUs (exact → unique-prefix; ambiguous/no-match left raw → Needs review), wired into `lib/velocity/sync.ts`. Closes the last piece of #27.

### Changed
- Change the reorder math from a reorder-point top-up to a classic (s,S) policy in `lib/reorder/recommend.ts`: trigger at `s = dailyDemand*leadTime + safetyStock`, then fill to `S = dailyDemand*coverageDays` (order up to `max(S,s)`). `coverageDays` 0/omitted reduces to the old behavior. `lib/settings/resolve.ts` + `lib/reorder/service.ts` thread coverage through; `/reorder` shows each row's coverage target and months-on-hand.

## [2026-07-22]

### Added
- Add live multi-source reorder: `/reorder` recommendations are assembled from four synced mirrors instead of the old throw-only demand provider — detailed FBA inventory (fulfillable + inbound buckets), AWD inventory (`lib/awd`), FBA daily ledger → calculated sales velocity (`lib/velocity`), and SV Direct replenishment inventory (`lib/svd`). New `supabase/migrations/0010_live_inventory_reorder.sql` adds the mirror tables, `source_sync_runs`/`source_sync_state`, `inventory_source_mappings`, and `replenishment_policy` (all RLS-gated, read-only to authenticated).
- Add `lib/sync/run.ts`: source-agnostic sync-run/-state helpers (`recordSyncAttempt`/`recordSyncSuccess`/`recordSyncFailure`) and the shared `SyncWriter` seam every sync module now uses.
- Add `lib/settings/policy.ts`: global `replenishment_policy` (velocity window, which inbound buckets count as usable supply) with defaults, row mapping, form parsing, and validation; editable from `/settings`.
- Add `lib/svd/` (types, server-only config/client, HTML parser, sync, owner-gated `refreshSvdInventoryAction`): SVD is a THIRD external source (not Amazon), server-side creds only, refreshed from the owner-gated `Refresh SVD` button on `/reorder` — never on the cron.
- Add `lib/velocity/` (pure 90-in-stock-day `calculateSalesVelocity`, ledger TSV normalization, Reports-API-driven sync) and `lib/amazon/reports.ts` (report request/status shapes + ledger report body).
- Add `lib/reorder/supply.ts` (pure usable-supply from FBA + AWD + SVD under policy) and `lib/reorder/mappings.ts` (FNSKU-first → SKU → manual SVD mapping).

### Changed
- Fix SP-API client correctness for the live path: send `SPAPI_SELLER_ID` on seller-SKU catalog lookups, add `details=true` to FBA inventory, paginate catalog/FBA/AWD, add AWD inventory + Reports API methods, drop the superfluous `Authorization` header. `SPAPI_SELLER_ID` is now required in live mode.
- Rewire `lib/cron/sync-all.ts` (`runFullSync`) to refresh catalog, FBA inventory, AWD inventory, and velocity alongside the two ads mirrors; unify all six sync modules on the shared `SyncWriter` seam so the cron's single `admin` dep doesn't exceed TypeScript's instantiation-depth limit at `next build`.
- Rewrite `lib/reorder/service.ts` off the `DemandProvider`: read persisted velocity + multi-source supply and surface source health, supply breakdown, velocity sample size, and `Needs review` reasons; rename `recommend()`'s `onHand` input to `usableSupply`. Reorder and settings UIs render the new source-health strip, supply breakdown, and policy controls.
- Document `SPAPI_SELLER_ID` and `SVD_BASE_URL`/`SVD_USERNAME`/`SVD_PASSWORD` in `.env.example`; update `docs/go-live-readiness.md` with the live-reorder readiness checklist.

### Removed
- Remove the per-SKU page-load demand path (`lib/reorder/demand.ts`, `fake-demand.ts`, `spapi-demand.ts`), replaced by the persisted velocity mirror.

## [2026-06-27]

### Added
- Add Ads Module 2 slice A5 (recommendations + the FIRST guarded write-back to Amazon): `lib/ads/recommend.ts` (PURE `recommendCampaignActions({state, cost, sales, dailyBudget, acosTarget, flags}) -> Recommendation[]`; decision-support only — spend-no-sales -> suggest `pause`, high-acos -> suggest `lower-budget` with a `suggestedBudget` only when the budget is KNOWN; UNKNOWN-safe and paused-safe, re-verifies each trigger on raw metrics) and `lib/ads/write.ts` (injectable, node-safe `applyCampaignChange` orchestration enforcing the safety order authorize -> validate -> log-before-write -> write -> re-sync).
- Add `requireOwner()` to `lib/auth/guard.ts`: builds on `requireUser()` and THROWS for an authenticated non-owner (owner-only gate for privileged/state-changing actions); `requireUser` left intact.
- Extend the `AdsClient` seam with `updateCampaign({campaignId, state?, dailyBudget?})`: `AdsApiClient` implements a documented v3 Sponsored Products write skeleton (PUT `/sp/campaigns`, `application/vnd.spCampaign.v3+json`, state/budget mapping) that throws NotImplemented on the live path (gated on sandbox verification, never silently no-ops); `FakeAdsClient.updateCampaign` mutates its in-memory campaign so a fake round-trip reflects the change.
- Add `supabase/migrations/0009_ads_write_log.sql`: append-only `public.ads_write_log` audit table (`marketplace_id`, `campaign_id`, `actor_email`, `change` jsonb {kind, before, after}, `created_at`), RLS enabled — authenticated SELECT and a self-bound INSERT (`actor_email = auth.jwt()->>'email'`), NO update/delete policy.
- Add `app/(app)/ads/write-actions.ts` (`'use server'` `applyCampaignChange` wrapper wiring `requireOwner` + authenticated client + `getAdsClient().updateCampaign` + a `syncCampaigns` re-sync, revalidates `/ads`).
- Add vitest coverage: `recommend.test.ts` (UNKNOWN-safe, paused-safe, stale-flag re-verification, suggestedBudget rules), `write.test.ts` (guard-ordering: authorize-first, log-before-write, abort-on-log-failure, validation-before-write, before/after audit shape — injected deps, no network/DB), and `guard.test.ts` (`requireOwner` returns owner, throws for staff).

### Changed
- Surface per-campaign recommendations on `/ads` for all users, and OWNER-only write-back controls in `app/(app)/ads/ads-table.tsx` (two-step confirm before any write); `page.tsx` resolves the session role and passes `isOwner` to the table.

### Added (A2, earlier today)
- Add Ads Module 2 slice A2 (campaign performance metrics) to `lib/ads/`: `metrics.ts` (PURE `acos(cost, sales)` / `roas(sales, cost)` -> `number | null`; zero/null denominator and non-finite inputs yield `null` (UNKNOWN), NEVER 0 or Infinity), `metrics-mapping.ts` (pure `CampaignMetrics -> ads_campaign_metrics row`, nulls preserved), and `syncCampaignMetrics` in `sync.ts` (dependency-injected upsert, idempotent on conflict `(marketplace_id, campaign_id)`). Extend `types.ts` with `CampaignMetrics` and `AdsCampaignMetricsRow`.
- Extend the `AdsClient` interface with `getCampaignMetrics(opts?)`: `AdsApiClient` implements it as a documented, BATCHED (one report, all campaigns) v3 async reporting skeleton (POST `/reporting/reports` with `application/vnd.createasyncreportrequest.v3+json`, `reportTypeId` `spCampaigns`, poll until COMPLETED, download+gunzip+parse) — the live network/gunzip leg throws NotImplemented (gated on sandbox-verified creds, never fabricates 0s); `FakeAdsClient` returns canned metrics (full / spend-no-sales / all-UNKNOWN).
- Add `supabase/migrations/0007_ads_campaign_metrics.sql`: `public.ads_campaign_metrics` synced mirror keyed on `(marketplace_id, campaign_id)` with nullable `impressions`/`clicks`/`cost`/`sales` numeric (NULL = UNKNOWN, column-commented; ACOS/ROAS deliberately not stored), `synced_at`, RLS enabled, authenticated SELECT only (writes via service role).
- Add vitest coverage: `metrics.test.ts` (exhaustive null/zero-denominator invariant — UNKNOWN is null, never 0/Infinity), `metrics-mapping.test.ts` (nulls preserved, true 0 distinct), and `syncCampaignMetrics` tests in `sync.test.ts` (idempotent upsert, UNKNOWN preserved).

### Changed
- Extend `/ads` (`app/(app)/ads/page.tsx`) with Spend, Sales, ACOS, ROAS columns joined from `ads_campaign_metrics` on `(marketplace_id, campaign_id)`; ACOS/ROAS are computed at render via `lib/ads/metrics.ts`. A null metric, absent metrics row, or computed-UNKNOWN ratio renders a distinct muted "Unknown" badge, never as 0/$0/0%. ACOS formatted as a percentage.
- Wire `syncAdsAction` (`app/(app)/ads/actions.ts`) to run `syncCampaigns` then `syncCampaignMetrics` after `requireUser()`.

### Infrastructure & docs
- Add GitHub Actions CI (`.github/workflows/ci.yml`): `tsc` + `eslint` + `vitest` on push(`main`)/PR.
- Rename `middleware.ts` → `proxy.ts` (Next 16 deprecation; same matcher).
- Migrate the Ads client off deprecated Sponsored Products **v2 → v3** (`lib/ads/v3.ts` pure parsers; `POST /sp/campaigns/list`, vendored media type, UPPERCASE→normalized state, nested DAILY-only budget, pagination).
- Add Ads slice A3 (`lib/cron/sync-all.ts` `runFullSync` — the Vercel Cron route now syncs catalog + inventory + ads) and A4 (`0008_ads_rules` ACOS target; `lib/ads/classify.ts` wasted-spend flags; `lib/ads/view.ts` search/sort; editable ACOS target on `/ads`).
- Add `docs/go-live-readiness.md` — multi-agent audit of the real SP-API + Advertising API vs the fake-backed code — and `[go-live]` issues (#25, #27, #28, #33).
- eslint: ignore `_`-prefixed unused args/vars. Daily Vercel Cron schedule (Hobby plan).

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
