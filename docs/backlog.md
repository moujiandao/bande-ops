# Backlog

Canonical to-do list for bande-ops (per project rules). Active Module work is tracked in
GitHub Issues; deferred items live here as tickets and get promoted to issues when picked up.

## In progress

### Module 1 — Catalog & Inventory
The first Module: synced mirror of catalog + inventory plus the operational layer
(replenishment settings, reorder recommendations, notes). PII-free, read + recommend only.
Tracked in GitHub issues **#1** and **#2** — not duplicated here.

## Deferred

### Module 2 — Ads (Advertising API)
Build campaign/ad reporting and management on the Amazon Advertising API as a second Module.
Synced mirror of ad entities; operational layer for our own tuning decisions.

### Module 3 — Product Launch (titles / descriptions)
Authoring and update flows for listing content (titles, bullets, descriptions) once the
SP-API write path is in scope.

### Module 4 — Product Research / competitor landscape
Competitor and market research surface (competitor listings, pricing, opportunity signals)
to inform launches and replenishment.

### Multi-marketplace (CA / EU) enablement
Exercise the `marketplace_id` dimension beyond US. Schema already carries it; this turns on
CA/EU in logic, auth scoping, and per-marketplace sync.

### Auto-PO / FBA shipment writes (high blast radius)
Move replenishment from decision-support to actually writing POs / FBA inbound shipments.
High blast radius — gated behind explicit approval and safeguards.

### VA roles / finer RBAC
Expand beyond the current 2-user `role` column to finer-grained roles (e.g. VA-scoped
permissions) with matching RLS policies.

### Port listing-editor capabilities onto SP-API
Re-implement the legacy Playwright `listing-editor` capabilities on official SP-API write
endpoints, retiring the scraping tool (see ADR-0002).

### Replace typecheck-only pre-commit with full test run
Once a test suite exists, swap the `tsc --noEmit` pre-commit step for a full test run
(keep lint-staged).
