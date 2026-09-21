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
 * There is deliberately no DDL in this file.
 *
 * It used to export `IDEMPOTENCY_TABLE_DDL`, described as "the shared table,
 * as DDL, so every service creates the same one" and justified on the grounds
 * that "the alternative is the definition existing once per service and
 * drifting". Both halves turned out to be false, and in the way the comment
 * predicted:
 *
 *   - **Nothing imported it.** An anchored search across `apps/`,
 *     `packages/` and `services/` returned exactly one hit: its own
 *     definition. It was never a shared definition, only a second one.
 *   - **It had already drifted**, on day one, with a single service shipped.
 *     The real table comes from `packages/db/migrations/
 *     20260919000001_platform_idempotency.sql`, which creates
 *     `platform.idempotency` — schema-qualified, with named constraints, an
 *     `idempotency_key_length` CHECK and a GRANT. This constant created a
 *     bare `idempotency` with none of them.
 *
 * So the drift it existed to prevent was the thing it was. **A shared
 * definition that nothing imports is not shared; it is a second definition
 * with a comment claiming otherwise.**
 *
 * The migration is the single creator, and it is genuinely shared: one
 * database, one table, every service — including the Go implementation in
 * YT-0514 — reaching the same rows. `docs/14` §8 still holds, and is the
 * reason no DDL belongs in an application package at all: the migration job
 * has the only DDL-granted role, and the app roles have none.
 */
