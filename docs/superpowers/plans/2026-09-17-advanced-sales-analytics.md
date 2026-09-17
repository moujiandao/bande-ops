# Advanced Analytics: sales momentum and launch performance

Date: 2026-09-17

Status: proposed implementation plan. Planning is complete; application code,
database migrations, and production data are unchanged. Numerical thresholds
below are proposed product defaults, not validated statistical confidence levels.

## Outcome

Add **Advanced Analytics** to the sidebar, with **Sales momentum** as its first
section. Identify products whose observed sales pace is increasing, preserve the
strongest historical periods, and make limited-stock launches visible even when
they have too little history for a normal comparison.

Every velocity must answer: how many units, over which dates, using how many
eligible days, with what stock or shipment evidence? A sold-out product must retain its last
observed pace and historical best without appearing to have current zero demand.

The first version is descriptive decision support. Reorder continues to use its
existing configured forecast. Choosing a historical maximum for a future order
would be a separate forecasting decision.

## Findings in the current app

- `lib/velocity/sync.ts` already saves daily per-marketplace, per-SKU shipments
  and ending inventory in `fba_daily_velocity_inputs`. It also replaces a single
  current summary in `sales_velocity`; that summary alone cannot describe trends.
- `lib/velocity/ledger-mapping.ts` currently sets `is_in_stock` from a positive
  SELLABLE ending warehouse balance. A day with shipments and a zero ending
  balance is excluded from the current velocity sample. Unknown balances also
  map to false, so analytics must inspect raw values instead of that flag alone.
- The parser currently converts an unreadable shipment value to zero. Analytics
  needs explicit validity so an unknown shipment count cannot look like no sales.
- The captured header in `lib/velocity/ledger-mapping.test.ts` includes starting
  balance, receipts, and adjustments, but the mirror does not retain those facts.
- `lib/velocity/calculate.ts` limits lookback by row count. Analytics must use
  actual date bounds because missing dates and stockouts make row count differ
  from elapsed calendar days.
- The shell supports another protected route under `app/(app)`. This section can
  use the existing authenticated read access and daily sync cadence.

