# CLAUDE.md — bande-ops

> Status: live. Module 1 (Catalog & Inventory) and Module 2 (Ads) are shipped to `main`
> and deployed at `bande-ops.vercel.app`, running on **fake** Amazon data
> (`AMAZON_USE_FAKE=true`). Flipping to real data is creds-gated — see
> `docs/go-live-readiness.md` and the `[go-live]` issues.

## What This Is

A single, clean web app for running Amazon Seller Central operations for a US store —
catalog & inventory, then ads, then product launch and research. Built one **Module** at a
time on the official Amazon APIs (SP-API + Advertising API), explicitly replacing a
scattering of one-off legacy tools (`listing-editor`, `supplier-reorder`).

## Architecture

- **Stack:** Next.js 16 (App Router) + TypeScript + Supabase (Postgres + Auth) + Tailwind v4, on Vercel.
- **Spine:** shared foundation every Module reuses — auth (2 users, `role` column, RLS), DB migrations, a server-side Amazon API client (`lib/amazon`), and a UI shell.
- **Modules (shipped):** Catalog & Inventory (`app/(app)/catalog`, `/reorder`, `lib/catalog`, `lib/inventory`, `lib/reorder`) and Ads (`app/(app)/ads`, `lib/ads`). Each is a route segment + per-module service files; modules interact via the DB + shared clients, never each other's internals.
- **Amazon clients:** `lib/amazon` (SP-API) and `lib/ads` (Advertising API — a SEPARATE API: own creds, host, profile-scoped, v3). Both server-only, fake-backed via `AMAZON_USE_FAKE`/`getAmazonClient()`/`getAdsClient()`.
- **Reorder supply sources:** the `/reorder` recommendation is assembled from four independent synced mirrors, each its own `lib/` module — detailed FBA inventory (`lib/inventory`), AWD inventory (`lib/awd`), FBA daily ledger → calculated sales velocity (`lib/velocity`), and SV Direct replenishment inventory (`lib/svd`, a THIRD external source: not Amazon, server-only creds `SVD_USERNAME`/`SVD_PASSWORD`, HTML-scraped). `lib/reorder` stays pure: FNSKU-first source mapping + usable-supply + recommendation math over persisted snapshots. The global `replenishment_policy` (`lib/settings/policy.ts`) governs the velocity window and which inbound buckets count as usable supply.
- **Sync:** per-module injectable sync fns share one structural writer seam and record freshness via `lib/sync/run.ts` (`source_sync_runs` + `source_sync_state`); `lib/cron/sync-all.ts` (`runFullSync`) drives the Vercel Cron route (`app/api/cron/sync`, daily) and refreshes catalog, FBA inventory, AWD inventory, and velocity + the two ads mirrors. SVD is NOT on the cron — it refreshes only from the owner-gated `Refresh SVD` button on `/reorder`.
- **Go-live:** real-Amazon readiness gaps are documented in `docs/go-live-readiness.md` (all live API paths throw/`// TODO: verify against sandbox` until creds).
- **Auth & routing:** protected app routes live in the `app/(app)/` group, whose layout gates on `getUser()` (via `lib/auth/session.ts`) and redirects to the public `/login` (`app/login/`) when unauthenticated, then renders `AppShell` with the user's email + role. Auth logic is spine: `lib/auth/` (`session.ts`, `actions.ts` sign-in/out, `types.ts`). Root `app/layout.tsx` is only the html/body shell.
- **Source-of-truth boundary:** Amazon (and SVD, for replenishment stock) is source of truth for catalog/inventory/ads/velocity → local Postgres holds a **synced mirror** (re-fetchable, `synced_at`). Local DB is authoritative only for the **operational layer** the sources don't store (replenishment settings, global policy, source mappings, reorder recs, notes). See ADR-0001.

## Key Conventions

- All Amazon API access goes through `lib/amazon` (server-side only). Credentials live in env, never reach the browser.
- Every persisted row is either a "synced mirror" (rebuildable from Amazon) or "ours" (authoritative) — never both.
- Schema carries `marketplace_id` from day one (default US), even though only US is exercised now.
- Server Actions re-check auth via `requireUser()` (`lib/auth/guard.ts`) — they are public endpoints; the `app/(app)/` layout gate does not protect them.
- Mirror tables are written only by sync via the service-role admin client (`lib/supabase/admin.ts`); RLS gives authenticated users read-only access.
- Use the glossary in `CONTEXT.md`; don't drift to avoided synonyms.

