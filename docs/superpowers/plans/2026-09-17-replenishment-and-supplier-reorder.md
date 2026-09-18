# Separate FBA replenishment and supplier reorder

Status: Proposed, inspection complete. Implementation has not started.
Date: 2026-09-17
Baseline: main, 011efcb. Working tree was clean before this document.

## Objective

Give operators two focused destinations: transfer inventory already held at SVD
to FBA, and decide what to purchase from suppliers. Preserve existing inventory,
recommendation, analytics, archive, and shipment-draft capabilities.

## Inspection findings

Inspected the authenticated production Reorder and Analytics screens, including
the full shipment draft, and the current route, table, navigation, settings,
archive, and refresh implementations. Catalog and Settings were also verified
live during the preceding deployment check.

- Reorder places five source-status cards, an analytics banner, transfer rows,
  and a large email draft before supplier recommendations. Purchasing is buried.
- The dark sidebar, pale background, white bordered panels, and restrained teal
  already provide a coherent visual language. Reuse these tokens.
- Dashboard stays highlighted on other pages because navigation is hard-coded.
- The transfer table has many columns and truncates SKU names. Its FBA cell shows
  full FBA inventory, while the shared column description says fulfillable.
- Transfer eligibility uses policy-counted Amazon-side supply. The displayed
  Cover column instead uses total usable supply including SVD. This can show high
  coverage on a row that legitimately needs an SVD transfer.
- Transfer and purchasing controls are coupled in one large ReorderTable.
- Box counts, notes, and edited email drafts are component state. Navigation
  away can discard edits, which becomes more likely with separate pages.
- SVD refresh currently invalidates only /reorder. Archive and settings actions
  also explicitly invalidate existing routes and must include the new route.

## Recommended navigation

Keep two real routes, with adjacent sidebar links in this order:
Catalog & Inventory, FBA Replenishment, Supplier Reorder, Analytics, Ads.

| Destination | Route | Subtitle |
| --- | --- | --- |
| FBA Replenishment | /replenishment | Move existing inventory from SVD to FBA. |
| Supplier Reorder | /reorder | Plan supplier purchases using inventory across FBA, AWD, and SVD. |

Use route-aware active styling and aria-current. Keep /reorder bookmarks pointing
to supplier purchasing. Avoid repeating the same two destinations as desktop tabs;
the sidebar already makes both discoverable. On narrow screens, where the current
sidebar disappears, show two compact route links above the page title. This is a
bounded navigation improvement, not a redesign of the entire mobile shell.

## Page composition

Both pages use the same order: title and actions, compact source-status row,
workflow controls, primary table, secondary sections. Preserve generous section
spacing but prioritize actionable rows over diagnostic cards.

Replace the five large health cards with a compact Data status disclosure showing
source-specific freshness. Expand to see every source timestamp, status, and row
count. Failed, stale, missing, or unreadable sources stay visible even when closed.
Never summarize several independently refreshed sources with one misleading
"last synced" timestamp. Preserve current blocking rules.

### FBA Replenishment

Header action: Refresh SVD, with pending, success, and error feedback. A small
Settings link opens the existing transfer-policy section.

Show the saved Transfer target, for example 90 days, next to the transfer-candidate
count. Keep the saved target in Settings for this slice; do not introduce a second
unsaved coverage control that resembles supplier coverage.

Primary table, Recommended transfers:

| Column | Meaning |
| --- | --- |
| SKU / Box label | Identify the product and physical box |
| FBA total | Existing total with expandable breakdown, clearly labeled |
| AWD units | Existing inventory figure with counted-supply explanation |
| SVD units | Available transfer stock, retain box conversion detail |
| Units/day | Existing configured demand |
| Amazon cover | Policy-counted FBA and AWD supply divided by demand; excludes SVD |
| Momentum | Link to dated Analytics evidence |
| Suggested units | Existing capped transfer recommendation |
| Boxes to send | Editable shipment quantity |
| Notes / Archive | Preserve existing controls |

Remove the redundant all-warehouse Total from the primary transfer columns;
make counted Amazon supply available in the coverage explanation. Do not silently
change demand, inbound policy, box rounding, or transfer recommendation math.

Below the table, keep Shipment email draft in one collapsible bordered panel.
Show a short summary and Copy email action when collapsed; expand to edit the
existing formatted draft. Make regeneration behavior explicit: editing box counts
currently replaces manual email edits. Do not imply that copying sends an email
or creates an Amazon shipment.

