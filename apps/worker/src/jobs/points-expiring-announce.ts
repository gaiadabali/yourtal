import { createHash } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { POINTS_EXPIRING_QUEUE } from "@yourtal/contracts/ledger-internal/expiry";
import type { PointsExpiringEvent } from "@yourtal/contracts/ledger-internal/expiry";
import { defineQueue } from "@yourtal/queue/define-queue";
import { defineJob } from "../job";
import { createWorkerLedgerClient } from "../ledger-client";
import type { WorkerLedgerClient } from "../ledger-client";

/**
 * TASKS.md 10.2.d: announce each 30/7-day points-expiring warning the
 * ledger's own expiry sweep (10.2.a) has written but nobody has told a
 * viewer about yet, as one `ledger.points_expiring` job — same
 * list-send-acknowledge shape `points-unlocked.ts` uses for holdback
 * releases. Only ever produces anything while points_expiry is ON for a
 * region (10.2.a's own sweep does not write notices while it is off).
 */
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

const defined = new WeakSet<PgBoss>();

/** A stable UUID per (account, milestone, expiringAt) — the same triple that is this notice's own identity. */
export function expiringJobId(
  accountId: string,
  milestoneDays: number,
  expiringAt: string,
): string {
  const hex = createHash("sha256")
    .update(`${POINTS_EXPIRING_QUEUE}:${accountId}:${String(milestoneDays)}:${expiringAt}`)
    .digest("hex");
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Returns how many notices this call announced. */
export async function announceExpiringPoints(
  boss: PgBoss,
  ledger: WorkerLedgerClient,
  pageSize = PAGE_SIZE,
): Promise<number> {
  if (!defined.has(boss)) {
    await defineQueue(boss, POINTS_EXPIRING_QUEUE);
    defined.add(boss);
  }
  let announced = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { notices } = await ledger.unnotifiedPointsExpiry(pageSize);
    if (notices.length === 0) break;
    for (const notice of notices) {
      const event: PointsExpiringEvent = {
        ...notice,
        idempotencyKey: `points_expiring_${notice.accountId}_${String(notice.milestoneDays)}_${notice.expiringAt}`,
      };
      await boss.send(POINTS_EXPIRING_QUEUE, event, {
        id: expiringJobId(notice.accountId, notice.milestoneDays, notice.expiringAt),
      });
    }
    // Only after every send: a crash in between re-sends, never skips.
    await ledger.pointsExpiryNotified(
      notices.map((notice) => ({
        accountId: notice.accountId,
        milestoneDays: notice.milestoneDays,
        expiringAt: notice.expiringAt,
      })),
    );
    announced += notices.length;
    if (notices.length < pageSize) break;
  }
  return announced;
}

export const job = defineJob({
  queue: "ledger.expiry_notices",
  schedule: "* * * * *",
  async handle(_job, { boss, config }) {
    await announceExpiringPoints(boss, createWorkerLedgerClient(config.ledger));
  },
});
