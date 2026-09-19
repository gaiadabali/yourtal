import type pg from "pg";
import type { DomainHandler, HandlerRegistry } from "@yourtal/consent/dsar-orchestrator";

/**
 * The deletion handlers for domains this database actually holds. YT-0036.
 *
 * `@yourtal/consent` owns the map of what must happen to each domain and
 * refuses to report a request complete while any is unhandled. This supplies
 * the handlers for the two domains whose data lives in Postgres today, so
 * that refusal shrinks by two rather than staying a permanent abstraction.
 *
 * ## Anonymise, not erase — and the reason is the merchant, not the schema
 *
 * `voucher.vouchers` is `anonymise` in the domain map because **a merchant
 * is owed settlement for a redemption that actually happened.** Deleting the
 * row would delete the evidence of a debt the platform still owes someone
 * who is not the subject. The event has to survive; the person attached to
 * it does not.
 *
 * So the subject is severed from the row — `owner_id` becomes a tombstone —
 * and everything the voucher needs to remain honourable and settleable is
 * left exactly as it was. A test asserts that face value, merchant and code
 * are untouched, because an "anonymisation" that quietly damaged the
 * instrument would be a deletion wearing a different name.
 */

/**
 * The value written over a subject's identifier.
 *
 * The NIL UUID, because `owner_id` is a uuid column — a readable string like
 * "erased_subject" does not fit, and discovering that at runtime is how a
 * deletion handler fails halfway through a request.
 *
 * Nil rather than NULL: a NULL owner reads as "we never knew", and the truth
 * is "we knew and were asked to forget" — a distinction a regulator and an
 * engineer both need. Nil rather than a fresh uuid per subject, because a
 * unique tombstone would still let rows be correlated back into one person,
 * which is re-identification with extra steps.
 */
export const TOMBSTONE = "00000000-0000-0000-0000-000000000000";

/** Severs the subject from their vouchers, leaving each voucher honourable. */
export function anonymiseVouchers(pool: pg.Pool): DomainHandler {
  return async (subjectId: string): Promise<number> => {
    const result = await pool.query(
      `UPDATE voucher.vouchers SET owner_id = $2 WHERE owner_id = $1`,
      [subjectId, TOMBSTONE],
    );
    return result.rowCount ?? 0;
  };
}

/**
 * Removes the subject from every business roster.
 *
 * `erase` rather than `anonymise`: a membership row is a statement about a
 * person and nothing else. Unlike a voucher it records no obligation to a
 * third party, so there is nothing left worth keeping once the person is
 * removed — an anonymised membership would be a row saying "somebody was an
 * analyst here", which is data with no subject and no purpose.
 */
export function eraseBusinessMemberships(pool: pg.Pool): DomainHandler {
  return async (subjectId: string): Promise<number> => {
    const result = await pool.query(`DELETE FROM business.business_members WHERE user_id = $1`, [
      subjectId,
    ]);
    return result.rowCount ?? 0;
  };
}

/**
 * The handlers this database can supply today.
 *
 * Deliberately NOT a complete registry. Passing it to `executeDeletion` still
 * produces an incomplete report, naming every domain that owes a handler —
 * which is the honest state and the thing that should stay visible until
 * each service ships its own.
 */
export function postgresHandlers(pool: pg.Pool): HandlerRegistry {
  return {
    vouchers: anonymiseVouchers(pool),
    // The domain map calls this `support_cases` and `identity` elsewhere;
    // business membership is part of the identity surface that exists now.
    identity: eraseBusinessMemberships(pool),
  };
}