Amazon documents DAILY ledger output as end-of-day aggregates, including starting
and ending balances and shipment movements. It does not establish hours of
customer-facing availability. Thus warehouse balances provide an availability
proxy, not proof that a listing was buyable all day. Source:
[Amazon FBA reports, Inventory Ledger Summary](https://developer-docs.amazon/sp-api/docs/report-type-values-fba#inventory-ledger-report---summary-view).

## 1. Establish which days can support a rate

Revised after Brian's sellout-day question: include a valid completed SKU-day if
there is evidence of stock at the beginning or end of the day, OR a positive
customer-shipment count. This is an **eligible selling day** for observed velocity,
not a claim that the listing was buyable for a full day. Require a valid shipment
count even when inventory qualifies the day. Count all its shipments in the
numerator and exactly one day in the denominator, never just the shipments.

Validate the classifications against captured real launch, restock, zero-sales,
and sellout records before finalizing them:

| Day evidence | Treatment |
| --- | --- |
| Known positive starting or ending sellable balance, valid shipments | Include shipments and one day, with warehouse-stock proxy label |
| Same stock evidence and explicitly zero shipments | Include zero units and one day; stocked days without sales must count |
| Positive starting balance, ending zero | Include; flag possible stock depletion/partial availability, even with zero shipments |
| Starting zero, ending positive | Include; flag restock/partial availability |
| Zero ending balance and valid positive customer shipments | Include shipments and one day; flag possible sellout or delayed fulfillment |
| Unknown inventory but valid positive customer shipments | Include as shipment-evidenced activity with inventory unknown; do not infer stock availability |
| Known zero balances, zero shipments, no evidence of replenishment | Inferred out-of-stock day; exclude from rate and show as a gap |
| Missing row, invalid shipment count, or neither positive stock nor shipment evidence with incomplete balances | Unknown eligibility; exclude and flag, never fill with zero |
| Zero balances, zero shipments, but intraday movements | Availability ambiguous; show separately until the movement evidence is validated |

Even positive opening and closing balances can hide an intraday stockout. Keep
that limitation visible in the metric explanation. Do not label these as
verified full days of buyable inventory. AWD/SVD quantities never qualify a day.

Include potential sellout-day shipments in the main observed velocity as well as
launch summaries. Shipments can fulfill purchases placed earlier, so a positive
shipment count does not prove a same-day sale or stock availability. Describe all
rates as FBA units shipped per eligible selling day, used as a sales-velocity proxy.
Counting a partial day as one day avoids guessing hours of availability; it does
not estimate unconstrained demand. No extrapolation to a hypothetical full day.

Show how many included days qualified from inventory, shipment evidence only,
or both, plus the count of possible sellout/restock days. A shift in that mix can
affect a comparison; expose it beside the trend. Use identical eligibility rules
for recent, previous, best-period, and launch calculations. Keep this analytics
eligibility separate from the existing inventory fact `is_in_stock`.

An additive migration can retain starting balance and parse-quality evidence.
Existing rows can qualify from valid positive ending inventory or verified
positive shipments without an opening balance. A zero-shipment, zero-ending-stock
row with unknown opening inventory stays unclassified until backfilled. Since
the old parser lost invalid-shipment evidence, validate/reprocess the source
range before treating zero shipment values as verified. Never default missing
new fields to zero. Aggregate across FNSKUs before classifying a SKU-day.

## 2. Recent velocity, previous velocity, and growth

Default comparison size: **7 eligible selling days**. Offer **14** and **28**.
Seven makes short launches useful earlier; larger samples trade responsiveness
for steadier numbers. The prior 21-of-28-calendar-days gate would hide too many
launches and is superseded by this design.

- Recent velocity: shipments on the latest N eligible days divided by N.
- Previous velocity: the immediately preceding, non-overlapping N eligible days.
- Absolute change: recent minus previous, in units per eligible day.
- Percentage change: 100 times absolute change divided by previous velocity.
- Both windows use all eligible days in order, including true zero-sales days.
  Never choose only days that had sales.

Windows show their real inclusive start/end dates and elapsed calendar span.
Seven eligible selling days need not equal one calendar week. To avoid joining unrelated
periods, each N-day window may span at most 3N calendar days, and both comparison
windows must be within the last 90 calendar days. Unknown dates interrupt a
qualifying window; known out-of-stock days with no shipments may be skipped within
the span limit. Include qualifying sellout/restock days rather than skipping
them. Report skipped days and the stock-evidence mix of the included days.

Construct the recent and previous blocks from the newest eligible dates first.
If a block violates these rules, mark the comparison unavailable; do not search
backward for a more favorable pair and call it recent. A gap of more than 28
calendar days between the two blocks also makes them a restock comparison rather
than a current trend. These bounds are proposed defaults to validate on real data.

When the recent block ends more than 14 calendar days before the analysis cutoff,
label it **Last observed pace**, show its age, and omit a current trending badge.
Historical comparisons remain visible in the product detail.

### Trend labels

Two complete equal-size windows are required for a percentage comparison. Display
the two shipment totals and sample sizes alongside it. Initially:

- **Trending up:** at least +15% and +0.1 units/day, with at least 20 combined
  shipments across the two windows.
- **Trending down:** at most -15% and -0.1 units/day, with the same evidence gate.
- **No clear change:** complete windows that do not meet those change thresholds.
- **Limited volume:** fewer than 20 combined shipments; show the observed rates
  and change, but do not award a strong direction label.
- **Sustained growth:** three complete, non-overlapping N-day windows, with each
  successive comparison meeting the Trending up rules and temporal limits.
- **New activity:** previous rate is zero and recent is positive. Show the
  absolute increase, never infinity or a fabricated percentage.
- Both rates zero: **No observed shipments**, with percentage change unavailable.
- Missing/partial comparison window: **Not enough comparable history**.

Trend labels are descriptive screening rules. Do not call them statistically
significant or confidence estimates. Launch promotions, seasonality, advertising,
weekday mix, and shipment timing can affect the observed change. Show these as
possible context rather than asserting the cause of an increase.

## 3. Best observed velocity with a verifiable period

**Best N-selling-day velocity** is the highest average among qualifying rolling
N-day blocks within the selected historical lookback, default 365 calendar days.
The same 7/14/28 selector applies. Compare equal-duration samples; do not rank a
one-day burst against another product's 28-day average.

A candidate is N consecutive entries in the eligible-day sequence, including
zero-sales days, subject to the same 3N calendar-span limit and unknown-day rule.
It is not the N best individual days gathered from anywhere in the year. Rolling
candidates may overlap when locating a maximum. Ties prefer the shorter calendar
span, then the more recent ending date.

Display each best period as an evidence card, for example (illustrative):

> **Best 7-day pace: 8.0 units/eligible selling day**
> 56 units, Aug 4-12, 2026. Seven eligible days across nine calendar days.
> Two excluded stockout days. Recorded 36 days before the analysis cutoff.

Clicking the metric highlights the exact qualifying dates and gaps on the product
timeline. Preserve shipment total, eligible dates, stock-evidence mix, excluded-day counts, source
run, data-through date, lookback, and calculation version so the figure can be
reproduced. Show historical coverage and any missing data; call it **best in
available history**, never an unqualified all-time best.

The historical maximum is an observed high point and is selected for being high.
It is not an expected future rate. A currently sold-out product can still show a
valid dated best period, while its current availability is a separate badge.

## 4. Limited-stock launch view

Keep new products in the table regardless of comparison eligibility. Do not
silently change the selected window size when their history is short.

| Usable history | Display |
| --- | --- |
| Zero eligible days | Stock/shipments timeline and eligibility reasons; rate unavailable |
| One or two eligible days | Observed units and days; too early for a ranked velocity signal |
| Three to six eligible days with 7 selected | Early launch pace over all qualifying days in the current short period, explicitly provisional; no seven-day best or growth badge |
| At least seven eligible days | Seven-day pace and best qualifying seven-day period; previous comparison waits for another full block |
| At least fourteen eligible days | Recent versus previous seven-day comparison if date/data-quality gates pass |
| At least twenty-one eligible days | Three-window sustained-growth screen if all gates pass |

Early pace uses the latest available eligible block, limited to three times its
day count in calendar span and interrupted by unknown data. It is not maximized
across many tiny candidate windows. With 14 or 28 selected, show a partial sample
as such and offer the smaller window explicitly rather than substituting it.

Example: 30 shipments over five eligible days gives an early pace of 6/day.
Ten additional units on a sixth day ending at zero stock are included: 40 / 6 =
6.67 units/day, with one possible sellout day flagged. Thirty subsequent known
stockout days with no shipments do not dilute that rate.

Regression example: Monday ships 10 units and ends with 40; Tuesday ships 40 and
ends with zero; Wednesday starts/ends with zero and ships zero. Observed velocity
is (10 + 40) / 2 = 25 units/day. Tuesday is included and flagged; Wednesday is
excluded. A stocked day with zero shipments would count and lower the average.

Group the timeline into observed periods of inventory or shipment activity,
separated by inactive stockouts or unknown gaps. Record dates, units, eligible-day
pace, and the included partial-day shipments for each period. Call the earliest
one **First observed activity period**
unless listing data establishes it was the actual launch. Compare equal-size
samples around restocking; do not equate entire episodes of unequal length.

## 5. Strongest historical momentum

After the initial metrics work, add **Strongest observed increase**: find the
largest absolute velocity gain between two consecutive, non-overlapping N-day
blocks, with both periods fully inside the selected historical lookback.

Apply the same completeness, volume, span, and gap rules, except historical
periods are not subject to the current-trend freshness gate. Show both date
ranges, both rates, the absolute gain, percentage change when defined, and units
supporting the comparison. Rank by absolute units/day gain by default so a tiny
baseline does not dominate. Keep zero-baseline activity separately labeled.

This distinguishes **highest pace** from **largest increase in pace**. A SKU may
have its fastest period in August but its strongest improvement in July. Neither
historical maximum earns a current Trending up badge without current evidence.

## 6. Product placement: dedicated analysis, embedded decision signals

Use a hybrid placement. Advanced Analytics gets a dedicated `/analytics` route,
protected by the existing app layout, because exploring windows, historical
peaks, stock gaps, and product timelines needs more room than the reorder table.
Reorder consumes a compact summary from the same analytics module so an operator
does not have to leave the decision workflow to notice a meaningful trend.

Do not combine the full analytics experience into Supplier Reorder. Analysis and
reordering are related but distinct tasks: analytics asks what demand did and how
strong the evidence is; reorder asks what supply action is appropriate now. A
single large page would make both harder to scan and would couple every analytics
iteration to the high-stakes reorder workflow.

Place **Analytics** directly after **Reorder** in the Modules navigation. Use the
short navigation label `Analytics`; the page heading can be `Advanced Analytics`
and its first section `Sales momentum`.

### Dedicated analytics page

- Page title: **Advanced Analytics**. Initial section: **Sales momentum**.
- Controls: 7/14/28 eligible selling days, best-period lookback 90/180/365 calendar days,
  product search, and filters for trending up, sustained growth, early launches,
  currently out of stock, limited data, and historical-only results.
- Four summary cards: Trending up, Early launch signals, Stock constrained
  (fewer than 30 days of recent observed cover), and
  Insufficient evidence. Each card filters the table rather than acting as a
  disconnected dashboard statistic.
- Keep the table product-centered. Freeze SKU/product on the left, then group
  columns visually as **Inventory now**, **Observed velocity**, and **Evidence**.
- Inventory now: FBA fulfillable, counted inbound, AWD, SVD, total usable supply,
  and days of cover. Reuse the exact supply values produced by `lib/reorder`; do
  not reassemble supply inside analytics.
- Observed velocity: recent pace, previous pace, percentage and absolute change,
  trend, best observed pace, and strongest historical increase when available.
- Evidence: dates, eligible-day count, possible sellout/restock-day count, data
  freshness, and current/last-observed status.
- Show three inventory scenarios in a row expansion or product detail: days of
  cover at the existing reorder forecast, recent observed pace, and best observed
  pace. Scenario quantities are decision support and do not overwrite the
  configured reorder forecast.
- Sort growth by absolute increase initially; allow percentage and best-pace
  sorts. Nulls sort last. Provisional and historical-only observations remain
  distinguishable from complete current comparisons.
- A product detail panel shows daily shipments on a calendar axis, shaded
  stockout/partial/unknown-stock intervals, the comparison windows, and the best period.
  Distinguish included shipment-evidenced days from excluded unknown-eligibility gaps.
  Skipped dates remain visible; the chart never connects an absent month as
  though continuous stock was available.
- Show a compact explanation such as “42 units / 7 eligible days, Sep 2-11” for
  every rate. Show source freshness separately from the age of the product sample.
- Failed sync or stale data preserves dated historical context with a warning
  and suppresses current-trend claims. A fresh sync with an old SKU sample is
  still an old observation.

Conceptual layout:

```text
Advanced Analytics / Sales momentum
[7 days] [14 days] [28 days]    [History: 365 days]    [Search]

[Trending up 8] [Early launch 4] [Stock constrained 6] [Needs evidence 12]

Product          Inventory now             Observed velocity                 Evidence
                 Usable  Cover              Recent  Previous  Change  Best     Period/status
SKU A            120     20d                8.0     5.5       +45%    9.1      Sep 2-10
SKU B             18      6d                3.0     n/a       Early   3.0      5 eligible days

Expanded SKU A
Inventory cover: configured forecast 20d | recent pace 15d | best pace 13d
[daily shipment and stock-evidence timeline with selected windows]
```

### Reorder integration

- Add one compact **Momentum** column to Reorder, not all analytics columns. Show
  a label such as `Trending up +45%`, `Early 5d`, `Stable`, or `Historical only`.
- The label links to `/analytics?sku=...`, opening the product detail and exact
  evidence. Its tooltip shows recent pace, previous pace, and date windows.
- On Reorder Now rows, highlight when days of cover at recent pace or best pace
  is materially lower than cover at the configured forecast. Keep the configured
  recommendation quantity visually primary until a separate forecast policy is
  approved.
- Add a small section summary above Reorder Now only if it leads to an action,
  such as `3 reorder candidates are trending up`. Clicking it filters to those
  rows. Avoid duplicating the full analytics dashboard.
- Replenish from SVD to FBA can use the same Momentum label because demand affects
  transfer urgency, but its current target-cover calculation remains unchanged.

### Module seam

Create one deep analytics module with a small interface that returns a product's
dated velocity evidence, trend classification, and inventory scenarios. Both the
dedicated page and Reorder call that interface. Keep window selection, sellout-day
eligibility, historical maxima, freshness, and evidence labels inside the module.
This concentrates the difficult logic in one place and prevents the two screens
from calculating or naming the same metric differently.

## 7. Build sequence and acceptance evidence

### Phase A: validate stock evidence and history

Capture representative real reports and reconcile selected SKU-day totals with
Seller Central: launch with a sellout, long stockout and restock, stable seller,
and low-volume seller. Confirm report date basis, completed-day cutoff, reporting
lag, and whether quiet inventory days are included. Never treat the maximum row
date alone as proof that every product has complete history through that date.

Decide availability classifications from those records, retain additive balance
and validity evidence, and backfill an explicit supported range. Keep current
reorder semantics isolated. Mark records outside verified coverage as unavailable.
Read paginated daily history; Supabase's response row limit must not silently
truncate a store-wide history query.

Acceptance: captured data reproduces observed movements; stocked zero-sales days
remain usable; qualifying sellout days contribute shipments and one day; invalid and missing rows never
become zero-demand observations. Migration/backfill execution is a later rollout
step, not part of this planning task.

### Phase B: implement the metric engine

Add pure window and trend calculations in a dedicated analytics service that
reads persisted mirrors. Calculate on the server initially; the existing daily
ledger is sufficient for derived metrics once evidence is classified. Persisting
new metric columns in `sales_velocity` is not required. Consider a rebuildable
analytics summary only if profiling justifies it.

Acceptance examples cover: known inactive stockout days excluded from both numerator
and denominator; zero-ending-stock days with shipments included with one day;
stocked zero-sales days included; shipment-only evidence flagged without inferring
in-stock status; invalid shipment counts rejected; date-based lookback; unknown gaps;
partial launch history; zero baseline; stale samples; equal-size non-overlapping
comparisons; rolling best-period boundaries and ties; insufficient source range;
SKU reconciliation and aggregation without double counting; and idempotent replay.
Use pure numerical examples for math tests and captured records for parser tests.

### Phase C: deliver the complete first page and Reorder signal

Build the navigation entry, protected route, filters, sortable table, and product
detail timeline. Deliver recent/previous rates, changes, trend labels, best dated
period, launch evidence, inventory scenarios, and the compact Reorder Momentum
column together. Refresh analytics from the existing ledger sync; viewing the
page does not issue Amazon reports. Ads availability does not block the view.
Unavailable SVD or inventory sources preserve the velocity analysis but make the
affected inventory scenario unknown rather than zero.

Acceptance: a five-day launch remains discoverable with early evidence; a sold-out
product retains its dated best; changing 7 to 14 recalculates windows and correctly
changes insufficient-data states; all sorting and chart selections match the
underlying daily inputs; the Reorder label deep-links to the same evidence; the
three cover scenarios use the canonical reorder supply total; authenticated staff
can inspect the page.

Run the project tests, lint, production build, browser interaction checks, and
required read-only code review before committing implementation. Apply additive
migrations/backfill before deploying dependent UI. Merge and deployment retain
their separate authorization steps.

### Phase D: add historical momentum and validate thresholds

Add strongest-increase period pairs and restock-period comparisons. Replay older
cutoffs against later observed stocked periods to assess how often the trend
labels persist. Tune the proposed thresholds from that evidence before describing
them as reliable signals. Forecast adjustments, confidence modeling, attribution
to ads/promotions, and automatic reorder changes are later scope decisions.

## Handoff

Repository inspected on clean `main` at `c403403`; plan prepared on
`feat/advanced-analytics`. No `docs/WORKFLOW.md` exists, so the work-start
fallback was read without installing it. User request and `AGENTS.md` govern scope.

Completed: formal spec, additive evidence migration, parser evidence retention,
pure metric engine, paginated reader, protected Analytics page, inventory-cover
scenarios, daily evidence detail, and compact Reorder signals. Eligibility
includes positive-shipment days that end at zero while retaining the possible
sellout flag. The implementation excludes partial current dates and suppresses
current momentum when the FBA ledger sync is failed, missing, or over 48 hours
old. Full tests, lint, TypeScript, production build, and independent review are
the completion gates.

Remaining release work: apply migration `0020`, run the FBA ledger sync to
reprocess history, then merge and deploy only with their separate approvals.
No migration, backfill, Amazon request, merge, or deployment was performed while
building this branch.
