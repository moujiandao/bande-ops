# Build on the official SP-API rather than porting the Playwright `listing-editor`

We already have `listing-editor`, a working tool that drives Seller Central via Playwright
browser automation. For the new Ops App we are rebuilding catalog/inventory/listing
capabilities on the **official SP-API** instead of porting that automation.

Browser automation is brittle (breaks on UI changes), hard to test, and would drag the
"mess" we're escaping into the clean app. The official API gives us stable contracts, a
sandbox, and a testable seam (the `AmazonClient` interface). The trade-off is real:
SP-API has onboarding (LWA credentials, app registration) and doesn't cover every Seller
Central surface the UI exposes, so some legacy-tool capabilities may lag. `listing-editor`
remains as a fallback and backlog reference until each capability is rebuilt on the API.
