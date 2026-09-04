# Bande Ops

Bande Ops is an operations application for managing an Amazon seller catalog, inventory, replenishment, and Sponsored Products advertising from one interface.

[Open the deployed demo](https://bande-ops.vercel.app)

The deployed application uses synthetic Amazon data. The real SP-API and Advertising API paths remain disabled until their sandbox behavior and production credentials are verified.

## What it does

- Mirrors catalog, FBA inventory, AWD inventory, sales velocity, and advertising data into Postgres.
- Combines supply from FBA, AWD, and a separate replenishment supplier to produce reorder recommendations.
- Calculates sales velocity from recent in-stock days so stockouts do not artificially reduce demand.
- Applies an `(s, S)` replenishment policy using lead time, safety stock, and target coverage.
- Shows campaign performance, ACOS, ROAS, and rule-based recommendations without converting missing data into zero.
- Protects advertising changes behind owner authorization, explicit confirmation, an append-only audit record, and a post-write resync.
- Records synchronization state so stale, failed, or unknown sources surface as `Needs review` instead of producing a confident recommendation.

## System shape

```text
Next.js application
    |
    +-- authenticated catalog, reorder, ads, and settings routes
    +-- server actions with role checks
    +-- scheduled synchronization route
            |
            +-- Amazon SP-API
            +-- Amazon Advertising API
            +-- SV Direct supplier inventory
            |
            v
        Supabase Postgres
        - rebuildable source mirrors
        - operational settings and mappings
        - synchronization and advertising audit records
```

Amazon and the supplier remain the source of truth for external data. The local database is authoritative only for operational settings, mappings, notes, and recommendations that do not exist in those systems.

## Safety boundaries

- The application is decision support for replenishment. It does not create purchase orders or FBA shipments.
- Unknown inventory, demand, mappings, and source health are preserved as unknown.
- Amazon and supplier credentials are read only on the server.
- Mirror tables are written through the service-role synchronization path and exposed read-only to authenticated users through row-level security.
- Fake, sandbox, and production modes are visibly distinguished in the application.
- Production advertising writes remain blocked until the API path is verified against Amazon's sandbox.

See [`docs/go-live-readiness.md`](docs/go-live-readiness.md) for the remaining work required before connecting a real seller account.

## Local development

Requirements:

- Node.js 20+
- A Supabase project for authentication and persistence

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Set `AMAZON_USE_FAKE=true` to work without Amazon credentials. The application runs at [http://localhost:3000](http://localhost:3000).

Environment variables are documented in [`.env.example`](.env.example). Keep real credentials in `.env.local` or the deployment provider's secret store.

## Verification

```bash
npm test
npm run lint
npm run build
```

The test suite covers authentication, source mapping, synchronization, inventory semantics, reorder policy, advertising metrics, recommendation rules, and the guarded advertising write path.

## Technology

- Next.js 16 and React 19
- TypeScript
- Supabase Postgres, Auth, and row-level security
- Vitest and ESLint
- Vercel

## Current limitations

- The public deployment uses fake Amazon and supplier data.
- The live API implementations still require sandbox validation.
- Only the US marketplace is currently exercised.
- Product launch and product research modules are not implemented.
