# Advanced Sales Analytics Design

Date: 2026-09-17

Status: Approved for implementation by Brian on 2026-09-17.

Implementation details and acceptance cases are expanded in
`docs/superpowers/plans/2026-09-17-advanced-sales-analytics.md`.

## Problem

The existing reorder forecast averages the most recent configured number of FBA
in-stock days. It does not show whether demand is rising, the strongest observed
selling period, or useful evidence for a launch that sold through limited stock.
It also excludes a day whenever ending inventory is zero, even when Amazon
reports customer shipments for that day.

Operators need demand evidence alongside current FBA, AWD, SVD, inbound, and
usable inventory so they can judge reorder and replenishment urgency. Historical
highs and trends must always identify the dates and sample behind the number.

## Product placement

Add `Analytics` directly below `Reorder` in the Modules navigation. The protected
`/analytics` page is titled **Advanced Analytics** and initially contains **Sales
momentum**.

Use a hybrid presentation:

- The dedicated page owns product discovery, comparisons, historical bests,
  evidence, filters, inventory scenarios, and the daily timeline.
- Reorder shows one compact Momentum signal that links to the same product and
  evidence on `/analytics`.
- The existing reorder forecast and recommendation remain primary. Analytics
  scenarios do not persist settings or write to Amazon.

## Eligible selling day

A completed SKU-day is eligible for observed velocity when its shipment count is
valid and at least one of these facts is true:

1. Starting sellable inventory is positive.
2. Ending sellable inventory is positive.
3. Customer shipments are positive.

An eligible day contributes all reported customer shipments to the numerator and
exactly one day to the denominator. A stocked day with zero shipments qualifies
and contributes zero units. A zero-ending-inventory day with positive shipments
qualifies and is flagged as a possible sellout or delayed-fulfillment day.

Known zero-stock, zero-shipment days are excluded. Missing or invalid shipment
data stays unknown and is never converted into zero. Shipment evidence proves
FBA activity, not hours of same-day listing availability, so the UI calls this
**observed velocity per eligible selling day**.

The ledger mirror must retain starting balance and shipment parse validity. The
existing `is_in_stock` fact remains unchanged for reorder compatibility; analytics
owns its separate day classification. The current UTC date is excluded because
its ledger aggregate may be partial. Current momentum is unavailable when the
FBA ledger sync is missing, failed, or more than 48 hours old; persisted prior
rows must not masquerade as fresh evidence. Dated history and best periods remain
visible in that state, with the product label downgraded to Historical only.

## Metrics

The default window is seven eligible selling days, with 14- and 28-day options.

- **Recent velocity:** latest N eligible days.
- **Previous velocity:** preceding non-overlapping N eligible days.
- **Change:** recent minus previous, in units/day and percent when the previous
  value is above zero.
- **Trending up:** at least +15%, at least +0.1 units/day, and at least 20 total
  shipments across two complete windows.
- **Sustained growth:** three complete windows, each meeting Trending up rules.
- **No observed shipments:** two complete eligible windows with zero shipments,
  kept distinct from a partial or missing sample.
- **Early launch pace:** three to N-1 eligible days when a full window is not yet
  available. It is provisional and never receives a complete trend label.
- **Best observed velocity:** highest qualifying rolling N-day average inside the
  selected history, with exact dates, units, evidence mix, and known stockout
  days skipped inside the period. Unknown or missing dates interrupt the period.
- **Strongest historical increase:** a later slice after the first page ships;
  compare consecutive N-day periods and retain both date ranges.

Windows may span no more than 3N calendar days. Current comparisons must be within
90 calendar days, and an observation older than 14 days is labeled historical.
Known stockout days may be skipped inside the span. Unknown dates interrupt a
qualifying window.

## Inventory context

Reuse the canonical `RecommendationRow` supply result from `lib/reorder`. Do not
reassemble inventory inside analytics. For each product show:

- FBA fulfillable and counted inbound
- AWD and SVD units
- Total usable supply
- Days of cover at the configured reorder forecast
- Days of cover at recent observed velocity
- Days of cover at best observed velocity

Unknown or stale inventory makes the affected scenario unknown rather than zero.

## Page design

Top controls select 7/14/28 eligible days, 90/180/365 calendar-day history,
search, and classification filters. Summary cards filter Trending up, Early
launch, Stock constrained, and Insufficient evidence products. Stock constrained
means current usable supply covers fewer than 30 days at the recent observed
velocity; an unknown supply or recent velocity remains unknown and does not
enter that filter.

The product table groups columns into Product, Inventory now, Observed velocity,
and Evidence. Each row can open a detail view containing the three cover
scenarios and a chronological ledger table/timeline with eligible, stockout,
sellout/restock, and unknown classifications. Best and comparison windows point
to the exact included dates.

Reorder gets one Momentum column on actionable order and SVD replenishment lists.
The label links to `/analytics?sku=<sku>` and exposes recent/previous dates in its
tooltip. No analytics math lives in a React component.

## Module design

Create a deep `lib/analytics` module. Its interface accepts canonical product
recommendations plus daily ledger facts and returns dated product insights. It
owns classification, windows, trends, historical maxima, freshness, and cover
scenarios. `/analytics` and `/reorder` consume the same results.

The ledger reader pages through Supabase results so a store-wide history cannot
be truncated by the response row limit. Viewing Analytics never requests a new
Amazon report.

## Release boundary

The first complete release includes the ledger evidence migration/parser,
calculation module, dedicated page, inventory scenarios, and compact Reorder
signals. Historical strongest-increase analysis follows after real-data replay
validates thresholds. Applying the migration, merging, and deploying remain
separate release actions.