## Non-Obvious Decisions

- Build on official SP-API, do **not** port the Playwright `listing-editor`. See ADR-0002.
- Replenishment is **decision-support only** (recommend + reasoning; no auto-PO/FBA writes).
- Reorder math is a classic **(s,S) policy** (`lib/reorder/recommend.ts`): trigger at the lead-time reorder point `s = dailyDemand*leadTime + safetyStock`, then fill to the coverage target `S = dailyDemand*coverageDays` (order up to `max(S,s)`). `coverageDays` is per-SKU with a global default in `replenishment_settings`; `coverageDays=0` reduces to a plain reorder-point top-up.
- Unknown/unavailable stock parses to UNKNOWN and is flagged for review — never folded in as 0 (carried from `supplier-reorder`). Any unknown, stale, failed, or unmapped reorder source yields `Needs review`, not a numeric recommendation.
- Sales velocity is the most recent 90 **in-stock** FBA days (search back ≤365 calendar days); FBA out-of-stock days are excluded from numerator and denominator, and zero in-stock days returns `Unknown`. Only FBA fulfillable inventory decides the in-stock flag — AWD and SVD reduce reorder need but never set it.
- Sandbox-first for SP-API, then flip to production.

## Common Tasks

- **Build the next module:** read its issue, build a vertical slice into the spine, TDD against the `AmazonClient` seam.
- **Add a synced entity:** create a mirror table with `synced_at` + `marketplace_id`; wire a sync path through `lib/amazon`; never treat the local copy as authoritative.
- **Add an Amazon call:** extend `lib/amazon`, not the calling module.
- **File / pick up work:** GitHub Issues (see `docs/agents/issue-tracker.md`).

## Do Not

- Do not call SP-API outside `lib/amazon`.
- Do not write back to Amazon in Module 1 (read + recommend only).
- Do not touch Orders/PII data (no Restricted Data Tokens in scope).
- Do not fold UNKNOWN stock into reorder math as zero.
- Do not call SVD outside `lib/svd`, put SVD or Amazon secrets anywhere they can reach the browser or a log, or add an automatic/unattended SVD refresh (owner-triggered only).
- Do not widen a sync module's `admin` dep beyond the shared `SyncWriter` seam (`lib/sync/run.ts`); intersecting Supabase's generic `from()` per-sync in `runFullSync` blows TypeScript's instantiation-depth limit at `next build` (vitest transpiles without typechecking, so the suite stays green — run `npm run build`).
- Do not write back to Amazon except via the Ads guarded path (owner-gated, confirmed, audited in `ads_write_log`, re-synced); never add an automated/unattended write.
- Do not bypass pre-commit hooks (`--no-verify`).

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI (repo `moujiandao/bande-ops`); external PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Next Steps

The app is built on **fake** Amazon data; the next session is about making it real. In priority order:

1. **Apply migrations `0006`–`0011`** to Supabase (`0006`–`0009` Ads tables; `0010` live-reorder mirrors + policy; `0011` per-SKU coverage target) and **browser-E2E Module 2** (`/ads`) and the live `/reorder` sources — Module 1 is E2E-verified; Module 2 and the multi-source coverage reorder path are only verified on fakes + by review.
2. **Generate Ads API creds** (approved) and the **SP-API secret** (pending approval), add **`SPAPI_SELLER_ID`** (required in live mode) and **`SVD_USERNAME`/`SVD_PASSWORD`** → put in Vercel + `.env.local` (see `.env.example`).
3. **Work the `[go-live]` tickets** (#25 SP-API correctness, #27 batched FBA-ledger demand, #28 sandbox-flip safety, #33 Ads write-path hardening), verifying each against the **sandbox** before flipping `AMAZON_USE_FAKE=false`. See `docs/go-live-readiness.md`.
4. **Then** Modules 3/4 (Product Launch, Research) — still backlog.