Keep blocked candidates reachable in a Needs review disclosure with actionable
reasons and links to mappings or box configuration. Retain an All active products
inspection view so excluded rows can be found. Reuse existing source blocking
rules; do not make a separate, more permissive transfer safety policy.

Show an explicit no-transfer-needed state when the data is healthy. Distinguish
this from unavailable data or all products being archived. Legacy products remain
in a separate disclosure and are never silently included as transfer candidates.

### Supplier Reorder

Primary table, Reorder now, starts near the top. Place Months of coverage and a
Coverage settings link in its toolbar. Rename the default option to Use SKU
settings, with concise helper text explaining SKU overrides and global fallback.
Fixed month choices remain temporary scenarios; show the effective coverage in
row detail without changing saved policy.

Retain FBA, AWD, SVD, total usable supply, demand, momentum, purchase quantity, and
Archive. Label Cover as Total cover and Order as Suggested order (units). Explain
that this calculation already counts policy-eligible supply including SVD.

Keep Needs review, Well stocked, and Legacy reachable as collapsed sections with
counts. Auto-expand Needs review when a source failure prevents recommendations.
Keep source-health warnings visible outside those sections.

Use a small contextual link for trending candidates instead of a full-width
promotional banner. Analytics remains its own page, accessible from both workflows.
Allow Refresh SVD inside source details here too, since SVD affects purchasing.

## Presentation and interaction details

- Reuse current type scale, panel radius, borders, and teal. Teal emphasizes
  quantities and primary actions; reserve warning colors for problems.
- Keep numbers, dates, and status labels on one line. Use tabular numerals and
  horizontal table scrolling rather than shrinking text to fit.
- Give SKU adequate width, retain full text in an accessible detail affordance,
  and keep row actions compact. Use sticky table headers within the scroll region.
- Preserve sorting, FBA expansion, momentum links, archive feedback, box editing,
  draggable notes, and formatted email copying.
- Preserve shipment edits across workflow navigation in tab-session storage,
  scoped by authenticated user, marketplace, and existing shipment-input key.
  Treat storage as a convenience only. If unavailable, explain that edits are
  temporary. If source inputs change, explicitly report that the draft was reset;
  do not restore an obsolete shipment over fresh recommendations. No DB migration.

## Implementation sequence

1. Extract a shared server-side planning-data loader from the current page.
   Preserve archive filtering, source errors, policy, and momentum derivation.
   Both routes consume the same service; routes do not import each other's internals.
2. Split route composition and workflow-specific client components. Reuse small
   inventory cells and table primitives rather than extending the shared table
   with more unrelated conditional behavior.
3. Add navigation, status disclosure, explicit column meanings, Settings anchors,
   transfer draft continuity, and workflow-specific empty/review states.
4. Audit refresh, settings, archive/unarchive, and sync invalidation for both routes.
   Preserve staff access and action-level authentication.
5. Verify, obtain required code review, and prepare the changes for review.
   Merge and deployment require authorization for this implementation.

## Acceptance and verification

- Direct links, refresh, back/forward, and sidebar highlights work on both routes.
- Supplier purchasing is visible without passing transfer rows or an email draft.
- With identical inputs, supplier quantities and suggested transfer units match
  the baseline. Transfer cover displays the existing Amazon-side calculation.
- A product may require both a transfer and a purchase; lists are not mutually
  exclusive. Warehouse stock remains counted correctly for each purpose.
- Unknown/stale sources cannot become numeric recommendations. Empty states
  distinguish healthy absence, blocked data, and archived inventory.
- Archive hides a SKU from both workflows and Catalog; Settings restoration brings
  it back. Refreshed stock and changed settings are reflected on both routes.
- Coverage scenarios do not overwrite saved SKU settings. Transfer target remains
  independent of supplier coverage.
- Draft edits survive route switches, and changed recommendation inputs have an
  explicit reset behavior. Copy output still reflects the entered box counts.
- Inspect desktop, narrow laptop, and mobile layouts; check keyboard navigation,
  focus indicators, disclosure labels, table scrolling, and full SKU access.
- Run npm test, npm run lint, npx tsc --noEmit, and npm run build, then the required
  read-only code-reviewer. Add regression tests for workflow boundaries, coverage
  labels/calculation, draft continuity, and cross-route invalidation.

## Scope and handoff

Planning only is complete. No app code, production data, or deployment changed.
Next step is implementation of the proposed organization. No new dependencies,
schema changes, supplier ordering API, shipment execution, or recommendation
algorithm changes are proposed. Keep broader Analytics and Settings redesigns
outside this slice. Any AGENTS.md updates must be proposed as a separate draft.
