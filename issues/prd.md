# PRD: Exclude confirmed Amazon Vine shipments from sales momentum

Date: 2026-09-17

Status: Implementation in progress on `feat/vine-sales-momentum`. Brian requested
execution on 2026-09-17. No production change is authorized by this document.
Source feasibility and the order-data boundary remain unresolved. Independent
settings and metric work is implemented; the Amazon integration is not complete.

## Problem Statement

Brian uses sales momentum to identify growing products and guide supplier
purchasing and FBA replenishment. Free Amazon Vine units can make a launch look
like it has stronger customer demand than it actually does, particularly when
initial inventory is limited and the product subsequently sells out.

The current analytics implementation uses daily FBA ledger customer shipments
and stock evidence. It includes a shipment day that ends at zero inventory,
excludes confirmed stockout days without shipments, and preserves dated recent,
previous, and best observed periods. It has no Vine classification or exclusion.
The captured ledger summary format has no order or promotion identifiers.

We have not yet demonstrated how a known Vine shipment appears in this seller's
ledger or supplemental reports. The earlier proposal that all Vine units are
included in Customer Shipments is a hypothesis to verify, not an established
mapping. Subtracting a unit already excluded by Amazon would understate demand.

## Solution

Add a saved toggle in **Settings → Analytics** labeled **Exclude Amazon Vine
shipments from sales momentum**. When on, recent, previous, best, early-launch,
and trend metrics exclude confirmed Vine units. When off, they include all
shipments, including Vine. The setting applies to all users and products in the
current marketplace, including Momentum badges on both planning pages.

Proposed initial value: off, preserving the existing calculation until an
operator explicitly enables exclusion. Once saved, the choice persists across
sessions and devices. Analytics displays the active basis with a link to Settings;
it does not have a competing local toggle or URL override.

Identify Vine using verified Amazon evidence, reconcile those units to the same
SKU and shipment dates as the ledger, and subtract only matched units. Preserve
the raw shipment and inventory facts. Show the number of Vine units excluded,
the dates covered, and any incomplete evidence beside the adjusted results.

Do not describe the remainder as paid or organic sales. Other promotions,
replacements, and non-Vine free units are not classified by this feature.

Success means a known Vine launch no longer creates a misleading momentum signal,
ordinary demand remains measurable through stockouts, and each adjustment can be
explained from source evidence. If Vine identification or report coverage cannot
be established, display adjustment unavailable rather than a guessed result.

## User Stories

1. As an operator, I want confirmed Vine units removed from momentum so giveaways do not look like growing customer demand.
2. As an operator, I want recent and previous periods calculated on the same basis so their change is meaningful.
3. As an operator, I want best velocity recalculated after exclusion so a Vine launch does not remain the historical peak.
4. As an operator, I want early-launch pace to exclude Vine so limited launch data remains useful.
5. As an operator, I want a stocked day with no non-Vine shipments to count as zero demand so the calculation does not select only days with sales.
6. As an operator, I want non-Vine shipments on a day ending at zero inventory included so genuine sellout activity remains visible.
7. As an operator, I want known stockout days skipped so time without inventory does not depress the rate.
8. As an operator, I want Vine-only shipment activity distinguished from customer-demand evidence so missing stock data does not fabricate a selling day.
9. As an operator, I want total shipments, excluded units, and adjusted units shown together so I can audit a change.
10. As an operator, I want a Settings toggle to include or exclude Vine so I can choose the sales-momentum basis for the app.
11. As an operator, I want unavailable or partial Vine data labeled so I do not mistake an unadjusted number for a corrected one.
12. As an operator, I want momentum links on Supplier Reorder and FBA Replenishment to use the same basis as Analytics so the pages agree.
13. As an operator, I want recent and best inventory-cover scenarios to use the selected basis so their assumptions are visible.
14. As an operator, I want historical data corrected after backfill so existing launch peaks and trends can be reassessed.
15. As an operator, I want refreshes and retries to avoid duplicate exclusions so the same Vine unit is never subtracted twice.
16. As an operator, I want existing order quantities clearly separated from the new momentum basis so a descriptive analytics change does not silently alter purchasing policy.
17. As an operator, I want the toggle saved across sessions and devices so the app consistently uses our chosen basis.
18. As an operator, I want the active basis visible on Analytics and planning pages so I can interpret their numbers without reopening Settings.
19. As an operator, I want clear save progress, confirmation, and failure feedback so I know whether a setting change actually took effect.

