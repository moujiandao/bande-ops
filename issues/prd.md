# PRD: Exclude Vine and fully discounted giveaways from sales momentum

Date: 2026-09-17
Status: Implemented on `feat/vine-sales-momentum`; verification and release gates below.

## Problem and outcome

Free product giveaways can inflate launch velocity and sales momentum. Brian
wants a marketplace-wide Settings toggle that removes Vine and fully discounted
item shipments from descriptive analytics while retaining raw inventory facts,
stockout-aware day eligibility, and existing supplier/transfer forecasts.

On 2026-09-17 Brian broadened the original Vine-only scope: other fully discounted
promotions count as giveaways for this feature. The remainder must not be called
paid, organic, or full-price sales. Partial discounts and free shipping do not by
themselves qualify an item as a giveaway.

## User experience

Place a saved switch in **Settings → Analytics** labeled **Exclude Vine and
full-discount giveaways from sales momentum**. Default off. The setting is
shared by all authenticated users and applies to Analytics plus Momentum badges
on Supplier Reorder and FBA Replenishment. It persists in the database across
sessions/devices. No competing local or URL preference exists.

Show pending, saved, unsaved, and failure feedback. Revalidate all affected
views after saving. Another user's next page refresh reads the persisted value.
A read failure leaves the basis unavailable rather than assuming on or off.
The setting may be enabled before reports finish, but unavailable evidence must
remain visibly unknown. Settings also offers an authenticated **Refresh shipment
evidence** action that advances persisted report jobs without a full inventory sync.

Display the active basis with a Settings link on analytics and planning views.
For selected-product evidence, show total shipments, giveaways excluded, observed
units, eligibility, and dates. Recent, previous, early, and best period totals
retain raw and excluded units. Show report coverage through a Pacific calendar
date, processing state, and incomplete history. Do not move the ledger analysis
date backward to hide report lag.

## Source evidence and access decision

Brian approved a narrow exception to the repository's Orders/PII restriction:
request the FBA customer shipment sales and promotion reports, keep identifiers
needed for matching, SKU/FNSKU/ASIN, dates, quantities and promotion details, and
discard destination fields before storage or logging. His subtotal/discount
comparison additionally authorizes the necessary item, shipping and gift-wrap
amounts. No broader Orders API, restricted roles, RDT, or customer PII storage is
in scope. All Amazon calls remain within `lib/amazon`.

The known Vine ASIN **B0GNZQ147T**, SKU **hp_notepad_2pack**, validates the source:
30 units shipped March 11–16, of which 28 have the observed Amazon description
`Auto-generated promotion for Amazon Vine enrollment` and a $19.99 discount
against a $19.99 item subtotal. Two shipments have no promotion. Pacific-day
shipment totals 15, 13, 1 and 1 exactly match the ledger. Sanitized captured
fixtures preserve this example and shipping/partial-discount counterexamples.
See `docs/vine-source-validation.md` for provenance and limitations.

The description is observed evidence, not a guaranteed stable enum. The primary
business rule is a fully discounted item subtotal. When shipping and gift-wrap
charges are zero, total promotion discounts equaling item subtotal suffice even
if the description changes. The report also puts shipping offers in its discount
column: fee-bearing cases require enough evidence to prove the item itself is
fully discounted. Ambiguous item-versus-fee attribution stays unknown. Zero price
alone does not qualify. Money comparisons use integer cents.

## Classification and reconciliation contract

- Parse only the approved two report formats. Validate required headers, dates,
  quantities, currency and amounts. A changed or empty report does not establish
  zero giveaway activity.
- Match promotions only to an unambiguous single shipment-sales row and single
  shipment-item identity for the order. Multi-item/order ambiguity stays unknown.
  Partial shipments must not cause an entire order to be subtracted.
- Deduplicate identical promotion identities. Conflicting duplicate records stay
  unresolved. Sum related promotion amounts before classification.
- Use quantity × unit price for item subtotal. Keep shipping and gift-wrap charges
  separate. Mismatched Vine amounts or mixed-unit discounts that cannot be
  attributed stay unknown.
- Resolve canonical SKU by unique FNSKU, then exact SKU. Conflicting or unresolved
  identity prevents a zero-exclusion assertion on the affected day.
- Convert full shipment timestamps to `America/Los_Angeles` with DST-aware dates.
  Request padding around each published range to check adjacent order activity.
- Reconcile all shipment units to the same canonical SKU/day in the FBA ledger.
  A mismatch, invalid count, unmatched promotion, ambiguous classification or
  impossible exclusion makes that day's adjusted evidence unknown. Never clamp.
- Persist only daily aggregates, report/job metadata, classification version,
  issue codes, and coverage. Do not persist order IDs, shipment IDs, customer
  destinations, raw report text, or signed download URLs.

## Metric behavior

Adjusted units equal valid ledger customer shipments minus reconciled giveaway
units. Apply this basis before day classification, all eligible-day windows,
trend thresholds, best-period selection, and inventory-cover scenarios.

| Daily evidence | Adjusted treatment |
| --- | --- |
| Positive starting or ending stock; 5 units, 3 giveaways | Include one day and 2 units. |
| Positive stock; all shipments giveaways | Include one day and zero observed units. |
| Positive stock; no shipments | Include one day and zero units. |
| Ending stock zero; non-giveaway shipment evidence | Include the day and observed units; retain possible-sellout flag. |
| Only giveaways, without positive stock evidence | Mark eligibility unknown and interrupt the window. |
| Starting and ending stock zero; no shipments | Skip the known stockout day. |
| Invalid shipments or incomplete adjustment evidence | Keep adjusted evidence unknown; retain available raw facts. |

