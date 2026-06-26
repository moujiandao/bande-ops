# Amazon is the source of truth; the local DB is a synced mirror plus our own operational layer

Amazon (SP-API / Advertising API) is the system of record for catalog, inventory,
listings, and ad campaigns. We deliberately do **not** treat our Postgres as a competing
copy: catalog/inventory tables are **synced mirrors** (re-fetchable, carry `synced_at`,
rebuildable from Amazon), while our DB is the sole source of truth only for the
**operational layer** Amazon doesn't store — replenishment settings, reorder
recommendations, notes. Every row is "synced mirror" XOR "ours", never both.

We chose this over a single blended store because letting local edits and Amazon data
share authority is exactly how integrations drift and rot. Reads hit the fast local
mirror; writes go to Amazon and we re-sync. The cost is an explicit sync path and
accepting eventual consistency on mirrored data — worth it to keep "clean" structural
rather than cosmetic.
