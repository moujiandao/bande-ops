# Units Per Box Design

Date: 2026-07-23

## Status

Approved design for the next implementation plan. This is a design spec only, not an implementation.

## Problem

AWD and SVD report inventory in **boxes**. FBA reports inventory in **units**. The
reorder path sums them without conversion.

`calculateUsableSupply` (`lib/reorder/supply.ts`) adds AWD and SVD box counts
directly to FBA unit counts to produce `usableSupply`. `recommend` then divides
that mixed quantity by a unit-denominated daily demand from the FBA ledger. Every
derived number on `/reorder` is therefore wrong by the units-per-box factor:
reorder quantities, days of cover, the `Replenish from SVD to FBA` list, and the
reorder-point trigger itself.

The error under-states supply, so the app over-recommends ordering. Purchase
decisions must not be made from these numbers until this ships.

`amazonSideCover` and `suggestedShipQty` in
`app/(app)/reorder/reorder-table.tsx` read `row.sources` directly and carry the
same defect independently of `supply.ts`.

## Decisions

**One box size per SKU.** A box is the same physical case pack at AWD and at SVD.
A single `units_per_box` value per SKU covers both sources. Separate per-warehouse
columns are not modelled.

**Per-SKU only, no global default.** `units_per_box` does **not** participate in
the global-default fallback that `effectiveSetting` (`lib/settings/resolve.ts`)
applies to `lead_time_days`, `safety_stock`, and `target_coverage_days`. It
resolves to the per-SKU value or to `null`.

A global default was considered and rejected. Lead time and safety stock are
policy choices where one reasonable number applies broadly. A pack size is a
physical fact that differs per product, and a wrong global default would silently
rewrite the supply of every SKU without an override into a plausible-looking
wrong number. That is the failure mode this codebase has been bitten by
repeatedly.

This asymmetry is deliberate and non-obvious. It must carry a comment in
`resolve.ts` explaining why, or it will be "fixed" into a bug later.

**Blocking is scoped to where the factor matters.** A missing `units_per_box`
produces `needs-review` with reason `unknown-units-per-box` **only when that SKU
has non-zero AWD or SVD box stock**. A SKU with zero boxes at both sources passes
through normally.

This is exact, not a leniency: zero boxes converts to zero units under every
possible factor, so no information is lost. It preserves the project's
unknown-is-never-zero rule while keeping the review list scoped to SKUs where the
missing value actually changes an answer.

**Ship quantity stays in units.** The `Replenish from SVD to FBA` suggestion
remains unit-denominated, consistent with every other quantity on the page.
Flooring to whole boxes was considered and rejected as an unnecessary second
denomination in the UI.

## Data Model

Migration `0015` adds one nullable column to the existing
`replenishment_settings` table:

- `units_per_box integer`, constrained `units_per_box is null or units_per_box > 0`

Nullable is load-bearing: `null` means "not yet known", which is exactly the
state the blocking rule keys on. A zero or negative pack size is meaningless and
is rejected at the database.

No new table. The existing RLS policies, the global-default-plus-per-SKU-override
row shape, and the `(marketplace_id, coalesce(sku, ''))` unique index all apply
unchanged. Rows on the global default record (`sku IS NULL`) simply leave this
column unset; nothing reads it.

## Conversion Seam

Conversion happens in exactly one place, expressed as a pure helper in
`lib/reorder/supply.ts`:

- `toUnits(boxes, unitsPerBox)` — the single conversion primitive.
- `calculateUsableSupply` accepts `unitsPerBox: number | null`, converts AWD and
  SVD inputs through `toUnits`, and owns the `unknown-units-per-box` emission
  alongside the existing unknown reasons.

The conversion belongs in `supply.ts` rather than in `service.ts` because
`calculateUsableSupply` is already the sole pure, unit-tested authority for
"this input is unknown, therefore needs-review with this reason". Splitting
unknown-handling between a pure module and an I/O module is where the AWD
absence-vs-unknown bug lived.

`lib/reorder/service.ts` converts AWD and SVD box counts through the same helper
before populating the row's `sources` field. `sources` becomes unit-denominated
throughout, comparable with FBA. Every downstream consumer — usable supply, days
of cover, the recommendation, the replenish suggestion — inherits the correction
without performing its own arithmetic.

The row additionally carries `unitsPerBox` and the raw box counts so the UI can
display the derivation without recomputing it. No component multiplies anything.

## Relocation

`amazonSideCover` and `suggestedShipQty` move from
`app/(app)/reorder/reorder-table.tsx` into `lib/reorder/`. They are reorder math,
not presentation; they currently sit in a client component where they cannot be
unit-tested and where they acquired the box/unit defect independently of
`supply.ts`.

This is in scope because the change touches both functions directly. No wider
refactoring of the reorder module is proposed.

## Settings UI

A `SKU Box Configuration` section on `/settings`, following the pattern
established by the manual SVD mapping form:

- Lists SKUs that have AWD or SVD stock.
- Sorts SKUs that are unset **and** have stock to the top, since those are the
  rows currently blocking a recommendation.
- One numeric input per row, saved individually through a new server action in
  `lib/settings/settings-actions.ts`.
- The action re-checks auth via `requireUser()`, consistent with every other
  server action in the module.

Bulk paste and inline editing on `/reorder` were both considered. Bulk paste
introduces a partial-failure mode; inline editing mixes an authoritative-data
editor into a decision-support view.

## Display

The AWD and SVD columns on `/reorder` show units. The cell tooltip shows the
derivation, in the form `192 units — 4 boxes × 48`, reusing the tooltip
precedent from the SKU/FNSKU display.

The existing column headers already read "Units at AWD" and "Units available at
SVD". Those labels have been inaccurate; this change makes them true.

Rows blocked on `unknown-units-per-box` appear in `Needs review` with a link to
the settings section for that SKU.

## Error Handling

`unknown-units-per-box` joins the existing `needs-review` reason vocabulary and
is handled by the same rendering path as `unknown-awd-available` and its peers.
No new error surface.

Source-level staleness continues to be enforced by `blockingSource`, which is
what makes absence-as-zero safe. This change does not touch it.

## Testing

Unit tests, pure and fast:

- `toUnits` conversion.
- `calculateUsableSupply` converts AWD and SVD box inputs to units.
- `calculateUsableSupply` returns `unknown-units-per-box` when `unitsPerBox` is
  null and box stock is non-zero.
- `calculateUsableSupply` succeeds when `unitsPerBox` is null and box stock is
  zero at both sources.
- The relocated `amazonSideCover` and `suggestedShipQty`.
- `service.ts` row shape carries unit-denominated `sources` plus `unitsPerBox`.

Verification beyond the suite, which this project has learned not to skip:

- `npm run build`, because vitest does not typecheck.
- One real save through the new settings action against the real database. The
  `mapping_source` NOT NULL failure was invisible to both TypeScript and the test
  suite and took seconds to find with one real insert.
- Read live `/reorder` data back and reconcile one SKU whose true on-hand count
  is known outside the app.

## Out Of Scope

- Per-warehouse box sizes.
- Bulk import of pack sizes.
- Expressing any quantity in boxes other than in the display tooltip.
- Any change to `blockingSource`, velocity, or sync behaviour.
