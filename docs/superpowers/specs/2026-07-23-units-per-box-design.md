# SVD Units Per Box Design

Date: 2026-07-23

## Status

Approved design for the next implementation plan. This is a design spec only, not an implementation.

## Problem

SVD reports inventory in **boxes**. FBA and AWD both report **units**. The
reorder path sums them without conversion.

`calculateUsableSupply` (`lib/reorder/supply.ts`) adds SVD box counts directly to
FBA and AWD unit counts to produce `usableSupply`. `recommend` then divides that
mixed quantity by a unit-denominated daily demand from the FBA ledger. Every
derived number on `/reorder` that includes SVD is therefore understated by the
units-per-box factor: reorder quantities, days of cover, the
`Replenish from SVD to FBA` list, and the reorder-point trigger itself.

The error under-states supply, so the app over-recommends ordering. Purchase
decisions must not be made from these numbers until this ships.

`amazonSideCover` and `suggestedShipQty` in
`app/(app)/reorder/reorder-table.tsx` read `row.sources` directly.
`suggestedShipQty` reads `row.sources.svd` and carries the same defect
independently of `supply.ts`.

### How the scope was established

The original report was that both AWD and SVD were box-denominated. That was
falsified before implementation by a magnitude check: at a claimed 60 units per
box, `babytracker_notebook_boy_g2`'s AWD reading of 500 implied 30,000 notebooks
of one SKU. Converting a suspect quantity into something physically imaginable is
the cheapest available oracle for a denomination error, because unit mismatches
are invisible to both the type system and the test suite.

AWD is units and needs no conversion. Its column on `/reorder` is correct today.

## Decisions

**SVD only, and the name says so.** The column is `svd_units_per_box`, not
`units_per_box`. Only SVD is box-denominated, and a source-neutral name invites a
future reader to apply the factor to AWD as well — which would reintroduce this
exact bug in the opposite direction. The cost is a rename if another
box-denominated source is ever added; that is cheaper than the ambiguity.

**Per-SKU only, no global default.** `svd_units_per_box` does **not** participate in
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

**Blocking is scoped to where the factor matters.** A missing `svd_units_per_box`
produces `needs-review` with reason `unknown-svd-units-per-box` **only when that
SKU has non-zero SVD box stock**. A SKU with zero SVD boxes passes through
normally, whatever its AWD or FBA position.

This is exact, not a leniency: zero boxes converts to zero units under every
possible factor, so no information is lost. It preserves the project's
unknown-is-never-zero rule while keeping the review list scoped to SKUs where the
missing value actually changes an answer.

Measured against live data on 2026-07-23: 42 of 230 catalog SKUs carry non-zero
SVD stock, so the settings list and the maximum possible review population are
both bounded by that number, not by the full catalog.

**Ship quantity stays in units.** The `Replenish from SVD to FBA` suggestion
remains unit-denominated, consistent with every other quantity on the page.
Flooring to whole boxes was considered and rejected as an unnecessary second
denomination in the UI.

## Data Model

Migration `0015` adds one nullable column to the existing
`replenishment_settings` table:

- `svd_units_per_box integer`, constrained
  `svd_units_per_box is null or svd_units_per_box > 0`

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
- `calculateUsableSupply` accepts `svdUnitsPerBox: number | null`, converts the
  SVD input through `toUnits`, and owns the `unknown-svd-units-per-box` emission
  alongside the existing unknown reasons. FBA and AWD inputs are untouched.

The conversion belongs in `supply.ts` rather than in `service.ts` because
`calculateUsableSupply` is already the sole pure, unit-tested authority for
"this input is unknown, therefore needs-review with this reason". Splitting
unknown-handling between a pure module and an I/O module is where the AWD
absence-vs-unknown bug lived.

