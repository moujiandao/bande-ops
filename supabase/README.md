# supabase/

Database schema for the Ops App. **This directory is the only place schema
changes go.** No ad-hoc edits in the Supabase dashboard that aren't captured as
a migration here — if it isn't in a migration file, it doesn't exist as far as
the project is concerned.

## Migration convention

- Migrations live in `migrations/` as `NNNN_slug.sql` (e.g. `0001_init.sql`).
- `NNNN` is a zero-padded, monotonically increasing integer. Never renumber or
  edit an applied migration; fix-forward with a new file.
- Each file is plain, idempotent-where-practical Postgres, applied **in order**.
- One logical change per migration; keep them small and reviewable.

## What lives here

Per ADR-0001, the local DB holds two kinds of tables:

- **Synced mirrors** — re-fetchable from Amazon, carry `synced_at` and
  `marketplace_id`. Amazon is the source of truth; never authoritative locally.
- **Operational layer** — data Amazon doesn't store (replenishment settings,
  reorder recommendations, notes, and `profiles`). The app is the sole source
  of truth.

`0001_init.sql` defines `profiles` (operational layer): one row per
`auth.users`, a `role` of `owner` or `staff`, RLS restricting each user to
their own row, and a trigger that auto-creates a profile on signup.

### Live replenishment mirrors

FBA inventory, AWD inventory, FBA daily ledger inputs, calculated sales velocity,
and SVD inventory are synced mirrors. Refresh code writes them with the service
role and records source freshness in `source_sync_state`. Reorder calculations
must surface stale, unknown, or unmapped source data as `Needs review`.

`replenishment_policy`, `replenishment_settings`, and
`inventory_source_mappings` are operational data owned by this app.

## Applying migrations

Local / linked project, in order:

```sh
# Apply all pending migrations to the linked Supabase project.
supabase db push
```

Or paste a single migration file into the Supabase **SQL Editor** and run it.
When applying by hand, run files in `NNNN` order and never skip one.

## Conventions for new tables

- Carry `marketplace_id` (default US) on any synced/marketplace-scoped table
  from day one, even though only the US marketplace is exercised now.
- Enable RLS on every table and add explicit policies; default-deny.
- Mirror tables get a `synced_at timestamptz`; operational tables do not.


## Giveaway analytics migrations

Apply `0022_analytics_settings.sql`, then `0023_shipment_adjustments.sql` before
releasing the giveaway-exclusion feature. Migration 0023 requires PostgreSQL 15+
for its security-invoker view (Supabase projects must meet that version).
The toggle defaults off. Mirror/RPC writes require the service role; ordinary
authenticated users can save the shared setting and trigger the protected refresh.

After deployment, Settings → Analytics → Refresh shipment evidence requests or
collects the next report jobs. Pending reports may need a later refresh; the daily
cron continues both lanes automatically, even with the toggle off. Inspect the
coverage dates and unknown days before relying on adjusted results. No production
backfill is performed by applying the SQL alone.

`tests/0023_shipment_adjustments.sql` exercises privileges and transactional
publication on an isolated local database with Supabase-like roles. It rolls back
its test data. Local validation is not a substitute for the hosted migration and
authenticated application check.


## FBA on-hand inventory migration

Apply `0024_fba_fc_transfer_inventory.sql` before deploying the on-hand fix.
It adds one nullable synced-mirror column and leaves RLS/privileges unchanged.
Existing rows deliberately remain NULL, not zero, because we have never retained
their FC-transfer quantities. After deploying, run **Catalog & Inventory → Sync
now** once (or the full scheduled sync) to populate the field from Amazon. The
old deployment does not write this column, so refreshing it before deployment
will not populate the new data. Until populated, on-hand and recommendations
remain unknown/Needs review instead of silently ignoring transferring units.

On-hand = immediately fulfillable + FC transfer. Both count once toward supplier
reorder and Amazon-side replenishment coverage. Other reservations, researching
and unfulfillable units remain excluded. Historical ledger/velocity rules do not
change. This is an FBA refresh; Refresh SVD and shipment-evidence backfills are
unrelated.
