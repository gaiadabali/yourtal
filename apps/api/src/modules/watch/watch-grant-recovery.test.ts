import type { FastifyRequest } from "fastify";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import type { WatchSession } from "@yourtal/contracts/watch/watch-session";
import type { CampaignRepository } from "../campaign/persistence/campaign.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import type { WatchSessionRepository } from "./persistence/drizzle-watch-session.repository";
import { StubDeliveryCoverageReader } from "./delivery-coverage";
import { NoopWatchCompletionHook } from "./watch-completion-hook";
import { WatchController } from "./watch.controller";

/**
 * 10.7.f: two ways a finished watch could leave no points, both fixed in
 * `WatchController`. Stubbed repositories, so these run without a database.
 */
const userId = "00000000-0000-4000-8000-0000000f0107";
const campaignId = "00000000-0000-4000-8000-0000000c0107";

function session(over: Partial<WatchSession>): WatchSession {
  return {
    id: "00000000-0000-4000-8000-0000000a0107",
    userId,
    campaignId,
    termsVersion: 1,
    state: "active",
    startedAt: "2026-11-27T01:00:00.000Z",
    lastProgressAt: "2026-11-27T01:00:00.000Z",
    completedAt: null,
    nonEarning: false,
    nonEarningReason: null,
    holdId: "hold-1",
    granted: false,
    questionsAsked: 0,
    questionsCorrect: 0,
    timingSuspicious: false,
    ...over,
  };
}

function build(opts: { current: WatchSession; resumed: boolean; holdOk: boolean }) {
  const sessions = {
    startOrResume: vi.fn().mockResolvedValue({ session: opts.current, resumed: opts.resumed }),
    finalizeEarningOutcome: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(opts.current),
    hasBeenGranted: vi.fn().mockResolvedValue(false),
    // With no coverage recorded a first completion is refused, so reaching
    // the grant proves the retry path skipped the coverage judgement.
    coverageFor: vi.fn().mockResolvedValue([]),
    markCompleted: vi.fn().mockResolvedValue(true),
    markGranted: vi.fn().mockResolvedValue(undefined),
    flagDeliveryGap: vi.fn().mockResolvedValue(undefined),
  };
  const campaigns = {
    findVisibleById: vi.fn().mockResolvedValue({ id: campaignId, hlsUrl: "https://x.test/a.m3u8" }),
    isLive: vi.fn().mockResolvedValue(true),
    currentTermsVersion: vi.fn().mockResolvedValue(1),
    termsVersionDetails: vi.fn().mockResolvedValue({
      durationSeconds: 30,
      rewardPoints: 100,
      accuracyBonusPoints: 0,
      scoringRule: "none",
    }),
    rewardConfigFor: vi.fn().mockResolvedValue({
      allocationId: "alloc-1",
      rewardPointsPerCompletion: 100,
      accuracyBonusPoints: 0,
    }),
  } as unknown as CampaignRepository;
  const ledger = {
    hold: vi
      .fn()
      .mockReturnValue(
        opts.holdOk
          ? okAsync({ holdId: "hold-new" })
          : errAsync({ code: "campaign_daily_cap_reached" }),
      ),
    grantReward: vi.fn().mockReturnValue(okAsync({ points: 100, unlockAt: null })),
    release: vi.fn(),
  };
  const profiles = {
    findByUserId: vi.fn().mockResolvedValue({
      userId,
      region: "AU",
      dateOfBirth: "1990-01-01",
      timezone: "Australia/Perth",
      trustTier: 1,
    }),
  } as unknown as UserProfileRepository;
  const controller = new WatchController(
    { resolve: () => ({ id: userId }) } as never,
    sessions as unknown as WatchSessionRepository,
    campaigns,
    ledger as unknown as LedgerInternalClient,
    profiles,
    "test-attestation-secret-not-a-real-one",
    "test-checkpoint-secret-not-a-real-one",
    "test-manifest-signing-secret-not-a-real-one",
    new StubDeliveryCoverageReader(),
    new NoopWatchCompletionHook(),
    { verdictFor: () => Promise.resolve({ mayEarn: true }) },
  );
  return { controller, sessions, ledger };
}

const request = {} as FastifyRequest;

describe("a resumed session stuck on the funding placeholder", () => {
  it("is re-decided instead of staying non-earning", async () => {
    const stuck = session({
      nonEarning: true,
      nonEarningReason: "pending_funding_check",
      holdId: null,
    });
    const { controller, sessions, ledger } = build({ current: stuck, resumed: true, holdOk: true });
    await controller.start(request, { campaignId });
    expect(ledger.hold).toHaveBeenCalledTimes(1);
    expect(sessions.finalizeEarningOutcome).toHaveBeenCalledWith(stuck.id, {
      nonEarning: false,
      nonEarningReason: null,
      holdId: "hold-new",
    });
  });

  it("does not re-decide a resumed session that was finalised", async () => {
    const done = session({ nonEarning: true, nonEarningReason: "This campaign has run out." });
    const { controller, sessions, ledger } = build({ current: done, resumed: true, holdOk: true });
    await controller.start(request, { campaignId });
    expect(ledger.hold).not.toHaveBeenCalled();
    expect(sessions.finalizeEarningOutcome).not.toHaveBeenCalled();
  });
});

describe("completing a session whose grant did not land", () => {
  it("retries the grant for a completed, ungranted, earning session", async () => {
    const completed = session({ state: "completed", completedAt: "2026-11-27T01:05:00.000Z" });
    const { controller, sessions, ledger } = build({
      current: completed,
      resumed: true,
      holdOk: true,
    });
    const result = await controller.complete(request, completed.id);
    expect(sessions.markCompleted).not.toHaveBeenCalled();
    expect(ledger.grantReward).toHaveBeenCalledTimes(1);
    expect(sessions.markGranted).toHaveBeenCalledWith(completed.id);
    expect(result).toMatchObject({ completed: true, granted: true, pendingPoints: 100 });
  });

  it("never grants again for a session that was already granted", async () => {
    const paid = session({ state: "completed", granted: true });
    const { controller, ledger } = build({ current: paid, resumed: true, holdOk: true });
    await expect(controller.complete(request, paid.id)).rejects.toThrow(/cannot be completed/);
    expect(ledger.grantReward).not.toHaveBeenCalled();
  });

  it("does not retry a non-earning completed session", async () => {
    const none = session({
      state: "completed",
      nonEarning: true,
      nonEarningReason: "already_earned",
    });
    const { controller, ledger } = build({ current: none, resumed: true, holdOk: true });
    await expect(controller.complete(request, none.id)).rejects.toThrow(/cannot be completed/);
    expect(ledger.grantReward).not.toHaveBeenCalled();
  });
});