`lib/reorder/service.ts` converts the SVD box count through the same helper
before populating the row's `sources.svd` field. `sources` becomes uniformly
unit-denominated, so FBA, AWD, and SVD are directly comparable. Every downstream
consumer — usable supply, days of cover, the recommendation, the replenish
suggestion — inherits the correction without performing its own arithmetic.

The row additionally carries `svdUnitsPerBox` and the raw SVD box count so the UI
can display the derivation without recomputing it. No component multiplies
anything.

## Relocation

`amazonSideCover` and `suggestedShipQty` move from
`app/(app)/reorder/reorder-table.tsx` into `lib/reorder/`. They are reorder math,
not presentation; they currently sit in a client component where they cannot be
unit-tested, and `suggestedShipQty` acquired the box/unit defect independently of
`supply.ts`.

`amazonSideCover` sums FBA and AWD only, both of which are units, so it is
already correct; it moves for testability, not to be fixed.

This is in scope because the change touches both functions directly. No wider
refactoring of the reorder module is proposed.

## Settings UI

A `SVD Box Configuration` section on `/settings`, following the pattern
established by the manual SVD mapping form:

- Lists SKUs that have non-zero SVD stock (42 as of 2026-07-23).
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

The SVD column on `/reorder` shows units, with the derivation in the cell
tooltip in the form `420 units — 7 boxes × 60`, reusing the tooltip precedent
from the SKU/FNSKU display. The AWD column is unchanged.

The SVD column header already reads "Units available at SVD". That label has
been inaccurate; this change makes it true.

Rows blocked on `unknown-svd-units-per-box` appear in `Needs review` with a link
to the settings section for that SKU.

## Error Handling

`unknown-svd-units-per-box` joins the existing `needs-review` reason vocabulary
and is handled by the same rendering path as `unknown-awd-available` and its
peers. No new error surface.

Source-level staleness continues to be enforced by `blockingSource`, which is
what makes absence-as-zero safe. This change does not touch it.

## Testing

Unit tests, pure and fast:

- `toUnits` conversion.
- `calculateUsableSupply` converts the SVD box input to units and leaves FBA and
  AWD untouched.
- `calculateUsableSupply` returns `unknown-svd-units-per-box` when
  `svdUnitsPerBox` is null and SVD box stock is non-zero.
- `calculateUsableSupply` succeeds when `svdUnitsPerBox` is null and SVD box
  stock is zero, including when AWD stock is non-zero.
- The relocated `amazonSideCover` and `suggestedShipQty`.
- `service.ts` row shape carries unit-denominated `sources` plus
  `svdUnitsPerBox`.

Verification beyond the suite, which this project has learned not to skip:

- `npm run build`, because vitest does not typecheck.
- One real save through the new settings action against the real database. The
  `mapping_source` NOT NULL failure was invisible to both TypeScript and the test
  suite and took seconds to find with one real insert.
- Read live `/reorder` data back and reconcile one SKU whose true on-hand count
  is known outside the app.

## Seed Data

Pack sizes for 67 SKUs were supplied directly and are seeded once, after the
migration, through the same server action the settings form uses — not by raw
SQL. Routing the seed through the application path exercises the write before the
UI depends on it, which is how the `mapping_source` NOT NULL failure would have
been caught.

Cross-checked against live data on 2026-07-23, four SKUs with SVD stock remain
without a value and will correctly appear in `Needs review` until set:

- `babytracker_notebook_boy_g2` — supplied twice, once as 60 and once blank
- `storage_clipboard_hard_nursing`
- `scrubnotes_nursing`
- `emtnotepad-3pack` — absent from the supplied list; the list contained
  `emt_notepad`, which does not exist in the catalog

The remaining unset SKUs have zero SVD stock and are correctly ignored.

## Out Of Scope

- Applying a box factor to AWD or FBA. Both are unit-denominated.
- Bulk paste import in the UI. The one-off seed is handled directly; ongoing
  maintenance is per-row.
- Expressing any quantity in boxes other than in the display tooltip.
- Any change to `blockingSource`, velocity, or sync behaviour.
