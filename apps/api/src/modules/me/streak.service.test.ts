import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { Coverage } from "@yourtal/contracts/ledger-internal/economy";
import type { Grant, GrantActionRequest } from "@yourtal/contracts/ledger-internal/rewards";
import type { RegionSetting } from "@yourtal/contracts/ledger-internal/settings";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { DrizzleCampaignRepository } from "../campaign/persistence/drizzle-campaign.repository";
import { StreakService } from "./streak.service";
import { DrizzleStreakStateRepository } from "./persistence/streak-state.repository";
import { DrizzleCompletedWatchDaysReader } from "./persistence/completed-watch-days.reader";

/**
 * Exercises the real streak arithmetic (`@yourtal/contracts/me/streak`) and
 * real Postgres persistence (`me.streak_state`) against `watch.session`
 * rows seeded directly by SQL — the watch module's own completion path is
 * still refused today (5.1-5.3, agent A, not merged: `watch.controller.ts`
 * hard-codes `questionsAnswered: false`), so there is no way to reach
 * `state = 'completed'` through the real HTTP flow yet. Seeding the exact
 * row shape `DrizzleWatchSessionRepository.markCompleted` itself writes is
 * the same "trigger from the interface as it exists" approach
 * `completed-watch-days.reader.ts`'s own doc comment describes, applied to
 * a test fixture instead of a caller.
 *
 * The ledger is a small hand-written stub, not `FakeLedgerClient` — that
 * fake's `coverage()` derives its ratio from whatever OTHER tests have
 * already purchased/granted in this shared database, which would make a
 * pass/fail here depend on suite ordering. This module owns none of the
 * ledger's economics, so a deterministic stub of the three methods
 * `StreakService` actually calls is the correct isolation, not a workaround.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const db: AppDb = createAppDb(DATABASE_URL);
const streakStates = new DrizzleStreakStateRepository(db);
const completedDays = new DrizzleCompletedWatchDaysReader(db);
const campaigns = new DrizzleCampaignRepository(db);

/** A real, seeded campaign id + its published terms version — `src/seed.ts` guarantees at least one. */
async function seededCampaign(): Promise<{ campaignId: string; termsVersion: number }> {
  const visible = await campaigns.listVisible(50);
  const campaignId = visible[0]?.id;
  if (campaignId === undefined) throw new Error("expected at least one seeded campaign");
  const termsVersion = await campaigns.currentTermsVersion(campaignId);
  if (termsVersion === null)
    throw new Error("expected the seeded campaign to carry published terms");
  return { campaignId, termsVersion };
}

class StubLedger implements Pick<LedgerInternalClient, "coverage" | "grantAction" | "getSettings"> {
  ratio = 5; // comfortably above the 1.1 pause threshold, unless overridden
  readonly granted: GrantActionRequest[] = [];

  coverage(region: string): ResultAsync<Coverage, LedgerError> {
    return okAsync({
      region: region as Coverage["region"],
      ratio: this.ratio,
      reserveMinor: toMinorUnits(0),
      pointsOutstanding: toPoints(0),
      asOf: new Date().toISOString(),
      nothingOwed: false,
    });
  }

  grantAction(request: GrantActionRequest): ResultAsync<Grant, LedgerError> {
    this.granted.push(request);
    return okAsync({
      grantId: randomUUID(),
      kind: request.kind,
      userId: request.userId,
      region: request.region,
      points: request.points,
      unlockAt: new Date().toISOString(),
      grantedAt: new Date().toISOString(),
    });
  }

  getSettings(): Promise<readonly RegionSetting[]> {
    return Promise.resolve([
      {
        id: "s1",
        region: "AU",
        key: "streak_bonus_points",
        value: { day3: 5, day7: 10 },
        setBy: "founder",
        approvedBy: "founder2",
        effectiveFrom: new Date().toISOString(),
      },
      {
        id: "s2",
        region: "AU",
        key: "streak_coverage_pause_threshold",
        value: 1.1,
        setBy: "founder",
        approvedBy: "founder2",
        effectiveFrom: new Date().toISOString(),
      },
    ]);
  }
}

/**
 * `PrincipalService.resolve()` no longer decides region/ageBand (see
 * `require-region.ts`), so `StreakService` reads them from the profile
 * repository directly — this test provides that repository as a stub
 * rather than a real registered account, matching `seedCompletedSession`'s
 * own "trigger from the interface as it exists" approach.
 */
function fakeProfiles(dateOfBirth: string, trustTier = 0) {
  return {
    findByUserId: () =>
      Promise.resolve({
        userId: "unused",
        region: "AU" as const,
        displayLocale: "en-AU" as const,
        displayName: "Streak Test",
        dateOfBirth,
        timezone: "Australia/Sydney",
        guardianEmail: null,
        parentConsentStatus: "not_required" as const,
        trustTier,
        suspendedAt: null,
      }),
  };
}