## Implementation Decisions

### Source validation is the first delivery phase

The candidate feeds are Amazon's FBA customer shipment sales report and customer
shipment promotion report. Their existence is documented; a reliable Vine marker,
join keys, date semantics, quantity granularity, report availability, retention,
and required permissions have not been established for this seller.

Before choosing the final integration:

- Compare a seller-confirmed Vine shipment, an ordinary shipment, and a non-Vine zero-value or discounted shipment against actual report output.
- Confirm that Vine units appear in the ledger's Customer Shipments and determine whether all relevant Vine cases carry the same reliable identifying evidence.
- Verify shipment-level matching, partial shipments, promotion rows, cancellations, marketplace identity, SKU mapping, and timezone/date alignment.
- Prove how a complete report range establishes zero Vine units for an unmatched SKU-day. An absent row alone is insufficient.
- Record report delivery delay and available history; do not promise a 365-day backfill until supported by the source.
- Capture sanitized real fixtures retaining their original structure. Do not invent Amazon headers, marker strings, or report examples.

Zero price, a 100% discount, an enrollment total, or a product's launch date alone
must never classify a shipment as Vine. Unknown classifications stay unresolved.
Failure to find a reliable marker blocks automatic exclusion. A manual import or
correction workflow would require a separate proposal, not an implicit fallback.

### Data-access boundary

The repository currently prohibits Orders/PII access. The proposed report joins
may introduce order identifiers or other order data even without an Orders API
call. Before fetching samples or integrating these reports, identify their exact
fields and permissions and obtain approval for any required exception to that
boundary. Approval to write this PRD is not approval to ingest order data.

Prefer the minimum source evidence needed for classification and reconciliation.
Customer names, contact details, and addresses are unnecessary and must not enter
the analytics mirror, UI, logs, or fixtures. Restricted Data Tokens, new restricted
roles, or a broader Orders API integration require a separate approved design.
Any proposed repository instruction amendment is a draft for Brian's approval.

### Metric contract

For a reconciled SKU-day:

- Adjusted units equal valid ledger customer shipments minus confirmed, matched Vine shipment units.
- Vine units must be a nonnegative integer no greater than ledger shipments. An impossible result is a reconciliation error, not a value to clamp to zero.
- Adjusted velocity equals adjusted units across eligible days divided by the number of eligible days.
- Inventory balances and total shipments remain physical facts; subtracting Vine does not restore stock.
- Refunding a shipment does not erase physical shipment demand in this version. Use shipped quantities; do not subtract an entire order on its purchase date.

The chosen basis applies before day classification, window construction, best
period selection, and trend thresholds. The adjusted basis uses non-Vine shipment
activity as its shipment evidence. The all-shipment basis retains today's behavior.
Both bases require valid raw shipment counts.

| Evidence for a fully reconciled day | Adjusted treatment |
| --- | --- |
| Positive starting or ending sellable stock; 5 total units, 3 Vine | Include one day and 2 units. |
| Positive stock evidence; 5 total units, all Vine | Include one day and 0 units. |
| Positive stock evidence; no shipments | Include one day and 0 units. |
| Ending stock zero; at least one non-Vine shipment | Include one day and non-Vine units; retain the possible-sellout flag. |
| Stock evidence incomplete; only Vine shipments | Mark eligibility unknown; Vine alone does not establish a commercial selling day. |
| Starting and ending stock zero; only Vine shipments | Mark availability ambiguous and interrupt the window; do not infer a full stockout or customer selling day from the giveaway. |
| Starting and ending stock zero; no shipments | Exclude as a known stockout day. |
| Missing/invalid shipments or incomplete Vine classification | Adjusted evidence is unknown; retain available raw facts for inspection. |

Positive stock remains an availability proxy. Neither basis claims verified hours
of buyable inventory or estimates hypothetical full-day demand. AWD and SVD never
qualify a selling day.

Retain the existing 7/14/28 eligible-day windows, 90/180/365-day history controls,
span limits, freshness limits, early-launch minimum samples, and trend thresholds.
Apply shipment-volume thresholds to adjusted units in the adjusted basis.
Unknown dates interrupt windows; do not bridge them as if they were stockouts.
Historical best and comparison dates may change after Vine exclusion and must be
recomputed, not relabeled. A zero previous rate must not produce an infinite
percentage change.

