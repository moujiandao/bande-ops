# SVD Units Per Box Implementation Plan

Spec: `docs/superpowers/specs/2026-07-23-units-per-box-design.md`

**Goal:** Convert SVD box counts to units so `/reorder` stops summing boxes into
unit-denominated supply, and block with `unknown-svd-units-per-box` where the
factor is missing and load-bearing.

**Architecture:** One nullable `svd_units_per_box` on `replenishment_settings`,
per-SKU only. A single pure conversion in `lib/reorder/supply.ts` that also owns
the unknown emission; `service.ts` applies the same helper once so `sources`
becomes uniformly unit-denominated and every consumer inherits the fix.

## Global Constraints

- Per-SKU only. `svd_units_per_box` never falls back to a global default.
- Blocks only when SVD box stock is non-zero. Zero boxes is zero units under any
  factor.
- AWD and FBA are units. Nothing multiplies them.
- Conversion exists in exactly one function. No component does arithmetic.
- `npm run build` after every phase — vitest does not typecheck.

---

## Phase 1 — Schema

- Write migration `0015`, adding nullable `svd_units_per_box integer` to
  `replenishment_settings` with a `> 0` check.
- Brian applies it to Supabase before Phase 2 lands; nothing else can be
  verified against real data until it exists.
- Extend the generated/DB types so the new column is visible to TypeScript.

## Phase 2 — Conversion and the blocking rule

- TDD `toUnits` and the extended `calculateUsableSupply` in
  `lib/reorder/supply.ts`: converts SVD, leaves FBA and AWD alone, emits
  `unknown-svd-units-per-box` only when boxes are non-zero.
- Cover the case that motivated the whole rule: null factor with zero SVD boxes
  and non-zero AWD stock must still succeed.
- Do not widen `SupplyInput` beyond the new factor; the module stays pure.

## Phase 3 — Wire through the service, relocate the replenish math

- `lib/reorder/service.ts` reads the per-SKU factor alongside the existing
  replenishment settings and converts `sources.svd` once, carrying
  `svdUnitsPerBox` and the raw box count on the row for display.
- Move `amazonSideCover` and `suggestedShipQty` out of the client component into
  `lib/reorder/` and unit-test them there.
- Confirm `effectiveSetting` in `lib/settings/resolve.ts` is left untouched, with
  a comment recording why the new column is deliberately excluded.

## Phase 4 — Settings section and the seed

- Add a `SVD Box Configuration` section to `/settings` plus a server action in
  `lib/settings/settings-actions.ts`, following the manual SVD mapping pattern
  and re-checking auth via `requireUser()`.
- Lists the 42 SKUs with SVD stock, unset-with-stock sorted first.
- Seed the 67 supplied pack sizes through that server action, not raw SQL, so the
  real write path is exercised before the UI depends on it.
- Parse rule for the seed: a blank never overwrites a value
  (`babytracker_notebook_boy_g2` resolves to 60). Seed the catalog's real
  `emtnotepad-3pack` string, unset.

## Phase 5 — Display and live verification

- SVD column on `/reorder` renders units, with `N units — B boxes × F` in the
  cell tooltip. AWD column unchanged.
- Blocked rows link to the settings section for that SKU.
- Reconcile live `/reorder` against a SKU whose true on-hand you know, and
  confirm exactly the expected SKUs sit in `Needs review`:
  `storage_clipboard_hard_nursing`, `scrubnotes_nursing`, `emtnotepad-3pack`.
- Update `CHANGELOG.md` and the `CLAUDE.md` Non-Obvious Decisions entry on
  source denominations.
- Run the `code-reviewer` gate before calling it done.
