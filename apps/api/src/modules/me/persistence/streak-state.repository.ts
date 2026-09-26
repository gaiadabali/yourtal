import { eq } from "drizzle-orm";
import type { StreakState } from "@yourtal/contracts/me/streak";
import { INITIAL_STREAK_STATE } from "@yourtal/contracts/me/streak";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { streakStates } from "./schema/me-schema";

/** `me.streak_state` (5.5.a) — one row per user, upserted on every sync. */
export interface StreakStateRepository {
  find(userId: string): Promise<StreakState | null>;
  upsert(userId: string, region: string, state: StreakState): Promise<void>;
}

export const STREAK_STATE_REPOSITORY = Symbol("STREAK_STATE_REPOSITORY");

export class DrizzleStreakStateRepository implements StreakStateRepository {
  constructor(private readonly db: AppDb) {}

  async find(userId: string): Promise<StreakState | null> {
    const rows = await this.db
      .select()
      .from(streakStates)
      .where(eq(streakStates.userId, userId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      currentLength: row.currentLength,
      lastCountedDate: row.lastCountedDate,
      day3Granted: row.day3Granted,
      day7Granted: row.day7Granted,
    };
  }

  async upsert(userId: string, region: string, state: StreakState): Promise<void> {
    await this.db
      .insert(streakStates)
      .values({
        userId,
        region,
        currentLength: state.currentLength,
        lastCountedDate: state.lastCountedDate,
        day3Granted: state.day3Granted,
        day7Granted: state.day7Granted,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: streakStates.userId,
        set: {
          currentLength: state.currentLength,
          lastCountedDate: state.lastCountedDate,
          day3Granted: state.day3Granted,
          day7Granted: state.day7Granted,
          updatedAt: new Date(),
        },
      });
  }
}

/** The default state a user with no row yet has. */
export function defaultStreakState(): StreakState {
  return INITIAL_STREAK_STATE;
}
