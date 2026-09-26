import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Region } from "@yourtal/contracts/region";
import { advanceStreak, INITIAL_STREAK_STATE } from "@yourtal/contracts/me/streak";
import type { StreakState } from "@yourtal/contracts/me/streak";
import type { Grant } from "@yourtal/contracts/ledger-internal/rewards";
import { toPoints } from "@yourtal/contracts/money";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import {
  LEDGER_INTERNAL_CLIENT,
  type LedgerInternalClient,
} from "../../shared/ledger-client/ledger-internal-client";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { STREAK_STATE_REPOSITORY } from "./persistence/streak-state.repository";
import type { StreakStateRepository } from "./persistence/streak-state.repository";
import { COMPLETED_WATCH_DAYS_READER } from "./persistence/completed-watch-days.reader";
import type { CompletedWatchDaysReader } from "./persistence/completed-watch-days.reader";

export interface StreakSyncResult {
  readonly state: StreakState;
  readonly grantsIssued: readonly Grant[];
}

/**
 * 5.5.a — folds newly-completed reward-session days into the caller's
 * streak, on read (`GET /api/me/streak`, and anywhere else that wants the
 * caller's current streak). There is no watch-completion hook to trigger
 * this from: `apps/api/src/modules/watch/watch.controller.ts` is A's file
 * this phase (5.1-5.3, still wiring the question bank that gates
 * completion), and this reads its OUTPUT (`watch.session.state =
 * 'completed'`) through `CompletedWatchDaysReader` rather than depending on
 * a hook into it. Computing on read means a user who never opens the app
 * again never sees their bonus paid — a periodic backstop job is a
 * reasonable follow-up, noted rather than built here (effort budget; see
 * this session's final report).
 *
 * Takes a bare `userId`, not a `Principal`: `PrincipalService.resolve()` —
 * the synchronous resolver every controller in this module injects — no
 * longer decides `jurisdiction` or `ageBand` at all (`DEFAULT_JURISDICTION`
 * is a fixed placeholder; `ageBand` is simply absent from what it returns).
 * The real values live in `identity.user_profile`, read here once via
 * `UserProfileRepository` — the same "read the profile, not the principal"
 * rule `WalletController.summary` already follows and `require-region.ts`
 * explains for the rest of this module's controllers.
 */
@Injectable()
export class StreakService {
  private readonly logger = new Logger(StreakService.name);

  constructor(
    @Inject(STREAK_STATE_REPOSITORY) private readonly states: StreakStateRepository,
    @Inject(COMPLETED_WATCH_DAYS_READER) private readonly completedDays: CompletedWatchDaysReader,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
  ) {}

  async sync(userId: string): Promise<StreakSyncResult> {
    const profile = await this.profiles.findByUserId(userId);
    if (profile === null) throw new NotFoundException("No such profile.");
    const region: Region = profile.region;
    const isTeen = ageBandFrom(ageYearsFrom(profile.dateOfBirth, new Date())) === "teen";

    const stored = await this.states.find(userId);
    const before = stored ?? INITIAL_STREAK_STATE;

    const days = await this.completedDays.distinctDaysSince(userId, region, before.lastCountedDate);
    if (days.length === 0) return { state: before, grantsIssued: [] };

    const { state: advanced, bonuses } = advanceStreak(before, days);
    if (bonuses.length === 0) {
      await this.states.upsert(userId, region, advanced);
      return { state: advanced, grantsIssued: [] };
    }

    // Teens get none (F12) — permanently: `advanceStreak` already marked
    // each bonus granted, so it is never retried for this account.
    if (isTeen) {
      await this.states.upsert(userId, region, advanced);
      return { state: advanced, grantsIssued: [] };
    }

    const bonusPoints = await this.bonusPointsFor(region);
    const pauseThreshold = await this.coveragePauseThresholdFor(region);
    const trustTier = profile.trustTier;

    let finalState = advanced;
    const grantsIssued: Grant[] = [];
    for (const bonus of bonuses) {
      const coverage = await this.ledger.coverage(region);
      const ratio = coverage.isOk() ? coverage.value.ratio : 0;
      if (coverage.isErr() || ratio < pauseThreshold) {
        // Paused (F12): revert THIS bonus's granted flag so a later sync,
        // once coverage recovers, pays it — the day count itself stands.
        finalState =
          bonus.day === 3
            ? { ...finalState, day3Granted: false }
            : { ...finalState, day7Granted: false };
        this.logger.log(
          `streak bonus paused: region=${region} ratio=${String(ratio)} < ${String(pauseThreshold)}`,
        );
        continue;
      }

      const points = bonus.day === 3 ? bonusPoints.day3 : bonusPoints.day7;
      const granted = await this.ledger.grantAction({
        kind: "streak",
        userId,
        region,
        points: toPoints(points),
        trustTier: trustTier as 0 | 1 | 2 | 3,
        idempotencyKey: `streak:${userId}:day${String(bonus.day)}:${bonus.forDate}`,
      });
      if (granted.isOk()) {
        grantsIssued.push(granted.value);
      } else {
        this.logger.warn(`streak grantAction failed: ${granted.error.code}`);
        finalState =
          bonus.day === 3
            ? { ...finalState, day3Granted: false }
            : { ...finalState, day7Granted: false };
      }
    }

    await this.states.upsert(userId, region, finalState);
    return { state: finalState, grantsIssued };
  }

  private async bonusPointsFor(region: Region): Promise<{ day3: number; day7: number }> {
    const value = await this.settingValue(region, "streak_bonus_points");
    const parsed = value as { day3?: unknown; day7?: unknown } | undefined;
    if (typeof parsed?.day3 === "number" && typeof parsed.day7 === "number") {
      return { day3: parsed.day3, day7: parsed.day7 };
    }
    throw new Error(`streak_bonus_points setting missing or malformed for region ${region}`);
  }

  private async coveragePauseThresholdFor(region: Region): Promise<number> {
    const value = await this.settingValue(region, "streak_coverage_pause_threshold");
    if (typeof value === "number") return value;
    throw new Error(`streak_coverage_pause_threshold setting missing for region ${region}`);
  }

  private async settingValue(region: Region, key: string): Promise<unknown> {
    const settings = await this.ledger.getSettings(region);
    return settings.find((setting) => setting.key === key)?.value;
  }
}
