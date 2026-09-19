/**
 * Refusing to process the same webhook twice. YT-0537.
 *
 * ## Why this is a separate concern from the signature
 *
 * They defend against different things and neither covers the other. A
 * signature proves a callback **came from the provider**; it says nothing
 * about whether we have already acted on it. A duplicate delivery carries a
 * *perfectly valid* signature, because the provider really did send it —
 * twice, on purpose.
 *
 * At-least-once is the normal guarantee from every real payment provider, so
 * a duplicate `settled` callback is ordinary traffic and not an attack. A
 * handler that credits points on each arrival is not being exploited; it is
 * simply wrong, and it will be wrong on an ordinary Tuesday rather than
 * under adversarial conditions.
 *
 * ## Claim before processing, not after
 *
 * `admit` records the event id **before** the caller does any work, and the
 * check-and-record is one operation. Recording afterwards leaves a window in
 * which two concurrent deliveries both see "not processed" and both proceed
 * — and a payment provider retrying an unacknowledged callback is precisely
 * the situation that produces concurrent deliveries.
 *
 * This is the same shape as `packages/idempotency`'s `putIfAbsent`, which
 * deliberately offers no `get`: a store that lets you look first and write
 * later is a store that invites the race. The production implementation
 * should be that store rather than this map — a per-process inbox is not an
 * inbox once there are two processes, the same mistake YT-0540 records for
 * throttling counters.
 */

export type Admission = "process" | "already_processed";

export interface WebhookInbox {
  /**
   * Claims an event id. `"process"` exactly once per id, ever.
   *
   * Returns rather than throwing: a duplicate is expected traffic, and an
   * exception would push a handler toward a catch block that swallows
   * genuine errors alongside it.
   */
  admit(eventId: string): Admission;
  /** How many distinct events have been admitted. For assertions. */
  readonly admittedCount: number;
}

export function createInMemoryWebhookInbox(): WebhookInbox {
  const seen = new Set<string>();

  return {
    admit(eventId: string): Admission {
      if (seen.has(eventId)) return "already_processed";
      seen.add(eventId);
      return "process";
    },
    get admittedCount(): number {
      return seen.size;
    },
  };
}