const ADULT_PROFILES = fakeProfiles("1990-01-01");
const TEEN_PROFILES = fakeProfiles("2012-01-01");

/** Inserts a completed `watch.session` row directly — see the suite's own header. */
async function seedCompletedSession(
  userId: string,
  completedAt: Date,
  campaign: { campaignId: string; termsVersion: number },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state, started_at, last_progress_at, completed_at)
    VALUES (${randomUUID()}, ${userId}, ${campaign.campaignId}, ${campaign.termsVersion}, 'completed', ${completedAt}, ${completedAt}, ${completedAt})
  `);
}

describe("StreakService.sync", () => {
  it("pays the day-3 bonus once coverage is healthy, and never twice", async () => {
    const campaign = await seededCampaign();
    const userId = randomUUID();
    const ledger = new StubLedger();
    const service = new StreakService(
      streakStates,
      completedDays,
      ledger as unknown as LedgerInternalClient,
      ADULT_PROFILES as never,
    );

    // Three consecutive UTC days at midday — safely inside one AU calendar
    // day each, regardless of the exact AEST/AEDT offset on the seed date.
    await seedCompletedSession(userId, new Date("2026-02-01T04:00:00Z"), campaign);
    await seedCompletedSession(userId, new Date("2026-02-02T04:00:00Z"), campaign);
    await seedCompletedSession(userId, new Date("2026-02-03T04:00:00Z"), campaign);

    const first = await service.sync(userId);
    expect(first.state.currentLength).toBe(3);
    expect(first.grantsIssued).toHaveLength(1);
    expect(first.grantsIssued[0]?.points).toBe(5);
    expect(ledger.granted).toHaveLength(1);
    expect(ledger.granted[0]?.idempotencyKey).toBe(`streak:${userId}:day3:2026-02-03`);

    // Re-syncing with no new completed day must not pay it again.
    const second = await service.sync(userId);
    expect(second.grantsIssued).toHaveLength(0);
    expect(ledger.granted).toHaveLength(1);

    const stored = await streakStates.find(userId);
    expect(stored?.currentLength).toBe(3);
    expect(stored?.day3Granted).toBe(true);
  });

  it("pauses the bonus while coverage is below 1.1, and retries once it recovers", async () => {
    const campaign = await seededCampaign();
    const userId = randomUUID();
    const ledger = new StubLedger();
    ledger.ratio = 0.5;
    const service = new StreakService(
      streakStates,
      completedDays,
      ledger as unknown as LedgerInternalClient,
      ADULT_PROFILES as never,
    );

    await seedCompletedSession(userId, new Date("2026-03-01T04:00:00Z"), campaign);
    await seedCompletedSession(userId, new Date("2026-03-02T04:00:00Z"), campaign);
    await seedCompletedSession(userId, new Date("2026-03-03T04:00:00Z"), campaign);

    const paused = await service.sync(userId);
    expect(paused.state.currentLength).toBe(3);
    expect(paused.grantsIssued).toHaveLength(0);
    expect(ledger.granted).toHaveLength(0);
    // Not marked granted — a later sync, once coverage recovers, still pays it.
    expect((await streakStates.find(userId))?.day3Granted).toBe(false);

    ledger.ratio = 5;
    await seedCompletedSession(userId, new Date("2026-03-04T04:00:00Z"), campaign);
    const recovered = await service.sync(userId);
    expect(recovered.grantsIssued).toHaveLength(1);
    expect(ledger.granted).toHaveLength(1);
  });

  it("teens never receive the bonus, permanently", async () => {
    const campaign = await seededCampaign();
    const userId = randomUUID();
    const ledger = new StubLedger();
    const service = new StreakService(
      streakStates,
      completedDays,
      ledger as unknown as LedgerInternalClient,
      TEEN_PROFILES as never,
    );

    await seedCompletedSession(userId, new Date("2026-04-01T04:00:00Z"), campaign);
    await seedCompletedSession(userId, new Date("2026-04-02T04:00:00Z"), campaign);
    await seedCompletedSession(userId, new Date("2026-04-03T04:00:00Z"), campaign);

    const result = await service.sync(userId);
    expect(result.state.currentLength).toBe(3);
    expect(result.grantsIssued).toHaveLength(0);
    expect(ledger.granted).toHaveLength(0);
    // Marked granted regardless — a teen account never retries this bonus.
    expect((await streakStates.find(userId))?.day3Granted).toBe(true);
  });
});
