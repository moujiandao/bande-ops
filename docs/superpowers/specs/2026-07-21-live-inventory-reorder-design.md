# Live Inventory And Reorder Design

Date: 2026-07-21

## Status

Approved design for the next implementation plan. This is a design spec only, not an implementation.

## Goal

Connect the reorder workflow to live operational sources so the app can recommend purchase/replenishment quantities from:

- Amazon FBA inventory
- Amazon AWD inventory
- Amazon FBA sales velocity
- Silicon Valley Direct (SVD) replenishment warehouse inventory

The app remains decision-support only. It must not write purchase orders, FBA shipments, or Seller Central changes.

## Source-Of-Truth Rules

Amazon remains the source of truth for Amazon catalog, FBA inventory, AWD inventory, and sales ledger data. Local Postgres stores synced mirrors that can be rebuilt.

SVD is an external source for replenishment warehouse inventory. Local Postgres stores the latest validated SVD snapshot. SVD stock is replenishment supply only.

The local database is authoritative for operational settings:

- lead time
- safety stock
- global velocity policy
- source behavior rules
- manual source mappings

Unknown values are never treated as zero. A missing, stale, unmapped, or unparseable input must produce a visible `Needs review` state, not a numeric recommendation.

## Business Rules

Fulfillment is FBA-only. The app must not model FBM fulfillment.

SVD is a replenishment warehouse. SVD cannot fulfill customer orders and must never make an FBA out-of-stock day count as in-stock.

Velocity is global, not per-SKU overrideable:

- search backward up to 365 calendar days
- use the most recent 90 in-stock FBA days
- divide customer shipments by the number of included in-stock days
- exclude out-of-stock FBA days from both numerator and denominator
- if fewer than 90 in-stock days are available, use the available in-stock days and display the sample-day count
- if zero in-stock days are available, velocity is `Unknown`, not `0`

Only FBA customer-buyable/fulfillable inventory determines whether a day is in stock. AWD and SVD can reduce reorder need, but they do not affect the velocity in-stock flag.

## Architecture

Use source-specific sync mirrors:

- Amazon FBA inventory sync
- Amazon AWD inventory sync
- Amazon FBA ledger sync
- SVD inventory refresh

Each source gets its own validated snapshot and sync-health state. The reorder workflow reads only the latest complete successful snapshot for each source.

Failed refreshes preserve the previous successful snapshot. A failed attempt updates sync health with attempted time and error details, but does not replace current inventory or velocity data.

Tradeoff: this uses more tables than one blended inventory table, but keeps each source's freshness, failure mode, and business meaning separate. The rejected alternative is a single merged inventory table, which would make FBA, AWD, and SVD look interchangeable when they are not.

## Data Model

Expand `inventory_levels` for detailed FBA current inventory:

- `marketplace_id`
- `sku`
- `fn_sku`
- `fulfillable_quantity`
- `inbound_working_quantity`
- `inbound_shipped_quantity`
- `inbound_receiving_quantity`
- `reserved_quantity`
- `researching_quantity`
- `unfulfillable_quantity`
- `total_quantity`
- `synced_at`
- `sync_run_id`

Add `awd_inventory_levels` for AWD replenishment inventory:

- marketplace and seller dimensions
- SKU and FNSKU when available
- warehouse or AWD supply fields returned by the API
- replenishment quantity
- raw total quantity
- synced timestamp and sync run

Add `fba_daily_velocity_inputs` for ledger-normalized rows:

- marketplace
- SKU/MSKU
- FNSKU
- activity date
- customer shipments
- sellable ending balance
- `is_in_stock`
- report id and sync run

Add `sales_velocity` for calculated velocity:

- marketplace
- SKU
- FNSKU
- units shipped in sample
- in-stock sample days
- lookback calendar days used
- daily velocity
- status (`ok` or `unknown`)
- calculated timestamp and sync run

Add `svd_inventory_levels` for SVD replenishment stock:

- SVD item id
- SKU when available
- FNSKU when available
- description
- quantity, nullable for unknown
- raw availability text
- refreshed timestamp and sync run

Add `inventory_source_mappings` for manual and automatic joins:

- marketplace
- canonical Amazon SKU
- canonical FNSKU
- SVD item id
- mapping source (`fn_sku`, `sku`, `manual`)
- confidence/status
- timestamps

Mapping priority:

1. Join by `marketplace_id + fn_sku` when both sources provide FNSKU.
2. Fall back to `marketplace_id + seller SKU/MSKU`.
3. Fall back to an explicit manual SVD item mapping.
4. Do not fuzzy-match names or descriptions into live reorder math without human approval.

Add `replenishment_policy` for global editable rules:

- velocity in-stock sample target, default `90`
- velocity max lookback days, default `365`
- fulfillment mode, fixed to FBA-only
- SVD replenishment-only behavior
- unknown-stock behavior
- stale-source behavior
- FBA inbound bucket policy

Default FBA inbound policy:

- count `inbound_shipped_quantity`
- count `inbound_receiving_quantity`
- exclude `inbound_working_quantity`

`inbound_working_quantity` can be added later as an editable policy option, but it should not be counted by default because it represents less certain supply than shipped or receiving inbound units.

