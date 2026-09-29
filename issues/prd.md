# Product Requirements Document: In-Stock Sales Trend

Status: Approved for implementation by Brian on 2026-09-17

## Problem Statement

The current Momentum metric compares average sales velocity across adjacent groups
of eligible selling days. Many products have shallow launch inventory, sell out
quickly, remain unavailable, and later return to stock. A percentage change between
two averages can therefore be hard to interpret and can hide the question that
matters for replenishment: while the product was actually available, did daily
sales increase, remain stable, or decline?

The current presentation also gives a precise-looking percentage when the evidence
may come from low-volume or separated periods. Operators need a metric tied to
continuous in-stock episodes, with dates, stockout context, sample size, and
confidence visible beside the result.

## Solution

Replace the user-facing Momentum metric with **In-stock sales trend**. The metric
will identify continuous, stock-confirmed selling runs and calculate how many
additional units per day the product gained or lost with each successive in-stock
day. It will use a robust slope so one unusually high or low day does not dominate
the result.

Each product will show:

- Direction: Growing, Stable, Declining, Quick sellout, No observed sales,
  Historical only, or Needs evidence.
- Trend per in-stock day, expressed as units/day gained or lost per successive
  stocked day.
- Start and end selling rates for the analyzed run.
- Latest in-stock run dates, eligible days, units shipped, and whether it ended in
  a sellout.
- Consistency across recent qualifying runs, such as "Growing in 3 of 4 runs."
- Confidence based on stocked days, units, and repeated evidence.
- Best sustained observed velocity with its dates.
- Current inventory and days-of-cover scenarios, as today.

The Reorder page will replace its Momentum column with one compact In-stock trend
signal linked to the product's evidence on Advanced Analytics. The Advanced
Analytics page will replace window-over-window momentum controls, filters, labels,
summary cards, detail cards, and columns with the new run-based metric.

## User Stories

1. As an operator, I want to know whether sales increased while a product was in
   stock, so that stockout gaps do not distort my replenishment decision.
2. As an operator, I want each trend tied to exact dates, so that I can validate
   it against a launch, promotion, or replenishment event.
3. As an operator, I want a sellout day with confirmed starting inventory included,
   so that strong final-day sales are not discarded.
4. As an operator, I want known out-of-stock days excluded, so that unavailable
   inventory does not depress observed demand.
5. As an operator, I want out-of-stock periods to split runs, so that two separate
   replenishment cycles are never presented as one continuous trend.
6. As an operator, I want missing dates and unknown inventory evidence to split
   runs, so that the app does not invent continuity.
7. As an operator, I want shipment-only days with no positive inventory evidence
   excluded from the trend, so that delayed fulfillment is not mistaken for an
   in-stock selling day.
8. As an operator, I want the trend expressed in absolute units, so that a small
   baseline does not create an exaggerated percentage.
9. As an operator, I want the beginning and ending selling rates, so that the
   slope has an intuitive before-and-after explanation.
10. As an operator, I want a robust trend calculation, so that one unusual day
    does not determine the result.
11. As an operator, I want repeated-run consistency, so that I can distinguish a
    recurring ramp from a single lucky run.
12. As an operator, I want a Quick sellout state, so that a product with runs too
    short to measure is still highlighted as operationally constrained.
13. As an operator, I want a confidence label, so that I know how strongly to rely
    on a directional claim.
14. As an operator, I want low-confidence trends shown honestly rather than hidden,
    so that limited launches still provide dated evidence.
15. As an operator, I want stale evidence labeled Historical only, so that an old
    ramp is not presented as current demand.
16. As an operator, I want source failures to suppress current claims while
    preserving dated history, so that prior evidence remains inspectable.
17. As an operator, I want the latest average velocity and best sustained velocity,
    so that I can compare the current stocked run with demonstrated demand.
18. As an operator, I want current inventory and cover beside the trend, so that I
    can convert demand evidence into a replenishment decision.
19. As an operator, I want to filter for products growing while in stock, so that I
    can review the most urgent demand increases first.
20. As an operator, I want to filter for stockout-constrained products, so that I
    can find products whose demand cannot be measured cleanly because stock runs
    end too quickly.
21. As an operator, I want to filter declining products, so that I avoid ordering
    against stale demand assumptions.
22. As an operator, I want insufficient evidence separated from stable demand, so
    that absence of proof is not presented as stability.
23. As an operator, I want Reorder to show the same trend definition as Advanced
    Analytics, so that the two pages never disagree.
24. As an operator, I want the configured reorder forecast left unchanged, so that
    replacing the diagnostic metric does not silently change order quantities.
25. As an operator, I want daily evidence to state whether each day was included,
    so that I can audit the result.
26. As an operator, I want the selected trend window to cap how much of each run is
    analyzed, so that a recent change is not diluted by a very long stocked period.
27. As an operator, I want a 7-, 14-, or 28-day trend window, so that I can inspect
    short and longer demand ramps.
