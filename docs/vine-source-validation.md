# Giveaway shipment evidence validation

Validated 2026-09-17 local time (captures 2026-09-18 UTC).

## Access and data boundary

Brian approved the two non-restricted FBA shipment reports and the minimum
matching, quantity, date, promotion and charge fields needed for this feature.
Destination fields are discarded before storage/logging. No Orders API, RDT,
customer contact details, raw report persistence or Amazon write-back is used.

| Report | Observed fields relevant to matching |
| --- | --- |
| `GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA` | UTC shipment timestamp, SKU, FNSKU, ASIN, quantity, currency, unit price, shipping/gift amounts, order ID. No shipment-item ID. |
| `GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_PROMOTION_DATA` | Pacific date, currency, discount, promotion ID/description/rule, order ID, shipment ID, shipment-item ID. No SKU or quantity. |

Amazon's [FBA report documentation](https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba)
documents these reports. Sales records can lag by up to 24 hours in rare cases;
promotions update daily and are available in North America. It does not document
the observed Vine description as a guaranteed stable enum. Numeric comparisons
and format validation are therefore necessary; future source changes can still
require a parser/classifier update.

## Seller-confirmed launch comparison

Brian supplied **B0GNZQ147T**, mapped to **hp_notepad_2pack**. The March 10–19 UTC
report request returned 917 sales rows and 294 promotion rows. The target had
30 one-unit shipments, each priced $19.99.

- 28 shipments matched the description `Auto-generated promotion for Amazon Vine enrollment`, promotion ID `30618988401`, rule value `70`, and a $19.99 discount. Shipping and gift-wrap charges were zero.
- Two shipments had no promotion record in the completed report.
- Pacific daily totals were 15, 13, 1 and 1 on March 11, 12, 13 and 16. These exactly matched the ledger. The excluded amounts were 14, 13, 1 and 0.
- Using UTC dates instead produced 11, 17, 1 and 1, proving string-date truncation is wrong for this sample. Use `America/Los_Angeles`, including DST.

This validates a positive Vine example and its inclusion in ledger customer
shipments. It does not establish that all Vine shipments forever carry this
marker or that an absent marker means there were no giveaways.

## Expanded rule and conservative limits

Brian approved treating all fully discounted item shipments like Vine for
momentum. With no fee charges, total discount equal to quantity × unit price
classifies a giveaway independently of description wording. Integer cents avoid
floating-point comparison errors. Covering all item and fee charges also proves
that the item is free. The exact observed Vine marker can establish item-specific
discount attribution when its amount reconciles to the item subtotal.

The captured promotion discount column also contains shipping offers. AtD,
Free Sub SameDay, and US Core Free Shipping examples offset shipping charges;
a Nagle discount is partial. Shipping-only and partial promotions must not be
subtracted as free products. When a subtotal-sized discount could partly pay for
shipping/gift wrap, attribution is unknown. Zero unit price alone, conflicting
Vine amounts, and ambiguous mixed-unit discounts also remain unknown.

The August 18–September 17 sample (4,121 sales / 609 promotion rows) had no explicit
Vine description. It included 186 orders with multiple sales rows, 61 promotion
rows on multi-SKU orders and 10 on orders spanning multiple UTC dates. An order
join alone is insufficient. The implemented classifier requires one sales row
and one shipment-item identity for promoted orders; ambiguous days are unknown.
It intentionally sacrifices coverage to avoid removing paid units by guessing.

## Storage, freshness and future orders

Sanitized real subsets are in `lib/amazon/__fixtures__/`; order and shipment
identifiers are consistent ephemeral HMAC pseudonyms. Production storage retains
only daily aggregates, safe issue codes and report/batch metadata. The two report
sources are reconciled with each ledger SKU/day before adjusted evidence is usable.

The implementation runs on the existing daily sync regardless of the toggle.
Recent work overlaps prior coverage and catches up after outages. A second lane
walks history in bounded ranges. Both are resumable, and Settings offers a manual
advance action. The source scans every returned SKU, including future products.
No maintained Vine ASIN list is involved. Retention and ambiguous item matching
limit coverage; historical failures do not become zero giveaway counts.

Publication is atomic and lease-fenced. Incomplete refreshes retain the previous
published generation. Corrected ranges can replace an exclusion with zero;
changed raw ledger totals immediately invalidate incompatible older adjustments.
Old coverage does not become current merely because a report finished today.

## Release state and evidence

Automated captured-source classification/reconciliation checks pass. All 538 tests, lint, TypeScript and the production build passed after review fixes.
Local PostgreSQL 18 migration tests verify permissions, RLS, fenced publication,
failed-write isolation and replacement with zero. The required read-only code review passed; details are recorded in `issues/prd.md`. Brian applied migrations 0022/0023, and hosted verification confirmed the schema
and anonymous read denial. The first production sync published August 19 through
September 15 coverage: 1,364 reconciled product-day records and 135 unknown records.
No confirmed giveaway units were excluded in this interval; the known March
launch is still outside this initial historical coverage. July 29–August 18 is
queued for a later sync. The shared toggle remains off.

Merge/deployment authorization and signed-in feature UI verification remain.
The deployed app's daily cron does not contain this feature yet, so queued jobs
will continue automatically only after deployment (or another authorized local
sync).
