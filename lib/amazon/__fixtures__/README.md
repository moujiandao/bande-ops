# Shipment evidence captures

Captured from the seller's live US SP-API reports on 2026-09-18 UTC after Brian
approved the narrow report-data exception. Requested interval:
2026-08-18T00:00:00Z through 2026-09-17T00:00:00Z.

- `fba-shipment-sales.redacted.tsv`: 9 source rows selected from 4,121 shipment
  rows, retaining rows belonging to the selected promotion orders.
- `fba-promotions.redacted.tsv`: 8 source rows selected from 609 promotion rows,
  covering each observed description plus multi-SKU and multiple-date orders.

These are **not confirmed Vine examples**. No explicit Vine marker was present
in this interval's promotion IDs, descriptions, or rule values. Do not use the
absence of a marker to conclude that there were no Vine shipments.

Redaction happened in memory before storage. Order, shipment, and shipment-item
IDs are consistent HMAC pseudonyms using an ephemeral random key. Destination
fields, prices, shipping amounts, and fulfillment-center values are replaced
with `[REDACTED]`. Only approved matching identifiers, SKU, dates, quantity, and
promotion details remain. Source column order, field text, and cell quoting
are preserved; line endings are normalized for repository storage.

The full sanitized samples were inspected locally; raw reports were never
written to disk. No report data was written to Supabase. See
`docs/vine-source-validation.md` for findings and the remaining validation gate.
