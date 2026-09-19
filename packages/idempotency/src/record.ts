import { z } from "zod";
import { idempotencyKeySchema, idempotencyScopeSchema } from "./key";

/**
 * One row of the shared idempotency table. YT-0039 AC1.
 *
 * `docs/10` §226 calls for *"a shared table and decorator, mandatory on every
 * value-moving endpoint"* — one table, every service, so a retry that lands
 * on a different service still finds the record.
 *
 * ## The two states, and why `in_progress` exists
 *
 * A naive implementation writes the record when the request FINISHES. That
 * leaves the window between "request started" and "request finished" wide
 * open: a client retrying on a timeout — which is exactly when clients retry
 * — finds no record and executes the operation a second time. Both run.
 *
 * So the record is written BEFORE the work, as `in_progress`, and a second
 * request arriving in that window is refused rather than executed.
 * `docs/12` notes that Stripe treats a raced request as safe to retry and
 * does not save it; we return a conflict, which tells the client to retry
 * later rather than leaving it to guess.
 *
 * ## Why completed 5xx responses are stored
 *
 * `docs/12`: the status and body of the first request are cached
 * **including 500s**. This reads wrong and is right. If a value operation
 * failed with a 500 after partially executing, replaying the key must
 * return that same 500 — not re-run the operation hoping for better. The
 * client's retry budget is not a reason to double-charge someone. A request
 * that failed VALIDATION is different: it never reached the value path, so
 * it is not stored and is safe to retry (see `idempotency.ts`).
 */
export const idempotencyStateSchema = z.enum(["in_progress", "completed"]);
export type IdempotencyState = z.infer<typeof idempotencyStateSchema>;

export const idempotencyRecordSchema = z
  .object({
    scope: idempotencyScopeSchema,
    key: idempotencyKeySchema,
    /** `requestFingerprint()`. A mismatch is a 409, never a replay. */
    fingerprint: z.string().length(64),
    state: idempotencyStateSchema,
    /** Present only once `state` is `completed`. */
    response: z
      .object({
        status: z.number().int().min(100).max(599),
        /** The response body as sent, verbatim. Replayed byte for byte. */
        body: z.string(),
      })
      .optional(),
    startedAt: z.iso.datetime({ offset: true }),
    /**
     * When this row may be pruned.
     *
     * `docs/14` §6 says a merchant redemption response is replayed for 24h.
     * `docs/12` sets a longer rule for vouchers — **the voucher's life plus
     * 30 days**, following Amazon's "resource lifetime plus a late-arrival
     * interval". Those are different numbers for different endpoints, so
     * retention is per-record rather than one global TTL. A single global
     * 24h would silently expire a voucher key that a merchant's queue
     * retries a week later, and the replay would become a second issuance.
     */
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((record) => record.state !== "completed" || record.response !== undefined, {
    message: "a completed record must carry the response it replays",
    path: ["response"],
  })
  .refine((record) => record.state !== "in_progress" || record.response === undefined, {
    message: "an in-progress record has no response yet",
    path: ["response"],
  });

export type IdempotencyRecord = z.infer<typeof idempotencyRecordSchema>;

/**
 * The shared table, as DDL, so every service creates the same one.
 *
 * Not executed by this package — `docs/14` §8 gives the migration job its own
 * DDL-only role and the app roles no DDL grant at all, so the app that
 * imports this must never run it. It lives here because the alternative is
 * the definition existing once per service and drifting.
 *
 * UNTESTED against a live Postgres: YT-0022 has not provisioned one.
 */
export const IDEMPOTENCY_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS idempotency (
  scope        text        NOT NULL,
  key          text        NOT NULL,
  fingerprint  char(64)    NOT NULL,
  state        text        NOT NULL CHECK (state IN ('in_progress', 'completed')),
  status       smallint,
  body         text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,

  PRIMARY KEY (scope, key),

  -- A completed row must carry what it replays, and an in-progress row must
  -- not pretend to. The same invariant as the Zod refinements above; stated
  -- twice on purpose, because the database is the only one of the two that
  -- a second service in another language is guaranteed to go through.
  CONSTRAINT completed_has_response CHECK (
    (state = 'completed' AND status IS NOT NULL AND body IS NOT NULL) OR
    (state = 'in_progress' AND status IS NULL AND body IS NULL)
  )
);

-- Pruning reads this; nothing else does.
CREATE INDEX IF NOT EXISTS idempotency_expires_at_idx ON idempotency (expires_at);
`;
