# bande-ops

The domain glossary for the Amazon Seller Central operations app. Defines the project's
canonical language so issues, tests, and code use one vocabulary.

## Language

**Ops App**:
The single web app that runs Seller Central operations.
_Avoid_: platform, suite.

**Module**:
One self-contained capability area inside the Ops App (Catalog & Inventory, Ads, Launch, Research), built end-to-end one at a time.
_Avoid_: application, tool, feature.

**Tool (legacy)**:
An existing standalone script outside this app (`listing-editor`, `supplier-reorder`); reference only until rebuilt as a Module.
_Avoid_: app, module.

**Spine**:
The shared foundation every Module reuses — auth, DB + migrations, the Amazon API client, the UI shell.
_Avoid_: framework, core.

**Synced mirror**:
A local table whose source of truth is Amazon; re-fetchable, carries a `synced_at`. The app never treats it as authoritative.
_Avoid_: cache (too weak), copy.

**Operational layer**:
Local tables Amazon doesn't store (replenishment settings, reorder recommendations, notes); the app is their sole source of truth.
_Avoid_: app data.

**Reorder recommendation**:
A decision-support output: a suggested reorder quantity for a SKU plus its reasoning. Never an executed purchase.
_Avoid_: purchase order, replenishment order.

**Unknown stock**:
An inventory value Amazon reports as non-numeric/unavailable. Distinct from a true zero; flagged for review, never computed as 0.
_Avoid_: empty, missing, zero.
