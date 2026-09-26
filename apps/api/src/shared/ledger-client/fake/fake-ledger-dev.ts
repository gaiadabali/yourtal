import { sql } from "drizzle-orm";
import { ResultAsync, ok } from "neverthrow";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type {
  AdvanceHoldbackRequest,
  AdvanceHoldbackResult,
} from "@yourtal/contracts/ledger-internal/dev";
import type { AppDb } from "../../persistence/drizzle-client";

/**
 * The fake-mode half of `/dev/clock`'s holdback control (2.3.d/2.3.f) — this
 * is the logic `dev-clock.service.ts` used to run directly against
 * `platform.ledger_fake_grant`, moved here so that file calls the ONE
 * `LedgerInternalClient.advanceHoldback` method in both fake and live mode,
 * same as every other operation in this client.
 *
 * `shifted` and `released` differ exactly the way they do for the live
 * ledger: `shifted` is every still-pending grant this call touched;
 * `released` is how many of those are now actually due — computed in the
 * same `UPDATE ... RETURNING` statement, so the "is it due" comparison uses
 * the identical `now()` snapshot the `SET` itself used, not a second
 * round trip that could race it. A grant this call shifts but does not yet
 * clear (advancing fewer days than its holdback) is `shifted` but not
 * `released` — exactly `dev-clock.controller.test.ts`'s prior behaviour for
 * `advance-days`, preserved rather than changed by this move.
 *
 * `escrowHeld` is always false: this fake table never modeled the escrow
 * hold `ledger.escrow`/4.4.g has (there is a separate, unrelated
 * `platform.ledger_fake_escrow`, read only by `fake-ledger-balance.ts`'s own
 * pending calculation) — preserving prior behaviour rather than introducing
 * new semantics under this ticket.
 */
export function advanceHoldback(
  db: AppDb,
  request: AdvanceHoldbackRequest,
): ResultAsync<AdvanceHoldbackResult, LedgerError> {
  return new ResultAsync(
    (async () => {
      const result = request.releaseNow
        ? await db.execute<{ due: boolean }>(sql`
            UPDATE platform.ledger_fake_grant
               SET unlock_at = now()
             WHERE user_id = ${request.userId} AND unlock_at > now() AND NOT reversed
             RETURNING (unlock_at <= now()) AS due
          `)
        : await db.execute<{ due: boolean }>(sql`
            UPDATE platform.ledger_fake_grant
               SET unlock_at = unlock_at - (${request.days ?? 0} || ' days')::interval
             WHERE user_id = ${request.userId} AND unlock_at > now() AND NOT reversed
             RETURNING (unlock_at <= now()) AS due
          `);
      const shifted = result.rows.length;
      const released = result.rows.filter((row) => row.due).length;
      return ok({ shifted, released, escrowHeld: false });
    })(),
  );
}