### Completeness, freshness, and correction

Track coverage by marketplace, date range, source generation, and classification
version. A report downloaded successfully is not proof that all required dates,
pages, or related reports were reconciled.

- Treat an unclassified historical day as unknown, never as zero Vine units.
- Publish daily adjustments only after required inputs are complete and reconciled. Consumers must not combine incompatible generations of ledger and adjustment data.
- Deduplicate at validated shipment-item identity before aggregation. Multiple promotion rows and overlapping report windows must not multiply excluded units.
- Reprocessing a completed range must replace its derived totals, including corrections to zero, so removed or corrected source rows do not leave stale exclusions.
- Preserve the last completed generation during an incomplete or failed refresh; expose its age and failure state.
- A failed, missing, or more-than-48-hours-old required source prevents a current adjusted momentum claim. Dated validated history may remain labeled historical, using existing analytics conventions.
- Show the common completed-through date and lag of required sources. Report lag must not silently move the analysis date backward and make old evidence appear current.
- Do not quietly fall back to all shipments. If a recent adjusted period cannot be formed, explain why and link to the Settings toggle. Missing evidence must not change the saved choice.
- When the toggle is off, unavailable Vine data must not block the existing all-shipment calculation; its existing ledger and inventory checks still apply.
- A zero-row parse is not a successful sync. A legitimate no-activity range needs a validated source signal and complete coverage evidence, with no conflicting ledger activity.

### Module responsibilities

1. **Amazon transport:** request and retrieve the validated reports through the existing server-only Amazon client and retry policy.
2. **Shipment classification and reconciliation:** own source parsing, Vine identification, deduplication, canonical SKU/marketplace matching, date alignment, completeness, and daily totals behind one testable boundary.
3. **Synced mirrors and sync tracking:** retain minimally necessary source evidence, daily adjustments, generation/coverage metadata, and freshness. Use additive migrations, service-role writes, authenticated read-only RLS, and the existing structural sync writer contract.
4. **Analytics:** consume raw ledger facts plus validated daily adjustments; own basis-aware day classification, windows, trends, inventory scenarios, and evidence explanations.
5. **Analytics and planning views:** consume shared results, preserving archive rules and source blocking. No calculations or Amazon report requests belong in page rendering.
6. **Analytics settings:** persist the marketplace-wide toggle in the authoritative operational layer, with an explicit false default. Use the existing authenticated Settings write permissions and server-side authentication checks, validate the submitted boolean, and record who changed it and when. A setting read error is unavailable configuration, not permission to assume either basis.

Schedule validated Amazon report refreshes with the existing sync workflow.
Backfill in bounded resumable ranges appropriate to report limits and runtime
budgets, then reconcile overlapping recent ranges for late corrections. A page
view must never initiate the backfill. This integration does not add an unattended
SVD refresh.

### Presentation and workflow

Place the toggle in an **Analytics** section of Settings, with this copy:

- Label: **Exclude Amazon Vine shipments from sales momentum**.
- Helper text: “When on, confirmed Vine giveaway units are excluded from recent, previous, best, and trend calculations. This applies to all users. Recommended order and transfer quantities are unchanged.”
- On: display **Excluding confirmed Vine** as the active basis.
- Off: display **All shipments, including Vine** as the active basis.

Use a labeled accessible switch and a Save action with pending, success, and
failure states. Enable saving an on preference even while backfill is incomplete,
but explain that adjusted metrics will remain unavailable until the required
evidence is ready. Do not present a saved preference as proof of complete data.

Persist the setting in the database, not browser storage. Apply it consistently
to Analytics, SKU detail, filters and summary counts, inventory scenarios, and
Momentum badges on Supplier Reorder and FBA Replenishment. Invalidate affected
cached results after a successful save and refresh the saving user's current
view. Other sessions adopt the new value on their next navigation or refresh;
real-time broadcasting is not required. Failed saves leave the persisted basis
and displayed results unchanged. Toggling must not trigger an Amazon sync.

Keep the existing window/history controls in Advanced Analytics. Add a compact
read-only basis indicator with a **Change in Settings** link. Navigation and
bookmarked URLs must read the saved setting; they cannot override it. Basis must
be part of any derived-result cache identity so results from opposite settings
cannot be reused accidentally.

Keep the main table compact. Show an adjustment summary such as “12 Vine units
excluded” on the selected period/product, and put daily total, Vine, adjusted
units, eligibility, and matching/coverage status in product detail. Different
periods need their own exclusion totals. Avoid adding several always-visible
columns to the main comparison table.

