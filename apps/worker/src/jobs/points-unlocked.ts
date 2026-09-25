import { createHash } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { POINTS_UNLOCKED_QUEUE } from "@yourtal/contracts/ledger-internal/releases";
import type { PointsUnlockedEvent } from "@yourtal/contracts/ledger-internal/releases";
import { defineQueue } from "@yourtal/queue/define-queue";
import { defineJob } from "../job";
import { createWorkerLedgerClient } from "../ledger-client";
import type { WorkerLedgerClient } from "../ledger-client";

/**
 * 4.4.g: announce each held grant the ledger has released as one
 * `ledger.points_unlocked` job, then acknowledge it to the ledger.
 *
 * At-least-once and idempotent: the job id is derived from the grant id, so
 * a re-send after a failed acknowledgement is dropped by pg-boss's primary
 * key, and a consumer can still dedupe on `idempotencyKey`.
 */
const PAGE_SIZE = 100;
/** Bounds one tick; whatever is left goes on the next. */
const MAX_PAGES = 20;

const defined = new WeakSet<PgBoss>();

/** A stable UUID per grant (sha-256, shaped as a version-5 UUID). */
export function unlockJobId(grantId: string): string {
  const hex = createHash("sha256").update(`${POINTS_UNLOCKED_QUEUE}:${grantId}`).digest("hex");
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Returns how many releases this call announced. */
export async function announceUnlockedPoints(
  boss: PgBoss,
  ledger: WorkerLedgerClient,
  pageSize = PAGE_SIZE,
): Promise<number> {
  if (!defined.has(boss)) {
    await defineQueue(boss, POINTS_UNLOCKED_QUEUE);
    defined.add(boss);
  }
  let announced = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { releases } = await ledger.unnotifiedReleases(pageSize);
    if (releases.length === 0) break;
    for (const release of releases) {
      const event: PointsUnlockedEvent = {
        ...release,
        idempotencyKey: `points_unlocked_${release.grantId}`,
      };
      await boss.send(POINTS_UNLOCKED_QUEUE, event, { id: unlockJobId(release.grantId) });
    }
    // Only after every send: a crash in between re-sends, never skips.
    await ledger.releasesNotified(releases.map((release) => release.grantId));
    announced += releases.length;
    if (releases.length < pageSize) break;
  }
  return announced;
}

export const job = defineJob({
  queue: "ledger.release_notices",
  schedule: "* * * * *",
  async handle(_job, { boss, config }) {
    await announceUnlockedPoints(boss, createWorkerLedgerClient(config.ledger));
  },
});