Existing `replenishment_settings` stays for lead time and safety stock. Per-SKU lead time and safety stock can remain, but velocity policy is global.

Add `source_sync_state` for source health:

- source name
- marketplace
- last attempt timestamp
- last success timestamp
- current successful sync run
- status
- row count
- error summary

## Refresh Flow

Amazon refreshes run server-side through `lib/amazon`.

FBA inventory refresh:

- calls the FBA Inventory API with detailed inventory fields
- stores detailed bucket quantities
- treats missing or non-numeric quantities as unknown
- writes atomically and advances the successful run pointer only after validation

AWD inventory refresh:

- calls the AWD Inventory API separately
- stores AWD replenishment quantity separately from FBA customer-buyable stock
- writes atomically and advances the successful run pointer only after validation

FBA ledger refresh:

- creates one report for the marketplace/window, not one API call per SKU
- pulls daily ledger rows for up to the configured max lookback
- normalizes the report to one row per SKU/FNSKU/day
- calculates velocity from the most recent configured number of in-stock days
- records sample-day count so weak velocity samples are visible in the UI

SVD refresh:

- is user-triggered with a `Refresh SVD` button
- runs server-side using the stored SVD username/password
- logs in, requests the SVD report, parses it, validates row counts and quantities, then writes a new snapshot
- preserves the previous successful SVD snapshot if login, fetch, parse, or validation fails

SVD refresh does not need to run every morning. It runs when an authenticated owner clicks refresh.

## Reorder Calculation

The calculation remains in `lib/reorder`, with the pure math kept testable and side-effect-free.

Daily velocity:

```text
daily velocity = customer shipments during included in-stock FBA days / included in-stock FBA days
```

Usable supply:

```text
usable supply =
  FBA fulfillable
  + FBA inbound shipped
  + FBA inbound receiving
  + AWD replenishment quantity
  + SVD available quantity
```

Recommended quantity:

```text
reorder point = daily velocity * lead time days + safety stock
recommended quantity = max(0, ceil(reorder point - usable supply))
```

Reserved, researching, and unfulfillable FBA inventory do not count as usable supply.

If any required source is unknown, stale beyond policy, or unmapped, the SKU is flagged `Needs review`.

## UI

The reorder page should show source health before recommendation rows:

- FBA inventory last successful refresh, status, row count
- AWD inventory last successful refresh, status, row count
- FBA sales ledger last successful refresh, lookback range, velocity sample coverage
- SVD inventory last successful refresh, status, row count, and `Refresh SVD` button

Each SKU recommendation should show the calculation pieces:

- FBA fulfillable
- FBA inbound counted as usable supply
- AWD replenishment stock
- SVD replenishment stock
- total usable supply
- velocity per day
- velocity sample-day count
- lead time
- safety stock
- reorder point
- recommended quantity or `Needs review`

The settings page should expose editable global replenishment policy. Credential values must not be displayed. The UI may show configured/not configured status for Amazon and SVD credentials.

Tradeoff: the reorder page becomes denser, but it makes the purchase recommendation auditable. The rejected alternative is a cleaner table that hides too much of the calculation.

## Security

All live source access stays server-side.

Amazon SP-API tokens, LWA secrets, seller refresh token, and SVD username/password must live only in server environment/config. They must never be sent to the browser or logged.

Browser actions call server actions or API routes that re-check auth with `requireUser()`. SVD refresh should be owner-only because it uses a shared credential and replaces a shared mirror.

No Restricted Data Token is in scope. The design uses aggregate inventory and ledger data, not PII.

## Error Handling

Each refresh creates an attempted sync run. The successful pointer only advances after fetch, parse, validation, and write succeed.

On failure:

- keep the previous successful snapshot
- record the failed attempt and error summary
- mark the source stale or failed in `source_sync_state`
- do not emit zero quantities for missing data
- flag affected recommendations as `Needs review`

## Testing

Test the invariants before wiring live behavior:

- velocity excludes FBA out-of-stock days from numerator and denominator
- velocity searches back up to 365 days for 90 in-stock days
- zero in-stock days returns `Unknown`, not `0`
- fewer than 90 in-stock days returns a velocity with visible sample-day count
- FNSKU match wins over SKU and manual mapping
- manual SVD mapping is required when no reliable key exists
- SVD parse failure keeps the previous successful snapshot
- reorder math counts FBA fulfillable, FBA inbound shipped, FBA inbound receiving, AWD, and SVD supply
- AWD and SVD never affect the velocity in-stock flag
- unknown inventory, unknown velocity, stale source, or unmapped source produces `Needs review`
- fake and live Amazon clients share the same domain types

Tradeoff: this adds more fixtures than the fake-only app needed, but fixture tests are the cheapest way to catch silent inventory and reorder mistakes.

## Implementation Boundaries

Do not implement live API calls outside `lib/amazon` and the SVD server-side integration module.

Do not replace existing reorder math with page-level calculation. Keep pure recommendation logic in `lib/reorder` and use the page only to render results.

Do not flip production mode by configuration alone. Live mode requires the planned correctness fixes, migrations, tests, and a deliberate fake-to-real switch.
