import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionUser } from '@/lib/auth/types';
import type { UpdateCampaignInput } from './client';
import { DEFAULT_MARKETPLACE, type CampaignState } from './types';

/**
 * Orchestrates ONE owner-initiated write-back to a Sponsored Products campaign —
 * the highest-risk path in the app (it can pause/enable a campaign and change
 * its daily budget: stop ads / change spend).
 *
 * The ordering here is the safety contract and is what the unit test pins:
 *   1. AUTHORIZE FIRST   — requireOwner() before anything else. A non-owner (or
 *      unauthenticated) caller is rejected and NOTHING is read, logged, or
 *      written.
 *   2. VALIDATE          — reject an empty/invalid change before touching state.
 *   3. READ BEFORE       — snapshot the current mirror row for the audit.
 *   4. LOG BEFORE WRITE  — append the audit row (who/what/before->after) BEFORE
 *      the Amazon write, so an attempt is always recorded even if the write then
 *      fails.
 *   5. WRITE             — call the AdsClient seam (Fake mutates; real is gated).
 *   6. RE-SYNC           — refresh the mirror so it reflects reality post-write.
 *
 * Dependencies are injected (auth gate, a Supabase `from`-haver, the AdsClient
 * write, and a resync thunk) so this stays unit-testable with no network/DB and
 * no 'server-only' import — the real wiring lives in
 * `app/(app)/ads/write-actions.ts`. The `AdsClient`/`SupabaseClient` imports are
 * type-only (erased at compile), so no server-only code is pulled in.
 */

/** The kind of change requested (mirrors recommend.ts RecommendationKind). */
export type CampaignChangeKind = 'pause' | 'lower-budget' | 'raise-budget';

/** A single owner-initiated campaign write request from the UI. */
export interface ApplyCampaignChangeInput {
  campaignId: string;
  /** Defaults to US when omitted. */
  marketplaceId?: string;
  kind: CampaignChangeKind;
  /** New daily budget — required for 'lower-budget' / 'raise-budget'. */
  dailyBudget?: number;
}

/** Campaign state captured for the audit's before/after. */
interface CampaignSnapshot {
  state: CampaignState | null;
  dailyBudget: number | null;
}

/** The slice of the Supabase client this orchestration uses. */
type AdsWriteDb = Pick<SupabaseClient, 'from'>;

export interface ApplyCampaignChangeDeps {
  /** Authorization gate. MUST reject non-owners (and unauthenticated callers). */
  requireOwner: () => Promise<SessionUser>;
  /** Authenticated Supabase client (RLS) for the before-read + audit insert. */
  db: AdsWriteDb;
  /** The AdsClient write seam (FakeAdsClient mutates; AdsApiClient is gated). */
  updateCampaign: (input: UpdateCampaignInput) => Promise<void>;
  /** Re-sync the mirror after the write so it reflects reality. */
  resync: () => Promise<void>;
}

/** A finite-number guard: rejects null, NaN, and ±Infinity. */
function isFiniteNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

/**
 * Translate a requested change into the AdsClient write payload, throwing on an
 * invalid request (fail loud — never write a malformed/empty change).
 */
function buildUpdate(input: ApplyCampaignChangeInput): UpdateCampaignInput {
  if (!input.campaignId || typeof input.campaignId !== 'string') {
    throw new Error('applyCampaignChange: campaignId is required.');
  }
  if (input.kind === 'pause') {
    return { campaignId: input.campaignId, state: 'paused' };
  }
  if (input.kind === 'lower-budget' || input.kind === 'raise-budget') {
    if (!isFiniteNumber(input.dailyBudget) || input.dailyBudget <= 0) {
      throw new Error(
        `applyCampaignChange: a positive dailyBudget is required for "${input.kind}".`,
      );
    }
    return { campaignId: input.campaignId, dailyBudget: input.dailyBudget };
  }
  throw new Error(`applyCampaignChange: unknown change kind "${input.kind}".`);
}

/** Compute the after-snapshot the audit should record for this change. */
function afterSnapshot(
  before: CampaignSnapshot,
  input: ApplyCampaignChangeInput,
  update: UpdateCampaignInput,
): CampaignSnapshot {
  return {
    state: update.state ?? before.state,
    dailyBudget:
      update.dailyBudget !== undefined ? update.dailyBudget : before.dailyBudget,
  };
}

export async function applyCampaignChange(
  deps: ApplyCampaignChangeDeps,
  input: ApplyCampaignChangeInput,
): Promise<void> {
  // 1. AUTHORIZE FIRST. Throws for a non-owner / unauthenticated caller — before
  //    any read, log, or write happens.
  const actor = await deps.requireOwner();

  // 2. VALIDATE (also derives the concrete write payload).
  const update = buildUpdate(input);
  const marketplaceId = input.marketplaceId ?? DEFAULT_MARKETPLACE.id;

  // 3. READ BEFORE — snapshot the current mirror row for the audit.
  const { data: beforeRow, error: beforeError } = await deps.db
    .from('ads_campaigns')
    .select('state, daily_budget')
    .eq('marketplace_id', marketplaceId)
    .eq('campaign_id', input.campaignId)
    .maybeSingle();
  if (beforeError) {
    throw new Error(
      `applyCampaignChange: failed to read campaign before-state: ${beforeError.message}`,
    );
  }
  const before: CampaignSnapshot = {
    state: (beforeRow?.state as CampaignState | undefined) ?? null,
    dailyBudget: (beforeRow?.daily_budget as number | null | undefined) ?? null,
  };
  const after = afterSnapshot(before, input, update);

  // 4. LOG BEFORE WRITE — append the audit row first, so the attempt is always
  //    recorded even if the Amazon write then fails.
  const { error: logError } = await deps.db.from('ads_write_log').insert({
    marketplace_id: marketplaceId,
    campaign_id: input.campaignId,
    actor_email: actor.email,
    change: { kind: input.kind, before, after },
  });
  if (logError) {
    throw new Error(
      `applyCampaignChange: failed to write audit log (write aborted): ${logError.message}`,
    );
  }

  // 5. WRITE to Amazon via the seam.
  await deps.updateCampaign(update);

  // 6. RE-SYNC the mirror so it reflects reality post-write.
  await deps.resync();
}
