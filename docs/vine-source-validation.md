# Vine source validation

Checked 2026-09-18 UTC (2026-09-17 Pacific). Feature branch:
`feat/vine-sales-momentum`.

## Access and scope

Brian approved requesting Amazon shipment sales and promotion reports while
retaining only matching identifiers, SKU, date, quantity, and promotion details.
Destination fields are discarded before logging or storage. This is a narrow
session-authorized exception to the repository's Orders/PII restriction. No
Orders API, restricted roles, RDT, or customer-address storage is authorized.

Both candidate report requests succeeded against the live US SP-API using the
existing credentials and server-side client. The requested range was
2026-08-18T00:00:00Z through 2026-09-17T00:00:00Z.

| Source | Observed rows | Observed fields relevant to matching |
| --- | ---: | --- |
| FBA customer shipment sales | 4,121 | Shipment timestamp, SKU, FNSKU, ASIN, quantity, order ID. No shipment-item ID. |
| FBA promotions | 609 | Shipment date, promotion ID/description/rule, discount, order ID, shipment ID, shipment-item ID. No SKU or quantity. |

The [official FBA report documentation](https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba)
describes both report types and their source delays. The observation above
confirms this seller can request them; it does not establish Vine identification
or complete reconciliation.

## Findings

- None of the promotion IDs, descriptions, or rule values explicitly identified
  Vine. Observed descriptions covered shipping offers, an AtD promotion, and a
  Nagle item discount. None is treated as a Vine marker.
- All 609 promotion rows matched at least one shipment-sales order in this
  interval, but order identity is insufficient for item-level attribution.
- 186 sales orders had multiple shipment rows. 61 promotion rows belonged to
  orders containing multiple SKUs, and 10 belonged to orders spanning multiple
  UTC shipment dates. Subtracting every row of a matching order would be unsafe.
- Sales used full UTC shipment timestamps. Promotion dates were midnight at
  `-07:00`. Simple string-date equality would assign some rows to the wrong day.
  Ledger day semantics and source boundaries still need verification.
- No duplicate shipment/item combination appeared in this sample. This is not
  evidence that duplicates, split promotions, or late corrections cannot occur.

Small sanitized real subsets are stored under `lib/amazon/__fixtures__/`, with
provenance and redaction notes. They demonstrate source shape and join ambiguity,
not a successful Vine classification. No production table was modified.

## Required next evidence

Obtain one seller-confirmed Vine SKU/ASIN and approximate shipment dates, then
request its bounded report interval. Compare confirmed Vine, ordinary, and
non-Vine promotional shipments. Verify a reliable marker and prove that each
subtracted unit actually appears in the ledger Customer Shipments count on the
same canonical day. If these two feeds cannot establish item identity or a
reliable Vine marker, propose the additional source and access scope before
expanding ingestion.

The Analytics toggle remains safe to save, but its on state stays unavailable.
No automatic classification, production sync, or backfill is enabled yet.

## Future shipment behavior

The planned completed integration requests new report intervals on the existing
daily cron, discovers future shipments across all report SKUs, and reprocesses
overlapping recent dates for source lag and corrections. It is not limited to
the initial validation SKU. Report jobs and coverage must survive retries and
runtime limits; a completed download alone is not a successful reconciliation.
Evidence collection runs regardless of the display toggle. Publication requires
complete, compatible ledger and Vine evidence; incomplete periods remain unknown.

Request transport is now available as a concrete `SpApiClient` method restricted
to the two approved report types and intervals of at most 31 days. It is not yet
part of the scheduled sync contract. No future retrieval claim should be made
for the deployed app until the remaining integration and release are complete.

Verification: 508 tests, lint, TypeScript, instruction-policy checks, production
build, and read-only code review passed after adding the request boundary. Live
report retrieval succeeded; reliable Vine identification remains unverified.
