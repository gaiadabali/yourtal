/**
 * Where a simulated `email`, `push` or `webhook` boundary's message actually
 * goes. 1.6.a/1.6.c (TASKS.md).
 *
 * ## Why this is not just another in-memory `Map`, unlike every other boundary
 *
 * `messaging.ts` and every existing simulator here hold their state in a
 * private `Map`, which is fine for a boundary nothing outside the process
 * needs to see. These three are different: the whole point of "everything
 * external is a simulated driver" (red line 11) is that a REVIEWER can read
 * what would have been sent — `/api/dev/inbox` (1.6.b) reads this table, not
 * this process's memory — and a review session and the process that sent the
 * verification email are not the same process. A `Map` would make the
 * message vanish the moment the request that created it finished.
 *
 * ## Why the interface, not just a Postgres implementation
 *
 * `packages/drivers` has no Postgres dependency anywhere else in it
 * (`webhook-inbox.ts`'s own header says the same thing about its map: "the
 * production implementation should be that store rather than this map").
 * Keeping the boundary interfaces in terms of `SimOutboxStore` — with an
 * in-memory default here — means every existing pure-unit test convention in
 * this package (`otp.test.ts`, `messaging.test.ts`, `registry.test.ts`'s
 * `createDrivers({})`) keeps working with zero Postgres involved, and the
 * REAL store (`apps/api/src/shared/drivers/postgres-sim-outbox-store.ts`,
 * backed by the `platform.sim_outbox` migration) is a separate, swappable
 * implementation of the same three methods.
 */

export type SimOutboxBoundary = "email" | "push" | "webhook";

export interface SimOutboxEntry {
  readonly boundary: SimOutboxBoundary;
  /** F2's hard wall — every simulated message belongs to exactly one region. */
  readonly region: "AU" | "ID";
  /** An email address, a push device token, or a webhook URL. */
  readonly recipient: string;
  /** The boundary's own vocabulary (e.g. "email_verification", "voucher_issued"). */
  readonly category: string;
  readonly subject?: string;
  readonly body: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

export interface SimOutboxRecord extends SimOutboxEntry {
  readonly id: string;
  readonly createdAt: Date;
}

export interface SimOutboxStore {
  /**
   * Records a message. Idempotent per `(boundary, idempotencyKey)`: a
   * replay returns the ORIGINAL record rather than creating a second row —
   * the same guarantee `@yourtal/idempotency` gives the request path, so a
   * retried send never shows a reviewer two messages for one event.
   */
  record(entry: SimOutboxEntry): Promise<SimOutboxRecord>;
}

export function createInMemorySimOutboxStore(): SimOutboxStore {
  const byKey = new Map<string, SimOutboxRecord>();
  let sequence = 0;

  return {
    record(entry: SimOutboxEntry): Promise<SimOutboxRecord> {
      const key = `${entry.boundary}:${entry.idempotencyKey}`;
      const existing = byKey.get(key);
      if (existing !== undefined) return Promise.resolve(existing);

      sequence += 1;
      const record: SimOutboxRecord = {
        ...entry,
        id: `sim_${String(sequence)}`,
        createdAt: new Date(),
      };
      byKey.set(key, record);
      return Promise.resolve(record);
    },
  };
}