Momentum badges on Supplier Reorder and FBA Replenishment use the saved basis
and link to Analytics, which reads the same setting. If unavailable, show that state explicitly.
Recent/best cover scenarios use the selected demand basis and canonical current
supply. The configured reorder forecast, recommended purchase/transfer quantities,
legacy classification, and last-sold date retain their current definitions in
this release. Label that distinction where forecasts and adjusted pace appear
together. Changing operational demand forecasts is a separate decision.

## Testing Decisions

Test observable results and failure behavior. Use captured, sanitized reports for
external parser and source-integration tests. Small synthetic domain inputs are
appropriate for arithmetic and eligibility tests, but must not masquerade as
Amazon report fixtures. Follow the existing analytics, ledger-parser, sync, and
source-blocking test patterns.

Required acceptance cases:

| Case | Expected result |
| --- | --- |
| Seven stocked days; 35 total units, 21 verified Vine | Adjusted velocity is 2/day; all-shipment velocity is 5/day. |
| Seven stocked days; every shipment confirmed Vine | Adjusted rate is 0/day; denominator remains seven; no positive growth signal caused by Vine. |
| Non-Vine sellout day followed by known zero-stock days | Include sellout units and one eligible day; skip the subsequent stockout days within existing span limits. |
| Vine-only activity with unknown inventory | No inferred commercial selling day; an unknown gap interrupts the window. |
| Known non-Vine zero-value shipment | Do not classify as Vine merely because its price is zero. |
| Historical peak driven by Vine | Recompute the best adjusted period and its exact dates; raw best remains available in All shipments. |
| Incomplete report, missing page, ambiguous match, or conflicting totals | Affected adjusted evidence is unavailable with an explanation; no assumed-zero exclusion. |
| Duplicate promotion rows or repeat sync | Identical adjusted totals; each shipped unit excluded at most once. |
| Same SKU text in different marketplaces; split shipments over two dates | Keep marketplace/date boundaries and subtract only matched shipped quantities. |
| Corrected source removes a prior Vine classification | Reprocessing removes the prior exclusion and invalidates dependent analytics. |
| Adjustment exceeds ledger units | Surface reconciliation failure; never emit negative units or silently clamp. |
| Required source fails or becomes stale | Suppress current adjusted trend claims; keep explicitly dated validated history inspectable. |
| Save the toggle on, then navigate to Analytics and both planning pages | Table, detail, dates, filters, badges, and inventory scenarios use the saved adjusted basis. |
| Save the toggle off while Vine reports are unavailable | All-shipment calculations remain available subject to their original source checks. |
| Reload, sign in on another device, or open a bookmarked SKU URL | Read the saved marketplace setting; no local or URL override changes the basis. |
| Save fails, unauthenticated caller attempts a write, or setting cannot be read | Failed/unauthorized writes do not change the setting; a read failure produces an explicit unavailable state. |
| Saved basis changes after results have been cached | Invalidate affected views; do not reuse opposite-basis results. Another user's next refresh sees the saved value. |
| Feature enabled | Raw ledger/inventory, archive visibility, and existing recommended order/transfer quantities remain unchanged. |

Before release, replay seller-confirmed Vine and ordinary shipments and reconcile
their daily totals against Seller Central. Test RLS and authentication on any new
read or manual-refresh paths. Run the full project suite, lint, TypeScript, and
production build before committing code. Obtain the required read-only code
review and inspect the authenticated UI, including unavailable/backfill states.
Unavailable credentials or missing real fixtures are verification gaps, not passes.

## Out of Scope

- Automatically changing reorder or transfer demand forecasts to adjusted velocity.
- Classifying all remaining shipments as paid, organic, or full-price sales.
- Excluding every zero-price order, replacement, discount, return, or other promotion.
- Managing Vine enrollment, reviews, customer messages, or Amazon write-back.
- Estimating hours in stock, lost sales, or unconstrained demand.
- Manual exclusion overrides/imports without a separately agreed workflow.
- New customer PII storage, restricted-role access, or an unrestricted Orders API integration.
- Changing trend thresholds or implementing the deferred strongest-historical-increase metric.
- Per-user or per-SKU Vine preferences, a separate Analytics-page override, or real-time cross-session updates.

## Further Notes