28. As an operator, I want a longer history selection, so that repeated stocked
    runs and historical bests can be evaluated over 90, 180, or 365 days.
29. As an operator, I want zero or unknown values kept distinct, so that missing
    evidence is never interpreted as no demand.
30. As an operator, I want all calculations to remain read-only with respect to
    Amazon, so that analytics cannot create orders or modify listings.

## Implementation Decisions

- Reuse the existing daily FBA ledger evidence. No database migration or new
  production dependency is required.
- Replace the sales-momentum domain result and public UI vocabulary with an
  in-stock trend domain result. Reorder and Advanced Analytics consume the same
  pure calculation.
- A stock-confirmed day requires valid shipments plus positive valid starting or
  ending sellable inventory. A restock day with positive ending inventory counts.
- A confirmed sellout day counts when valid starting inventory is positive,
  shipments are valid, and ending inventory is valid zero. It closes the run after
  contributing its shipments.
- A day with shipments but no positive starting or ending inventory remains visible
  as shipment-only evidence but does not enter an in-stock run.
- Known out-of-stock days, unknown evidence, missing calendar dates, a restock after
  a prior run, and the day after a confirmed sellout split runs.
- Analyze at most the selected 7, 14, or 28 most recent stock-confirmed days from
  each run. At least five days are required for a directional trend.
- Calculate the daily trend with the Theil-Sen median pairwise slope. The unit is
  units/day gained or lost per successive in-stock day.
- Calculate the start and end rates from non-overlapping edge averages, using up to
  the first and last three days of the analyzed slice.
- Classify Growing when slope is at least +0.1 units/day per day and the end rate
  is at least 15 percent above the start rate. Classify Declining with the mirrored
  thresholds. Otherwise classify Stable.
- When the latest run ends in a confirmed sellout before five eligible days, show
  Quick sellout instead of manufacturing a direction.
- Show No observed sales for a qualifying run with zero shipments, Needs evidence
  when no direction or quick-sellout conclusion is supportable, and Historical
  only when the latest evidence is over 14 days old or current source health cannot
  support a current claim.
- Report consistency as the count of recent qualifying runs classified Growing
  divided by the number of qualifying runs considered.
- Confidence is High when repeated evidence supplies at least two qualifying runs,
  14 analyzed days, 20 units, and consistent direction. It is Medium when at least
  one seven-day, ten-unit run or ten total analyzed days and units support the
  claim. Other directional results are Low confidence.
- Preserve best sustained velocity as the highest complete rolling selected-window
  average wholly inside one stock-confirmed run.
- Current observed cover uses the average of the latest qualifying in-stock slice.
  Unknown supply or velocity remains unknown.
- Reorder recommendations, stored replenishment policy, and Amazon sync behavior do
  not change. The metric remains decision support.
- Advanced Analytics replaces Momentum labels, cards, filters, sort options,
  tables, detail evidence, and legend text with run-based trend vocabulary.
- Reorder replaces its Momentum column with In-stock trend and links each signal to
  the same product evidence on Advanced Analytics.

## Testing Decisions

- Tests will assert externally meaningful calculation results rather than private
  helper structure.
- Pure calculation tests will cover continuous stocked runs, restocks, confirmed
  sellouts, known stockouts, unknown and missing days, shipment-only evidence,
  robust slope behavior, direction thresholds, short quick sellouts, confidence,
  consistency, history freshness, and best sustained velocity.
- Service tests will verify that canonical inventory supply is combined with the
  new trend result and that stale source health prevents current claims.
- View-model tests will cover filters, summary counts, and sorting by in-stock
  slope, observed velocity, best sustained velocity, cover, and SKU.
- Component rendering tests will verify that Reorder and the Analytics legend use
  the new user-facing labels and do not expose the replaced Momentum vocabulary.
- Existing analytics and reorder tests provide the prior art for pure calculation,
  service composition, server-rendered table markup, and query parsing.
- The complete project test suite, lint, TypeScript check, and production build must
  pass before commit.

## Out of Scope

- Changing reorder quantities or the configured sales-velocity forecast.
- Forecasting lost sales while out of stock.
- Estimating hourly availability within a ledger day.
- Advertising attribution, promotions, seasonality adjustment, weekday adjustment,
  or causal analysis.
- Automatic purchase orders, FBA transfers, or writes to Amazon.
- New warehouse, order, or customer-level data.
- A database migration or persisted analytics result.
- Notifications or scheduled trend alerts.

## Further Notes

- A sellout is censored evidence: observed shipments may be lower than true demand.
  The UI must call this out rather than treating the last-day number as an upper
  bound on demand.
- Absolute slope is primary. Percent growth can be derived for supporting detail,
  but it must not replace the absolute signal or be shown when the starting rate is
  zero.
- The tradeoff is conservative evidence versus broader coverage. Shipment-only
  days are rejected from the trend because the feature's promise is specifically
  about confirmed in-stock behavior.
