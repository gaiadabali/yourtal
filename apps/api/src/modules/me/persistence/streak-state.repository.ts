import { eq } from "drizzle-orm";
import type { StreakState } from "@yourtal/contracts/me/streak";
import { INITIAL_STREAK_STATE } from "@yourtal/contracts/me/streak";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { streakStates } from "./schema/me-schema";

/** `me.streak_state` (5.5.a) — one row per user, upserted on every sync. */
export interface StreakStateRepository {
  find(userId: string): Promise<StreakState | null>;
  upsert(userId: string, region: string, state: StreakState): Promise<void>;
  /**
   * 5.5.d: runs `fn` with a real Postgres row lock held on this user's
   * `me.streak_state` row for the whole call — created first if it does not
   * exist, so the FIRST sync for a brand-new user is serialised exactly the
   * same as every later one. `fn` returns the state to persist alongside
   * its own result; both are written back before the lock releases.
   */
  runExclusive<T>(
    userId: string,
    region: string,
    fn: (current: StreakState) => Promise<{ next: StreakState; result: T }>,
  ): Promise<T>;
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

  async runExclusive<T>(
    userId: string,
    region: string,
    fn: (current: StreakState) => Promise<{ next: StreakState; result: T }>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      // Ensures the row exists before locking it — `FOR UPDATE` cannot lock
      // a row that is not there yet, and a brand-new user must be
      // serialised against a concurrent sync exactly like an existing one.
      await tx.insert(streakStates).values(defaultRow(userId, region)).onConflictDoNothing({
        target: streakStates.userId,
      });

      const rows = await tx
        .select()
        .from(streakStates)
        .where(eq(streakStates.userId, userId))
        .for("update")
        .limit(1);
      const row = rows[0];
      const current: StreakState =
        row === undefined
          ? INITIAL_STREAK_STATE
          : {
              currentLength: row.currentLength,
              lastCountedDate: row.lastCountedDate,
              day3Granted: row.day3Granted,
              day7Granted: row.day7Granted,
            };

      const { next, result } = await fn(current);

      await tx
        .update(streakStates)
        .set({
          region,
          currentLength: next.currentLength,
          lastCountedDate: next.lastCountedDate,
          day3Granted: next.day3Granted,
          day7Granted: next.day7Granted,
          updatedAt: new Date(),
        })
        .where(eq(streakStates.userId, userId));

      return result;
    });
  }
}

function defaultRow(
  userId: string,
  region: string,
): {
  userId: string;
  region: string;
  currentLength: number;
  lastCountedDate: string | null;
  day3Granted: boolean;
  day7Granted: boolean;
} {
  return {
    userId,
    region,
    currentLength: INITIAL_STREAK_STATE.currentLength,
    lastCountedDate: INITIAL_STREAK_STATE.lastCountedDate,
    day3Granted: INITIAL_STREAK_STATE.day3Granted,
    day7Granted: INITIAL_STREAK_STATE.day7Granted,
  };
}

/** The default state a user with no row yet has. */
export function defaultStreakState(): StreakState {
  return INITIAL_STREAK_STATE;
}
