import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import type { AppConfig } from "../../../config/app-config";
import { DrizzleSessionRepository } from "../persistence/drizzle-session.repository";
import { SessionService } from "./session.service";

/**
 * `SessionService`, against the real Postgres this app runs against
 * everywhere else — 1.5.e / F12's own bar: prove the sliding window
 * actually slides and the absolute cap actually caps, against real rows,
 * not read the code and agree it looks right.
 *
 * Every test drives time through the explicit `now: Date` parameter both
 * `issue` and `validateAndTouch` already take, rather than waiting real
 * days — the SAME real F12 numbers (30 days / 90 days / 12h) are used
 * throughout, just with a controlled clock, so what this proves is the
 * actual configured values, not a shortened stand-in for them.
 */

const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!;

const CONFIG = {
  session: {
    consumerIdleTtlMs: 30 * 24 * 60 * 60 * 1000,
    consumerAbsoluteTtlMs: 90 * 24 * 60 * 60 * 1000,
    staffAbsoluteTtlMs: 12 * 60 * 60 * 1000,
  },
} as unknown as AppConfig;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const db = createAppDb(DATABASE_URL);
const sessionRepo = new DrizzleSessionRepository(db);
const sessions = new SessionService(sessionRepo, CONFIG);

function freshUserId(): string {
  return `session-service-test-${randomUUID()}`;
}

describe("the consumer sliding window (F12: 30 days)", () => {
  it("extends on touch: a session touched every 20 days survives well past the 30-day window measured from issuance", async () => {
    const userId = freshUserId();
    const issuedAt = new Date();
    const token = await sessions.issue(userId, issuedAt);

    // First touch at +20 days: comfortably inside the 30-day idle window
    // measured from issuance.
    const firstTouch = await sessions.validateAndTouch(
      token,
      new Date(issuedAt.getTime() + 20 * DAY_MS),
    );
    expect(firstTouch).toMatchObject({ valid: true, userId });

    // Second touch at +45 days from ISSUANCE — 45 > 30, so a check that
    // (wrongly) measured idle from issuance would refuse this. It is only
    // 25 days after the FIRST touch, which is what "sliding" means: the
    // window's origin moves to the last touch, not the original issuance.
    const secondTouch = await sessions.validateAndTouch(
      token,
      new Date(issuedAt.getTime() + 45 * DAY_MS),
    );
    expect(secondTouch).toMatchObject({ valid: true, userId });
  });

  it("refuses a session that really has gone idle: no touch for over 30 days", async () => {
    const userId = freshUserId();
    const issuedAt = new Date();
    const token = await sessions.issue(userId, issuedAt);

    const goneIdle = await sessions.validateAndTouch(
      token,
      new Date(issuedAt.getTime() + 31 * DAY_MS),
    );
    expect(goneIdle).toMatchObject({ valid: false, reason: "idle_timeout" });
  });
});

describe("the consumer absolute ceiling (F12: 90 days)", () => {
  it("refuses even an actively-touched session once 90 days have passed since issuance", async () => {
    const userId = freshUserId();
    const issuedAt = new Date();
    const token = await sessions.issue(userId, issuedAt);

    // Touched every 20 days — always well inside the 30-day idle window,
    // so nothing about idle timeout ever refuses this session.
    for (const days of [20, 40, 60, 80]) {
      const touch = await sessions.validateAndTouch(token, new Date(issuedAt.getTime() + days * DAY_MS));
      expect(touch, `touch at +${String(days)}d should still be valid`).toMatchObject({
        valid: true,
        userId,
      });
    }

    // At +95 days the ABSOLUTE ceiling (90 days from issuance) has passed,
    // even though the last touch above was only 15 days earlier — proving
    // the cap is measured from ISSUANCE, never extended by activity, the
    // one property that distinguishes it from the idle window.
    const pastAbsolute = await sessions.validateAndTouch(
      token,
      new Date(issuedAt.getTime() + 95 * DAY_MS),
    );
    expect(pastAbsolute).toMatchObject({ valid: false, reason: "expired" });
  });
});

describe("a staff session (F12: 12h)", () => {
  it("gets the 12h absolute ceiling, not the consumer's 90 days", async () => {
    const userId = freshUserId();
    const issuedAt = new Date();
    const token = await sessions.issue(userId, issuedAt, "staff");

    // Comfortably valid an hour in.
    const earlyCheck = await sessions.validateAndTouch(
      token,
      new Date(issuedAt.getTime() + 1 * HOUR_MS),
    );
    expect(earlyCheck).toMatchObject({ valid: true, userId });

    // Past 12h: refused, even though a consumer session at the same age
    // would still have roughly 89 days and 12 hours left.
    const pastStaffCeiling = await sessions.validateAndTouch(
      token,
      new Date(issuedAt.getTime() + 13 * HOUR_MS),
    );
    expect(pastStaffCeiling).toMatchObject({ valid: false, reason: "expired" });
  });

  it("a consumer session issued at the same instant is still valid at 13h — proving the two kinds really differ", async () => {
    const userId = freshUserId();
    const issuedAt = new Date();
    const token = await sessions.issue(userId, issuedAt, "consumer");

    const stillValid = await sessions.validateAndTouch(
      token,
      new Date(issuedAt.getTime() + 13 * HOUR_MS),
    );
    expect(stillValid).toMatchObject({ valid: true, userId });
  });
});
