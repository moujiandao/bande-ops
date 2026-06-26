# CLAUDE.md — bande-ops

> Status: pre-scaffold. This describes the **planned** architecture (see issues #1, #2 and
> the design plan). Update as code lands.

## What This Is

A single, clean web app for running Amazon Seller Central operations for a US store —
catalog & inventory, then ads, then product launch and research. Built one **Module** at a
time on the official Amazon APIs (SP-API + Advertising API), explicitly replacing a
scattering of one-off legacy tools (`listing-editor`, `supplier-reorder`).

## Architecture

- **Stack:** Next.js 16 (App Router) + TypeScript + Supabase (Postgres + Auth) + Tailwind v4, on Vercel.
- **Spine:** shared foundation every Module reuses — auth (2 users, `role` column, RLS), DB migrations, a server-side Amazon API client (`lib/amazon`), and a UI shell.
- **Modules:** one route segment each (`app/(modules)/<name>/…`), per-module service files. Modules interact via the DB and the shared client, never each other's internals.
- **Auth & routing:** protected app routes live in the `app/(app)/` group, whose layout gates on `getUser()` (via `lib/auth/session.ts`) and redirects to the public `/login` (`app/login/`) when unauthenticated, then renders `AppShell` with the user's email + role. Auth logic is spine: `lib/auth/` (`session.ts`, `actions.ts` sign-in/out, `types.ts`). Root `app/layout.tsx` is only the html/body shell.
- **Source-of-truth boundary:** Amazon is source of truth for catalog/inventory/ads → local Postgres holds a **synced mirror** (re-fetchable, `synced_at`). Local DB is authoritative only for the **operational layer** Amazon doesn't store (replenishment settings, reorder recs, notes). See ADR-0001.

## Key Conventions

- All Amazon API access goes through `lib/amazon` (server-side only). Credentials live in env, never reach the browser.
- Every persisted row is either a "synced mirror" (rebuildable from Amazon) or "ours" (authoritative) — never both.
- Schema carries `marketplace_id` from day one (default US), even though only US is exercised now.
- Use the glossary in `CONTEXT.md`; don't drift to avoided synonyms.

## Non-Obvious Decisions

- Build on official SP-API, do **not** port the Playwright `listing-editor`. See ADR-0002.
- Replenishment is **decision-support only** (recommend + reasoning; no auto-PO/FBA writes).
- Unknown/unavailable stock parses to UNKNOWN and is flagged for review — never folded in as 0 (carried from `supplier-reorder`).
- Sandbox-first for SP-API, then flip to production.

## Common Tasks

- **Build the next module:** read its issue, build a vertical slice into the spine, TDD against the `AmazonClient` seam.
- **Add a synced entity:** create a mirror table with `synced_at` + `marketplace_id`; wire a sync path through `lib/amazon`; never treat the local copy as authoritative.
- **Add an Amazon call:** extend `lib/amazon`, not the calling module.
- **File / pick up work:** GitHub Issues (see `docs/agents/issue-tracker.md`).

## Do Not

- Do not call SP-API outside `lib/amazon`.
- Do not write back to Amazon in Module 1 (read + recommend only).
- Do not touch Orders/PII data (no Restricted Data Tokens in scope).
- Do not fold UNKNOWN stock into reorder math as zero.
- Do not bypass pre-commit hooks (`--no-verify`).

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI (repo `moujiandao/bande-ops`); external PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