Delivery phases:

1. **Validate the source:** establish the identifier, ledger inclusion, reconciliation, coverage, permissions, and real fixtures. Record the decision and any required boundary approval before ingesting order data.
2. **Build the adjustment mirror:** add migrations, bounded backfill, retry-safe reconciliation, and source status. Keep the current analytics accessible while evidence is prepared.
3. **Integrate adjusted analytics:** implement the saved Settings toggle, active-basis indicators, shared metric contract, daily audit evidence, planning-page signals, and failure states.
4. **Validate and release:** compare known examples with Seller Central, complete automated/manual checks and review, then request the separately authorized migration/merge/deployment actions.

Reference: Amazon's [SP-API seller use-case directory](https://developer-docs.amazon.com/sp-api/lang-es_ES/docs/sp-api-seller-use-cases)
lists the candidate FBA shipment sales and promotion reports. It does not by
itself establish a Vine-specific marker or this seller's access. No external
report was requested and no production record was inspected for this PRD.

## Implementation handoff (2026-09-17)

Branch: `feat/vine-sales-momentum`, based on main at `2949e54`.

Implemented locally:

- Add migration 0022 for a marketplace-wide analytics preference, default off,
  authenticated reads/writes, and database-stamped actor/time metadata.
- Add Settings switch with pending/save/error feedback and shared read semantics.
  Missing migration or read failures do not silently select a basis.
- Apply the saved basis to Analytics and planning-page Momentum. Display active
  basis and unavailable evidence explicitly. Preserve operational forecasts and
  purchase/transfer calculations.
- Add pure daily adjustment rules and period totals. Test stocked Vine-only days,
  non-Vine sellouts, ambiguous Vine-only stock, invalid quantities, missing
  evidence, best-period recomputation, and all-shipment parity.
- Display raw, excluded, and observed units in daily evidence and period totals.

Source validation remains blocked. The pending user question asks for a narrow
exception to AGENTS.md's "Do not touch Orders/PII data" rule for report matching
fields, plus a seller-confirmed Vine SKU/date. No order reports have been fetched.
No marker, Amazon parser, external fixture, sync, backfill, adjustment mirror,
or automatic exclusion has been invented. `vineAdjustmentIssue` deliberately
keeps the on state unavailable pending a validated source integration. The pure
calculation accepts confirmed daily domain inputs, but production readers do not
yet supply these inputs.

Official source findings:

- [FBA report types](https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba)
  documents shipment sales (`GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA`)
  with SKU, date, quantity and order ID, but also destination city/state/postal
  code. The promotions report
  (`GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_PROMOTION_DATA`) documents promotion,
  order, shipment and shipment-item identifiers, but no SKU or quantity. Their
  join cardinality and a Vine marker cannot be inferred from these field lists.
  Sales may lag up to 24 hours; promotions update daily. The latter is NA-only.
- The [official Orders 2026 model](https://github.com/amzn/selling-partner-api-models/blob/main/models/orders-api-model/orders_2026-01-01.json)
  contains no documented VINE program value. Do not assume `programs` identifies
  Vine or expand to the Orders API without a separately approved design.

Remaining: resolve report-access permission, obtain a known Vine example,
capture/sanitize real evidence, validate marker and ledger inclusion, design
generation-safe reconciliation and coverage storage from those findings, wire
bounded sync/backfill, validate live examples and authenticated UI, then complete
review and release. Migration 0022 is not applied; no merge or deployment has
been performed. This branch is an incomplete foundation, not release-ready.

Verification:

- All 501 tests across 62 files passed. Lint, TypeScript, instruction-policy
  check, diff whitespace check, and production build passed.
- Migration 0022 ran successfully against an isolated local PostgreSQL cluster
  with Supabase-like auth roles and default grants. Checked default off,
  authenticated upsert, shared visibility across two users, server-stamped audit
  fields despite spoofed input, anonymous denial, no delete/truncate privileges,
  and RLS enabled. The cluster was stopped and removed. This is not hosted
  Supabase validation and does not establish live source access.
- The required read-only reviewer passed the foundation with notes about the
  incomplete integration and UI verification. Fixed its stale-switch finding:
  refreshed server settings now reset the local draft, and action feedback no
  longer overrides another user's saved preference.
- Browser verification reached the local login page. No authenticated browser
  session was available, so real save/error/cross-user UI behavior is still
  unverified. The temporary development server was stopped.