Preserve 7/14/28 eligible-day windows, 90/180/365-day history controls, span limits,
freshness conventions and existing trend thresholds. Unknown dates interrupt
windows rather than being bridged as stockouts. Zero previous velocity never
produces an infinite percentage change. Recompute best dates after exclusions.
Positive stock is a day-level proxy, not verified hours of buyable availability.
AWD and SVD never establish a selling day.

Off retains the previous all-shipment calculation, even if giveaway reports are
unavailable. Neither setting changes physical inventory, archive visibility,
configured forecasts, recommended supplier quantities or transfer quantities.

## Durable sync, coverage and corrections

Use the existing daily sync, independently of the toggle. Discover all report
SKUs, including future products, without maintaining a Vine SKU list. No page
render initiates an Amazon request. SVD remains user-triggered only.

Maintain two bounded, resumable lanes. Recent work overlaps the last completed
coverage and catches up forward after outages, at most 21 published days per
job. A separate lane walks backward through up to 365 days, 21 days per job.
Reports are requested with padding and within the 31-day transport bound. Leave
a two-day delay for source reporting; polling happens once per sync, without
sleeping for report generation. Persist each report ID immediately. Queue the
next interval after publication so subsequent daily runs can collect it.

Failed ranges retry up to three times, then remain an explicit gap
while older work continues. Retention is not guaranteed; do not promise full
365-day recovery. Empty/no-activity ranges cannot be certified by these samples
and remain unavailable. Recent catch-up retries keep the same interval; after
three failures, the job records that gap and advances to avoid blocking all future
shipments behind an unrecoverable interval. A stalled job expires after three days.

Use a marketplace lease to prevent competing jobs. Publish daily rows and batch
completion in one database transaction guarded by the lease token. An old worker
cannot publish or change a batch after losing its lease. Readers use the newest
completed request per SKU/day, preserving the prior generation during pending
or failed writes. A corrected zero replaces the prior exclusion. Stored ledger
counts must still equal the current ledger, and classification versions must
match before analytics uses an adjustment.

A failed recent refresh, evidence older than 48 hours, or report coverage more
than three Pacific calendar days behind prevents a current adjusted claim.
Dated validated history can remain inspectable. An unresolved day after the
selected observed period also prevents presenting that period as a current
trend. Recent report lag is shown, not filled with fabricated zero exclusions.

## Boundaries

Amazon transport owns report requests/status/download and shared retries.
`lib/shipments` owns parsing, matching, reconciliation, jobs, publication and
mirror reads. Analytics consumes validated daily adjustments and owns metric
math. Pages display shared results and do not duplicate calculations.

Migration 0022 stores the authoritative marketplace preference with authenticated
RLS and server-stamped actor/time metadata. Migration 0023 stores rebuildable
batch/daily mirrors and fenced leases. Authenticated users can read mirrors;
only the service role may write them or invoke publication RPCs. The shared
`SyncWriter` contract remains unchanged; additional reads/RPCs are narrowed at
the shipment store boundary. View security requires PostgreSQL 15 or newer.

## Acceptance evidence

- Replay captured launch data: 30 raw units, 28 excluded, 2 remaining, exact
  Pacific ledger reconciliation. Keep real partial discounts and shipping offers.
- Keep financial full-discount classification when description wording changes.
- Reject ambiguous joins, contradictory promotions, empty reports, unknown
  quantities/currency, and mismatched source totals.
- Exercise stocked giveaway-only days, genuine sellout days, known stockouts,
  missing evidence, best-period recomputation, off-mode parity, and forecast parity.
- Exercise pending jobs, persisted report resumption, retry-safe publication,
  correction to zero, failed generations, lease fencing and outage catch-up.
- Verify mirror RLS/privileges, authenticated setting writes, ordinary-user
  manual refresh, and refusal before admin access for unauthenticated requests.
- Run the full project tests, lint, TypeScript, production build, required
  read-only review, and authenticated UI checks before release. Missing services
  or unavailable sessions are verification gaps, not passes.

## Out of scope

Changing the operational demand forecast; classifying all remaining shipments
as paid or organic; deleting physical shipment facts after refunds; lost-sales
estimation; Vine enrollment/reviews; Amazon write-back; unrestricted Orders/PII
access; manual overrides/imports; per-user or per-SKU exclusion preferences;
strongest-historical-increase analytics; guaranteed complete report retention.

## Implementation handoff

Branch `feat/vine-sales-momentum`, based on main `2949e54`. Earlier commits
`d68152f` and `cb1a383` contain settings/math foundations and validated transport.
Current integration adds classification, generation-safe mirrors, resumable
cron/manual refresh, evidence reads, UI copy and the expanded business rule.

Verification complete locally: all 538 tests across 66 files, lint, TypeScript,
instruction-policy checks, whitespace checks and production build passed.
Captured live-source replay passed. Migration
0023 and SQL privilege/publication tests passed against isolated local PostgreSQL
18 with Supabase-like roles/default grants. PostgreSQL 14 cannot run the
security-invoker view; no hosted Supabase migration has been attempted.

The required read-only review passed after fixes for outage date coverage,
coverage-date freshness, and forward progress through unavailable intervals.
Regression tests cover these cases, mixed promotions, and explicit source
timezones. The reviewer made no file or memory writes. Authenticated end-to-end
UI verification is still unavailable in this session. Migrations 0022 and 0023 remain unapplied to
hosted Supabase. No merge, deployment or production evidence writes have occurred.
Once migrations and release are authorized, run the initial refresh, inspect
coverage/unknown states in the signed-in app, and allow the daily sync to continue.
